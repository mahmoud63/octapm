const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const fivedee = require("./bim-5d.service");

/**
 * BIM / 5D, second batch (BIM-7..BIM-11): what a new model revision changes
 * commercially, and where quantities may be double counted or already paid.
 *
 *   BIM-7  revision diff by stable identity (the IFC GlobalId, never a row id)
 *   BIM-8  potential duplicate quantity, with the records responsible
 *   BIM-9  model change after certification: flagged, never rewritten
 *   BIM-10 an element's commercial state from progress, inspections, NCRs, IPC
 *   BIM-11 a model change under review: ignore, associate with a change event,
 *          or raise an OPEN change event - never an approved change order
 *
 * Nothing here writes an executed, approved, certified or paid quantity, and
 * nothing deletes a quantity or rewrites a certificate.
 */

const QTY = fivedee.QUANTITY_FIELDS;
const EPS = 1e-6;
const round = (value, digits = 3) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const elementSelect = { id: true, globalId: true, ifcType: true, name: true, typeName: true, objectType: true, tag: true, storeyName: true, propertiesJson: true, modelId: true, netVolume: true, grossVolume: true, netArea: true, grossArea: true, length: true, width: true, height: true, perimeter: true, weight: true, quantityCount: true };

const loadModel = async ({ orgId, projectId, modelId }) => {
  const model = await prisma.bimModel.findFirst({ where: { id: modelId, orgId, projectId }, select: { id: true, name: true, version: true, revisionCode: true, revisionDate: true, status: true, isCurrent: true, createdAt: true } });
  if (!model) throw new HttpError(404, "BIM_MODEL_NOT_FOUND", "Model not found");
  return model;
};

// ─── BIM-7: revision diff ─────────────────────────────────────────────────

const changesOf = (from, to, fromBoq, toBoq) => {
  const changes = [];
  for (const field of QTY) {
    const a = from[field];
    const b = to[field];
    if ((a === null || a === undefined) && (b === null || b === undefined)) continue;
    if (a === null || a === undefined || b === null || b === undefined || Math.abs(Number(a) - Number(b)) > EPS) changes.push({ kind: "quantity", field, from: a ?? null, to: b ?? null });
  }
  if (from.ifcType !== to.ifcType || (from.typeName || "") !== (to.typeName || "")) changes.push({ kind: "type", field: "type", from: `${from.ifcType} ${from.typeName || ""}`.trim(), to: `${to.ifcType} ${to.typeName || ""}`.trim() });
  if ((from.storeyName || "") !== (to.storeyName || "")) changes.push({ kind: fivedee.levelOf(from.storeyName) !== fivedee.levelOf(to.storeyName) ? "level" : "location", field: "storeyName", from: from.storeyName, to: to.storeyName });
  if ((from.name || "") !== (to.name || "") || (from.tag || "") !== (to.tag || "")) changes.push({ kind: "identity", field: "name", from: from.tag || from.name, to: to.tag || to.name });
  if (JSON.stringify(from.propertiesJson || {}) !== JSON.stringify(to.propertiesJson || {})) changes.push({ kind: "properties", field: "propertiesJson", from: null, to: null });
  const a = [...fromBoq].sort().join(",");
  const b = [...toBoq].sort().join(",");
  if (toBoq.size && a !== b) changes.push({ kind: "mapping", field: "boq", from: a || null, to: b || null });
  return changes;
};

/**
 * One revision against another of the same model (the previous one by
 * default). Elements are matched on the GlobalId. Each BOQ-impacting change
 * is measured by the item's own rule; its value uses the BOQ rate only for a
 * BOQ reader. `persistReviews` opens a review for each BOQ-impacting change
 * (an already-decided review keeps its decision).
 */
