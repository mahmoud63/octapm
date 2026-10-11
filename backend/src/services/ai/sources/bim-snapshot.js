/**
 * BIM / 5D for Ask OctaPM (BIM-12): the deterministic BIM/5D results as
 * sources — models and revisions, mapping coverage, the commercial
 * reconciliation per BOQ item, the latest revision impact and potential
 * duplicates. The AI explains these; it never measures, certifies or
 * computes a quantity. Read as the caller: bim:read for models and
 * elements, the BOQ quantities only with canReadBoq, the official
 * installed / certified / paid figures through the quantity engine's can().
 */
const { hasPermission } = require("../../../middleware/rbac");
const { canReadBoq } = require("../../../utils/boq-figures");

const fmt = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 }));
const fig = (figure) => (figure && figure.available ? fmt(figure.value) : "not available");
const fact = (line) => `FACT: ${line}`;

const bimSources = async ({ view, projectId }) => {
  if (!view?.user || !hasPermission(view, "bim", "read")) return [];
  const fivedee = require("../../bim-5d.service");
  const changes = require("../../bim-5d-changes.service");
  const { detailReader } = require("../../controls-detail.service");
  const reader = detailReader(view);
  const boq = canReadBoq(view);
  const orgId = view.user.orgId;
  const overview = await fivedee.overview({ orgId, projectId, reader, canReadBoq: boq });
  const lines = [
    fact(`BIM models: ${overview.models.count}; current revisions: ${overview.models.current.map((model) => `${model.name} ${model.revision} (${model.elements} elements, ${model.revisionDate.slice(0, 10)})`).join("; ") || "none"}`),
    fact(`Elements ${overview.elements.total}: mapped ${overview.elements.mapped} (${overview.elements.mappedPct}%), unmapped ${overview.elements.unmapped}, with a BOQ item ${overview.elements.withBoq}, with a location ${overview.elements.withLocation}`),
    ...overview.alerts.filter((alert) => alert.count).map((alert) => fact(`Alert ${alert.key}: ${alert.label} — ${alert.count}`)),
  ];
  const sources = [];
  if (boq) {
    const recon = await fivedee.reconciliation({ orgId, projectId, reader });
    lines.push(fact("Quantity states per BOQ item come from their own authorities: contract = BOQ; BIM = current-revision elements measured by the item's rule; executed = submitted, not yet approved; approved = official installed; certified and paid = IPC. They are never merged."));
    for (const row of recon.rows) lines.push(fact(`BOQ ${row.code} ${row.description} (${row.unit}): contract ${fmt(row.contract)}, BIM ${fmt(row.bim)} from ${row.mappedElements} elements, executed ${fmt(row.executed)}, approved ${fig(row.approved)}, certified ${fig(row.certified)}, paid ${fig(row.paid)}, difference ${fmt(row.difference)}, status ${row.status}, measurement rule ${row.rule.quantityField || "not configured"} (${row.rule.status})`));
    for (const model of overview.models.current) {
      const diff = await changes.compareRevisions({ orgId, projectId, toModelId: model.id, reader, canReadBoq: true }).catch(() => null);
      if (!diff?.summary) continue;
      const s = diff.summary;
      lines.push(fact(`Revision impact ${model.name} ${diff.to.revision} vs ${diff.from.revision}: added ${s.added}, removed ${s.removed}, modified ${s.modified}, unchanged ${s.unchanged}, quantity changed ${s.quantityChanged}, BOQ-impacting ${s.boqImpacting}, previously certified changed ${s.previouslyCertifiedChanged}, potential variation value ${fmt(s.potentialVariationValue)}, open reviews ${s.openReviews}`));
      for (const row of diff.byBoqItem || []) lines.push(fact(`Revision impact on ${row.code}: ${row.elements} elements, quantity change ${fmt(row.deltaQuantity)} ${row.unit}, value at BOQ rate ${fmt(row.deltaValue)}, certified to date ${fmt(row.certified)}`));
      for (const change of (diff.changes || []).slice(0, 15)) lines.push(fact(`Model change: ${change.kind} ${change.label} (${change.ifcType}, ${change.storeyName || "—"}) on ${change.boqCode || "no BOQ item"}, quantity change ${fmt(change.deltaQuantity)} ${change.unit || ""}${change.certifiedOnItem ? ", on a BOQ item with certified quantity" : ""}${change.changes.length ? `; ${change.changes.map((item) => `${item.field} ${item.from ?? "—"}→${item.to ?? "—"}`).join("; ")}` : ""}; review ${change.review?.status || "none"}`));
    }
    const dup = await changes.duplicates({ orgId, projectId });
    lines.push(fact(`Potential duplicate quantity findings: ${dup.findings.length}`));
    for (const finding of dup.findings.slice(0, 8)) lines.push(fact(`POTENTIAL DUPLICATE: ${finding.label}`));
  } else {
    lines.push(fact("BOQ quantities are not shown: the caller cannot read the BOQ on this project."));
  }
  sources.push({ id: `${projectId}:bim5d`, type: "bim_facts", typeLabel: "BIM / 5D (OctaPM commercial reconciliation)", title: "BIM / 5D", ref: null, status: null, projectId, projectName: null, url: `/projects/${projectId}?module=bim`, snippet: null, text: lines.join("\n") });
  return sources;
};

