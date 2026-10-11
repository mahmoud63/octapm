const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { hasPermission } = require("../middleware/rbac");
const auditService = require("./audit.service");
const { isPartyScopedAccess } = require("./company-party.service");

/**
 * Project closeout / turnover (CLOSEOUT V1, 2026-10-11).
 *
 * Three things, all read from or recorded against the project's own records:
 *
 * - Readiness: what is still open on the punch list, the inspection and test
 *   plan, NCRs, submittals, RFIs, the drawing register, the subcontract
 *   closeouts, changes, IPCs and the schedule. Derived on every read, for the
 *   modules the caller may read, and never ticked by hand — close the punch
 *   item, pass the inspection. A check can be waived by the PM with a reason;
 *   the waiver is stored and audited and survives the records changing.
 * - The turnover package: deliverables handed to the owner (as-builts, O&M
 *   manuals, warranties, certificates, training, spares, keys, lien waivers),
 *   each submitted with evidence by the responsible party and accepted or
 *   rejected by a reviewer other than the submitter.
 * - The milestones: substantial completion, handover and final completion,
 *   recorded by a person with a date and a note. Handover needs every required
 *   deliverable settled and final completion needs every check clear too —
 *   unless the PM records an override with a reason. Nothing here closes,
 *   certifies, pays or releases anything in another module.
 */

const CATEGORIES = Object.freeze({
  as_built: "As-built drawings and records",
  om_manual: "Operation and maintenance manuals",
  warranty: "Warranties and guarantees",
  test_certificate: "Test certificates",
  commissioning: "Commissioning records",
  training: "Training",
  spares: "Spares and attic stock",
  keys: "Keys and access",
  authority_certificate: "Authority and occupancy certificates",
  lien_waiver: "Final lien waivers and releases",
  health_safety_file: "Health and safety file",
  other: "Other",
});
const CATEGORY_KEYS = Object.freeze(Object.keys(CATEGORIES));

/** The standard turnover list a project starts from; every row can be edited, waived or marked not applicable. */
const STANDARD = Object.freeze([
  { category: "as_built", title: "As-built drawings (all disciplines)" },
  { category: "om_manual", title: "Operation and maintenance manuals" },
  { category: "warranty", title: "Main contractor workmanship warranty", warrantyMonths: 12 },
  { category: "test_certificate", title: "Test certificates (MEP, fire, structural)" },
  { category: "commissioning", title: "Commissioning records and sign-off" },
  { category: "training", title: "Owner's staff training on building systems" },
  { category: "spares", title: "Spares and attic stock", required: false },
  { category: "keys", title: "Keys, access cards and codes" },
  { category: "authority_certificate", title: "Completion / occupancy certificate from the authority" },
  { category: "lien_waiver", title: "Final lien waivers and releases" },
  { category: "health_safety_file", title: "Health and safety file" },
]);

const STATUS = Object.freeze({
  OUTSTANDING: "outstanding",
  SUBMITTED: "submitted",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  WAIVED: "waived",
  NOT_APPLICABLE: "not_applicable",
});
const STATUSES = Object.freeze(Object.values(STATUS));
const SETTLED = Object.freeze([STATUS.ACCEPTED, STATUS.WAIVED, STATUS.NOT_APPLICABLE]);

const MILESTONES = Object.freeze(["substantial_completion", "handover", "final_completion"]);
const MILESTONE_STATUS = Object.freeze({
  substantial_completion: "substantially_complete",
  handover: "handed_over",
  final_completion: "final_complete",
});
const MILESTONE_LABEL = Object.freeze({
  substantial_completion: "Substantial completion",
  handover: "Handover to the owner",
  final_completion: "Final completion",
});
const MILESTONE_FIELDS = Object.freeze({
  substantial_completion: ["substantialCompletionAt", "substantialCompletionBy", "substantialCompletionNote"],
  handover: ["handoverAt", "handoverBy", "handoverNote"],
  final_completion: ["finalCompletionAt", "finalCompletionBy", "finalCompletionNote"],
});

const EXPIRING_DAYS = 90;
/** The attachment record type a deliverable's evidence is filed under. */
const EVIDENCE_TYPE = "closeout_deliverable";
const DAY_MS = 24 * 60 * 60 * 1000;

const text = (value) => {
  const out = String(value ?? "").trim();
  return out || null;
};
const iso = (value) => (value ? new Date(value).toISOString() : null);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

// ─── viewer ────────────────────────────────────────────────────────────────

/**
 * The caller as the route sees them: their permission decisions (req), id and
 * project access. A party-scoped person (a subcontractor) sees only the
 * deliverables their company is responsible for, and none of the readiness
 * checks — those read the whole project.
 */
const viewerOf = (req) => ({
  req,
  id: req.user.id,
  partyScoped: isPartyScopedAccess(req.projectAccess || {}),
  companyIds: [...new Set((req.projectAccess?.partyAccess || []).map((party) => party.companyId).filter(Boolean))],
});

const deliverableScope = (viewer) => {
  if (!viewer?.partyScoped) return {};
  return {
    OR: [
      ...(viewer.companyIds.length ? [{ responsibleCompanyId: { in: viewer.companyIds } }] : []),
      { responsibleUserId: viewer.id },
      { createdBy: viewer.id },
    ],
  };
};

// ─── readiness (derived) ───────────────────────────────────────────────────

const refs = (rows, field = "ref") => rows.slice(0, 8).map((row) => row[field]).filter(Boolean);

