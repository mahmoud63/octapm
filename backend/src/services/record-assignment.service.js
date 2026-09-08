const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  COMPANY_REF_FIELDS,
  USER_REF_FIELDS,
  deriveBallInCourt,
  resolveAssignmentReferences,
} = require("./workflow-support.service");
const { ballInCourt } = require("./ball-in-court.service");
const { waitingState: poWaitingState } = require("./purchase-order.service");

/**
 * Cross-record accountability (OCTA-DATA-REFS-004): which records still carry
 * unresolved text assignments, manual mapping, and "my open items".
 */

const RECORD_MODELS = Object.freeze({
  risk: {
    model: "risk",
    label: "Risk",
    module: "risks",
    titleField: "description",
    statusField: "status",
    closed: ["closed", "archived"],
    textFields: { owner: "ownerUserId" },
    assigneeTextField: null,
    workspaceModule: "schedule",
    workspaceChild: "risks",
  },
  ncr: {
    model: "ncrRecord",
    label: "NCR",
    module: "ncr",
    titleField: "description",
    statusField: "status",
    closed: ["closed"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
      responsible: "assigneeUserId",
    },
    assigneeTextField: "responsible",
    workspaceModule: "quality",
    workspaceChild: "ncr",
  },
  itp: {
    model: "itpRecord",
    label: "ITP",
    module: "ncr",
    titleField: "title",
    statusField: "status",
    closed: ["passed", "waived"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
      inspector: "assigneeUserId",
    },
    assigneeTextField: "inspector",
    workspaceModule: "quality",
    workspaceChild: "itp",
  },
  defect: {
    model: "defectRecord",
    label: "Defect",
    module: "ncr",
    titleField: "title",
    statusField: "status",
    closed: ["closed"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
      assignee: "assigneeUserId",
    },
    assigneeTextField: "assignee",
    workspaceModule: "quality",
    workspaceChild: "defects",
  },
  safety_incident: {
    model: "safetyIncident",
    label: "Safety incident",
    module: "safety",
    titleField: "title",
    statusField: "status",
    closed: ["closed", "archived"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
      responsible: "assigneeUserId",
    },
    assigneeTextField: "responsible",
    workspaceModule: "quality",
    workspaceChild: "safety",
  },
  material_test: {
    model: "materialTest",
    label: "Material test",
    module: "ncr",
    titleField: "testType",
    statusField: "result",
    closed: ["pass"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
    },
    assigneeTextField: null,
    workspaceModule: "quality",
    workspaceChild: "tests",
  },
  rfi: {
    model: "rfi",
    label: "RFI",
    module: "rfi",
    titleField: "subject",
    statusField: "status",
    closed: ["closed", "archived"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
    },
    assigneeTextField: null,
    workspaceModule: "docControl",
    workspaceChild: "rfi",
  },
  submittal: {
    model: "submittal",
    label: "Submittal",
    module: "submittal",
    titleField: "title",
    statusField: "status",
    closed: ["approved", "archived"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
    },
    assigneeTextField: null,
    workspaceModule: "docControl",
    workspaceChild: "submittals",
  },
  drawing: {
    model: "drawingRecord",
    label: "Drawing",
    module: "document_control",
    titleField: "title",
    statusField: "status",
    closed: ["superseded", "cancelled"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
    },
    assigneeTextField: null,
    workspaceModule: "docControl",
    workspaceChild: "drawings",
  },
  transmittal: {
    model: "transmittal",
    label: "Transmittal",
    module: "document_control",
    titleField: "subject",
    statusField: "status",
    closed: ["acknowledged"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
    },
    assigneeTextField: null,
    workspaceModule: "docControl",
    workspaceChild: "transmittals",
  },
  correspondence: {
    model: "correspondence",
    label: "Correspondence",
    module: "document_control",
    titleField: "subject",
    statusField: "status",
    closed: ["closed"],
    textFields: {
      owner: "ownerUserId",
      reviewer: "reviewerUserId",
      approver: "approverUserId",
    },
    assigneeTextField: null,
    workspaceModule: "docControl",
    workspaceChild: "correspondence",
  },
});

const RECORD_TYPE_IDS = Object.keys(RECORD_MODELS);
const ASSIGNABLE_FIELDS = [...USER_REF_FIELDS, ...COMPANY_REF_FIELDS];

const toIso = (value) => value?.toISOString?.() || value || null;