const compareRevisions = async ({ orgId, projectId, toModelId, fromModelId = null, reader, canReadBoq = false, persistReviews = false, limit = 400 }) => {
  const to = await loadModel({ orgId, projectId, modelId: toModelId });
  const from = fromModelId
    ? await loadModel({ orgId, projectId, modelId: fromModelId })
    : await prisma.bimModel.findFirst({ where: { orgId, projectId, name: to.name, version: { lt: to.version } }, orderBy: { version: "desc" }, select: { id: true, name: true, version: true, revisionCode: true, revisionDate: true, status: true, createdAt: true } });
  if (!from) return { model: to.name, to: fivedee.revisionLabel(to), from: null, summary: null, note: "This is the first revision of the model: nothing to compare." };
  if (from.name !== to.name) throw new HttpError(400, "BIM_DIFFERENT_MODELS", "Compare two revisions of the same model");
  const [fromElements, toElements, fromLinks, toLinks, rules] = await Promise.all([
    prisma.bimElement.findMany({ where: { modelId: from.id }, select: elementSelect }),
    prisma.bimElement.findMany({ where: { modelId: to.id }, select: elementSelect }),
    prisma.bimElementLink.findMany({ where: { modelId: from.id, recordType: "boq_item" }, select: { elementId: true, recordId: true, quantity: true } }),
    prisma.bimElementLink.findMany({ where: { modelId: to.id, recordType: "boq_item" }, select: { elementId: true, recordId: true, quantity: true } }),
    prisma.bimMeasurementRule.findMany({ where: { projectId } }),
  ]);
  const boqOf = (links) => {
    const map = new Map();
    for (const link of links) map.set(link.elementId, new Set([...(map.get(link.elementId) || []), link.recordId]));
    return map;
  };
  const fromBoq = boqOf(fromLinks);
  const toBoq = boqOf(toLinks);
  const byGlobal = (rows) => new Map(rows.map((row) => [row.globalId, row]));
  const oldMap = byGlobal(fromElements);
  const newMap = byGlobal(toElements);

  // Which BOQ item an element belongs to: its links, else the one rule that uniquely measures it.
  const ruleItemFor = (element) => {
    const matches = rules.filter((rule) => {
      const allowed = Array.isArray(rule.allowedTypes) ? rule.allowedTypes : [];
      if (allowed.length && !allowed.includes(String(element.ifcType).toUpperCase())) return false;
      const text = `${element.name || ""} ${element.typeName || ""} ${element.objectType || ""}`.toLowerCase();
      if (rule.includeText && !text.includes(rule.includeText.toLowerCase())) return false;
      if (rule.excludeText && text.includes(rule.excludeText.toLowerCase())) return false;
      return true;
    });
    return matches.length === 1 ? matches[0].boqItemId : null;
  };
  const ruleByItem = new Map(rules.map((rule) => [rule.boqItemId, rule]));
  const measured = (element, boqItemId) => {
    const rule = ruleByItem.get(boqItemId);
    if (!element || !rule) return null;
    return fivedee.measure({ element, rule, boqItem: null }).quantity;
  };

  const rows = [];
  for (const [globalId, now] of newMap) {
    const before = oldMap.get(globalId);
    if (!before) {
      const item = [...(toBoq.get(now.id) || [])][0] || ruleItemFor(now);
      rows.push({ kind: "added", globalId, element: now, before: null, boqItemId: item, delta: item ? measured(now, item) : null, changes: [] });
      continue;
    }
    const changes = changesOf(before, now, fromBoq.get(before.id) || new Set(), toBoq.get(now.id) || new Set());
    const item = [...(fromBoq.get(before.id) || toBoq.get(now.id) || [])][0] || ruleItemFor(now);
    const delta = item ? round((measured(now, item) ?? 0) - (measured(before, item) ?? 0)) : null;
    rows.push({ kind: changes.length ? "modified" : "unchanged", globalId, element: now, before, boqItemId: item, delta, changes });
  }
  for (const [globalId, before] of oldMap) {
    if (newMap.has(globalId)) continue;
    const item = [...(fromBoq.get(before.id) || [])][0] || ruleItemFor(before);
    rows.push({ kind: "removed", globalId, element: null, before, boqItemId: item, delta: item ? -(measured(before, item) ?? 0) : null, changes: [] });
  }

  const impacting = rows.filter((row) => row.kind !== "unchanged" && row.boqItemId && (row.kind !== "modified" || Math.abs(row.delta || 0) > EPS || row.changes.some((change) => ["type", "mapping"].includes(change.kind))));
  const itemIds = [...new Set(impacting.map((row) => row.boqItemId))];
  const items = itemIds.length ? await prisma.boqItem.findMany({ where: { id: { in: itemIds }, projectId }, select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true, qty: true, rate: true, isActive: true } }) : [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  let certified = new Map();
  if (canReadBoq && items.length && reader) {
    const { quantityBlocks } = require("./quantity-views.service");
    const { blocks } = await quantityBlocks({ orgId, projectId, items, can: reader.can, partyScoped: reader.partyScoped });
    certified = new Map(items.map((item) => [item.id, blocks.get(item.id)?.figures?.certified?.value ?? null]));
  }
  const byItem = itemIds.map((id) => {
    const item = itemById.get(id);
    const mine = impacting.filter((row) => row.boqItemId === id);
    const delta = round(mine.reduce((sum, row) => sum + (row.delta || 0), 0));
    const rate = canReadBoq && item ? Number(item.rate) : null;
    return {
      boqItemId: id,
      code: item ? item.code || item.ref : null,
      description: item?.description || null,
      unit: item?.unit || null,
      elements: mine.length,
      deltaQuantity: delta,
      deltaValue: rate !== null && delta !== null ? round(delta * rate, 2) : null,
      certified: certified.get(id) ?? null,
    };
  });
  const certifiedItems = new Set(byItem.filter((row) => (row.certified || 0) > 0).map((row) => row.boqItemId));
  const certifiedChanged = impacting.filter((row) => certifiedItems.has(row.boqItemId) && (row.kind === "removed" || (row.delta || 0) < 0 || row.changes.some((change) => change.kind === "quantity")));

  if (persistReviews && impacting.length) {
    for (const row of impacting) {
      await prisma.bimChangeReview.upsert({
        where: { toModelId_globalId: { toModelId: to.id, globalId: row.globalId } },
        create: { orgId, projectId, modelName: to.name, fromModelId: from.id, toModelId: to.id, globalId: row.globalId, kind: row.kind },
        update: { kind: row.kind },
      });
    }
  }
  const reviews = await prisma.bimChangeReview.findMany({ where: { toModelId: to.id }, select: { id: true, globalId: true, status: true, changeEventId: true, note: true } });
  const reviewByGlobal = new Map(reviews.map((review) => [review.globalId, review]));
  const describe = (row) => {
    const element = row.element || row.before;
    const item = row.boqItemId ? itemById.get(row.boqItemId) : null;
    return {
      kind: row.kind,
      globalId: row.globalId,
      elementId: row.element?.id || null,
      previousElementId: row.before?.id || null,
      label: element.tag || element.name,
      ifcType: element.ifcType,
      storeyName: element.storeyName,
      boqItemId: row.boqItemId,
      boqCode: item ? item.code || item.ref : null,
      deltaQuantity: row.delta,
      unit: item?.unit || null,
      certifiedOnItem: certifiedItems.has(row.boqItemId),
      changes: row.changes,
      review: reviewByGlobal.get(row.globalId) || null,
    };
  };
  const count = (kind) => rows.filter((row) => row.kind === kind).length;
  const quantityChanged = rows.filter((row) => row.changes.some((change) => change.kind === "quantity")).length;
  const potentialValue = byItem.reduce((sum, row) => sum + (row.deltaValue || 0), 0);
  return {
    model: to.name,
    from: { id: from.id, revision: fivedee.revisionLabel(from), date: (from.revisionDate || from.createdAt).toISOString() },
    to: { id: to.id, revision: fivedee.revisionLabel(to), date: (to.revisionDate || to.createdAt).toISOString() },
    summary: {
      added: count("added"),
      removed: count("removed"),
      modified: count("modified"),
      unchanged: count("unchanged"),
      quantityChanged,
      boqImpacting: impacting.length,
      previouslyCertifiedChanged: certifiedChanged.length,
      potentialVariationValue: canReadBoq ? round(potentialValue, 2) : null,
      openReviews: reviews.filter((review) => review.status === "open").length,
    },
    byBoqItem: byItem,
    changes: rows.filter((row) => row.kind !== "unchanged").slice(0, limit).map(describe),
    note: "A model change is never a contractual change by itself: review it, ignore it, associate it with an existing change event, or raise an open change event.",
  };
};