/**
 * Each check names the permission module it reads; it runs only when the
 * caller can read that module (authorisation before retrieval).
 */
const CHECKS = Object.freeze([
  {
    key: "punch_closed",
    label: "Punch list closed",
    module: "punch",
    run: async ({ projectId }) => {
      const open = await prisma.punchItem.findMany({ where: { projectId, kind: "punch", status: { notIn: ["closed", "void"] } }, select: { ref: true, status: true }, orderBy: { number: "asc" } });
      return { open: open.length, refs: refs(open), detail: open.length ? `${plural(open.length, "punch item")} not closed` : "No open punch items" };
    },
  },
  {
    key: "inspections_passed",
    label: "Inspections passed",
    module: "inspection",
    run: async ({ projectId }) => {
      const rows = await prisma.itpRecord.findMany({ where: { projectId, status: { in: ["pending", "failed"] } }, select: { ref: true, status: true }, orderBy: { ref: "asc" } });
      const failed = rows.filter((row) => row.status === "failed").length;
      return { open: rows.length, refs: refs(rows), detail: rows.length ? `${plural(rows.length - failed, "inspection")} pending, ${failed} failed` : "Every inspection point passed or waived" };
    },
  },
  {
    key: "ncrs_closed",
    label: "NCRs closed",
    module: "ncr",
    run: async ({ projectId }) => {
      const rows = await prisma.ncrRecord.findMany({ where: { projectId, status: { notIn: ["closed", "void", "cancelled"] } }, select: { ref: true, severity: true }, orderBy: { ref: "asc" } });
      const major = rows.filter((row) => row.severity === "major").length;
      return { open: rows.length, refs: refs(rows), detail: rows.length ? `${plural(rows.length, "NCR")} open (${major} major)` : "No open NCRs" };
    },
  },
  {
    key: "submittals_closed",
    label: "Submittals approved or closed",
    module: "submittal",
    run: async ({ projectId }) => {
      const rows = await prisma.submittal.findMany({ where: { projectId, archivedAt: null, status: { in: ["pending", "under_review", "resubmit"] } }, select: { ref: true }, orderBy: { ref: "asc" } });
      return { open: rows.length, refs: refs(rows), detail: rows.length ? `${plural(rows.length, "submittal")} pending, in review or to resubmit` : "No submittal is waiting" };
    },
  },
  {
    key: "rfis_closed",
    label: "RFIs closed",
    module: "rfi",
    run: async ({ projectId }) => {
      const rows = await prisma.rfi.findMany({ where: { projectId, status: { not: "closed" } }, select: { ref: true, status: true }, orderBy: { ref: "asc" } });
      const answered = rows.filter((row) => row.status === "answered").length;
      return { open: rows.length, refs: refs(rows), detail: rows.length ? `${plural(rows.length, "RFI")} not closed (${answered} answered, awaiting close)` : "Every RFI is closed" };
    },
  },
  {
    key: "as_built_drawings",
    label: "Current drawings issued as-built",
    module: "document_control",
    run: async ({ projectId }) => {
      const rows = await prisma.drawingRecord.findMany({ where: { projectId, status: "active" }, select: { ref: true, drawingNumber: true, purpose: true }, orderBy: { drawingNumber: "asc" } });
      const notAsBuilt = rows.filter((row) => !/as[\s-]?built/i.test(row.purpose || ""));
      return { open: notAsBuilt.length, refs: refs(notAsBuilt, "drawingNumber"), detail: !rows.length ? "No drawings are registered" : notAsBuilt.length ? `${notAsBuilt.length} of ${rows.length} current drawings not issued as-built` : `All ${rows.length} current drawings issued as-built` };
    },
  },
  {
    key: "subcontracts_closed",
    label: "Subcontract closeouts complete",
    module: "commitment",
    run: async ({ projectId }) => {
      const rows = await prisma.commitment.findMany({ where: { projectId, type: "subcontract", status: { notIn: ["draft", "void"] } }, select: { id: true, ref: true } });
      const done = rows.length ? await prisma.subcontractCloseout.findMany({ where: { commitmentId: { in: rows.map((row) => row.id) }, status: "complete" }, select: { commitmentId: true } }) : [];
      const closed = new Set(done.map((row) => row.commitmentId));
      const open = rows.filter((row) => !closed.has(row.id));
      return { open: open.length, refs: refs(open), detail: !rows.length ? "No subcontracts" : open.length ? `${open.length} of ${rows.length} subcontract closeouts not complete` : `All ${rows.length} subcontract closeouts complete` };
    },
  },
  {
    key: "change_orders_decided",
    label: "Change orders decided",
    module: "change_order",
    run: async ({ projectId }) => {
      const rows = await prisma.changeOrder.findMany({ where: { projectId, status: { in: ["draft", "pending"] } }, select: { ref: true }, orderBy: { ref: "asc" } });
      return { open: rows.length, refs: refs(rows), detail: rows.length ? `${plural(rows.length, "change order")} still draft or pending` : "No change order awaits a decision" };
    },
  },
  {
    key: "change_events_resolved",
    label: "Change events resolved",
    module: "change_event",
    run: async ({ projectId }) => {
      const rows = await prisma.changeEvent.findMany({ where: { projectId, status: { in: ["open", "pricing", "priced"] } }, select: { ref: true }, orderBy: { ref: "asc" } });
      return { open: rows.length, refs: refs(rows), detail: rows.length ? `${plural(rows.length, "change event")} open, being priced or priced` : "No open change events" };
    },
  },
  {
    key: "ipcs_settled",
    label: "Payment certificates settled",
    module: "ipc",
    run: async ({ projectId }) => {
      const rows = await prisma.ipcCertificate.findMany({ where: { projectId }, select: { status: true, retentionStatus: true, paymentStatus: true } });
      const inFlight = rows.filter((row) => ["draft", "submitted"].includes(row.status)).length;
      const unpaid = rows.filter((row) => row.status === "certified" && row.paymentStatus !== "paid").length;
      const retention = rows.filter((row) => ["certified", "paid"].includes(row.status) && row.retentionStatus !== "released").length;
      const open = inFlight + unpaid;
      return { open, refs: [], detail: `${plural(inFlight, "certificate")} draft or submitted, ${unpaid} certified and not fully paid; retention still held on ${plural(retention, "certificate")} (released under the contract, not here)` };
    },
  },
  {
    key: "schedule_complete",
    label: "Activities complete (official progress)",
    module: "progress",
    run: async ({ projectId }) => {
      const activities = await prisma.activity.findMany({ where: { projectId }, select: { id: true, activityCode: true, physComplete: true } });
      if (!activities.length) return { open: 0, refs: [], detail: "No activities" };
      const approved = await prisma.activityProgress.findMany({ where: { activityId: { in: activities.map((row) => row.id) }, status: "approved" }, orderBy: [{ approvedAt: "desc" }, { updatedAt: "desc" }], select: { activityId: true, pctComplete: true } });
      const latest = new Map();
      for (const row of approved) if (!latest.has(row.activityId)) latest.set(row.activityId, Number(row.pctComplete));
      const open = activities.filter((row) => (latest.get(row.id) ?? Number(row.physComplete || 0)) < 100);
      return { open: open.length, refs: refs(open, "activityCode"), detail: open.length ? `${open.length} of ${activities.length} activities below 100% official progress` : `All ${activities.length} activities complete` };
    },
  },
]);
const CHECK_KEYS = Object.freeze(CHECKS.map((check) => check.key));

