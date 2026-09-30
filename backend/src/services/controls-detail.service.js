/**
 * BOQ item detail and activity detail (PC-5): one read that tells the story
 * of a bill row or of an activity — where it sits, what it is mapped to, how
 * far it has got, what it cost, what changed — by asking the service that
 * owns each figure. Nothing here is new arithmetic: a figure is read from
 * its source row, or taken from the service that already derives it
 * (allocation summary, the IPC variation allowance, the cost record the
 * certified committed/actual writers keep), and says which it is:
 *
 *   { value, truth: 'source' | 'derived' | 'projection', basis, derivedFrom }
 *
 * (docs/project-controls/OCTAPM_PROJECT_CONTROL_MODEL.md §3). A figure no
 * service can prove today is not computed: it is `notAvailable` and names
 * the wave that will bring it.
 *
 * Every section is gated by the permission module that owns it, decided by
 * the route's `can(module)`: a section the viewer cannot read is
 * `{ allowed: false, module, reason }` with no data. Party-scoped members (a
 * subcontractor's people) see commitments, punch items and lookahead
 * constraints only through those modules' own party rules, so those
 * sections are refused here rather than re-implementing the rules. The
 * bill's figures on the activity detail (allocations, mapped quantity, the
 * allocation-derived budget and EV, certification per allocation, the
 * allocation history, the BOQ links on change orders and PO lines) are
 * withheld in one place: utils/boq-figures.withheldActivityDetail.
 *
 * Lists are capped at LIST_CAP rows with their `total` and a `viewAll` link.
 */
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, toMoneyNumber } = require("../utils/money");
const { recordWorkspacePath } = require("../utils/record-links");
const allocationService = require("./activity-boq-allocation.service");
const boqService = require("./boq.service");
const activityService = require("./activity.service");
const progressService = require("./progress.service");
const auditService = require("./audit.service");
const attachmentService = require("./attachment.service");
const commitmentService = require("./commitment.service");
const readinessService = require("./project-setup-readiness.service");
const { getApprovedVariationAllowance } = require("./ipc.service");

const LIST_CAP = 50;
// The allocation summary's and the IPC module's certified statuses.
const CERTIFIED_IPC_STATUSES = ["certified", "paid"];

const fig = (value, truth, basis, derivedFrom = []) => ({ value, truth, basis, derivedFrom });
const notAvailable = (wave, basis) => ({ value: null, truth: null, notAvailable: true, wave, basis, derivedFrom: [] });
const denied = (module, reason = "You do not have permission to read this section") => ({
  allowed: false,
  module,
  reason,
});
const PARTY_SCOPED_REASON = "Your access is limited to your company's records: open the module to see them";
const SCHEDULE_WITHHELD_REASON =
  "The activity's dates, critical status, float and progress are available only to members who may read the schedule";

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const iso = (value) => (value ? new Date(value).toISOString() : null);
const capped = (rows, total, viewAll) => ({ items: rows.slice(0, LIST_CAP), total, viewAll });
const activityCodeOf = (activity) => activity?.activityCode || activity?.p6ActivityId || null;
// An IPC line opens the certificate it sits on (the IPC workbook selects a
// certificate, not a line); a line on no certificate yet opens the register.
const ipcLineHref = (link, entry) => (entry.ipcCertificateId ? link("ipc_certificate", entry.ipcCertificateId) : link("ipc"));

// Another organisation's project answers as a missing one does.
const loadContext = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, org: { select: { id: true, slug: true } } },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  const link = (recordType, recordId = null) =>
    recordWorkspacePath({ projectId, recordType, recordId, orgSlug: project.org });
  // A record type record-links does not know opens the project root.
  const projectBase = recordWorkspacePath({ projectId, recordType: "__project__", orgSlug: project.org });
  const controls = (child, record = null) =>
    `${projectBase}/controls/${child}${record ? `?recordId=${encodeURIComponent(record.id)}&source=${record.type}` : ""}`;
  return { link, controls };
};

const structureOf = async ({ orgId, projectId, wbsNodeId, locationId, costCodeId }, controls) => {
  const [wbs, location, costCode] = await Promise.all([
    wbsNodeId
      ? prisma.wbsNode.findFirst({ where: { id: wbsNodeId, projectId }, select: { id: true, code: true, name: true, path: true } })
      : null,
    locationId
      ? prisma.location.findFirst({ where: { id: locationId, projectId }, select: { id: true, code: true, name: true, path: true } })
      : null,
    costCodeId
      ? prisma.costCode.findFirst({ where: { id: costCodeId, orgId }, select: { id: true, code: true, name: true } })
      : null,
  ]);
  const href = controls("structure");
  return {
    wbs: wbs ? { ...wbs, href } : null,
    location: location ? { ...location, href } : null,
    costCode: costCode ? { ...costCode, href } : null,
  };
};

/** Latest approved progress per activity, by the allocation summary's rule (most recently updated). */
const latestApprovedProgress = async (activityIds) => {
  if (!activityIds.length) return new Map();
  const rows = await prisma.activityProgress.findMany({
    where: { activityId: { in: activityIds }, status: "approved" },
    orderBy: { updatedAt: "desc" },
    select: { activityId: true, pctComplete: true, approvedAt: true, source: true, progressMethod: true },
  });
  const map = new Map();
  for (const row of rows) if (!map.has(row.activityId)) map.set(row.activityId, row);
  return map;
};

// ─── BOQ item detail ─────────────────────────────────────────────────────

