const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");

/**
 * BIM / 5D commercial intelligence (BIM-1..BIM-6).
 *
 * Built on the existing IFC register (bim.service: BimModel revisions by name
 * and version, BimElement keyed by the IFC GlobalId, BimElementLink to the
 * project's own records). This layer answers "why is this quantity
 * commercially valid?":
 *
 *   element → model revision → location / WBS / activity → BOQ item
 *     → measured quantity (BimMeasurementRule: property, conversion, rounding)
 *     → executed / approved (quantity-progress records) → certified / paid (IPC)
 *
 * Authority stays where it is: the BOQ states the contract quantity, the
 * quantity-progress engine the installed quantity, IPC the certified and paid
 * quantity (quantity-views.service quantityBlocks, read as the caller). The
 * model supplies identity, location and a measured quantity; it never writes
 * an executed, approved or certified figure.
 */

// The measured properties an element carries (bim.service QUANTITY_FIELDS) and their natural unit.
const FIELD_UNITS = Object.freeze({ netVolume: "m3", grossVolume: "m3", netArea: "m2", grossArea: "m2", length: "m", width: "m", height: "m", perimeter: "m", weight: "kg", quantityCount: "nr" });
const QUANTITY_FIELDS = Object.freeze(Object.keys(FIELD_UNITS));
const RULE_STATUS = Object.freeze({ VALID: "VALID", WARNING: "WARNING", INVALID: "INVALID", NOT_CONFIGURED: "NOT_CONFIGURED" });
const COMMERCIAL_LINKS = Object.freeze(["location", "activity", "boq_item", "wbs_node"]);
const SUPPORTED_FORMATS = Object.freeze([
  { format: "IFC", versions: ["IFC2X3", "IFC4"], status: "supported", note: "Parsed directly by OctaPM (elements, storeys, property sets, base quantities). No geometry." },
  { format: "RVT", versions: [], status: "not_supported", note: "Native Revit needs Autodesk Platform Services (not connected). Export IFC from Revit instead." },
  { format: "NWD / DWG", versions: [], status: "not_supported", note: "Not parsed." },
]);

const round = (value, digits = 3) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const num = (value) => (value === null || value === undefined ? null : Number(value));
const revisionLabel = (version) => `R${String(version).padStart(2, "0")}`;
const normUnit = (unit) => String(unit || "").toLowerCase().replace(/[²³\s.]/g, (c) => ({ "²": "2", "³": "3" })[c] || "").replace(/^sqm$/, "m2").replace(/^cum$/, "m3").replace(/^(no|nr|nos|ea|each)$/, "nr");

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// ─── BIM-1 / BIM-2: model and revision register ───────────────────────────

/** Every model of the project with its revisions, newest first. Old revisions are never overwritten. */
const revisionRegister = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.bimModel.findMany({
    where: { orgId, projectId },
    orderBy: [{ name: "asc" }, { version: "desc" }],
    select: { id: true, name: true, discipline: true, version: true, isCurrent: true, status: true, ifcSchema: true, elementCount: true, linkedCount: true, uploadedBy: true, createdAt: true, parsedAt: true, documentId: true, sourceDocument: { select: { originalName: true, sha256: true, title: true } } },
  });
  const byName = new Map();
  for (const row of rows) {
    if (!byName.has(row.name)) byName.set(row.name, []);
    byName.get(row.name).push(row);
  }
  const models = [...byName.entries()].map(([name, revisions]) => {
    const latest = revisions[0];
    return {
      name,
      discipline: latest.discipline,
      currentRevisionId: revisions.find((rev) => rev.isCurrent)?.id || latest.id,
      latestRevision: revisionLabel(latest.version),
      revisions: revisions.map((rev) => ({
        id: rev.id,
        revision: revisionLabel(rev.version),
        version: rev.version,
        isCurrent: rev.isCurrent,
        status: rev.status,
        revisionDate: rev.createdAt.toISOString(),
        uploadedBy: rev.uploadedBy,
        uploadedAt: rev.createdAt.toISOString(),
        parsedAt: rev.parsedAt ? rev.parsedAt.toISOString() : null,
        sourceFormat: rev.ifcSchema ? `IFC (${rev.ifcSchema})` : "IFC",
        documentId: rev.documentId,
        fileName: rev.sourceDocument?.originalName || null,
        checksum: rev.sourceDocument?.sha256 || null,
        previousRevisionId: revisions.find((other) => other.version === rev.version - 1)?.id || null,
        elementCount: rev.elementCount,
        linkedCount: rev.linkedCount,
      })),
    };
  });
  return { models, formats: SUPPORTED_FORMATS };
};