const requireConfig = (recordType) => {
  const config = RECORD_MODELS[recordType];
  if (!config) {
    throw new HttpError(400, "RECORD_TYPE_INVALID", `Unknown record type: ${recordType}`);
  }
  return config;
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, name: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

/**
 * Records whose legacy text assignment could not be matched to a user. This is
 * the backfill report: one row per (record, field).
 */
const listUnresolvedAssignments = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });
  const items = [];

  for (const [recordType, config] of Object.entries(RECORD_MODELS)) {
    const model = prisma[config.model];
    if (!model?.findMany) continue;
    const textFields = Object.entries(config.textFields);
    const rows = await model.findMany({
      where: {
        projectId,
        OR: textFields.map(([textField, idField]) => ({
          [textField]: { not: null },
          [idField]: null,
        })),
      },
      select: {
        id: true,
        ref: true,
        [config.titleField]: true,
        [config.statusField]: true,
        ...Object.fromEntries(textFields.flatMap(([t, i]) => [[t, true], [i, true]])),
      },
      orderBy: [{ ref: "asc" }],
      take: 500,
    });

    for (const row of rows) {
      for (const [textField, idField] of textFields) {
        const text = row[textField] ? String(row[textField]).trim() : "";
        if (!text || row[idField]) continue;
        items.push({
          recordType,
          recordId: row.id,
          ref: row.ref,
          title: row[config.titleField] || row.ref,
          status: row[config.statusField],
          field: idField,
          textField,
          value: text,
          label: config.label,
        });
      }
    }
  }

  const byType = {};
  for (const item of items) byType[item.recordType] = (byType[item.recordType] || 0) + 1;

  return {
    projectId,
    projectName: project.name,
    total: items.length,
    byType,
    items,
  };
};

/**
 * Manual mapping for one record field: sets a user or company reference and
 * refreshes ball-in-court. `userId: null` clears the reference.
 */
const resolveAssignment = async ({
  orgId,
  projectId,
  payload = {},
  actorId = null,
  actorRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const config = requireConfig(payload.recordType);
  const field = String(payload.field || "");
  if (!ASSIGNABLE_FIELDS.includes(field)) {
    throw new HttpError(400, "ASSIGNMENT_FIELD_INVALID", `Unknown assignment field: ${field}`);
  }
  const model = prisma[config.model];
  const existing = await model.findFirst({ where: { id: payload.recordId, projectId } });
  if (!existing) throw new HttpError(404, "RECORD_NOT_FOUND", `${config.label} not found`);

  const value = COMPANY_REF_FIELDS.includes(field)
    ? (payload.companyId ?? null)
    : (payload.userId ?? null);

  const updated = await prisma.$transaction(async (tx) => {
    const data = await resolveAssignmentReferences({
      tx,
      orgId,
      projectId,
      payload: { [field]: value },
      existing,
      status: existing[config.statusField],
      assigneeTextField: config.assigneeTextField,
    });
    const row = await model.update({ where: { id: existing.id }, data });
    if (tx.authAuditEvent?.create) {
      await tx.authAuditEvent.create({
        data: {
          orgId,
          projectId,
          actorId,
          actorRole,
          entityType: "record_assignment",
          entityId: existing.id,
          action: "resolved",
          metadataJson: { recordType: payload.recordType, field, value },
        },
      });
    }
    return row;
  });

  return {
    recordType: payload.recordType,
    recordId: updated.id,
    field,
    value,
    ballInCourtUserId: updated.ballInCourtUserId || null,
  };
};

const isOpen = (config, row) =>
  !config.closed.includes(String(row[config.statusField] || "").toLowerCase());

const dueDateOf = (row) =>
  row.dueDate || row.responseRequiredBy || row.targetCloseBy || row.inspectionDate || null;

/**
 * Everything the user is accountable for (owner, reviewer, approver,
 * assignee, or ball in court) that is still open, across the given projects.
 */
/**
 * Commercial and procurement records, whose ball-in-court is derived rather
 * than assigned.
 *
 * The action centre was built for records that name a person: an NCR has an
 * assignee, an RFI has a ball-in-court user. Nothing in commercial or
 * procurement does — a purchase order waiting on approval is waiting on
 * whoever holds the PM role, not on a stored user id. So none of it appeared
 * on the one screen that answers "what needs my attention today?", and a
 * buyer with eleven orders to issue saw an empty list (OCTA-UX-ACTION-098).
 *
 * These are folded into the same list rather than given a competing one: same
 * shape, same sort, same deep link.
 */
const DERIVED_MODELS = Object.freeze({
  purchase_order: {
    model: "procurementOrder",
    label: "Purchase order",
    titleField: "item",
    workspaceModule: "procurement",
    workspaceChild: "purchase-orders",
    // Once an order is out with the supplier the useful question is a
    // delivery question, and the register already knows how to ask it.
    extraFields: ["warehouseStatus"],
    waitingState: poWaitingState,
    // The workspace calls this one "procurement_order" when it opens a
    // record from a URL. Our own name for the type is not that, and a link
    // built from the wrong one loads the register and opens nothing — which
    // is what happened, silently, because a deep link that misses just shows
    // the list (OCTA-UX-ACTION-099).
    source: "procurement_order",
  },
  commitment: {
    model: "commitment",
    label: "Commitment",
    titleField: "title",
    workspaceModule: "commercial",
    workspaceChild: "commitments",
  },
  sub_pay_app: {
    model: "subPayApp",
    label: "Payment application",
    titleField: "periodLabel",
    workspaceModule: "commercial",
    workspaceChild: "pay-apps",
  },
  bid_package: {
    model: "bidPackage",
    label: "Bid package",
    titleField: "title",
    workspaceModule: "commercial",
    workspaceChild: "bids",
  },
});

const listDerivedItems = async ({ projectIds, role, limit }) => {
  if (!role || !projectIds.length) return [];
  const items = [];

  for (const [recordType, config] of Object.entries(DERIVED_MODELS)) {
    const model = prisma[config.model];
    // A name that does not exist is a bug, and record-assignment.models.test
    // fails on it against the real client. Here it must not take down the
    // whole action centre for the record types that do work.
    if (!model?.findMany) continue;
    const rows = await model.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        id: true,
        projectId: true,
        ref: true,
        status: true,
        updatedAt: true,
        [config.titleField]: true,
        ...Object.fromEntries((config.extraFields || []).map((field) => [field, true])),
        project: { select: { id: true, name: true } },
      },
      take: limit,
      orderBy: [{ updatedAt: "desc" }],
    });

    for (const row of rows) {
      // Only what is actually this person's move. "You are permitted to do
      // this" would put nearly every record in the project on a PM's list.
      const status = config.waitingState ? config.waitingState(row) : row.status;
      const waiting = ballInCourt(recordType, { ...row, status }, { role });
      if (waiting.state !== "yours") continue;
      items.push({
        recordType,
        label: config.label,
        recordId: row.id,
        ref: row.ref,
        title: row[config.titleField] || row.ref,
        status,
        projectId: row.projectId,
        projectName: row.project?.name || null,
        roles: [],
        ballInCourt: true,
        derived: true,
        dueDate: null,
        overdue: false,
        updatedAt: toIso(row.updatedAt),
        target: {
          projectId: row.projectId,
          module: config.workspaceModule,
          child: config.workspaceChild,
          recordType,
          // What the workspace expects in ?source=, which is not always our
          // name for the record type.
          source: config.source || recordType,
          recordId: row.id,
        },
      });
    }
  }

  return items;
};