/**
 * A new revision starts with no mappings; this copies the previous revision's
 * location, WBS, activity and BOQ links onto the same elements (matched by
 * GlobalId). BOQ quantities are re-measured from the new revision by the
 * item's rule — the old quantity is never copied.
 */
const carryForward = async ({ orgId, projectId, toModelId, actor = null }) => {
  const bim = require("./bim.service");
  const to = await loadModel({ orgId, projectId, modelId: toModelId });
  const from = await prisma.bimModel.findFirst({ where: { orgId, projectId, name: to.name, version: { lt: to.version } }, orderBy: { version: "desc" }, select: { id: true } });
  if (!from) return { carried: 0, note: "No previous revision to carry mappings from." };
  const [oldElements, newElements, links] = await Promise.all([
    prisma.bimElement.findMany({ where: { modelId: from.id }, select: { id: true, globalId: true } }),
    prisma.bimElement.findMany({ where: { modelId: to.id }, select: { id: true, globalId: true } }),
    prisma.bimElementLink.findMany({ where: { modelId: from.id, recordType: { in: ["location", "activity", "wbs_node", "boq_item"] } } }),
  ]);
  const newByGlobal = new Map(newElements.map((row) => [row.globalId, row.id]));
  const oldGlobal = new Map(oldElements.map((row) => [row.id, row.globalId]));
  const groups = new Map();
  for (const link of links) {
    const target = newByGlobal.get(oldGlobal.get(link.elementId));
    if (!target) continue;
    const key = `${link.recordType}:${link.recordId}:${link.quantityField || ""}`;
    if (!groups.has(key)) groups.set(key, { link, elementIds: [] });
    groups.get(key).elementIds.push(target);
  }
  let carried = 0;
  for (const { link, elementIds } of groups.values()) {
    if (link.recordType === "boq_item") carried += (await fivedee.mapToBoq({ orgId, projectId, modelId: to.id, boqItemId: link.recordId, elementIds, quantityField: link.quantityField || null, method: "carried", actor })).mapped;
    else carried += (await bim.createLinks({ orgId, projectId, modelId: to.id, payload: { recordType: link.recordType, recordId: link.recordId, elementIds, relationType: link.relationType }, actor })).linked || 0;
  }
  return { carried, from: from.id, to: to.id };
};