const loadRecord = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  const record = await prisma.projectCloseout.findUnique({ where: { projectId } });
  return { project, record };
};

const ensureRecord = async ({ orgId, projectId, userId }) => {
  const { record } = await loadRecord({ orgId, projectId });
  if (record) return record;
  return prisma.projectCloseout.upsert({ where: { projectId }, create: { orgId, projectId, createdBy: userId, updatedBy: userId }, update: {} });
};

const readiness = async ({ projectId, viewer, waivers = {} }) => {
  if (viewer.partyScoped) return [];
  const out = [];
  for (const check of CHECKS) {
    const waiver = waivers[check.key] || null;
    if (!hasPermission(viewer.req, check.module, "read")) {
      out.push({ key: check.key, label: check.label, module: check.module, visible: false, status: "restricted", open: null, refs: [], detail: "You cannot read this module on the project", waiver });
      continue;
    }
    const result = await check.run({ projectId });
    out.push({ key: check.key, label: check.label, module: check.module, visible: true, status: waiver ? "waived" : result.open ? "open" : "clear", ...result, waiver });
  }
  return out;
};

// ─── deliverables ──────────────────────────────────────────────────────────

const warrantyState = (row, now = new Date()) => {
  if (row.category !== "warranty") return null;
  if (!row.warrantyEnd) return { state: row.warrantyStart ? "open_ended" : "not_started", daysLeft: null };
  const daysLeft = Math.ceil((new Date(row.warrantyEnd) - now) / DAY_MS);
  if (row.warrantyStart && new Date(row.warrantyStart) > now) return { state: "not_started", daysLeft };
  return { state: daysLeft < 0 ? "expired" : daysLeft <= EXPIRING_DAYS ? "expiring" : "active", daysLeft };
};

const addMonths = (date, months) => {
  const out = new Date(date);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
};

const docIds = (row) => (Array.isArray(row.documentIdsJson) ? row.documentIdsJson.filter((id) => typeof id === "string") : []);