/** The project's current, parsed revisions (one per model name). */
const currentModels = (projectId) =>
  prisma.bimModel.findMany({ where: { projectId, isCurrent: true, status: "ready" }, select: { id: true, name: true, version: true, discipline: true, elementCount: true, createdAt: true } });

// ─── BIM-5: measurement rules ─────────────────────────────────────────────

const loadBoqItem = async ({ projectId, boqItemId }) => {
  const item = await prisma.boqItem.findFirst({ where: { id: boqItemId, projectId }, select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true, qty: true, isActive: true } });
  if (!item) throw new HttpError(404, "BOQ_ITEM_NOT_FOUND", "BOQ item not found");
  return item;
};

const serializeRule = (rule) => (rule ? { id: rule.id, boqItemId: rule.boqItemId, quantityField: rule.quantityField, allowedTypes: Array.isArray(rule.allowedTypes) ? rule.allowedTypes : [], factor: rule.factor, rounding: rule.rounding, unit: rule.unit, includeText: rule.includeText, excludeText: rule.excludeText, notes: rule.notes, updatedAt: rule.updatedAt?.toISOString?.() || null } : null);

const listRules = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.bimMeasurementRule.findMany({ where: { orgId, projectId }, orderBy: { createdAt: "asc" } });
  return { items: rows.map(serializeRule), quantityFields: QUANTITY_FIELDS };
};