// ─── BIM-8: potential duplicate quantity ──────────────────────────────────

const duplicates = async ({ orgId, projectId }) => {
  const models = await prisma.bimModel.findMany({ where: { orgId, projectId, isCurrent: true, status: "ready" }, select: { id: true, name: true, version: true, revisionCode: true, revisionDate: true } });
  const modelLabel = new Map(models.map((model) => [model.id, `${model.name} ${fivedee.revisionLabel(model)}`]));
  const sameName = await prisma.bimModel.groupBy({ by: ["name"], where: { projectId, isCurrent: true }, _count: { _all: true } });
  const links = models.length ? await prisma.bimElementLink.findMany({ where: { modelId: { in: models.map((model) => model.id) }, recordType: "boq_item" }, select: { id: true, recordId: true, quantityField: true, quantity: true, modelId: true, element: { select: { id: true, globalId: true, ifcType: true, name: true, tag: true, storeyName: true } } } }) : [];
  const items = links.length ? await prisma.boqItem.findMany({ where: { id: { in: [...new Set(links.map((link) => link.recordId))] } }, select: { id: true, code: true, ref: true } }) : [];
  const code = new Map(items.map((item) => [item.id, item.code || item.ref]));
  const findings = [];
  const group = (keyOf) => {
    const map = new Map();
    for (const link of links) {
      const key = keyOf(link);
      if (key) map.set(key, [...(map.get(key) || []), link]);
    }
    return [...map.values()].filter((rows) => rows.length > 1);
  };
  const record = (link) => ({ linkId: link.id, elementId: link.element.id, element: link.element.tag || link.element.name, globalId: link.element.globalId, model: modelLabel.get(link.modelId), boqItemId: link.recordId, boqCode: code.get(link.recordId), quantity: link.quantity, measured: link.quantityField });
  for (const rows of group((link) => `${link.element.id}:${link.quantityField}`)) findings.push({ kind: "SAME_ELEMENT_TWO_BOQ_ITEMS", label: `${rows[0].element.tag || rows[0].element.name} is measured by ${rows[0].quantityField} against ${rows.length} BOQ items`, records: rows.map(record) });
  for (const rows of group((link) => `${link.element.globalId}`)) {
    if (new Set(rows.map((row) => row.modelId)).size > 1) findings.push({ kind: "SAME_ELEMENT_TWO_MODELS", label: `GlobalId ${rows[0].element.globalId} is mapped in ${new Set(rows.map((row) => row.modelId)).size} current models`, records: rows.map(record) });
  }
  for (const rows of group((link) => `${link.modelId}:${link.recordId}:${link.element.ifcType}:${link.element.storeyName}:${link.element.tag || link.element.name}:${link.quantity}`)) findings.push({ kind: "IDENTICAL_ELEMENTS", label: `${rows.length} identical ${rows[0].element.ifcType} "${rows[0].element.tag || rows[0].element.name}" on ${rows[0].element.storeyName} measured against ${code.get(rows[0].recordId)}`, records: rows.map(record) });
  for (const row of sameName.filter((entry) => entry._count._all > 1)) findings.push({ kind: "TWO_ACTIVE_REVISIONS", label: `Model "${row.name}" has ${row._count._all} current revisions`, records: [] });
  return { findings, note: "Potential duplicates are flagged with the records responsible; nothing is deleted." };
};

