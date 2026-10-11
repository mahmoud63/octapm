const ExcelJS = require("exceljs");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { brandWorkbook } = require("../utils/export-branding");
const fivedee = require("./bim-5d.service");

/**
 * BIM / 5D exports (XLSX, or CSV of the main sheet): the element register,
 * the commercial reconciliation, the mapping register and the revision
 * impact. Every figure comes from the same services the screens use; BOQ
 * codes and quantities appear only for a BOQ reader (the reconciliation and
 * the per-item revision impact need BOQ read outright). Element-level
 * contract / approved / certified / paid columns are the figures of the
 * element's BOQ item — certification is per BOQ item, never per element.
 */

const KINDS = Object.freeze({
  elements: "BIM element register",
  reconciliation: "Commercial reconciliation",
  mapping: "Mapping register",
  "revision-impact": "Revision impact",
});
const BOQ_ONLY = Object.freeze(["reconciliation"]);

const IFC_CATEGORY = (ifcType) => {
  const body = String(ifcType || "").replace(/^IFC/i, "").toLowerCase();
  return body ? body.charAt(0).toUpperCase() + body.slice(1) : "";
};
const fig = (figure) => (figure && figure.available ? figure.value : null);
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

/** Labels for the records links point at, read in bulk. */
const recordLabels = async (links) => {
  const ids = (type) => [...new Set(links.filter((link) => link.recordType === type).map((link) => link.recordId))];
  const [locations, activities, wbs, boq] = await Promise.all([
    prisma.location.findMany({ where: { id: { in: ids("location") } }, select: { id: true, name: true } }),
    prisma.activity.findMany({ where: { id: { in: ids("activity") } }, select: { id: true, activityCode: true, name: true } }),
    prisma.wbsNode.findMany({ where: { id: { in: ids("wbs_node") } }, select: { id: true, code: true, name: true } }),
    prisma.boqItem.findMany({ where: { id: { in: ids("boq_item") } }, select: { id: true, code: true, ref: true, description: true, unit: true } }),
  ]);
  const labels = new Map();
  for (const row of locations) labels.set(`location:${row.id}`, row.name);
  for (const row of activities) labels.set(`activity:${row.id}`, `${row.activityCode ? `${row.activityCode} ` : ""}${row.name}`);
  for (const row of wbs) labels.set(`wbs_node:${row.id}`, `${row.code ? `${row.code} ` : ""}${row.name}`);
  for (const row of boq) labels.set(`boq_item:${row.id}`, row.code || row.ref || row.id);
  return { labels, boq: new Map(boq.map((row) => [row.id, row])) };
};

const currentModels = (orgId, projectId) =>
  prisma.bimModel.findMany({ where: { orgId, projectId, isCurrent: true, status: "ready" }, orderBy: { name: "asc" }, select: { id: true, name: true, version: true, revisionCode: true, revisionDate: true, discipline: true } });