const decorate = async (rows) => {
  const ids = (pick) => [...new Set(rows.map(pick).filter(Boolean))];
  const userIds = ids((row) => row.submittedBy).concat(ids((row) => row.reviewedBy), ids((row) => row.responsibleUserId));
  const [companies, users, activities, locations, documents] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: ids((row) => row.responsibleCompanyId) } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true } }),
    prisma.activity.findMany({ where: { id: { in: ids((row) => row.activityId) } }, select: { id: true, activityCode: true, name: true } }),
    prisma.location.findMany({ where: { id: { in: ids((row) => row.locationId) } }, select: { id: true, name: true } }),
    rows.length ? prisma.attachment.findMany({ where: { recordType: EVIDENCE_TYPE, recordId: { in: rows.map((row) => row.id) } }, orderBy: { createdAt: "asc" }, select: { recordId: true, documentId: true, document: { select: { title: true, originalName: true, documentNumber: true } } } }) : [],
  ]);
  const name = (list) => new Map(list.map((item) => [item.id, item.name]));
  const companyName = name(companies);
  const userName = name(users);
  const locationName = name(locations);
  const activityLabel = new Map(activities.map((item) => [item.id, `${item.activityCode ? `${item.activityCode} ` : ""}${item.name}`]));
  const evidenceOf = new Map();
  for (const item of documents) evidenceOf.set(item.recordId, [...(evidenceOf.get(item.recordId) || []), { id: item.documentId, label: item.document?.title || item.document?.documentNumber || item.document?.originalName || "Document" }]);
  return rows.map((row) => ({
    id: row.id,
    ref: row.ref,
    category: row.category,
    categoryLabel: CATEGORIES[row.category] || row.category,
    title: row.title,
    description: row.description,
    required: row.required,
    status: row.status,
    settled: SETTLED.includes(row.status),
    responsibleCompanyId: row.responsibleCompanyId,
    responsibleCompany: companyName.get(row.responsibleCompanyId) || null,
    responsibleUserId: row.responsibleUserId,
    responsibleUser: userName.get(row.responsibleUserId) || null,
    activityId: row.activityId,
    activity: activityLabel.get(row.activityId) || null,
    locationId: row.locationId,
    location: locationName.get(row.locationId) || null,
    dueDate: iso(row.dueDate),
    overdue: Boolean(row.dueDate && !SETTLED.includes(row.status) && row.status !== STATUS.SUBMITTED && new Date(row.dueDate) < new Date()),
    warrantyStart: iso(row.warrantyStart),
    warrantyMonths: row.warrantyMonths,
    warrantyEnd: iso(row.warrantyEnd),
    warranty: warrantyState(row),
    documents: evidenceOf.get(row.id) || [],
    submittedDocumentIds: docIds(row),
    submittedAt: iso(row.submittedAt),
    submittedBy: userName.get(row.submittedBy) || null,
    reviewedAt: iso(row.reviewedAt),
    reviewedBy: userName.get(row.reviewedBy) || null,
    reviewComment: row.reviewComment,
    waivedReason: row.waivedReason,
    updatedAt: iso(row.updatedAt),
  }));
};

const listDeliverables = async ({ orgId, projectId, viewer, query = {} }) => {
  await loadRecord({ orgId, projectId });
  const where = { projectId, orgId, ...deliverableScope(viewer) };
  if (query.status) where.status = query.status;
  if (query.category) where.category = query.category;
  const rows = await prisma.closeoutDeliverable.findMany({ where, orderBy: [{ number: "asc" }] });
  return { items: await decorate(rows), categories: CATEGORIES, statuses: STATUSES };
};

const findDeliverable = async ({ orgId, projectId, id, viewer }) => {
  const row = await prisma.closeoutDeliverable.findFirst({ where: { id, projectId, orgId, ...deliverableScope(viewer) } });
  if (!row) throw new HttpError(404, "CLOSEOUT_DELIVERABLE_NOT_FOUND", "Deliverable not found");
  return row;
};

const getDeliverable = async (args) => (await decorate([await findDeliverable(args)]))[0];

/** The references a deliverable names must belong to the project: a company on it, a project activity and location. */
const assertReferences = async ({ orgId, projectId, data }) => {
  if (data.responsibleCompanyId) {
    const party = await prisma.projectParty.findFirst({ where: { projectId, companyId: data.responsibleCompanyId, status: "active" }, select: { id: true } });
    if (!party) throw new HttpError(400, "CLOSEOUT_COMPANY_NOT_ON_PROJECT", "The responsible company is not a party on this project");
  }
  if (data.responsibleUserId) {
    const member =
      (await prisma.projectAssignment.findFirst({ where: { projectId, userId: data.responsibleUserId }, select: { id: true } })) ||
      (await prisma.organizationMembership.findFirst({ where: { orgId, userId: data.responsibleUserId }, select: { id: true } })) ||
      (await prisma.projectPartyMember.findFirst({ where: { userId: data.responsibleUserId, status: "active", projectParty: { projectId, status: "active" } }, select: { id: true } }));
    if (!member) throw new HttpError(400, "CLOSEOUT_USER_NOT_ON_PROJECT", "The responsible person is not on this project");
  }
  if (data.activityId && !(await prisma.activity.findFirst({ where: { id: data.activityId, projectId }, select: { id: true } }))) throw new HttpError(400, "ACTIVITY_NOT_FOUND", "Activity not found on this project");
  if (data.locationId && !(await prisma.location.findFirst({ where: { id: data.locationId, projectId }, select: { id: true } }))) throw new HttpError(400, "LOCATION_NOT_FOUND", "Location not found on this project");
};

const fieldsFrom = (payload, existing = null) => {
  const data = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  if (has("category")) data.category = payload.category;
  if (has("title")) data.title = text(payload.title);
  if (has("description")) data.description = text(payload.description);
  if (has("required")) data.required = Boolean(payload.required);
  for (const key of ["responsibleCompanyId", "responsibleUserId", "activityId", "locationId"]) if (has(key)) data[key] = text(payload[key]);
  for (const key of ["dueDate", "warrantyStart", "warrantyEnd"]) if (has(key)) data[key] = payload[key] ? new Date(payload[key]) : null;
  if (has("warrantyMonths")) data.warrantyMonths = payload.warrantyMonths === null || payload.warrantyMonths === "" ? null : Number(payload.warrantyMonths);
  // A warranty's end is its start plus its period unless an end date is given.
  const start = has("warrantyStart") ? data.warrantyStart : existing?.warrantyStart;
  const months = has("warrantyMonths") ? data.warrantyMonths : existing?.warrantyMonths;
  if (!has("warrantyEnd") && (has("warrantyStart") || has("warrantyMonths"))) data.warrantyEnd = start && months ? addMonths(start, months) : null;
  return data;
};