// The original quantity is the baseline-locked revision's row for the same
// code (source); without a lock, or when this row is that revision's, it is
// the current quantity. Nothing is subtracted or summed across revisions.
const originalQuantityOf = async ({ projectId, item, lock }) => {
  const code = item.code || item.ref || null;
  if (lock.boqRevisionId && code && item.revisionId !== lock.boqRevisionId) {
    const locked = await prisma.boqItem.findFirst({
      where: { projectId, revisionId: lock.boqRevisionId, OR: [{ code }, { ref: code }] },
      select: { id: true, qty: true },
    });
    if (locked) {
      return fig(toNumber(locked.qty), "source", `BoqItem.qty of code ${code} on the baseline-locked BOQ revision`, [
        { type: "boq_item", id: locked.id },
      ]);
    }
  }
  return fig(
    toNumber(item.qty),
    "source",
    lock.boqRevisionId
      ? "This row is on the baseline-locked revision (or the locked revision has no row of its code): the current quantity"
      : "No BOQ revision is baseline-locked: the current quantity",
    [{ type: "boq_item", id: item.id }],
  );
};

// PC-4's per-record readiness issues. Each issue lists at most ITEM_CAP
// records: a row absent from a capped list is "not itemised", never clean.
const readinessFlagsFor = async ({ orgId, projectId, itemId, canReadSchedule }) => {
  const readiness = await readinessService.getSetupReadiness({ orgId, projectId, canReadBoq: true, canReadSchedule });
  const flags = [];
  const notItemised = [];
  for (const step of readiness.steps || []) {
    for (const [severity, list] of [["blocking", step.blockers], ["warning", step.warnings], ["advisory", step.advisories]]) {
      for (const issue of list || []) {
        const rows = (issue.items || []).filter((entry) => entry.type === "boq_item");
        const mine = rows.find((entry) => entry.id === itemId);
        if (mine) {
          flags.push({ step: step.key, stepLabel: step.label, code: issue.code, severity, message: issue.message, href: mine.href || null });
        } else if (rows.length && issue.count > (issue.items || []).length) {
          notItemised.push({ step: step.key, code: issue.code, severity, message: issue.message, count: issue.count, itemised: issue.items.length });
        }
      }
    }
  }
  return {
    allowed: true,
    truth: "derived",
    basis: "PC-4 setup readiness (project-setup-readiness.service): the per-record lists of its issues",
    flags,
    notItemised,
    note: notItemised.length
      ? `Some checks list only their first ${readinessService.ITEM_CAP} records and this row is not itemised beyond that: no flag there is not a clean result`
      : null,
  };
};