const elementRegister = async ({ orgId, projectId, reader, canReadBoq }) => {
  const models = await currentModels(orgId, projectId);
  const modelIds = models.map((model) => model.id);
  const [elements, links] = await Promise.all([
    modelIds.length ? prisma.bimElement.findMany({ where: { modelId: { in: modelIds } }, orderBy: [{ storeyName: "asc" }, { ifcType: "asc" }, { name: "asc" }], take: 100_000, select: { id: true, modelId: true, globalId: true, ifcType: true, typeName: true, name: true, tag: true, storeyName: true } }) : [],
    modelIds.length ? prisma.bimElementLink.findMany({ where: { modelId: { in: modelIds } }, select: { elementId: true, recordType: true, recordId: true, quantityField: true, quantity: true, unit: true } }) : [],
  ]);
  const { labels } = await recordLabels(links);
  const recon = canReadBoq ? await fivedee.reconciliation({ orgId, projectId, reader }) : null;
  const itemRow = new Map((recon?.rows || []).map((row) => [row.boqItemId, row]));
  const byElement = new Map();
  for (const link of links) byElement.set(link.elementId, [...(byElement.get(link.elementId) || []), link]);
  const modelOf = new Map(models.map((model) => [model.id, model]));
  const rows = [];
  for (const element of elements) {
    const mine = byElement.get(element.id) || [];
    const first = (type) => mine.find((link) => link.recordType === type);
    const location = first("location");
    const wbs = first("wbs_node");
    const activity = first("activity");
    const boqLinks = mine.filter((link) => link.recordType === "boq_item");
    const present = [location, activity, boqLinks.length ? boqLinks[0] : null].filter(Boolean).length;
    const mapping = !mine.length ? "Unmapped" : present === 3 ? "Mapped" : `Partly mapped (${[!location && "no location", !activity && "no activity", !boqLinks.length && "no BOQ item"].filter(Boolean).join(", ")})`;
    const model = modelOf.get(element.modelId);
    const base = {
      model: model?.name,
      revision: fivedee.revisionLabel(model),
      globalId: element.globalId,
      category: IFC_CATEGORY(element.ifcType),
      ifcType: element.ifcType,
      type: element.typeName || "",
      element: element.tag || element.name || "",
      level: element.storeyName || "",
      location: location ? labels.get(`location:${location.recordId}`) || "" : "",
      wbs: wbs ? labels.get(`wbs_node:${wbs.recordId}`) || "" : "",
      activity: activity ? labels.get(`activity:${activity.recordId}`) || "" : "",
      mappingStatus: mapping,
    };
    if (!canReadBoq || !boqLinks.length) {
      rows.push(base);
      continue;
    }
    // One row per BOQ item the element is measured against.
    for (const link of boqLinks) {
      const item = itemRow.get(link.recordId);
      rows.push({
        ...base,
        boqCode: labels.get(`boq_item:${link.recordId}`) || "",
        measurement: link.quantityField || "",
        bimQuantity: link.quantity,
        unit: link.unit || item?.unit || "",
        itemContract: item?.contract ?? null,
        itemExecuted: item?.executed ?? null,
        itemApproved: fig(item?.approved),
        itemCertified: fig(item?.certified),
        itemPaid: fig(item?.paid),
        itemVariation: item?.variation ?? null,
        commercialStatus: item?.status || "",
      });
    }
  }
  const columns = [
    ["Model", "model", 22], ["Revision", "revision", 9], ["GlobalId", "globalId", 24], ["Category", "category", 16], ["IFC type", "ifcType", 18], ["Type", "type", 26], ["Element", "element", 22], ["Level", "level", 14], ["Location", "location", 18], ["WBS", "wbs", 18], ["Activity", "activity", 30], ["Mapping status", "mappingStatus", 30],
    ...(canReadBoq
      ? [["BOQ code", "boqCode", 10], ["Measurement", "measurement", 12], ["BIM quantity", "bimQuantity", 12], ["Unit", "unit", 7], ["BOQ item contract qty", "itemContract", 14], ["BOQ item executed (pending approval)", "itemExecuted", 16], ["BOQ item approved (installed)", "itemApproved", 16], ["BOQ item certified", "itemCertified", 14], ["BOQ item paid", "itemPaid", 12], ["BOQ item variation (BIM above contract)", "itemVariation", 16], ["Commercial status (BOQ item)", "commercialStatus", 18]]
      : []),
  ];
  const notes = [
    "Current revision of each model. Contract, executed, approved, certified and paid are the figures of the element's BOQ item (certification is per BOQ item, never per element), each from its own authority.",
    ...(canReadBoq ? [] : ["BOQ codes and quantities are not included: you cannot read the BOQ on this project."]),
  ];
  return { sheets: [{ name: "Elements", columns, rows }], notes };
};

const reconciliationSheet = async ({ orgId, projectId, reader }) => {
  const recon = await fivedee.reconciliation({ orgId, projectId, reader });
  const rows = recon.rows.map((row) => ({
    code: row.code, description: row.description, unit: row.unit, contract: row.contract, bim: row.bim, mappedElements: row.mappedElements,
    executed: row.executed, approved: fig(row.approved), certified: fig(row.certified), paid: fig(row.paid),
    difference: row.difference, variation: row.variation, status: row.status, rule: row.rule.quantityField || "Not configured", ruleStatus: row.rule.status,
  }));
  const columns = [["BOQ code", "code", 10], ["Description", "description", 40], ["Unit", "unit", 7], ["Contract", "contract", 12], ["BIM (current revisions)", "bim", 14], ["Mapped elements", "mappedElements", 10], ["Executed (pending approval)", "executed", 14], ["Approved (installed)", "approved", 14], ["Certified", "certified", 12], ["Paid", "paid", 12], ["BIM − contract", "difference", 12], ["Potential variation", "variation", 12], ["Status", "status", 16], ["Measurement rule", "rule", 14], ["Rule check", "ruleStatus", 12]];
  return { sheets: [{ name: "Reconciliation", columns, rows }], notes: [`Tolerance ${recon.tolerancePct}%. ${Object.entries(recon.basis).map(([key, text]) => `${key}: ${text}`).join(" · ")}`] };
};