const upsertRule = async ({ orgId, projectId, boqItemId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const item = await loadBoqItem({ projectId, boqItemId });
  if (!QUANTITY_FIELDS.includes(payload.quantityField)) throw new HttpError(400, "INVALID_QUANTITY_FIELD", `quantityField must be one of ${QUANTITY_FIELDS.join(", ")}`);
  const allowedTypes = [...new Set((Array.isArray(payload.allowedTypes) ? payload.allowedTypes : []).map((type) => String(type).trim().toUpperCase()).filter(Boolean))];
  const factor = payload.factor === undefined || payload.factor === null ? 1 : Number(payload.factor);
  if (!Number.isFinite(factor) || factor <= 0) throw new HttpError(400, "INVALID_FACTOR", "factor must be a positive number");
  const rounding = payload.rounding === undefined || payload.rounding === null ? 3 : Number(payload.rounding);
  if (!Number.isInteger(rounding) || rounding < 0 || rounding > 6) throw new HttpError(400, "INVALID_ROUNDING", "rounding must be 0 to 6 decimals");
  const data = { quantityField: payload.quantityField, allowedTypes, factor, rounding, unit: payload.unit ? String(payload.unit).trim() : item.unit || null, includeText: payload.includeText ? String(payload.includeText).trim() : null, excludeText: payload.excludeText ? String(payload.excludeText).trim() : null, notes: payload.notes ? String(payload.notes).trim() : null, updatedBy: actor?.id || null };
  const rule = await prisma.bimMeasurementRule.upsert({ where: { projectId_boqItemId: { projectId, boqItemId } }, create: { orgId, projectId, boqItemId, ...data, createdBy: actor?.id || null }, update: data });
  await auditService.recordEvent({ orgId, projectId, entityType: "bim_model", entityId: rule.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { measurementRule: item.code || item.id, quantityField: rule.quantityField, factor: rule.factor, allowedTypes } }).catch(() => null);
  return serializeRule(rule);
};

const textOf = (element) => `${element.name || ""} ${element.typeName || ""} ${element.objectType || ""}`.toLowerCase();

/**
 * Is this element measured against this BOQ item the contractual way?
 * Deterministic, from the item's rule; the AI never decides it.
 */
const ruleCheck = ({ element, link, rule, boqItem }) => {
  if (!rule) return { status: RULE_STATUS.NOT_CONFIGURED, reasons: ["No measurement rule is set for this BOQ item"] };
  const reasons = [];
  let status = RULE_STATUS.VALID;
  const downgrade = (to, reason) => {
    reasons.push(reason);
    if (to === RULE_STATUS.INVALID || status === RULE_STATUS.VALID) status = to;
  };
  const allowed = Array.isArray(rule.allowedTypes) ? rule.allowedTypes : [];
  if (allowed.length && !allowed.includes(String(element.ifcType).toUpperCase())) downgrade(RULE_STATUS.INVALID, `${element.ifcType} is not a type this BOQ item measures (${allowed.join(", ")})`);
  if (link?.quantityField && link.quantityField !== rule.quantityField) downgrade(RULE_STATUS.INVALID, `Measured by ${link.quantityField}; the rule measures ${rule.quantityField}`);
  if (element[rule.quantityField] === null || element[rule.quantityField] === undefined) downgrade(RULE_STATUS.INVALID, `The element carries no ${rule.quantityField}`);
  else if (Number(element[rule.quantityField]) === 0) downgrade(RULE_STATUS.WARNING, `${rule.quantityField} is 0`);
  if (rule.includeText && !textOf(element).includes(rule.includeText.toLowerCase())) downgrade(RULE_STATUS.WARNING, `Name/type does not contain "${rule.includeText}"`);
  if (rule.excludeText && textOf(element).includes(rule.excludeText.toLowerCase())) downgrade(RULE_STATUS.INVALID, `Name/type contains excluded "${rule.excludeText}"`);
  const ruleUnit = normUnit(rule.unit || boqItem?.unit);
  const fieldUnit = FIELD_UNITS[rule.quantityField];
  if (boqItem?.unit && ruleUnit && normUnit(boqItem.unit) !== ruleUnit) downgrade(RULE_STATUS.WARNING, `Rule unit ${rule.unit} differs from the BOQ unit ${boqItem.unit}`);
  if (ruleUnit && fieldUnit && ruleUnit !== fieldUnit && Number(rule.factor) === 1) downgrade(RULE_STATUS.WARNING, `${rule.quantityField} is in ${fieldUnit}; the BOQ is in ${rule.unit || boqItem?.unit} with no conversion factor`);
  return { status, reasons };
};

/** An element's measured quantity for a BOQ item: the property, raw value, conversion and result. */
const measure = ({ element, rule, boqItem, quantityField = null }) => {
  const field = quantityField || rule?.quantityField || null;
  if (!field || !QUANTITY_FIELDS.includes(field)) return { quantityField: null, rawQuantity: null, factor: null, quantity: null, unit: boqItem?.unit || null };
  const raw = num(element[field]);
  const factor = rule && rule.quantityField === field ? Number(rule.factor) : 1;
  const digits = rule ? rule.rounding : 3;
  return { quantityField: field, rawQuantity: raw, factor, quantity: raw === null ? null : round(raw * factor, digits), unit: (rule && rule.unit) || boqItem?.unit || FIELD_UNITS[field] };
};

// ─── BIM-4: mapping ───────────────────────────────────────────────────────

const loadModel = async ({ orgId, projectId, modelId }) => {
  const model = await prisma.bimModel.findFirst({ where: { id: modelId, orgId, projectId }, select: { id: true, name: true, version: true, status: true, isCurrent: true } });
  if (!model) throw new HttpError(404, "BIM_MODEL_NOT_FOUND", "Model not found");
  return model;
};

const elementSelect = { id: true, globalId: true, ifcType: true, name: true, typeName: true, objectType: true, tag: true, storeyName: true, modelId: true, netVolume: true, grossVolume: true, netArea: true, grossArea: true, length: true, width: true, height: true, perimeter: true, weight: true, quantityCount: true };

const refreshCounts = async (modelId, elementIds) => {
  for (const elementId of elementIds) {
    const linkCount = await prisma.bimElementLink.count({ where: { elementId } });
    await prisma.bimElement.update({ where: { id: elementId }, data: { linkCount } });
  }
  const linked = await prisma.bimElement.count({ where: { modelId, linkCount: { gt: 0 } } });
  await prisma.bimModel.update({ where: { id: modelId }, data: { linkedCount: linked } });
};

/**
 * Elements → one BOQ item, each with its measured quantity and provenance
 * (property, raw, factor, converted, unit, method, actor). Re-mapping the same
 * element re-measures it; nothing is summed twice.
 */
const mapToBoq = async ({ orgId, projectId, modelId, boqItemId, elementIds = [], quantityField = null, method = "manual", actor = null }) => {
  await loadModel({ orgId, projectId, modelId });
  const boqItem = await loadBoqItem({ projectId, boqItemId });
  if (quantityField && !QUANTITY_FIELDS.includes(quantityField)) throw new HttpError(400, "INVALID_QUANTITY_FIELD", `quantityField must be one of ${QUANTITY_FIELDS.join(", ")}`);
  const ids = [...new Set(elementIds)].slice(0, 5000);
  if (!ids.length) throw new HttpError(400, "ELEMENTS_REQUIRED", "Choose at least one element");
  const elements = await prisma.bimElement.findMany({ where: { id: { in: ids }, modelId, projectId }, select: elementSelect });
  if (elements.length !== ids.length) throw new HttpError(404, "BIM_ELEMENT_NOT_FOUND", "One or more elements are not in this model");
  const rule = await prisma.bimMeasurementRule.findUnique({ where: { projectId_boqItemId: { projectId, boqItemId } } });
  const results = [];
  for (const element of elements) {
    const measured = measure({ element, rule, boqItem, quantityField });
    const data = { relationType: "represents", quantityField: measured.quantityField, rawQuantity: measured.rawQuantity, factor: measured.factor, quantity: measured.quantity, unit: measured.unit, method };
    const link = await prisma.bimElementLink.upsert({
      where: { elementId_recordType_recordId: { elementId: element.id, recordType: "boq_item", recordId: boqItemId } },
      create: { orgId, projectId, modelId, elementId: element.id, recordType: "boq_item", recordId: boqItemId, createdBy: actor?.id || null, ...data },
      update: data,
    });
    results.push({ elementId: element.id, globalId: element.globalId, linkId: link.id, ...measured, check: ruleCheck({ element, link, rule, boqItem }) });
  }
  await refreshCounts(modelId, ids);
  return { boqItemId, mapped: results.length, quantity: round(results.reduce((sum, row) => sum + (row.quantity || 0), 0)), unit: results[0]?.unit || boqItem.unit, items: results };
};

const LEVEL_WORDS = [[/\b(ground|gf|g\/f)\b/, 0], [/\b(basement|b)\s*0*(\d+)\b/, (m) => -Number(m[2])], [/\b(roof)\b/, 99]];
/** A storey or location name's level number, when it names one ("Level 03", "L3", "Ground floor"). */
const levelOf = (text) => {
  const value = String(text || "").toLowerCase();
  const explicit = /\b(?:level|lvl|floor|l)\s*-?0*(\d{1,3})\b/.exec(value);
  if (explicit) return Number(explicit[1]);
  for (const [pattern, out] of LEVEL_WORDS) {
    const match = pattern.exec(value);
    if (match) return typeof out === "function" ? out(match) : out;
  }
  return null;
};

/**
 * Suggestions, never applied by themselves: a location for each element by its
 * storey (matched on the level number against the project's own locations), a
 * BOQ item for each unmapped element whose type a measurement rule measures.
 */
const suggestions = async ({ orgId, projectId, modelId }) => {
  await loadModel({ orgId, projectId, modelId });
  const [elements, locations, rules, links] = await Promise.all([
    prisma.bimElement.findMany({ where: { modelId, projectId }, select: elementSelect }),
    prisma.location.findMany({ where: { projectId, archivedAt: null }, select: { id: true, name: true, code: true, kind: true } }).catch(() => []),
    prisma.bimMeasurementRule.findMany({ where: { projectId } }),
    prisma.bimElementLink.findMany({ where: { modelId, recordType: { in: ["location", "boq_item"] } }, select: { elementId: true, recordType: true } }),
  ]);
  const has = new Set(links.map((link) => `${link.elementId}:${link.recordType}`));
  const locationByLevel = new Map();
  for (const location of locations) {
    const level = levelOf(`${location.name} ${location.code || ""}`);
    if (level !== null && !locationByLevel.has(level)) locationByLevel.set(level, location);
  }
  const boqItems = rules.length ? await prisma.boqItem.findMany({ where: { id: { in: rules.map((rule) => rule.boqItemId) } }, select: { id: true, code: true, description: true, unit: true } }) : [];
  const itemById = new Map(boqItems.map((item) => [item.id, item]));
  const location = [];
  const boq = [];
  for (const element of elements) {
    if (!has.has(`${element.id}:location`)) {
      const level = levelOf(element.storeyName);
      const match = level !== null ? locationByLevel.get(level) : null;
      if (match) location.push({ elementId: element.id, globalId: element.globalId, storeyName: element.storeyName, locationId: match.id, locationName: match.name, basis: `storey "${element.storeyName}" is level ${level}` });
    }
    if (!has.has(`${element.id}:boq_item`)) {
      const candidates = rules.filter((rule) => {
        const allowed = Array.isArray(rule.allowedTypes) ? rule.allowedTypes : [];
        if (allowed.length && !allowed.includes(String(element.ifcType).toUpperCase())) return false;
        if (rule.includeText && !textOf(element).includes(rule.includeText.toLowerCase())) return false;
        if (rule.excludeText && textOf(element).includes(rule.excludeText.toLowerCase())) return false;
        return element[rule.quantityField] !== null && element[rule.quantityField] !== undefined;
      });
      if (candidates.length === 1) {
        const item = itemById.get(candidates[0].boqItemId);
        boq.push({ elementId: element.id, globalId: element.globalId, ifcType: element.ifcType, boqItemId: candidates[0].boqItemId, boqCode: item?.code || null, boqDescription: item?.description || null, basis: `measurement rule of ${item?.code || "the item"} measures ${element.ifcType}` });
      } else if (candidates.length > 1) {
        boq.push({ elementId: element.id, globalId: element.globalId, ifcType: element.ifcType, boqItemId: null, ambiguous: candidates.map((rule) => itemById.get(rule.boqItemId)?.code || rule.boqItemId), basis: "more than one BOQ rule measures this element type: map it by hand" });
      }
    }
  }
  return { location, boq };
};

/** Apply the unambiguous suggestions (method "rule"); a person chose to. */
const applySuggestions = async ({ orgId, projectId, modelId, kinds = ["location", "boq"], actor = null }) => {
  const bim = require("./bim.service");
  const found = await suggestions({ orgId, projectId, modelId });
  let locations = 0;
  let boqLinks = 0;
  if (kinds.includes("location")) {
    const byLocation = new Map();
    for (const row of found.location) byLocation.set(row.locationId, [...(byLocation.get(row.locationId) || []), row.elementId]);
    for (const [locationId, elementIds] of byLocation) {
      await bim.createLinks({ orgId, projectId, modelId, payload: { recordType: "location", recordId: locationId, elementIds, relationType: "represents" }, actor });
      locations += elementIds.length;
    }
  }
  if (kinds.includes("boq")) {
    const byItem = new Map();
    for (const row of found.boq.filter((row) => row.boqItemId)) byItem.set(row.boqItemId, [...(byItem.get(row.boqItemId) || []), row.elementId]);
    for (const [boqItemId, elementIds] of byItem) boqLinks += (await mapToBoq({ orgId, projectId, modelId, boqItemId, elementIds, method: "rule", actor })).mapped;
  }
  return { locations, boqLinks };
};

// ─── BIM-5: why this quantity? ────────────────────────────────────────────

const nameOf = async (recordType, recordId) => {
  if (recordType === "location") return prisma.location.findFirst({ where: { id: recordId }, select: { id: true, name: true, code: true, kind: true } }).then((row) => row && { id: row.id, label: row.name, kind: row.kind });
  if (recordType === "activity") return prisma.activity.findFirst({ where: { id: recordId }, select: { id: true, name: true, activityCode: true } }).then((row) => row && { id: row.id, label: `${row.activityCode ? `${row.activityCode} ` : ""}${row.name}` });
  if (recordType === "wbs_node") return prisma.wbsNode.findFirst({ where: { id: recordId }, select: { id: true, code: true, name: true } }).then((row) => row && { id: row.id, label: `${row.code ? `${row.code} ` : ""}${row.name}` });
  return null;
};

/** The quantity's full provenance for one element and BOQ item: model, revision, property, rule, raw, converted, links, actor. */
const provenance = async ({ orgId, projectId, elementId, boqItemId = null }) => {
  const element = await prisma.bimElement.findFirst({ where: { id: elementId, orgId, projectId }, select: { ...elementSelect, model: { select: { id: true, name: true, version: true, discipline: true, createdAt: true, isCurrent: true } } } });
  if (!element) throw new HttpError(404, "BIM_ELEMENT_NOT_FOUND", "Element not found");
  const links = await prisma.bimElementLink.findMany({ where: { elementId }, orderBy: { createdAt: "asc" } });
  const boqLinks = links.filter((link) => link.recordType === "boq_item" && (!boqItemId || link.recordId === boqItemId));
  const context = {};
  for (const type of ["location", "activity", "wbs_node"]) {
    const link = links.find((row) => row.recordType === type);
    context[type] = link ? await nameOf(type, link.recordId) : null;
  }
  const quantities = [];
  for (const link of boqLinks) {
    const item = await prisma.boqItem.findFirst({ where: { id: link.recordId, projectId }, select: { id: true, code: true, description: true, unit: true, qty: true } });
    const rule = await prisma.bimMeasurementRule.findUnique({ where: { projectId_boqItemId: { projectId, boqItemId: link.recordId } } });
    const actor = link.createdBy ? await prisma.user.findFirst({ where: { id: link.createdBy }, select: { name: true } }).catch(() => null) : null;
    quantities.push({
      boqItem: item ? { id: item.id, code: item.code, description: item.description, unit: item.unit } : { id: link.recordId },
      measurement: link.quantityField,
      measurementRule: serializeRule(rule),
      rawQuantity: link.rawQuantity,
      rawUnit: link.quantityField ? FIELD_UNITS[link.quantityField] : null,
      factor: link.factor,
      quantity: link.quantity,
      unit: link.unit,
      method: link.method,
      mappedBy: actor?.name || null,
      mappedAt: link.createdAt.toISOString(),
      check: ruleCheck({ element, link, rule, boqItem: item }),
    });
  }
  return {
    element: { id: element.id, globalId: element.globalId, ifcType: element.ifcType, name: element.name, typeName: element.typeName, tag: element.tag, storeyName: element.storeyName },
    source: { modelId: element.model.id, model: element.model.name, revision: revisionLabel(element.model.version), discipline: element.model.discipline, revisionDate: element.model.createdAt.toISOString(), isCurrentRevision: element.model.isCurrent },
    location: context.location,
    activity: context.activity,
    wbs: context.wbs_node,
    quantities,
    measured: Object.fromEntries(QUANTITY_FIELDS.filter((field) => element[field] !== null && element[field] !== undefined).map((field) => [field, { value: element[field], unit: FIELD_UNITS[field] }])),
  };
};

// ─── BIM-6: commercial reconciliation ─────────────────────────────────────

const STATUS_ORDER = ["UNMAPPED", "OVER_CONTRACT", "BELOW_CERTIFIED", "UNDER_CONTRACT", "RULE_ISSUES", "MATCHED"];

/**
 * Per BOQ item: contract (BOQ), current BIM measured (current revisions'
 * BOQ links), executed (submitted quantity entries, not yet approved),
 * approved/installed, certified and paid (quantityBlocks, the official
 * quantity engine, read as the caller), and the difference. `reader` is the
 * caller's own detail reader (can(module), partyScoped).
 */
const reconciliation = async ({ orgId, projectId, reader, tolerancePct = 2 }) => {
  await ensureProject({ orgId, projectId });
  const { quantityBlocks } = require("./quantity-views.service");
  const [items, models] = await Promise.all([
    prisma.boqItem.findMany({ where: { projectId, isActive: true }, select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true, qty: true, isActive: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    currentModels(projectId),
  ]);
  const modelIds = models.map((model) => model.id);
  const links = modelIds.length ? await prisma.bimElementLink.findMany({ where: { projectId, modelId: { in: modelIds }, recordType: "boq_item" }, select: { recordId: true, quantity: true, elementId: true, quantityField: true, element: { select: { ...elementSelect } } } }) : [];
  const rules = await prisma.bimMeasurementRule.findMany({ where: { projectId } });
  const ruleByItem = new Map(rules.map((rule) => [rule.boqItemId, rule]));
  const canProgress = reader.can("progress");
  const executedRows = canProgress && items.length ? await prisma.quantityProgressEntry.groupBy({ by: ["boqItemId"], where: { projectId, status: "submitted" }, _sum: { quantity: true } }) : [];
  const executed = new Map(executedRows.map((row) => [row.boqItemId, Number(row._sum.quantity || 0)]));
  const { blocks } = items.length ? await quantityBlocks({ orgId, projectId, items, can: reader.can, partyScoped: reader.partyScoped }) : { blocks: new Map() };
  const figure = (block, key) => (block?.figures?.[key] ? { value: block.figures[key].value, available: block.figures[key].value !== null, reason: block.figures[key].notAvailable?.reason || null } : { value: null, available: false, reason: "Not available" });
  const rows = items.map((item) => {
    const mine = links.filter((link) => link.recordId === item.id);
    const rule = ruleByItem.get(item.id) || null;
    const bim = mine.length ? round(mine.reduce((sum, link) => sum + (link.quantity || 0), 0)) : null;
    const checks = mine.map((link) => ruleCheck({ element: link.element, link, rule, boqItem: item }).status);
    const block = blocks.get(item.id);
    const certified = figure(block, "certified");
    const contract = round(item.qty);
    const difference = bim === null ? null : round(bim - contract);
    let status = "MATCHED";
    if (!mine.length) status = "UNMAPPED";
    else if (certified.value !== null && bim !== null && bim < certified.value) status = "BELOW_CERTIFIED";
    else if (contract && difference > (contract * tolerancePct) / 100) status = "OVER_CONTRACT";
    else if (contract && difference < -(contract * tolerancePct) / 100) status = "UNDER_CONTRACT";
    else if (checks.some((check) => check !== RULE_STATUS.VALID)) status = "RULE_ISSUES";
    return {
      boqItemId: item.id,
      code: item.code || item.ref || "",
      description: item.description,
      unit: item.unit,
      contract,
      bim,
      mappedElements: mine.length,
      executed: canProgress ? round(executed.get(item.id) || 0) : null,
      approved: figure(block, "installed"),
      certified,
      paid: figure(block, "paid"),
      variation: difference !== null && difference > 0 ? difference : null,
      difference,
      status,
      rule: rule ? { quantityField: rule.quantityField, status: checks.length ? (checks.includes("INVALID") ? "INVALID" : checks.includes("WARNING") ? "WARNING" : "VALID") : "VALID" } : { quantityField: null, status: RULE_STATUS.NOT_CONFIGURED },
      ruleChecks: { valid: checks.filter((c) => c === "VALID").length, warning: checks.filter((c) => c === "WARNING").length, invalid: checks.filter((c) => c === "INVALID").length, notConfigured: checks.filter((c) => c === "NOT_CONFIGURED").length },
    };
  });
  rows.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return {
    models: models.map((model) => ({ id: model.id, name: model.name, revision: revisionLabel(model.version) })),
    tolerancePct,
    rows,
    basis: {
      contract: "BoqItem.qty (the BOQ)",
      bim: "Σ measured quantity of current-revision elements mapped to the item (measurement rule or chosen property)",
      executed: "Σ quantity entries submitted and not yet approved (quantity progress)",
      approved: "Installed: Σ approved quantity entries (the official quantity engine)",
      certified: "Σ certified IPC lines (IPC)",
      paid: "Certified on paid certificates (IPC)",
    },
  };
};

/** The current-revision elements measured against one BOQ item, each with its quantity and rule check. */
const boqItemElements = async ({ orgId, projectId, boqItemId }) => {
  await ensureProject({ orgId, projectId });
  const item = await loadBoqItem({ projectId, boqItemId });
  const models = await currentModels(projectId);
  const rule = await prisma.bimMeasurementRule.findUnique({ where: { projectId_boqItemId: { projectId, boqItemId } } });
  const links = models.length ? await prisma.bimElementLink.findMany({ where: { projectId, modelId: { in: models.map((model) => model.id) }, recordType: "boq_item", recordId: boqItemId }, select: { id: true, quantityField: true, rawQuantity: true, factor: true, quantity: true, unit: true, method: true, modelId: true, element: { select: elementSelect } }, orderBy: { createdAt: "asc" }, take: 5000 }) : [];
  const modelName = new Map(models.map((model) => [model.id, `${model.name} ${revisionLabel(model.version)}`]));
  return {
    boqItem: { id: item.id, code: item.code || item.ref || "", description: item.description, unit: item.unit, contract: round(item.qty) },
    rule: serializeRule(rule),
    total: round(links.reduce((sum, link) => sum + (link.quantity || 0), 0)),
    items: links.map((link) => ({
      linkId: link.id,
      elementId: link.element.id,
      globalId: link.element.globalId,
      ifcType: link.element.ifcType,
      name: link.element.name,
      tag: link.element.tag,
      storeyName: link.element.storeyName,
      model: modelName.get(link.modelId),
      quantityField: link.quantityField,
      rawQuantity: link.rawQuantity,
      factor: link.factor,
      quantity: link.quantity,
      unit: link.unit,
      method: link.method,
      check: ruleCheck({ element: link.element, link, rule, boqItem: item }),
    })),
  };
};

// ─── BIM-1: overview and alerts ───────────────────────────────────────────

/** The BIM/5D landing: models, latest revisions, mapping coverage, the quantity states and the alerts. */
const overview = async ({ orgId, projectId, reader, canReadBoq }) => {
  await ensureProject({ orgId, projectId });
  const models = await currentModels(projectId);
  const modelIds = models.map((model) => model.id);
  const totalModels = await prisma.bimModel.groupBy({ by: ["name"], where: { projectId } }).then((rows) => rows.length);
  const [elementCount, links] = await Promise.all([
    modelIds.length ? prisma.bimElement.count({ where: { modelId: { in: modelIds } } }) : 0,
    modelIds.length ? prisma.bimElementLink.findMany({ where: { modelId: { in: modelIds }, recordType: { in: COMMERCIAL_LINKS } }, select: { elementId: true, recordType: true, recordId: true, quantityField: true, quantity: true, element: { select: { globalId: true, storeyName: true, modelId: true } } } }) : [],
  ]);
  const byElement = new Map();
  for (const link of links) byElement.set(link.elementId, [...(byElement.get(link.elementId) || []), link]);
  const mapped = byElement.size;
  const withBoq = new Set(links.filter((link) => link.recordType === "boq_item").map((link) => link.elementId)).size;
  const withLocation = new Set(links.filter((link) => link.recordType === "location").map((link) => link.elementId)).size;

  // Location conflicts: an element tied to more than one location, or to one whose level is not the element's storey level.
  const locationIds = [...new Set(links.filter((link) => link.recordType === "location").map((link) => link.recordId))];
  const locations = locationIds.length ? await prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true, code: true } }) : [];
  const locationLevel = new Map(locations.map((row) => [row.id, levelOf(`${row.name} ${row.code || ""}`)]));
  let locationConflicts = 0;
  for (const [, rows] of byElement) {
    const locs = rows.filter((row) => row.recordType === "location");
    if (locs.length > 1) locationConflicts += 1;
    else if (locs.length === 1) {
      const elementLevel = levelOf(locs[0].element.storeyName);
      const linkedLevel = locationLevel.get(locs[0].recordId);
      if (elementLevel !== null && linkedLevel !== null && linkedLevel !== undefined && elementLevel !== linkedLevel) locationConflicts += 1;
    }
  }
  // Potential duplicates (BIM-8 extends): one element measured against two BOQ items by the same property; one GlobalId mapped to BOQ in two current models.
  const boqLinks = links.filter((link) => link.recordType === "boq_item");
  const perElementField = new Map();
  for (const link of boqLinks) {
    const key = `${link.elementId}:${link.quantityField}`;
    perElementField.set(key, (perElementField.get(key) || 0) + 1);
  }
  const sameMeasureTwice = [...perElementField.values()].filter((count) => count > 1).length;
  const globalModels = new Map();
  for (const link of boqLinks) globalModels.set(link.element.globalId, new Set([...(globalModels.get(link.element.globalId) || []), link.element.modelId]));
  const acrossModels = [...globalModels.values()].filter((set) => set.size > 1).length;
  const openReviews = await prisma.bimChangeReview.count({ where: { projectId, status: "open" } });

  let quantities = null;
  let changedAfterCertification = null;
  if (canReadBoq) {
    const recon = await reconciliation({ orgId, projectId, reader });
    const mappedRows = recon.rows.filter((row) => row.mappedElements > 0);
    const sum = (pick) => {
      const units = [...new Set(mappedRows.map((row) => row.unit))];
      if (units.length !== 1) return { value: null, unit: null, byUnit: units.map((unit) => ({ unit, value: round(mappedRows.filter((row) => row.unit === unit).reduce((acc, row) => acc + (pick(row) || 0), 0)) })) };
      return { value: round(mappedRows.reduce((acc, row) => acc + (pick(row) || 0), 0)), unit: units[0] };
    };
    quantities = {
      note: mappedRows.length ? `Across ${mappedRows.length} BOQ item${mappedRows.length === 1 ? "" : "s"} with mapped elements; quantities in different units are shown per unit, never added.` : "No BOQ item has mapped elements yet.",
      contract: sum((row) => row.contract),
      bim: sum((row) => row.bim),
      executed: sum((row) => row.executed),
      approved: sum((row) => row.approved.value),
      certified: sum((row) => row.certified.value),
      paid: sum((row) => row.paid.value),
      potentialChange: sum((row) => (row.variation !== null ? row.variation : 0)),
    };
    changedAfterCertification = recon.rows.filter((row) => row.status === "BELOW_CERTIFIED").length;
  }

  const alert = (key, label, count, severity, action) => ({ key, label, count, severity: count ? severity : "ok", action });
  return {
    models: { count: totalModels, current: models.map((model) => ({ id: model.id, name: model.name, discipline: model.discipline, revision: revisionLabel(model.version), elements: model.elementCount, revisionDate: model.createdAt.toISOString() })) },
    elements: { total: elementCount, mapped, unmapped: elementCount - mapped, mappedPct: elementCount ? round((mapped / elementCount) * 100, 1) : 0, unmappedPct: elementCount ? round(((elementCount - mapped) / elementCount) * 100, 1) : 0, withBoq, withLocation },
    quantities,
    alerts: [
      alert("BIM_UNMAPPED", "Unmapped BIM elements", elementCount - mapped, "warning", "mapping"),
      alert("BIM_NO_BOQ", "Elements without a BOQ item", elementCount - withBoq, "warning", "mapping"),
      alert("BIM_LOCATION_MISSING", "Elements without a location", elementCount - withLocation, "info", "mapping"),
      alert("BIM_LOCATION_CONFLICT", "Elements in the wrong location", locationConflicts, "critical", "mapping"),
      alert("BIM_CHANGED_AFTER_CERTIFICATION", "Quantity below what is already certified", changedAfterCertification ?? 0, "critical", "reconciliation"),
      alert("BIM_POTENTIAL_DUPLICATE", "Potential duplicate quantity", sameMeasureTwice + acrossModels, "critical", "reconciliation"),
      alert("BIM_CHANGE_REVIEW", "Model changes needing commercial review", openReviews, "warning", "changes"),
    ],
    formats: SUPPORTED_FORMATS,
  };
};

module.exports = { FIELD_UNITS, QUANTITY_FIELDS, RULE_STATUS, SUPPORTED_FORMATS, revisionLabel, levelOf, revisionRegister, listRules, upsertRule, ruleCheck, measure, mapToBoq, suggestions, applySuggestions, provenance, reconciliation, boqItemElements, overview };