const audit = (event) => auditService.recordEvent(event).catch(() => null);

const nextNumber = async (projectId) => ((await prisma.closeoutDeliverable.aggregate({ where: { projectId }, _max: { number: true } }))._max.number || 0) + 1;

const createRow = async ({ orgId, projectId, userId, data }) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const number = await nextNumber(projectId);
    try {
      return await prisma.closeoutDeliverable.create({ data: { orgId, projectId, number, ref: `TO-${String(number).padStart(3, "0")}`, createdBy: userId, updatedBy: userId, ...data } });
    } catch (error) {
      if (error?.code !== "P2002" || attempt === 2) throw error;
    }
  }
  return null;
};

const createDeliverable = async ({ orgId, projectId, viewer, payload }) => {
  await ensureRecord({ orgId, projectId, userId: viewer.id });
  const data = fieldsFrom(payload);
  if (!data.title) throw new HttpError(400, "CLOSEOUT_TITLE_REQUIRED", "Give the deliverable a title");
  if (!CATEGORY_KEYS.includes(data.category)) throw new HttpError(400, "CLOSEOUT_CATEGORY_INVALID", "Unknown deliverable category");
  await assertReferences({ orgId, projectId, data });
  const row = await createRow({ orgId, projectId, userId: viewer.id, data });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CLOSEOUT_DELIVERABLE, entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: viewer.id, summary: { ref: row.ref, category: row.category, title: row.title } });
  return getDeliverable({ orgId, projectId, id: row.id, viewer });
};

/** Adds the standard turnover list, skipping any category/title already on the project. */
const addStandardList = async ({ orgId, projectId, viewer }) => {
  await ensureRecord({ orgId, projectId, userId: viewer.id });
  const existing = await prisma.closeoutDeliverable.findMany({ where: { projectId }, select: { category: true, title: true } });
  const seen = new Set(existing.map((row) => `${row.category}:${row.title.toLowerCase()}`));
  let added = 0;
  for (const item of STANDARD) {
    if (seen.has(`${item.category}:${item.title.toLowerCase()}`)) continue;
    await createRow({ orgId, projectId, userId: viewer.id, data: { category: item.category, title: item.title, required: item.required !== false, warrantyMonths: item.warrantyMonths ?? null } });
    added += 1;
  }
  if (added) await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.PROJECT_CLOSEOUT, entityId: projectId, action: auditService.ACTIONS.CREATED, actorId: viewer.id, summary: { transition: "closeout.standard_list", added } });
  return { added, ...(await listDeliverables({ orgId, projectId, viewer })) };
};

const LOCKED = [STATUS.ACCEPTED, STATUS.WAIVED, STATUS.NOT_APPLICABLE];