const mappingRegister = async ({ orgId, projectId, canReadBoq }) => {
  const models = await currentModels(orgId, projectId);
  const modelOf = new Map(models.map((model) => [model.id, model]));
  const links = models.length
    ? await prisma.bimElementLink.findMany({ where: { modelId: { in: models.map((model) => model.id) }, ...(canReadBoq ? {} : { recordType: { not: "boq_item" } }) }, orderBy: [{ createdAt: "asc" }], take: 200_000, select: { modelId: true, recordType: true, recordId: true, relationType: true, quantityField: true, rawQuantity: true, factor: true, quantity: true, unit: true, method: true, createdBy: true, createdAt: true, element: { select: { globalId: true, ifcType: true, tag: true, name: true, storeyName: true } } } })
    : [];
  const { labels } = await recordLabels(links);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(links.map((link) => link.createdBy).filter(Boolean))] } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  const TYPE = { location: "Location", activity: "Activity", wbs_node: "WBS", boq_item: "BOQ item", punch_item: "Punch item", rfi: "RFI", ncr: "NCR", observation: "Observation" };
  const rows = links.map((link) => ({
    model: modelOf.get(link.modelId)?.name, revision: fivedee.revisionLabel(modelOf.get(link.modelId)), globalId: link.element.globalId, element: link.element.tag || link.element.name || "", category: IFC_CATEGORY(link.element.ifcType), level: link.element.storeyName || "",
    linkedTo: TYPE[link.recordType] || link.recordType, record: labels.get(`${link.recordType}:${link.recordId}`) || link.recordId,
    measurement: link.quantityField || "", raw: link.rawQuantity, factor: link.factor, quantity: link.quantity, unit: link.unit || "", method: link.method || "", mappedBy: users.get(link.createdBy) || "", mappedAt: day(link.createdAt),
  }));
  const columns = [["Model", "model", 22], ["Revision", "revision", 9], ["GlobalId", "globalId", 24], ["Element", "element", 22], ["Category", "category", 16], ["Level", "level", 14], ["Linked to", "linkedTo", 12], ["Record", "record", 30], ["Measurement", "measurement", 12], ["Raw quantity", "raw", 12], ["Factor", "factor", 8], ["Quantity", "quantity", 12], ["Unit", "unit", 7], ["Method", "method", 10], ["Mapped by", "mappedBy", 18], ["Mapped on", "mappedAt", 12]];
  return { sheets: [{ name: "Mappings", columns, rows }], notes: canReadBoq ? [] : ["BOQ links are not included: you cannot read the BOQ on this project."] };
};