// ─── BIM-10: an element's commercial state ────────────────────────────────

/**
 * Where an element stands commercially, from the project's own records:
 * its activity's official progress and the quantity entries for its BOQ item
 * there, the activity's inspection points and open NCRs, NCRs linked to the
 * element itself, and the BOQ item's certified and paid quantities (IPC).
 * Each part only where the caller may read that module (reader.can).
 */
const elementCommercialState = async ({ orgId, projectId, elementId, reader }) => {
  const element = await prisma.bimElement.findFirst({ where: { id: elementId, orgId, projectId }, select: { id: true, globalId: true, tag: true, name: true, modelId: true, model: { select: { name: true, version: true, revisionCode: true, revisionDate: true } } } });
  if (!element) throw new HttpError(404, "BIM_ELEMENT_NOT_FOUND", "Element not found");
  const links = await prisma.bimElementLink.findMany({ where: { elementId }, select: { recordType: true, recordId: true, quantity: true, unit: true } });
  const activityId = links.find((link) => link.recordType === "activity")?.recordId || null;
  const boqLink = links.find((link) => link.recordType === "boq_item") || null;
  const reasons = [];
  const out = { elementId, label: element.tag || element.name, installed: null, progress: null, inspections: [], ncrs: [], certified: null, paid: null, state: "NOT_MAPPED", reasons };

  if (activityId && reader.can("progress")) {
    // The official progress row (ActivityProgress), as quantity-views readLatestOfficialProgress reads it.
    const approved = await prisma.activityProgress.findFirst({ where: { activityId, status: "approved" }, orderBy: [{ approvedAt: "desc" }, { updatedAt: "desc" }], select: { pctComplete: true } });
    const activity = await prisma.activity.findFirst({ where: { id: activityId, projectId }, select: { physComplete: true, activityCode: true, name: true } });
    const pct = Number(approved?.pctComplete ?? activity?.physComplete ?? 0);
    const entries = boqLink ? await prisma.quantityProgressEntry.groupBy({ by: ["status"], where: { projectId, activityId, boqItemId: boqLink.recordId, status: { in: ["submitted", "approved"] } }, _sum: { quantity: true } }) : [];
    const sumOf = (status) => Number(entries.find((row) => row.status === status)?._sum.quantity || 0);
    // An element is confirmed installed only by its activity being complete or by approved quantity recorded
    // at the element's own location; an activity part-way through says nothing about one element.
    const locationId = links.find((link) => link.recordType === "location")?.recordId || null;
    const atLocation = boqLink && locationId ? await prisma.quantityProgressEntry.aggregate({ where: { projectId, activityId, boqItemId: boqLink.recordId, locationId, status: "approved" }, _sum: { quantity: true } }) : null;
    const approvedHere = Number(atLocation?._sum?.quantity || 0);
    out.progress = { activity: activity ? `${activity.activityCode || ""} ${activity.name}`.trim() : null, officialPct: pct, approvedQuantity: sumOf("approved"), submittedQuantity: sumOf("submitted"), approvedAtElementLocation: locationId ? approvedHere : null };
    out.installed = pct >= 100 || approvedHere > 0 ? true : pct > 0 ? "unconfirmed" : false;
  }
  if (activityId && reader.can("inspection")) {
    const itps = await prisma.itpRecord.findMany({ where: { projectId, activityId }, select: { id: true, ref: true, title: true, pointType: true, status: true, dueDate: true }, orderBy: { createdAt: "asc" } });
    out.inspections = itps.map((row) => ({ id: row.id, ref: row.ref, title: row.title, pointType: row.pointType, status: row.status }));
  }
  if (reader.can("ncr")) {
    const ncrIds = links.filter((link) => link.recordType === "ncr").map((link) => link.recordId);
    const ncrs = await prisma.ncrRecord.findMany({ where: { projectId, OR: [...(activityId ? [{ activityId }] : []), ...(ncrIds.length ? [{ id: { in: ncrIds } }] : [])], status: { notIn: ["closed", "void"] } }, select: { id: true, ref: true, severity: true, status: true, description: true } }).catch(() => []);
    out.ncrs = ncrs.map((row) => ({ id: row.id, ref: row.ref, severity: row.severity, status: row.status, description: String(row.description || "").slice(0, 160) }));
  }
  if (boqLink) {
    const { quantityBlocks } = require("./quantity-views.service");
    const item = await prisma.boqItem.findFirst({ where: { id: boqLink.recordId, projectId }, select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true, qty: true, isActive: true } });
    if (item) {
      const { blocks } = await quantityBlocks({ orgId, projectId, items: [item], can: reader.can, partyScoped: reader.partyScoped });
      const figures = blocks.get(item.id)?.figures || {};
      out.certified = { boqItem: item.code || item.ref, onItem: figures.certified?.value ?? null, unit: item.unit };
      out.paid = { boqItem: item.code || item.ref, onItem: figures.paid?.value ?? null, unit: item.unit };
    }
  }

  // The state, most blocking first.
  const failed = out.inspections.find((row) => row.status === "failed");
  const hold = out.inspections.find((row) => row.pointType === "hold" && !["passed", "waived"].includes(row.status));
  const pending = out.inspections.find((row) => !["passed", "waived"].includes(row.status));
  if (!activityId && !boqLink) out.state = "NOT_MAPPED";
  else if (out.installed === false) {
    out.state = "NOT_STARTED";
    reasons.push("No approved progress or approved quantity on its activity yet");
  } else if (failed) {
    out.state = "INSPECTION_FAILED";
    reasons.push(`${failed.ref} ${failed.title} failed`);
  } else if (out.ncrs.length) {
    out.state = "BLOCKED_BY_NCR";
    reasons.push(`${out.ncrs.map((ncr) => ncr.ref).join(", ")} open`);
  } else if (hold) {
    out.state = "BLOCKED_BY_HOLD_POINT";
    reasons.push(`Hold point ${hold.ref} ${hold.title} is ${hold.status}`);
  } else if (pending) {
    out.state = "INSPECTION_PENDING";
    reasons.push(`${pending.ref} ${pending.title} is ${pending.status}`);
  } else if (out.installed === "unconfirmed") {
    out.state = "ACTIVITY_IN_PROGRESS";
    reasons.push(`${out.progress.activity} is ${out.progress.officialPct}% complete (official); no approved quantity is recorded at this element's location to confirm it is installed`);
  } else if (out.installed === true) {
    out.state = "APPROVED_FOR_CERTIFICATION";
    reasons.push(`${out.progress.officialPct >= 100 ? "Activity complete" : "Approved quantity recorded at this location"}; ${out.inspections.length ? "every inspection point passed" : "no inspection point on its activity"}`);
  } else {
    out.state = "UNKNOWN";
    reasons.push("Progress is not readable to you");
  }
  if (["INSPECTION_FAILED", "BLOCKED_BY_NCR", "BLOCKED_BY_HOLD_POINT", "INSPECTION_PENDING", "NOT_STARTED", "ACTIVITY_IN_PROGRESS"].includes(out.state)) reasons.push("NOT YET APPROVED FOR CERTIFICATION");
  return out;
};