const getBoqItemDetail = async ({ orgId, projectId, itemId, can, partyScoped = false, attachmentViewer = null }) => {
  const { link, controls } = await loadContext({ orgId, projectId });
  const item = await prisma.boqItem.findFirst({
    where: { id: itemId, projectId },
    include: { boqRevision: { select: { id: true, revisionNumber: true, label: true, status: true, baselineLocked: true } } },
  });
  if (!item) throw new HttpError(404, "BOQ_ITEM_NOT_FOUND", "BOQ item not found");

  const [lock, allocationList, structure, variation] = await Promise.all([
    boqService.getBoqBaselineLock(projectId),
    allocationService.listAllocations({ orgId, projectId, boqItemId: itemId }),
    structureOf({ orgId, projectId, wbsNodeId: item.wbsNodeId, locationId: item.locationId, costCodeId: item.costCodeId }, controls),
    getApprovedVariationAllowance({ tx: prisma, projectId, boqItemId: itemId }),
  ]);
  const summaryItem = (allocationList.summary.items || []).find((entry) => entry.boqItemId === itemId) || null;
  const allocations = allocationList.allocations;
  const activityIds = [...new Set(allocations.map((entry) => entry.activityId))];
  // This view is admitted on boq:read alone. A linked activity's schedule —
  // its dates, critical flag, float, progress — belongs to the schedule
  // module: a member who may not read the schedule is refused GET
  // /activities, so here the activity is what an allocation listing already
  // shows a BOQ reader (id, code, name) and a { allowed: false } marker, and
  // the schedule is not even read.
  const canReadSchedule = can("schedule");
  const [activities, progress, original] = await Promise.all([
    activityIds.length
      ? prisma.activity.findMany({
          where: { id: { in: activityIds }, projectId },
          select: canReadSchedule
            ? {
                id: true, name: true, activityCode: true, p6ActivityId: true, startDate: true, endDate: true,
                isCritical: true, totalFloat: true, isActive: true,
              }
            : { id: true, name: true, activityCode: true, p6ActivityId: true },
        })
      : [],
    canReadSchedule ? latestApprovedProgress(activityIds) : new Map(),
    originalQuantityOf({ projectId, item, lock }),
  ]);
  const activityById = new Map(activities.map((entry) => [entry.id, entry]));

  const allocationRows = await Promise.all(
    allocations.slice(0, LIST_CAP).map(async (allocation) => {
      const activity = activityById.get(allocation.activityId);
      // The IPC certification cap's own rule for this allocation.
      const perAllocation = await getApprovedVariationAllowance({ tx: prisma, projectId, allocationId: allocation.id, boqItemId: itemId });
      const latest = progress.get(allocation.activityId);
      return {
        allocationId: allocation.id,
        status: allocation.status,
        basis: allocation.basis,
        quantity: fig(toNumber(allocation.quantity), "source", "ActivityBoqAllocation.quantity", [{ type: "activity_boq_allocation", id: allocation.id }]),
        amount: fig(toMoneyNumber(allocation.amount), "source", "ActivityBoqAllocation.amount", [{ type: "activity_boq_allocation", id: allocation.id }]),
        authorisedQuantity: fig(
          toNumber(allocation.quantity) + perAllocation.quantity,
          "derived",
          "Allocation quantity + Σ approved change-order allocation-link quantity (ipc.service getApprovedVariationAllowance, the IPC certification cap)",
          [{ type: "activity_boq_allocation", id: allocation.id }, { type: "change_order_allocation_link", filter: "changeOrder.status = approved" }],
        ),
        activity: activity && !canReadSchedule
          ? {
              id: activity.id,
              code: activityCodeOf(activity),
              name: activity.name,
              href: null,
              schedule: denied("schedule", SCHEDULE_WITHHELD_REASON),
            }
          : activity
          ? {
              id: activity.id,
              code: activityCodeOf(activity),
              name: activity.name,
              startDate: iso(activity.startDate),
              endDate: iso(activity.endDate),
              isCritical: Boolean(activity.isCritical),
              totalFloat: activity.totalFloat ?? null,
              isActive: activity.isActive,
              pctComplete: latest
                ? fig(toNumber(latest.pctComplete), "source", "Latest approved ActivityProgress (most recently updated)", [{ type: "activity_progress" }])
                : null,
              progressSource: latest?.source ?? null,
              href: link("activity", activity.id),
            }
          : null,
      };
    }),
  );

  const quantity = toNumber(item.qty);
  const sections = {};

  sections.structure = { allowed: true, ...structure };
  sections.mapping = {
    allowed: true,
    mappingRule: item.mappingRule || "required",
    mappingState: summaryItem?.mappingState ?? null,
    allocationCount: summaryItem?.allocationCount ?? allocations.length,
    allocations: capped(allocationRows, allocations.length, controls("mapping", { id: itemId, type: "boq_item" })),
  };
  sections.quantities = {
    allowed: true,
    unit: item.unit ?? null,
    unitCode: item.unitCode ?? null,
    original,
    current: fig(quantity, "source", "BoqItem.qty on the current revision", [{ type: "boq_item", id: item.id }]),
    authorised: fig(
      quantity + variation.quantity,
      "derived",
      "Current quantity + Σ approved change-order allocation-link quantity naming this item (ipc.service getApprovedVariationAllowance)",
      [{ type: "boq_item", id: item.id }, { type: "change_order_allocation_link", filter: "boqItemId, changeOrder.status = approved" }],
    ),
    approvedVariation: fig(variation.quantity, "derived", "Σ approved change-order allocation-link quantity naming this item (ipc.service getApprovedVariationAllowance)", [
      { type: "change_order_allocation_link", filter: "boqItemId, changeOrder.status = approved" },
    ]),
    mapped: summaryItem
      ? fig(summaryItem.approvedAllocatedQuantity, "derived", "Σ approved, active allocation quantity (allocation summary)", [{ type: "activity_boq_allocation" }])
      : null,
    unallocated: summaryItem
      ? fig(summaryItem.unallocatedQuantity, "derived", "Current quantity − approved allocations; an n/a row's remainder is its own bucket (allocation summary)", [
          { type: "activity_boq_allocation" },
        ])
      : null,
    installed: notAvailable("PC-6", "Not available yet (PC-6): installed quantity per BOQ item comes with quantity progress"),
    paid: notAvailable("PC-6", "Not available yet (PC-6): payments are recorded per certificate, not per BOQ item"),
    forecast: notAvailable("PC-7", "Not available yet (PC-7): a per-item forecast comes with forecast intelligence"),
  };
  sections.money = {
    allowed: true,
    rate: fig(toMoneyNumber(item.rate), "source", "BoqItem.rate", [{ type: "boq_item", id: item.id }]),
    amount: fig(toMoneyNumber(item.amount), "source", "BoqItem.amount", [{ type: "boq_item", id: item.id }]),
    approvedAllocated: summaryItem
      ? fig(summaryItem.approvedAllocatedAmount, "derived", "Σ approved, active allocation amount (allocation summary)", [{ type: "activity_boq_allocation" }])
      : null,
    earnedValue: summaryItem
      ? fig(
          summaryItem.earnedValue,
          "derived",
          "Derived — as of now, not the official reporting-cutoff EV: approved allocation amount × latest approved progress (allocation summary)",
          [{ type: "activity_boq_allocation" }, { type: "activity_progress", filter: "status = approved, latest" }],
        )
      : null,
    forecast: notAvailable("PC-7", "Not available yet (PC-7)"),
  };

  if (can("ipc")) {
    const ipcItems = await prisma.ipcItem.findMany({
      where: { projectId, boqItemId: itemId },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true, ipcPeriod: true, qty: true, currentCert: true, status: true, certDate: true, ipcCertificateId: true },
    });
    const certified = ipcItems.filter((entry) => CERTIFIED_IPC_STATUSES.includes(entry.status));
    sections.certification = {
      allowed: true,
      certifiedQuantity: fig(
        certified.reduce((sum, entry) => sum + toNumber(entry.qty), 0),
        "derived",
        "Σ IpcItem.qty for this item where status ∈ {certified, paid}",
        [{ type: "ipc_item", filter: "boqItemId, status in (certified, paid)" }],
      ),
      certifiedAmount: summaryItem
        ? fig(summaryItem.certifiedValue, "derived", "Σ IpcItem.currentCert where status ∈ {certified, paid} on approved allocations (allocation summary)", [
            { type: "ipc_item", filter: "status in (certified, paid)" },
          ])
        : null,
      lines: capped(
        ipcItems.map((entry) => ({
          id: entry.id,
          period: entry.ipcPeriod,
          status: entry.status,
          qty: toNumber(entry.qty),
          currentCert: toMoneyNumber(entry.currentCert),
          certDate: iso(entry.certDate),
          href: ipcLineHref(link, entry),
        })),
        ipcItems.length,
        link("ipc"),
      ),
    };
  } else {
    sections.certification = denied("ipc");
  }

  if (!can("commitment")) sections.commitments = denied("commitment");
  else if (partyScoped) sections.commitments = denied("commitment", PARTY_SCOPED_REASON);
  else {
    const lines = await prisma.commitmentSovLine.findMany({
      where: { projectId, boqItemId: itemId, commitment: { projectId, status: { in: commitmentService.POSTING_STATUSES } } },
      select: { id: true, amount: true, qty: true, commitment: { select: { id: true, number: true, title: true, status: true } } },
    });
    sections.commitments = {
      allowed: true,
      committed: fig(
        lines.reduce((sum, entry) => addMoney(sum, entry.amount), 0),
        "derived",
        "Σ CommitmentSovLine.amount naming this item on executed/closed commitments — excludes variations (CCO lines carry no BOQ item)",
        [{ type: "commitment_sov_line", filter: "boqItemId, commitment.status in (executed, closed)" }],
      ),
      lines: capped(
        lines.map((entry) => ({
          id: entry.id,
          qty: toNumber(entry.qty),
          amount: toMoneyNumber(entry.amount),
          commitment: { ...entry.commitment, href: link("commitment", entry.commitment.id) },
        })),
        lines.length,
        link("commitment"),
      ),
    };
  }

  if (can("change_order")) {
    const linkWhere = { OR: [{ boqItemId: itemId }, { allocation: { boqItemId: itemId } }] };
    const orders = await prisma.changeOrder.findMany({
      where: { projectId, allocationLinks: { some: linkWhere } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, ref: true, description: true, status: true, value: true, approvedAt: true, createdAt: true,
        allocationLinks: { where: linkWhere, select: { id: true, allocationId: true, quantity: true, amount: true } },
      },
    });
    sections.changes = {
      allowed: true,
      changeOrders: capped(
        orders.map((order) => ({
          id: order.id,
          ref: order.ref,
          description: order.description,
          status: order.status,
          value: toMoneyNumber(order.value),
          approvedAt: iso(order.approvedAt),
          createdAt: iso(order.createdAt),
          links: order.allocationLinks.map((entry) => ({
            id: entry.id,
            allocationId: entry.allocationId,
            quantity: toNumber(entry.quantity),
            amount: toMoneyNumber(entry.amount),
          })),
          href: link("change_order", order.id),
        })),
        orders.length,
        link("change_order"),
      ),
    };
  } else {
    sections.changes = denied("change_order");
  }

  if (can("procurement")) {
    const poLines = await prisma.procurementPoLine.findMany({
      where: { projectId, boqItemId: itemId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, description: true, unit: true, orderedQty: true, receivedQty: true, unitCost: true, status: true, activityId: true,
        order: { select: { id: true, ref: true, status: true } },
      },
    });
    sections.procurement = {
      allowed: true,
      note: "Order values are what was ordered, not committed cost",
      poLines: capped(
        poLines.map((entry) => ({
          id: entry.id,
          description: entry.description,
          unit: entry.unit,
          orderedQty: toNumber(entry.orderedQty),
          receivedQty: toNumber(entry.receivedQty),
          unitCost: toMoneyNumber(entry.unitCost),
          status: entry.status,
          activityId: entry.activityId,
          activityHref: entry.activityId ? link("activity", entry.activityId) : null,
          order: entry.order ? { ...entry.order, href: link("procurement_order", entry.order.id) } : null,
        })),
        poLines.length,
        link("procurement_order"),
      ),
    };
  } else {
    sections.procurement = denied("procurement");
  }

  sections.readiness = await readinessFlagsFor({ orgId, projectId, itemId, canReadSchedule });

  if (can("audit")) {
    const history = await auditService.listEvents({ orgId, projectId, entityType: "boq_item", entityId: itemId, limit: LIST_CAP, order: "desc" });
    sections.history = { allowed: true, events: history.events, nextCursor: history.nextCursor };
  } else {
    sections.history = denied("audit");
  }

  const attachments = await attachmentService.listAttachments({ orgId, projectId, recordType: "boq_item", recordId: itemId, viewer: attachmentViewer });
  sections.documents = { allowed: true, attachments: capped(attachments.items, attachments.items.length, null) };

  return {
    kind: "boq_item",
    id: item.id,
    href: link("boq_item", item.id),
    header: {
      id: item.id,
      code: item.code || item.ref || "",
      description: item.description,
      section: item.section ?? null,
      unit: item.unit ?? null,
      isActive: item.isActive,
      supersededAt: iso(item.supersededAt),
      revision: item.boqRevision
        ? { id: item.boqRevision.id, revisionNumber: item.boqRevision.revisionNumber, label: item.boqRevision.label, status: item.boqRevision.status }
        : null,
      baselineLock: lock,
    },
    sections,
  };
};