const revisionImpact = async ({ orgId, projectId, reader, canReadBoq }) => {
  const changes = require("./bim-5d-changes.service");
  const models = await currentModels(orgId, projectId);
  const summary = [];
  const changeRows = [];
  const itemRows = [];
  for (const model of models) {
    const diff = await changes.compareRevisions({ orgId, projectId, toModelId: model.id, reader, canReadBoq });
    if (!diff.summary) {
      summary.push({ model: model.name, to: diff.to, from: "—", note: diff.note });
      continue;
    }
    summary.push({ model: model.name, from: diff.from.revision, to: diff.to.revision, ...diff.summary });
    for (const change of diff.changes || []) {
      changeRows.push({ model: model.name, from: diff.from.revision, to: diff.to.revision, kind: change.kind, globalId: change.globalId, element: change.label, category: IFC_CATEGORY(change.ifcType), level: change.storeyName || "", ...(canReadBoq ? { boqCode: change.boqCode || "", delta: change.deltaQuantity, unit: change.unit || "", certifiedOnItem: change.certifiedOnItem ? "Yes" : "" } : {}), changes: (change.changes || []).map((item) => `${item.field}: ${item.from ?? "—"} → ${item.to ?? "—"}`).join("; "), review: change.review?.status || "" });
    }
    if (canReadBoq) for (const row of diff.byBoqItem || []) itemRows.push({ model: model.name, code: row.code, description: row.description, unit: row.unit, elements: row.elements, delta: row.deltaQuantity, value: row.deltaValue, certified: row.certified });
  }
  const sheets = [
    { name: "Changes", columns: [["Model", "model", 22], ["From", "from", 8], ["To", "to", 8], ["Change", "kind", 10], ["GlobalId", "globalId", 24], ["Element", "element", 20], ["Category", "category", 14], ["Level", "level", 12], ...(canReadBoq ? [["BOQ code", "boqCode", 10], ["Quantity change", "delta", 12], ["Unit", "unit", 7], ["BOQ item already certified", "certifiedOnItem", 12]] : []), ["What changed", "changes", 50], ["Commercial review", "review", 14]], rows: changeRows },
    { name: "Summary", columns: [["Model", "model", 22], ["From", "from", 8], ["To", "to", 8], ["Added", "added", 8], ["Removed", "removed", 8], ["Modified", "modified", 8], ["Unchanged", "unchanged", 10], ["Quantity changed", "quantityChanged", 10], ["BOQ-impacting", "boqImpacting", 10], ["Previously certified changed", "previouslyCertifiedChanged", 12], ...(canReadBoq ? [["Potential variation value", "potentialVariationValue", 14]] : []), ["Open reviews", "openReviews", 10], ["Note", "note", 30]], rows: summary },
    ...(canReadBoq ? [{ name: "By BOQ item", columns: [["Model", "model", 22], ["BOQ code", "code", 10], ["Description", "description", 36], ["Unit", "unit", 7], ["Elements", "elements", 9], ["Quantity change", "delta", 12], ["Value at BOQ rate", "value", 14], ["Certified to date", "certified", 14]], rows: itemRows }] : []),
  ];
  return { sheets, notes: ["Current revision of each model against its previous revision, matched by IFC GlobalId. A potential change is not a variation until it is approved."] };
};

const buildExport = async ({ orgId, projectId, kind, reader, canReadBoq }) => {
  if (!KINDS[kind]) throw new HttpError(400, "VALIDATION_ERROR", "Unknown export");
  if (BOQ_ONLY.includes(kind) && !canReadBoq) throw Object.assign(new HttpError(403, "FORBIDDEN", "This export states BOQ quantities; it needs BOQ read access on this project"), { details: { module: "boq", action: "read" } });
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  const built =
    kind === "elements" ? await elementRegister({ orgId, projectId, reader, canReadBoq })
      : kind === "reconciliation" ? await reconciliationSheet({ orgId, projectId, reader })
        : kind === "mapping" ? await mappingRegister({ orgId, projectId, canReadBoq })
          : await revisionImpact({ orgId, projectId, reader, canReadBoq });
  return { ...built, title: KINDS[kind], project: project.name };
};

const fileBase = (project, title) => `${project} - ${title} - ${new Date().toISOString().slice(0, 10)}`.replace(/[\\/:*?"<>|\r\n]+/g, " ").slice(0, 150);

const toWorkbook = ({ sheets, notes, title, project }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OctaPM";
  workbook.created = new Date();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.columns = sheet.columns.map(([header, key, width]) => ({ header, key, width }));
    for (const row of sheet.rows) ws.addRow(row);
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  if (notes?.length) {
    const about = workbook.addWorksheet("Notes");
    about.columns = [{ header: "Notes", key: "note", width: 120 }];
    for (const note of notes) about.addRow({ note });
  }
  brandWorkbook(workbook, { title: `${title} — ${project}` });
  return { workbook, filename: `${fileBase(project, title)}.xlsx` };
};

const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // A cell starting with = + - @ is read as a formula by spreadsheets: neutralise it.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const toCsv = ({ sheets, title, project }) => {
  const [sheet] = sheets;
  const lines = [sheet.columns.map(([header]) => csvCell(header)).join(","), ...sheet.rows.map((row) => sheet.columns.map(([, key]) => csvCell(row[key])).join(","))];
  return { body: `﻿${lines.join("\r\n")}\r\n`, filename: `${fileBase(project, title)}.csv` };
};

module.exports = { KINDS, buildExport, toWorkbook, toCsv, _csvCell: csvCell };