/** The element's history across revisions, by GlobalId: which revisions held it and its measured quantities. */
const elementHistory = async ({ orgId, projectId, elementId }) => {
  const element = await prisma.bimElement.findFirst({ where: { id: elementId, orgId, projectId }, select: { globalId: true, model: { select: { name: true } } } });
  if (!element) throw new HttpError(404, "BIM_ELEMENT_NOT_FOUND", "Element not found");
  const rows = await prisma.bimElement.findMany({ where: { projectId, globalId: element.globalId, model: { name: element.model.name } }, select: { id: true, netVolume: true, netArea: true, length: true, typeName: true, storeyName: true, model: { select: { version: true, revisionCode: true, revisionDate: true, createdAt: true, isCurrent: true } } }, orderBy: { model: { version: "asc" } } });
  const reviews = await prisma.bimChangeReview.findMany({ where: { projectId, globalId: element.globalId }, select: { kind: true, status: true, changeEventId: true, updatedAt: true } });
  return { globalId: element.globalId, revisions: rows.map((row) => ({ elementId: row.id, revision: fivedee.revisionLabel(row.model), date: (row.model.revisionDate || row.model.createdAt).toISOString(), isCurrent: row.model.isCurrent, netVolume: row.netVolume, netArea: row.netArea, length: row.length, typeName: row.typeName, storeyName: row.storeyName })), reviews };
};