const listMyOpenItems = async ({ orgId, userId, role = null, projectIds = [], limit = 200 }) => {
  if (!userId || !projectIds.length) {
    return { items: [], summary: { total: 0, overdue: 0, ballInCourt: 0, byType: {} } };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const items = [];

  for (const [recordType, config] of Object.entries(RECORD_MODELS)) {
    const model = prisma[config.model];
    if (!model?.findMany) continue;
    const rows = await model.findMany({
      where: {
        projectId: { in: projectIds },
        [config.statusField]: { notIn: config.closed },
        OR: USER_REF_FIELDS.map((field) => ({ [field]: userId })),
      },
      select: {
        id: true,
        projectId: true,
        ref: true,
        [config.titleField]: true,
        [config.statusField]: true,
        dueDate: true,
        updatedAt: true,
        ...Object.fromEntries(USER_REF_FIELDS.map((field) => [field, true])),
        project: { select: { id: true, name: true } },
      },
      take: limit,
      orderBy: [{ updatedAt: "desc" }],
    });

    for (const row of rows) {
      if (!isOpen(config, row)) continue;
      const roles = USER_REF_FIELDS.filter((field) => row[field] === userId).map((field) =>
        field.replace(/UserId$/, ""),
      );
      const dueDate = dueDateOf(row);
      const overdue = dueDate ? new Date(dueDate).getTime() < today.getTime() : false;
      items.push({
        recordType,
        label: config.label,
        recordId: row.id,
        ref: row.ref,
        title: row[config.titleField] || row.ref,
        status: row[config.statusField],
        projectId: row.projectId,
        projectName: row.project?.name || null,
        roles,
        ballInCourt: row.ballInCourtUserId === userId,
        dueDate: toIso(dueDate),
        overdue,
        updatedAt: toIso(row.updatedAt),
        target: {
          projectId: row.projectId,
          module: config.workspaceModule,
          child: config.workspaceChild,
          recordType,
          recordId: row.id,
        },
      });
    }
  }

  items.push(...(await listDerivedItems({ projectIds, role, limit })));

  items.sort((a, b) => {
    if (a.ballInCourt !== b.ballInCourt) return a.ballInCourt ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const dueA = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const dueB = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    return dueA - dueB;
  });

  const byType = {};
  for (const item of items) byType[item.recordType] = (byType[item.recordType] || 0) + 1;

  return {
    items: items.slice(0, limit),
    summary: {
      total: items.length,
      overdue: items.filter((item) => item.overdue).length,
      ballInCourt: items.filter((item) => item.ballInCourt).length,
      byType,
    },
  };
};

module.exports = {
  DERIVED_MODELS,
  ASSIGNABLE_FIELDS,
  RECORD_MODELS,
  RECORD_TYPE_IDS,
  deriveBallInCourt,
  listMyOpenItems,
  listUnresolvedAssignments,
  resolveAssignment,
};