// ─── Activity detail ─────────────────────────────────────────────────────

// A workflow record linked to the activity is listed only to a reader of its own module.
const WORKFLOW_LINK_MODULES = {
  rfi: "rfi",
  submittal: "submittal",
  ncr: "ncr",
  itp: "inspection",
  drawing: "document_control",
  document: "document_control",
  punch_item: "punch",
};

const activityHistory = async ({ orgId, projectId, activityId, allocationIds, changeOrders }) => {
  const submissionIds = (await prisma.progressSubmission.findMany({ where: { projectId, activityId }, select: { id: true } })).map((entry) => entry.id);
  const [progressEvents, allocationEvents, revisionEvents] = await Promise.all([
    submissionIds.length
      ? prisma.auditEvent.findMany({
          where: { orgId, projectId, entityType: "progress_submission", entityId: { in: submissionIds } },
          orderBy: { occurredAt: "desc" },
          take: LIST_CAP,
          select: { id: true, action: true, entityId: true, actorId: true, occurredAt: true },
        })
      : [],
    allocationIds.length
      ? prisma.approvalWorkflowEvent.findMany({
          where: { orgId, projectId, recordType: "activity_boq_allocation", recordId: { in: allocationIds } },
          orderBy: { createdAt: "desc" },
          take: LIST_CAP,
          select: { id: true, action: true, recordId: true, fromStatus: true, toStatus: true, actorId: true, createdAt: true },
        })
      : [],
    prisma.auditEvent.findMany({
      // A revision becomes the live programme when it is approved, and is frozen by the baseline lock.
      where: { orgId, projectId, entityType: "schedule_revision", action: { in: [auditService.ACTIONS.APPROVED, auditService.ACTIONS.BASELINE_LOCKED] } },
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: { id: true, action: true, entityId: true, actorId: true, occurredAt: true },
    }),
  ]);
  return [
    ...progressEvents.map((entry) => ({
      id: entry.id, kind: "progress_submission", label: `Progress submission ${entry.action}`, at: iso(entry.occurredAt), action: entry.action, recordId: entry.entityId, actorId: entry.actorId,
    })),
    ...allocationEvents.map((entry) => ({
      id: entry.id, kind: "allocation_approval", label: `BOQ allocation ${entry.fromStatus || "created"} → ${entry.toStatus}`, at: iso(entry.createdAt), action: entry.action, recordId: entry.recordId, actorId: entry.actorId,
    })),
    ...changeOrders.map((order) => ({
      id: order.id, kind: "change_order_link", label: `Change order ${order.ref || ""} (${order.status})`, at: order.createdAt, action: order.status, recordId: order.id, href: order.href,
    })),
    ...revisionEvents.map((entry) => ({
      id: entry.id, kind: "schedule_revision", label: `Schedule revision ${entry.action} (project-wide)`, at: iso(entry.occurredAt), action: entry.action, recordId: entry.entityId, actorId: entry.actorId,
    })),
  ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
};

const getActivityDetail = async ({ orgId, projectId, activityId, can, partyScoped = false, attachmentViewer = null }) => {
  const { link, controls } = await loadContext({ orgId, projectId });
  const row = await prisma.activity.findFirst({
    where: { id: activityId, projectId },
    select: { id: true, wbsNodeId: true, locationId: true, totalFloat: true, isCritical: true, isMilestone: true, budget: true, isActive: true },
  });
  if (!row) throw new HttpError(404, "ACTIVITY_NOT_FOUND", "Activity not found");

  const [activity, structure, allocationList, totals, latestMap] = await Promise.all([
    activityService.getActivityById({ orgId, projectId, activityId }),
    structureOf({ orgId, projectId, wbsNodeId: row.wbsNodeId, locationId: row.locationId, costCodeId: null }, controls),
    allocationService.listAllocations({ orgId, projectId, activityId }),
    allocationService.getApprovedActivityAllocationTotals({ projectId, activityIds: [activityId] }),
    latestApprovedProgress([activityId]),
  ]);
  const approved = totals.get(activityId) || { quantity: 0, amount: 0, weight: 0, count: 0 };
  const latest = latestMap.get(activityId) || null;
  const sections = {};

  sections.structure = {
    allowed: true,
    wbsCode: activity.wbsCode ?? null,
    ...structure,
    costCode: null,
    costCodeNote: "An activity carries no cost code of its own; the BOQ rows allocated to it do",
  };

  // The bill's side of the activity — withheld whole by boq-figures for a non-BOQ reader.
  const allocationRows = allocationList.allocations.slice(0, LIST_CAP);
  const perAllocation = await Promise.all(
    allocationRows.map((allocation) =>
      getApprovedVariationAllowance({ tx: prisma, projectId, allocationId: allocation.id, boqItemId: allocation.boqItemId }),
    ),
  );
  // EV is the allocation summary's own figure, scoped to this activity: Σ per
  // approved allocation of multiplyMoney(amount, clamp(pct, 0, 100) / 100) —
  // not a second formula over the activity's total.
  const activitySummary = await allocationService.buildAllocationSummary({ projectId, activityIds: [activityId] });
  sections.mapping = {
    allowed: true,
    mappedQuantity: fig(approved.quantity, "derived", "Σ approved, active allocation quantity for this activity (getApprovedActivityAllocationTotals)", [
      { type: "activity_boq_allocation", filter: "status = approved, isActive" },
    ]),
    budget: fig(approved.amount, "derived", "Σ approved allocation amount — the certified activity-budget rule (schedule.service)", [
      { type: "activity_boq_allocation", filter: "status = approved, isActive" },
    ]),
    generatedBudget: fig(toMoneyNumber(row.budget), "projection", "Generated budget: Activity.budget as the generator or the import spread the bill — not the certified budget", [
      { type: "activity", id: activityId, field: "budget" },
    ]),
    earnedValue: fig(
      activitySummary.earnedValue,
      "derived",
      "Derived — as of now, not the official reporting-cutoff EV: Σ approved allocation amount × latest approved progress, per allocation (allocation summary scoped to this activity)",
      [{ type: "activity_boq_allocation" }, { type: "activity_progress", filter: "status = approved, latest" }],
    ),
    allocations: capped(
      allocationRows.map((allocation, index) => ({
        allocationId: allocation.id,
        status: allocation.status,
        quantity: fig(toNumber(allocation.quantity), "source", "ActivityBoqAllocation.quantity", [{ type: "activity_boq_allocation", id: allocation.id }]),
        amount: fig(toMoneyNumber(allocation.amount), "source", "ActivityBoqAllocation.amount", [{ type: "activity_boq_allocation", id: allocation.id }]),
        authorisedQuantity: fig(
          toNumber(allocation.quantity) + perAllocation[index].quantity,
          "derived",
          "Allocation quantity + Σ approved change-order allocation-link quantity (ipc.service getApprovedVariationAllowance)",
          [{ type: "activity_boq_allocation", id: allocation.id }, { type: "change_order_allocation_link", filter: "changeOrder.status = approved" }],
        ),
        boqItem: {
          id: allocation.boqItemId,
          code: allocation.boqItem?.code ?? null,
          description: allocation.boqItem?.description ?? null,
          unit: allocation.boqItem?.unit ?? null,
          href: link("boq_item", allocation.boqItemId),
        },
      })),
      allocationList.allocations.length,
      controls("mapping", { id: activityId, type: "activity" }),
    ),
  };

  if (can("progress")) {
    const [method, submissions, history, approvedCount] = await Promise.all([
      progressService.getProgressMethod({ orgId, projectId, activityId }),
      progressService.listProgressSubmissions({ orgId, projectId, activityId }),
      prisma.activityProgress.findMany({
        where: { activityId, status: "approved" },
        orderBy: [{ approvedAt: "desc" }, { updatedAt: "desc" }],
        take: LIST_CAP,
        select: {
          id: true, submissionId: true, pctComplete: true, quantityComplete: true, quantityPlanned: true, quantityUnit: true,
          progressMethod: true, source: true, approvedAt: true, approvedBy: true,
        },
      }),
      prisma.activityProgress.count({ where: { activityId, status: "approved" } }),
    ]);
    const submissionList = Array.isArray(submissions) ? submissions : submissions?.submissions || submissions?.items || [];
    sections.progress = {
      allowed: true,
      method,
      pctComplete: latest
        ? fig(toNumber(latest.pctComplete), "source", "Latest approved ActivityProgress (most recently updated)", [{ type: "activity_progress" }])
        : fig(0, "source", "No approved progress yet", []),
      progressSource: latest?.source ?? null,
      installedQuantity:
        history[0] && history[0].quantityComplete != null
          ? fig(toNumber(history[0].quantityComplete), "source", "ActivityProgress.quantityComplete on the latest approved row (quantity method)", [
              { type: "activity_progress", id: history[0].id },
            ])
          : notAvailable("PC-6", "Not available yet (PC-6): installed quantity is recorded only on quantity-method progress"),
      approvedHistory: capped(
        history.map((entry) => ({ ...entry, pctComplete: toNumber(entry.pctComplete), approvedAt: iso(entry.approvedAt) })),
        approvedCount,
        link("activity", activityId),
      ),
      submissions: capped(submissionList, submissionList.length, link("activity", activityId)),
    };
  } else {
    sections.progress = denied("progress");
  }

  // The cost module's record for the activity: committed and actual are the
  // certified writers' figures; its budget (the allocation) is in mapping.
  if (can("cost")) {
    const record = await prisma.costRecord.findFirst({
      where: { projectId, activityId },
      select: { id: true, committed: true, actual: true, forecast: true, actualThroughDate: true },
    });
    sections.cost = {
      allowed: true,
      committed: fig(record ? toMoneyNumber(record.committed) : 0, "derived", "CostRecord.committed — written only by commitment.service recomputeCommitted (SOV lines and approved CCO lines on executed commitments)", [
        { type: "cost_record", id: record?.id ?? null },
      ]),
      actual: fig(record ? toMoneyNumber(record.actual) : 0, "derived", "CostRecord.actual — kept from the cost ledger (Σ CostLedgerEntry for this activity)", [
        { type: "cost_ledger_entry", filter: "activityId" },
      ]),
      forecast:
        record && record.forecast != null
          ? fig(toMoneyNumber(record.forecast), "projection", "CostRecord.forecast as the cost module stores it", [{ type: "cost_record", id: record.id }])
          : notAvailable("PC-7", "No forecast is stored for this activity; forecast intelligence is PC-7"),
      actualThroughDate: iso(record?.actualThroughDate),
      href: link("cost_record", record?.id ?? null),
    };
  } else {
    sections.cost = denied("cost");
  }

  // Certified against this activity's allocations (the IPC module's lines).
  if (can("ipc")) {
    const ipcItems = await prisma.ipcItem.findMany({
      where: { projectId, allocation: { activityId }, status: { in: CERTIFIED_IPC_STATUSES } },
      select: { id: true, ipcPeriod: true, qty: true, currentCert: true, status: true, boqItemId: true, ipcCertificateId: true },
      orderBy: { createdAt: "desc" },
    });
    sections.certification = {
      allowed: true,
      certifiedAmount: fig(
        ipcItems.reduce((sum, entry) => addMoney(sum, entry.currentCert), 0),
        "derived",
        "Σ IpcItem.currentCert on this activity's allocations where status ∈ {certified, paid}",
        [{ type: "ipc_item", filter: "allocation.activityId, status in (certified, paid)" }],
      ),
      lines: capped(
        ipcItems.map((entry) => ({
          id: entry.id, period: entry.ipcPeriod, status: entry.status, qty: toNumber(entry.qty), currentCert: toMoneyNumber(entry.currentCert), boqItemId: entry.boqItemId, href: ipcLineHref(link, entry),
        })),
        ipcItems.length,
        link("ipc"),
      ),
    };
  } else {
    sections.certification = denied("ipc");
  }

  const changes = { allowed: can("change_order") || can("change_event") };
  let orderRows = [];
  if (can("change_order")) {
    const orders = await prisma.changeOrder.findMany({
      where: { projectId, OR: [{ activityId }, { activityLinks: { some: { activityId } } }, { allocationLinks: { some: { allocation: { activityId } } } }] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, ref: true, description: true, status: true, value: true, approvedAt: true, createdAt: true, activityId: true,
        activityLinks: { where: { activityId }, select: { id: true, relationType: true, scheduleImpactDays: true, costImpact: true, approvedScheduleImpactDays: true } },
        allocationLinks: { where: { allocation: { activityId } }, select: { id: true, allocationId: true, boqItemId: true, quantity: true, amount: true } },
      },
    });
    orderRows = orders.map((order) => ({
      // How the order reaches this activity: an order found only through an
      // allocation link says the activity is mapped (boq-figures uses it).
      matchedBy: [
        ...(order.activityId === activityId ? ["activity"] : []),
        ...(order.activityLinks.length ? ["activity_link"] : []),
        ...(order.allocationLinks.length ? ["allocation_link"] : []),
      ],
      id: order.id,
      ref: order.ref,
      description: order.description,
      status: order.status,
      value: toMoneyNumber(order.value),
      approvedAt: iso(order.approvedAt),
      createdAt: iso(order.createdAt),
      activityLinks: order.activityLinks.map((entry) => ({ ...entry, costImpact: entry.costImpact == null ? null : toMoneyNumber(entry.costImpact) })),
      allocationLinks: order.allocationLinks.map((entry) => ({
        id: entry.id,
        allocationId: entry.allocationId,
        boqItemId: entry.boqItemId,
        quantity: toNumber(entry.quantity),
        amount: toMoneyNumber(entry.amount),
        boqItemHref: entry.boqItemId ? link("boq_item", entry.boqItemId) : null,
      })),
      href: link("change_order", order.id),
    }));
    changes.changeOrders = capped(orderRows, orderRows.length, link("change_order"));
  } else {
    changes.changeOrders = denied("change_order");
  }
  if (can("change_event")) {
    const events = await prisma.changeEvent.findMany({
      where: { projectId, OR: [{ activityId }, { lines: { some: { activityId } } }] },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, title: true, status: true, changeOrderId: true, scheduleImpactDays: true, createdAt: true },
    });
    changes.changeEvents = capped(
      events.map((event) => ({ ...event, createdAt: iso(event.createdAt), href: link("change_event", event.id) })),
      events.length,
      link("change_event"),
    );
  } else {
    changes.changeEvents = denied("change_event");
  }
  sections.changes = changes.allowed ? changes : denied("change_order");

  if (can("procurement")) {
    const [packages, orders, poLines, longLead, alerts] = await Promise.all([
      prisma.procurementPackage.findMany({ where: { projectId, activityId }, select: { id: true, packageNumber: true, title: true, status: true, requiredOnSiteDate: true }, take: LIST_CAP }),
      prisma.procurementOrder.findMany({ where: { projectId, activityId }, select: { id: true, ref: true, item: true, status: true, requiredBy: true, promisedDate: true }, take: LIST_CAP }),
      prisma.procurementPoLine.findMany({
        where: { projectId, activityId },
        select: { id: true, description: true, unit: true, orderedQty: true, receivedQty: true, status: true, boqItemId: true, order: { select: { id: true, ref: true } } },
        take: LIST_CAP,
      }),
      prisma.longLeadItem.findMany({ where: { projectId, activityId }, select: { id: true, item: true, status: true, orderBy: true, expectedDeliveryDate: true, criticality: true }, take: LIST_CAP }),
      prisma.procurementLeadTimeAlert.findMany({
        where: { projectId, activityId, status: { in: ["open", "acknowledged"] } },
        select: { id: true, severity: true, reason: true, status: true, daysAtRisk: true, needDate: true },
        take: LIST_CAP,
      }),
    ]);
    sections.procurement = {
      allowed: true,
      note: "Order values are what was ordered, not committed cost",
      packages: packages.map((entry) => ({ ...entry, href: link("procurement_package", entry.id) })),
      orders: orders.map((entry) => ({ ...entry, href: link("procurement_order", entry.id) })),
      poLines: poLines.map((entry) => ({
        ...entry,
        orderedQty: toNumber(entry.orderedQty),
        receivedQty: toNumber(entry.receivedQty),
        boqItemHref: entry.boqItemId ? link("boq_item", entry.boqItemId) : null,
        order: entry.order ? { ...entry.order, href: link("procurement_order", entry.order.id) } : null,
      })),
      longLeadItems: longLead.map((entry) => ({ ...entry, href: link("procurement_package") })),
      leadTimeAlerts: alerts,
    };
  } else {
    sections.procurement = denied("procurement");
  }

  if (can("ncr") || can("inspection") || can("punch")) {
    const [ncrs, itps, punchItems] = await Promise.all([
      can("ncr") ? prisma.ncrRecord.findMany({ where: { projectId, activityId }, select: { id: true, ref: true, severity: true, status: true, description: true, dueDate: true }, take: LIST_CAP }) : null,
      can("inspection") ? prisma.itpRecord.findMany({ where: { projectId, activityId }, select: { id: true, ref: true, title: true, status: true, pointType: true, inspectionDate: true }, take: LIST_CAP }) : null,
      can("punch") && !partyScoped
        ? prisma.punchItem.findMany({ where: { projectId, activityId }, select: { id: true, number: true, title: true, status: true, priority: true }, take: LIST_CAP })
        : null,
    ]);
    sections.quality = {
      allowed: true,
      ncrs: ncrs ? { allowed: true, items: ncrs.map((entry) => ({ ...entry, href: link("ncr", entry.id) })) } : denied("ncr"),
      itps: itps ? { allowed: true, items: itps.map((entry) => ({ ...entry, href: link("itp", entry.id) })) } : denied("inspection"),
      punchItems: punchItems
        ? { allowed: true, items: punchItems.map((entry) => ({ ...entry, href: link("punch_item", entry.id) })) }
        : denied("punch", can("punch") ? PARTY_SCOPED_REASON : undefined),
    };
  } else {
    sections.quality = denied("ncr");
  }

  const [predecessors, successors, lookahead] = await Promise.all([
    prisma.activityDependency.findMany({
      where: { projectId, successorId: activityId },
      select: { id: true, relationshipType: true, lagDays: true, predecessor: { select: { id: true, name: true, activityCode: true, p6ActivityId: true } } },
    }),
    prisma.activityDependency.findMany({
      where: { projectId, predecessorId: activityId },
      select: { id: true, relationshipType: true, lagDays: true, successor: { select: { id: true, name: true, activityCode: true, p6ActivityId: true } } },
    }),
    can("lookahead") && !partyScoped
      ? prisma.lookaheadItem.findMany({
          where: { projectId, activityId, constraintStatus: "open" },
          select: { id: true, name: true, constraint: true, constraintStatus: true, constraintDueDate: true, plannedStart: true },
          take: LIST_CAP,
        })
      : null,
  ]);
  const dependencyRow = (entry, other) => ({
    id: entry.id,
    relationshipType: entry.relationshipType,
    lagDays: entry.lagDays,
    activity: other ? { id: other.id, code: activityCodeOf(other), name: other.name, href: link("activity", other.id) } : null,
  });
  sections.constraints = {
    allowed: true,
    note: "Activities carry no CPM date constraints: these are the logic ties and the open lookahead constraints",
    predecessors: predecessors.map((entry) => dependencyRow(entry, entry.predecessor)),
    successors: successors.map((entry) => dependencyRow(entry, entry.successor)),
    lookahead: lookahead
      ? { allowed: true, items: lookahead.map((entry) => ({ ...entry, href: link("lookahead", entry.id) })) }
      : denied("lookahead", can("lookahead") ? PARTY_SCOPED_REASON : undefined),
  };

  const [attachments, workflowLinks] = await Promise.all([
    attachmentService.listAttachments({ orgId, projectId, recordType: "activity", recordId: activityId, viewer: attachmentViewer }),
    prisma.workflowActivityLink.findMany({
      where: { projectId, activityId },
      select: { id: true, recordType: true, recordId: true, relationType: true, scheduleImpactDays: true },
      take: LIST_CAP,
    }),
  ]);
  const photos = attachments.items.filter((entry) => entry.role === "photo");
  const files = attachments.items.filter((entry) => entry.role !== "photo");
  sections.documents = {
    allowed: true,
    attachments: capped(files, files.length, null),
    photos: capped(photos, photos.length, null),
    linkedRecords: workflowLinks
      .filter((entry) => WORKFLOW_LINK_MODULES[entry.recordType] && can(WORKFLOW_LINK_MODULES[entry.recordType]))
      .map((entry) => ({ ...entry, href: link(entry.recordType, entry.recordId) })),
  };

  // Activity has no audit entity of its own yet (follow-up): its history is
  // the events of the records that move it, each labelled by kind.
  if (can("audit")) {
    const events = await activityHistory({
      orgId,
      projectId,
      activityId,
      allocationIds: allocationList.allocations.map((entry) => entry.id),
      changeOrders: orderRows,
    });
    sections.history = {
      allowed: true,
      note: "Activities have no audit trail of their own yet: progress-submission, allocation-approval, change-order and schedule-revision history",
      events: events.slice(0, LIST_CAP),
      total: events.length,
    };
  } else {
    sections.history = denied("audit");
  }

  return {
    kind: "activity",
    id: activityId,
    href: link("activity", activityId),
    header: {
      id: activity.id,
      code: activityCodeOf(activity),
      name: activity.name,
      p6ActivityId: activity.p6ActivityId ?? null,
      category: activity.category ?? null,
      status: activity.status ?? null,
      isActive: row.isActive,
      isMilestone: row.isMilestone,
      isCritical: Boolean(row.isCritical),
      totalFloat: row.totalFloat ?? null,
      duration: activity.duration ?? null,
      startDate: iso(activity.startDate),
      endDate: iso(activity.endDate),
      earlyStartDate: activity.earlyStartDate ?? null,
      earlyFinishDate: activity.earlyFinishDate ?? null,
      lateStartDate: activity.lateStartDate ?? null,
      lateFinishDate: activity.lateFinishDate ?? null,
      baselineStartDate: activity.baselineStartDate ?? null,
      baselineFinishDate: activity.baselineFinishDate ?? null,
      actualStart: activity.actualStart ?? null,
      actualFinish: activity.actualFinish ?? null,
    },
    sections,
  };
};

/**
 * Who is reading, as the two detail routes pass it: `can(module)` is the
 * permission module's own read decision (template, role, party, API-key
 * scope — rbac.hasPermission), and the attachment viewer is the one the
 * attachments route builds, so party-scoped members see only the files
 * their own rule admits.
 */
const detailReader = (req) => {
  const { hasPermission } = require("../middleware/rbac");
  const { isPartyScopedAccess } = require("./company-party.service");
  const partyScoped = isPartyScopedAccess(req.projectAccess || {});
  const parties = req.projectAccess?.partyAccess || [];
  const can = (moduleName) => hasPermission(req, moduleName, "read");
  return {
    can,
    partyScoped,
    attachmentViewer: {
      id: req.user.id,
      userId: req.user.id,
      canRead: can,
      partyIds: partyScoped ? parties.map((party) => party.projectPartyId).filter(Boolean) : null,
      companyIds: partyScoped ? [...new Set(parties.map((party) => party.companyId).filter(Boolean))] : null,
    },
  };
};

module.exports = {
  LIST_CAP,
  detailReader,
  getBoqItemDetail,
  getActivityDetail,
};