// ─── BIM-11: model change review ──────────────────────────────────────────

const listReviews = async ({ orgId, projectId, status = null }) => {
  const rows = await prisma.bimChangeReview.findMany({ where: { orgId, projectId, ...(status ? { status } : {}) }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 500 });
  return { items: rows.map((row) => ({ id: row.id, modelName: row.modelName, kind: row.kind, globalId: row.globalId, status: row.status, changeEventId: row.changeEventId, note: row.note, decidedAt: row.decidedAt?.toISOString() || null, toModelId: row.toModelId })) };
};

/**
 * A person decides a model change: ignore it, associate it with an existing
 * change event, or raise an OPEN change event from it (a potential change,
 * priced and approved later through the change workflow). Never an approved
 * change order; never a certificate edit.
 */
const decideReview = async ({ orgId, projectId, reviewId, action, changeEventId = null, note = null, actor, canCreateChangeEvent = false, reader, canReadBoq = false }) => {
  const review = await prisma.bimChangeReview.findFirst({ where: { id: reviewId, orgId, projectId } });
  if (!review) throw new HttpError(404, "BIM_REVIEW_NOT_FOUND", "Model change review not found");
  let eventId = null;
  if (action === "associate") {
    const event = await prisma.changeEvent.findFirst({ where: { id: changeEventId, projectId }, select: { id: true } });
    if (!event) throw new HttpError(404, "CHANGE_EVENT_NOT_FOUND", "Change event not found");
    eventId = event.id;
  } else if (action === "draft_change_event") {
    if (!canCreateChangeEvent) throw Object.assign(new HttpError(403, "FORBIDDEN", "Raising a change event needs change event create access"), { details: { module: "change_event", action: "create" } });
    const diff = await compareRevisions({ orgId, projectId, toModelId: review.toModelId, reader, canReadBoq });
    const row = (diff.changes || []).find((change) => change.globalId === review.globalId);
    const item = row?.boqItemId ? await prisma.boqItem.findFirst({ where: { id: row.boqItemId, projectId }, select: { code: true, description: true, unit: true, rate: true } }) : null;
    const changeEventService = require("./change-event.service");
    const qty = Math.abs(row?.deltaQuantity || 0);
    // An omission is priced negative: a reduction must never read as added scope.
    const omission = (row?.deltaQuantity || 0) < 0 || review.kind === "removed";
    const created = await changeEventService.createChangeEvent({
      orgId,
      projectId,
      actor,
      payload: {
        title: `Model change ${diff.from?.revision || ""}→${diff.to?.revision || ""}: ${row?.label || review.globalId} (${review.kind})`.slice(0, 200),
        description: `Raised from BIM/5D revision review of "${review.modelName}". Element ${review.globalId} was ${review.kind}${row?.changes?.length ? ` (${row.changes.map((change) => `${change.field} ${change.from ?? "—"}→${change.to ?? "—"}`).join("; ")})` : ""}. Measured quantity change ${row?.deltaQuantity ?? "—"} ${row?.unit || ""} on ${row?.boqCode || "no BOQ item"}. Potential change for review; not approved.`,
        type: "design_change",
        origin: "other",
        lines: item ? [{ description: `${omission ? "OMISSION" : "ADDITION"}: ${item.code} ${item.description}`.slice(0, 500), quantity: qty || 1, unit: item.unit, unitCost: canReadBoq ? (omission ? -1 : 1) * Number(item.rate) : 0 }] : [],
      },
    });
    eventId = created.id || created.changeEvent?.id || null;
  } else if (action !== "ignore" && action !== "reopen") {
    throw new HttpError(400, "INVALID_ACTION", "Action must be ignore, associate, draft_change_event or reopen");
  }
  const status = action === "ignore" ? "ignored" : action === "reopen" ? "open" : action === "associate" ? "associated" : "draft_created";
  const updated = await prisma.bimChangeReview.update({ where: { id: review.id }, data: { status, changeEventId: action === "reopen" ? null : eventId ?? review.changeEventId, note: note ?? review.note, decidedBy: actor?.id || null, decidedAt: new Date() } });
  await auditService.recordEvent({ orgId, projectId, entityType: "bim_model", entityId: review.toModelId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { changeReview: review.globalId, decision: status, changeEventId: updated.changeEventId } }).catch(() => null);
  return { id: updated.id, status: updated.status, changeEventId: updated.changeEventId };
};

module.exports = { compareRevisions, carryForward, duplicates, elementCommercialState, elementHistory, listReviews, decideReview, _changesOf: changesOf };