const updateDeliverable = async ({ orgId, projectId, viewer, id, payload }) => {
  const row = await findDeliverable({ orgId, projectId, id, viewer });
  if (LOCKED.includes(row.status)) throw new HttpError(409, "CLOSEOUT_DELIVERABLE_SETTLED", "This deliverable is settled; reopen it before changing it");
  const data = fieldsFrom(payload, row);
  if (Object.prototype.hasOwnProperty.call(data, "title") && !data.title) throw new HttpError(400, "CLOSEOUT_TITLE_REQUIRED", "Give the deliverable a title");
  if (data.category && !CATEGORY_KEYS.includes(data.category)) throw new HttpError(400, "CLOSEOUT_CATEGORY_INVALID", "Unknown deliverable category");
  // A party-scoped person updates their own deliverable's details; they cannot hand it to another company.
  if (viewer.partyScoped && (data.responsibleCompanyId !== undefined || data.required !== undefined)) throw new HttpError(403, "FORBIDDEN", "Only the project team can reassign a deliverable or change whether it is required");
  await assertReferences({ orgId, projectId, data });
  await prisma.closeoutDeliverable.update({ where: { id: row.id }, data: { ...data, updatedBy: viewer.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CLOSEOUT_DELIVERABLE, entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: viewer.id, summary: { ref: row.ref, fields: Object.keys(data) } });
  return getDeliverable({ orgId, projectId, id: row.id, viewer });
};

const deleteDeliverable = async ({ orgId, projectId, viewer, id }) => {
  const row = await findDeliverable({ orgId, projectId, id, viewer });
  const attached = await prisma.attachment.count({ where: { projectId, recordType: EVIDENCE_TYPE, recordId: row.id } });
  if (row.status !== STATUS.OUTSTANDING || attached || docIds(row).length) throw new HttpError(409, "CLOSEOUT_DELIVERABLE_IN_USE", "Only an outstanding deliverable with no evidence can be deleted; waive it or mark it not applicable instead");
  await prisma.closeoutDeliverable.delete({ where: { id: row.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CLOSEOUT_DELIVERABLE, entityId: row.id, action: auditService.ACTIONS.DELETED, actorId: viewer.id, summary: { ref: row.ref, title: row.title } });
  return { deleted: true };
};

/**
 * Submits a deliverable. Its evidence is the files attached to it
 * (attachments on closeout_deliverable, uploaded or linked through the
 * attachment panel under the attachment rules); documentIds named here are
 * linked first, through the same rules. The ids reviewed are kept on the row.
 */
const submitDeliverable = async ({ orgId, projectId, viewer, id, documentIds = [], note = null }) => {
  const row = await findDeliverable({ orgId, projectId, id, viewer });
  if (![STATUS.OUTSTANDING, STATUS.REJECTED].includes(row.status)) throw new HttpError(409, "CLOSEOUT_DELIVERABLE_NOT_OPEN", `This deliverable is ${row.status.replace("_", " ")}; only an outstanding or rejected one can be submitted`);
  const named = [...new Set((documentIds || []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
  if (named.length) {
    const notFound = () => new HttpError(404, "DOCUMENT_NOT_FOUND", "Evidence document not found");
    await require("./document-text.service").assertDocumentsLinkable({ orgId, projectId, keys: named, unchanged: [], userId: viewer.id, refuse: notFound });
    await require("./attachment.service").createAttachments({ orgId, projectId, userId: viewer.id, recordType: EVIDENCE_TYPE, recordId: row.id, role: "evidence", documentIds: named });
  }
  const evidence = await prisma.attachment.findMany({ where: { projectId, recordType: EVIDENCE_TYPE, recordId: row.id }, select: { documentId: true } });
  const ids = [...new Set(evidence.map((item) => item.documentId))];
  if (!ids.length) throw new HttpError(400, "CLOSEOUT_EVIDENCE_REQUIRED", "Attach the evidence first: at least one file");
  await prisma.closeoutDeliverable.update({ where: { id: row.id }, data: { status: STATUS.SUBMITTED, documentIdsJson: ids, submittedAt: new Date(), submittedBy: viewer.id, reviewedAt: null, reviewedBy: null, updatedBy: viewer.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CLOSEOUT_DELIVERABLE, entityId: row.id, action: auditService.ACTIONS.STATUS_CHANGED, actorId: viewer.id, oldStatus: row.status, newStatus: STATUS.SUBMITTED, reason: text(note), summary: { transition: "closeout.submit", ref: row.ref, documents: ids.length } });
  return getDeliverable({ orgId, projectId, id: row.id, viewer });
};

/** Accepts or rejects a submitted deliverable. The reviewer is not the submitter; a rejection says why. */
const reviewDeliverable = async ({ orgId, projectId, viewer, id, decision, comment = null }) => {
  const row = await findDeliverable({ orgId, projectId, id, viewer });
  if (row.status !== STATUS.SUBMITTED) throw new HttpError(409, "CLOSEOUT_DELIVERABLE_NOT_SUBMITTED", "Only a submitted deliverable can be accepted or rejected");
  if (row.submittedBy && row.submittedBy === viewer.id) throw new HttpError(409, "CLOSEOUT_SELF_REVIEW", "Someone other than the submitter must review this deliverable");
  if (decision === "reject" && !text(comment)) throw new HttpError(400, "CLOSEOUT_REJECT_REASON_REQUIRED", "Say why the deliverable is rejected");
  const status = decision === "accept" ? STATUS.ACCEPTED : STATUS.REJECTED;
  await prisma.closeoutDeliverable.update({ where: { id: row.id }, data: { status, reviewedAt: new Date(), reviewedBy: viewer.id, reviewComment: text(comment), updatedBy: viewer.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CLOSEOUT_DELIVERABLE, entityId: row.id, action: decision === "accept" ? auditService.ACTIONS.APPROVED : auditService.ACTIONS.REJECTED, actorId: viewer.id, oldStatus: row.status, newStatus: status, reason: text(comment), summary: { transition: `closeout.${decision}`, ref: row.ref } });
  return getDeliverable({ orgId, projectId, id: row.id, viewer });
};

/** Waives a deliverable or marks it not applicable, with a reason (PM). */
const waiveDeliverable = async ({ orgId, projectId, viewer, id, status, reason }) => {
  const row = await findDeliverable({ orgId, projectId, id, viewer });
  if (![STATUS.WAIVED, STATUS.NOT_APPLICABLE].includes(status)) throw new HttpError(400, "CLOSEOUT_STATUS_INVALID", "Waive or mark not applicable");
  if (!text(reason)) throw new HttpError(400, "CLOSEOUT_WAIVER_REASON_REQUIRED", "Say why");
  if (row.status === STATUS.ACCEPTED) throw new HttpError(409, "CLOSEOUT_DELIVERABLE_SETTLED", "This deliverable is accepted; reopen it first");
  await prisma.closeoutDeliverable.update({ where: { id: row.id }, data: { status, waivedReason: text(reason), reviewedAt: new Date(), reviewedBy: viewer.id, updatedBy: viewer.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CLOSEOUT_DELIVERABLE, entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: viewer.id, oldStatus: row.status, newStatus: status, reason: text(reason), summary: { transition: "closeout.waive", ref: row.ref } });
  return getDeliverable({ orgId, projectId, id: row.id, viewer });
};

/** Puts a settled or rejected deliverable back to outstanding, with a reason; its evidence stays. */
const reopenDeliverable = async ({ orgId, projectId, viewer, id, reason }) => {
  const row = await findDeliverable({ orgId, projectId, id, viewer });
  if (row.status === STATUS.OUTSTANDING) return getDeliverable({ orgId, projectId, id: row.id, viewer });
  if (!text(reason)) throw new HttpError(400, "CLOSEOUT_REOPEN_REASON_REQUIRED", "Say why the deliverable is reopened");
  await prisma.closeoutDeliverable.update({ where: { id: row.id }, data: { status: STATUS.OUTSTANDING, waivedReason: null, reviewedAt: null, reviewedBy: null, reviewComment: text(reason), updatedBy: viewer.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CLOSEOUT_DELIVERABLE, entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: viewer.id, oldStatus: row.status, newStatus: STATUS.OUTSTANDING, reason: text(reason), summary: { transition: "closeout.reopen", ref: row.ref } });
  return getDeliverable({ orgId, projectId, id: row.id, viewer });
};

// ─── the whole picture and the gates ───────────────────────────────────────

const deliverableSummary = (items) => {
  const required = items.filter((row) => row.required);
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, items.filter((row) => row.status === status).length]));
  const byCategory = CATEGORY_KEYS.map((key) => {
    const rows = items.filter((row) => row.category === key);
    return { category: key, label: CATEGORIES[key], total: rows.length, settled: rows.filter((row) => row.settled).length };
  }).filter((row) => row.total);
  return {
    total: items.length,
    required: required.length,
    requiredSettled: required.filter((row) => row.settled).length,
    settledPct: required.length ? Math.round((required.filter((row) => row.settled).length / required.length) * 1000) / 10 : 0,
    overdue: items.filter((row) => row.overdue).length,
    byStatus,
    byCategory,
  };
};

const warrantySummary = (items) => {
  const rows = items.filter((row) => row.category === "warranty");
  const count = (state) => rows.filter((row) => row.warranty?.state === state).length;
  return { total: rows.length, active: count("active"), expiring: count("expiring"), expired: count("expired"), notStarted: count("not_started"), expiringDays: EXPIRING_DAYS };
};

const milestoneOf = (record, users, key) => {
  const [at, by, note] = MILESTONE_FIELDS[key];
  return { key, label: MILESTONE_LABEL[key], at: iso(record?.[at]), by: users.get(record?.[by]) || null, note: record?.[note] || null };
};

const gates = ({ checks, items, record }) => {
  const outstandingDeliverables = items.filter((row) => row.required && !row.settled).map((row) => `${row.ref} ${row.title}`);
  const blockingChecks = checks.filter((check) => check.status === "open" || check.status === "restricted").map((check) => `${check.label}: ${check.detail}`);
  const reached = (key) => Boolean(record?.[MILESTONE_FIELDS[key][0]]);
  return {
    substantial_completion: { ready: true, outstanding: [], recorded: reached("substantial_completion"), requires: [] },
    handover: { ready: outstandingDeliverables.length === 0 && reached("substantial_completion"), outstanding: [...(reached("substantial_completion") ? [] : ["Substantial completion is not recorded"]), ...outstandingDeliverables], recorded: reached("handover"), requires: ["substantial_completion"] },
    final_completion: { ready: reached("handover") && !outstandingDeliverables.length && !blockingChecks.length, outstanding: [...(reached("handover") ? [] : ["Handover is not recorded"]), ...outstandingDeliverables, ...blockingChecks], recorded: reached("final_completion"), requires: ["handover"] },
  };
};

const overview = async ({ orgId, projectId, viewer }) => {
  const { project, record } = await loadRecord({ orgId, projectId });
  const waivers = record?.checkWaiversJson && typeof record.checkWaiversJson === "object" ? record.checkWaiversJson : {};
  const [checks, deliverables] = await Promise.all([
    readiness({ projectId, viewer, waivers }),
    listDeliverables({ orgId, projectId, viewer }),
  ]);
  const items = deliverables.items;
  const userIds = record ? [record.substantialCompletionBy, record.handoverBy, record.finalCompletionBy].filter(Boolean) : [];
  const users = new Map((userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []).map((user) => [user.id, user.name]));
  const visible = checks.filter((check) => check.visible);
  return {
    project: { id: project.id, name: project.name },
    status: record?.status || "in_progress",
    milestones: MILESTONES.map((key) => milestoneOf(record, users, key)),
    readiness: {
      checks,
      clear: visible.filter((check) => check.status === "clear").length,
      waived: visible.filter((check) => check.status === "waived").length,
      open: visible.filter((check) => check.status === "open").length,
      restricted: checks.filter((check) => !check.visible).length,
      note: viewer.partyScoped ? "Readiness reads the whole project; a party sees only its own deliverables." : null,
    },
    deliverables: deliverableSummary(items),
    warranties: warrantySummary(items),
    gates: viewer.partyScoped ? null : gates({ checks, items, record }),
  };
};

/** Waives one readiness check with a reason (PM), or clears the waiver. Stored and audited. */
const setCheckWaiver = async ({ orgId, projectId, viewer, key, reason, clear = false }) => {
  if (!CHECK_KEYS.includes(key)) throw new HttpError(404, "CLOSEOUT_CHECK_UNKNOWN", `No readiness check called "${key}"`);
  if (!clear && !text(reason)) throw new HttpError(400, "CLOSEOUT_WAIVER_REASON_REQUIRED", "Say why the check is waived");
  const record = await ensureRecord({ orgId, projectId, userId: viewer.id });
  const waivers = { ...(record.checkWaiversJson || {}) };
  if (clear) delete waivers[key];
  else waivers[key] = { reason: text(reason), by: viewer.id, at: new Date().toISOString() };
  await prisma.projectCloseout.update({ where: { id: record.id }, data: { checkWaiversJson: waivers, updatedBy: viewer.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.PROJECT_CLOSEOUT, entityId: record.id, action: auditService.ACTIONS.UPDATED, actorId: viewer.id, reason: text(reason), summary: { transition: clear ? "closeout.check_unwaive" : "closeout.check_waive", key } });
  return overview({ orgId, projectId, viewer });
};

/**
 * Records a milestone. Handover and final completion refuse while their gate
 * names anything outstanding, unless an override reason is given by someone
 * holding closeout.override; the outstanding list is kept in the audit.
 */
const recordMilestone = async ({ orgId, projectId, viewer, milestone, date = null, note = null, override = null, canOverride = false }) => {
  if (!MILESTONES.includes(milestone)) throw new HttpError(404, "CLOSEOUT_MILESTONE_UNKNOWN", "Unknown milestone");
  const record = await ensureRecord({ orgId, projectId, userId: viewer.id });
  const [atField, byField, noteField] = MILESTONE_FIELDS[milestone];
  if (record[atField]) throw new HttpError(409, "CLOSEOUT_MILESTONE_RECORDED", `${MILESTONE_LABEL[milestone]} is already recorded; reopen it to change it`);
  const current = await overview({ orgId, projectId, viewer });
  const gate = current.gates?.[milestone];
  const previous = MILESTONES[MILESTONES.indexOf(milestone) - 1];
  if (previous && !record[MILESTONE_FIELDS[previous][0]]) throw new HttpError(409, "CLOSEOUT_MILESTONE_ORDER", `Record ${MILESTONE_LABEL[previous].toLowerCase()} first`);
  const overrideReason = text(override);
  if (gate && !gate.ready) {
    if (!overrideReason) {
      const error = new HttpError(409, "CLOSEOUT_OUTSTANDING", `${MILESTONE_LABEL[milestone]} cannot be recorded: ${plural(gate.outstanding.length, "item is", "items are")} outstanding`);
      error.details = { outstanding: gate.outstanding };
      throw error;
    }
    if (!canOverride) throw new HttpError(403, "FORBIDDEN", "Only someone allowed to override closeout can record this with items outstanding");
  }
  const when = date ? new Date(date) : new Date();
  if (Number.isNaN(when.getTime())) throw new HttpError(400, "VALIDATION_ERROR", "Invalid date");
  // A milestone records what happened: not a date still to come.
  if (when.getTime() > Date.now() + DAY_MS) throw new HttpError(400, "CLOSEOUT_DATE_IN_FUTURE", `${MILESTONE_LABEL[milestone]} cannot be recorded for a future date`);
  await prisma.projectCloseout.update({ where: { id: record.id }, data: { [atField]: when, [byField]: viewer.id, [noteField]: text(note), status: MILESTONE_STATUS[milestone], updatedBy: viewer.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.PROJECT_CLOSEOUT, entityId: record.id, action: auditService.ACTIONS.APPROVED, actorId: viewer.id, reason: overrideReason, oldStatus: record.status, newStatus: MILESTONE_STATUS[milestone], summary: { transition: `closeout.${milestone}`, date: when.toISOString(), overridden: Boolean(gate && !gate.ready), outstanding: gate && !gate.ready ? gate.outstanding.slice(0, 50) : [] } });
  return overview({ orgId, projectId, viewer });
};

/** Withdraws the latest recorded milestone, with a reason. */
const reopenMilestone = async ({ orgId, projectId, viewer, reason }) => {
  if (!text(reason)) throw new HttpError(400, "CLOSEOUT_REOPEN_REASON_REQUIRED", "Say why the milestone is withdrawn");
  const record = await ensureRecord({ orgId, projectId, userId: viewer.id });
  const latest = [...MILESTONES].reverse().find((key) => record[MILESTONE_FIELDS[key][0]]);
  if (!latest) throw new HttpError(409, "CLOSEOUT_NOTHING_TO_REOPEN", "No milestone is recorded");
  const before = MILESTONES[MILESTONES.indexOf(latest) - 1];
  const [atField, byField, noteField] = MILESTONE_FIELDS[latest];
  const status = before ? MILESTONE_STATUS[before] : "in_progress";
  await prisma.projectCloseout.update({ where: { id: record.id }, data: { [atField]: null, [byField]: null, [noteField]: null, status, updatedBy: viewer.id } });
  await audit({ orgId, projectId, entityType: auditService.ENTITY_TYPES.PROJECT_CLOSEOUT, entityId: record.id, action: auditService.ACTIONS.UPDATED, actorId: viewer.id, reason: text(reason), oldStatus: record.status, newStatus: status, summary: { transition: "closeout.reopen_milestone", milestone: latest } });
  return overview({ orgId, projectId, viewer });
};

const warranties = async ({ orgId, projectId, viewer }) => {
  const { items } = await listDeliverables({ orgId, projectId, viewer, query: { category: "warranty" } });
  const order = { expired: 0, expiring: 1, active: 2, open_ended: 3, not_started: 4 };
  return { items: items.sort((a, b) => (order[a.warranty?.state] ?? 9) - (order[b.warranty?.state] ?? 9) || String(a.warrantyEnd).localeCompare(String(b.warrantyEnd))), summary: warrantySummary(items) };
};

module.exports = {
  CATEGORIES,
  CATEGORY_KEYS,
  CHECK_KEYS,
  MILESTONES,
  STANDARD,
  STATUS,
  STATUSES,
  addMonths,
  warrantyState,
  viewerOf,
  overview,
  listDeliverables,
  getDeliverable,
  createDeliverable,
  addStandardList,
  updateDeliverable,
  deleteDeliverable,
  submitDeliverable,
  reviewDeliverable,
  waiveDeliverable,
  reopenDeliverable,
  setCheckWaiver,
  recordMilestone,
  reopenMilestone,
  warranties,
  _gates: gates,
};