/** One element on the caller's screen: its quantity provenance and commercial state, as text. */
const bimElementSource = async ({ view, projectId, recordId }) => {
  if (!view?.user || !hasPermission(view, "bim", "read")) return null;
  const fivedee = require("../../bim-5d.service");
  const changes = require("../../bim-5d-changes.service");
  const { detailReader } = require("../../controls-detail.service");
  const reader = detailReader(view);
  const boq = canReadBoq(view);
  const orgId = view.user.orgId;
  const provenance = await fivedee.provenance({ orgId, projectId, elementId: recordId }).catch(() => null);
  if (!provenance) return null;
  const state = await changes.elementCommercialState({ orgId, projectId, elementId: recordId, reader }).catch(() => null);
  const history = await changes.elementHistory({ orgId, projectId, elementId: recordId }).catch(() => null);
  const e = provenance.element;
  const lines = [
    `Element ${e.tag || e.name} (${e.ifcType}${e.typeName ? `, ${e.typeName}` : ""}), GlobalId ${e.globalId}`,
    `Source ${provenance.source.model} ${provenance.source.revision}${provenance.source.isCurrentRevision ? " (current)" : " (superseded)"}, ${provenance.source.revisionDate.slice(0, 10)}`,
    `Location ${provenance.location?.label || "not mapped"}; model storey ${e.storeyName || "—"}; WBS ${provenance.wbs?.label || "—"}; activity ${provenance.activity?.label || "—"}`,
    ...(boq ? provenance.quantities.map((q) => `Quantity for BOQ ${q.boqItem.code} ${q.boqItem.description || ""}: ${q.measurement} raw ${fmt(q.rawQuantity)} ${q.rawUnit || ""} × ${q.factor ?? "—"} = ${fmt(q.quantity)} ${q.unit || ""}; rule check ${q.check.status}${q.check.reasons.length ? ` (${q.check.reasons.join("; ")})` : ""}; mapped ${q.method}${q.mappedBy ? ` by ${q.mappedBy}` : ""} on ${q.mappedAt.slice(0, 10)}`) : ["BOQ quantities are not shown: the caller cannot read the BOQ on this project."]),
    ...(state ? [`Commercial state ${state.state}: ${state.reasons.join("; ")}`, `Progress: ${state.progress ? `${state.progress.activity} ${state.progress.officialPct}% official, approved at this location ${fmt(state.progress.approvedAtElementLocation)}` : "not readable"}; inspections: ${state.inspections.map((row) => `${row.ref} ${row.pointType} ${row.status}`).join(", ") || "none"}; open NCRs: ${state.ncrs.map((row) => row.ref).join(", ") || "none"}${boq && state.certified ? `; BOQ item certified to date ${fmt(state.certified.onItem)} ${state.certified.unit || ""}, paid ${fmt(state.paid?.onItem)}` : ""}`] : []),
    ...(history ? [`Revision history: ${history.revisions.map((rev) => `${rev.revision} vol ${fmt(rev.netVolume)} area ${fmt(rev.netArea)} ${rev.storeyName || ""}`).join("; ")}`] : []),
  ];
  return { id: recordId, type: "bim_element", typeLabel: "BIM element on your screen", module: "bim", title: `${e.tag || e.name} (${e.ifcType})`, ref: e.tag || null, status: state?.state || null, projectId, projectName: null, url: `/projects/${projectId}?module=bim`, snippet: null, text: lines.join("\n") };
};

module.exports = { bimSources, bimElementSource };
