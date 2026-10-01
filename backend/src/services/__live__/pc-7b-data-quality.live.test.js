/**
 * PC-7b data quality (docs/project-controls/OCTAPM_CHANGE_INTELLIGENCE.md §7)
 * — the data-quality rules of the exception engine, proven against the real
 * local Postgres in throwaway "LiveTest <uuid>" organisations.
 *
 * Two projects are built directly (fixture rows in this LiveTest org only):
 *   gaps  — every §7 gap the rules know, each set up once on purpose;
 *   clean — the same kinds of records with nothing wrong.
 * Each rule is evaluated standalone (exception-rules/data-quality.js), as the
 * engine will call it, and asserted row by row: subject, measured / limit and
 * their basis. Then: no rule writes anything (every row of the organisation
 * compared before and after), a rule asked for a project under another
 * organisation sees nothing, and — once exception-engine.service.js is on the
 * base — the engine itself opens, refreshes and resolves the rows. Until the
 * engine merges, that part is skipped and says why (the orchestrator re-runs
 * this file after the merge).
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run -s test:live -- src/services/__live__/pc-7b-data-quality.live.test.js
 */
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const RULES = require("../exception-rules/data-quality");

// ─── the engine, through a tiny adapter ───────────────────────────────────
const optional = (path, name) => {
  try {
    return require(path);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND" && error.message.includes(name)) return null;
    throw error;
  }
};
const engine = optional("../exception-engine.service", "exception-engine.service");
const ENGINE_ABSENT = "[skipped: backend/src/services/exception-engine.service.js is not on this base; the orchestrator re-runs this file after the engine track merges]";
const engineIt = (name, fn, timeout) => (engine ? it(name, fn, timeout) : it.skip(`${ENGINE_ABSENT} ${name}`, fn, timeout));

// ─── every row of the organisation ("writes nothing") ─────────────────────
const scalarField = (model, name) => model.fields.some((field) => field.name === name && field.kind === "scalar");
const THROUGH_ACTIVITY = new Set(["ActivityProgress", "ActivityAssignment", "ActivityEquipment"]);
const scopeOf = (model) => {
  if (model.name === "Organisation") return ({ orgId }) => ({ id: orgId });
  if (scalarField(model, "orgId")) return ({ orgId }) => ({ orgId });
  if (scalarField(model, "projectId")) return ({ projectIds }) => ({ projectId: { in: projectIds } });
  if (THROUGH_ACTIVITY.has(model.name)) return ({ projectIds }) => ({ activity: { projectId: { in: projectIds } } });
  return null;
};
const SCOPED = Prisma.dmmf.datamodel.models
  .map((model) => ({
    name: model.name,
    delegate: model.name[0].toLowerCase() + model.name.slice(1),
    key: model.primaryKey?.fields?.length ? model.primaryKey.fields : model.fields.filter((field) => field.isId).map((field) => field.name),
    where: scopeOf(model),
  }))
  .filter((table) => table.where);
const stable = (value) => JSON.stringify(value, (key, inner) => (typeof inner === "bigint" ? `${inner}n` : inner));
const everyRow = async (scope) => {
  const snapshot = new Map();
  for (let index = 0; index < SCOPED.length; index += 3) {
    await Promise.all(SCOPED.slice(index, index + 3).map(async (table) => {
      const found = await prisma[table.delegate].findMany({ where: table.where(scope) });
      snapshot.set(table.name, new Map(found.map((row) => [table.key.map((field) => stable(row[field])).join("|"), stable(row)])));
    }));
  }
  return snapshot;
};
const changesBetween = (before, after) => {
  const changes = [];
  for (const [name, rowsAfter] of after) {
    const rowsBefore = before.get(name) || new Map();
    for (const [key, row] of rowsAfter) if (rowsBefore.get(key) !== row) changes.push(`${name} ${key}: ${rowsBefore.has(key) ? "changed" : "added"}`);
    for (const key of rowsBefore.keys()) if (!rowsAfter.has(key)) changes.push(`${name} ${key}: removed`);
  }
  return changes;
};

const ruleOf = (kind) => {
  const rule = RULES.find((entry) => entry.kind === kind);
  if (!rule) throw new Error(`no data-quality rule ${kind}`);
  return rule;
};
const NOW = new Date();
const DAY = 86_400_000;
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY);
const n = (value) => Number(value);

liveDescribe("PC-7b data quality: the §7 kinds are rules of the one engine, read-only, each citing its evidence", () => {
  let live;
  let other;
  const gaps = {};
  const clean = {};

  const evaluate = (kind, built, { orgId = live.org.id, ctx = {} } = {}) => ruleOf(kind).evaluate({ orgId, projectId: built.project.id, cutoff: NOW, ctx });
  const bySubject = (rows) => new Map(rows.map((row) => [`${row.subjectType}:${row.subjectId}${row.secondarySubjectId ? `:${row.secondarySubjectId}` : ""}`, row]));

  /** A project with the records every rule reads; `gap` sets each §7 gap up on purpose. */
  const build = async (target, { gap }) => {
    const orgId = live.org.id;
    const tag = `${gap ? "gaps" : "clean"}-${Date.now().toString(36)}`;
    const project = await prisma.project.create({
      data: { orgId, name: `LiveTest PC-7b data quality ${tag}`, status: "active", contractValue: gap ? 100000 : 50000, startDate: new Date("2026-01-05"), endDate: new Date("2027-06-30") },
    });
    target.project = project;
    const costCode = await prisma.costCode.create({ data: { orgId, code: `LT7B-${tag}`, name: "LiveTest data quality" } });
    await prisma.projectCostCode.create({ data: { orgId, projectId: project.id, costCodeId: costCode.id } });
    target.line = await prisma.budgetLine.create({ data: { orgId, projectId: project.id, costCodeId: costCode.id, costType: "material", originalBudget: gap ? 80000 : 50000 } });

    // Structure: both projects have a WBS node; only the clean one has a
    // location and files its rows and activities under the node and a cost code.
    target.wbs = await prisma.wbsNode.create({ data: { orgId, projectId: project.id, code: "DQ", name: "LiveTest scope", path: "DQ" } });
    if (!gap) target.location = await prisma.location.create({ data: { orgId, projectId: project.id, name: "LiveTest level 1", code: "L1", path: "L1" } });
    const filed = gap ? {} : { wbsNodeId: target.wbs.id };

    const activity = (code, extra = {}) =>
      prisma.activity.create({ data: { projectId: project.id, name: `LiveTest ${code}`, activityCode: code, duration: 10, startDate: new Date("2026-02-02"), endDate: new Date("2026-02-13"), ...filed, ...extra } });
    target.a1 = await activity("DQ-A1", { budget: gap ? 0 : 50000 });
    target.a2 = await activity("DQ-A2", { budget: gap ? 7000 : 0 });
    target.a3 = await activity("DQ-A3", { budget: 0 });

    const itemFiling = gap ? {} : { wbsNodeId: target.wbs.id, costCodeId: costCode.id };
    target.item = await prisma.boqItem.create({ data: { projectId: project.id, code: "DQ.1", description: "LiveTest concrete", unit: "m3", qty: 10, rate: 5000, amount: 50000, ...itemFiling } });
    // A second, unpriced row: a unit nobody recognises on the gaps project.
    target.item2 = await prisma.boqItem.create({ data: { projectId: project.id, code: "DQ.2", description: "LiveTest sundries", unit: gap ? "cubbits" : "m2", qty: 1, rate: 0, amount: 0, ...itemFiling } });
    // Units: on the gaps project A1 is measured in m2 against its m3 row, and
    // an executed commitment's SOV line names the row in tonnes.
    if (gap) {
      await prisma.activityProgressMethod.create({ data: { projectId: project.id, activityId: target.a1.id, method: "quantity", quantityUnit: "m2", plannedQuantity: 10 } });
      const commitment = await prisma.commitment.create({ data: { orgId, projectId: project.id, number: 1, ref: `SC-${tag}`, title: "LiveTest subcontract", status: "executed" } });
      await prisma.commitmentSovLine.create({ data: { orgId, projectId: project.id, commitmentId: commitment.id, lineNumber: 1, description: "LiveTest concrete", boqItemId: target.item.id, unit: "t", qty: 5, rate: 100, amount: 500 } });
    }
    target.allocation = await prisma.activityBoqAllocation.create({
      data: { projectId: project.id, boqItemId: target.item.id, activityId: target.a1.id, quantity: 10, amount: 50000, weight: 100, status: "approved", approvedAt: daysAgo(30) },
    });
    if (gap) {
      await prisma.budgetRevision.create({ data: { projectId: project.id, ref: "BR-DQ1", title: "LiveTest addition", changeType: "addition", amount: 1000, status: "approved", effectiveDate: daysAgo(20), approvedAt: daysAgo(20) } });
    }

    // Cost records: A1 a NULL-source forecast (gap) or an entered one;
    // A2 a default the actual has passed (gap) or a default above it; A3
    // an entered forecast below its actual (never a gap: entered stands).
    const record = (activityId, data) => prisma.costRecord.create({ data: { projectId: project.id, activityId, ...data } });
    target.r1 = await record(target.a1.id, gap ? { budget: 0, forecast: 1200, forecastSource: null, actual: 300 } : { budget: 50000, forecast: 52000, forecastSource: "entered", actual: 300 });
    target.r2 = await record(target.a2.id, gap ? { budget: 7000, forecast: 7000, forecastSource: "default", actual: 9000 } : { budget: 0, forecast: 900, forecastSource: "default", actual: 800 });
    target.r3 = await record(target.a3.id, { budget: 0, forecast: 100, forecastSource: "entered", actual: 500 });

    if (gap) await prisma.procurementOrder.create({ data: { projectId: project.id, ref: `PO-${tag}`, item: "LiveTest rebar", status: "issued", value: 5000 } });

    // Equipment usage: DR1 with no posting (gap), DR2 posted, DR3 posted then
    // reversed (gap). The clean project's one report is posted.
    const report = (date) => prisma.dailyReport.create({ data: { projectId: project.id, activityId: target.a1.id, engineerId: live.user.id, date, status: "approved" } });
    const usage = (dailyReportId, costAmount) =>
      prisma.activityEquipmentUsage.create({ data: { projectId: project.id, activityId: target.a1.id, dailyReportId, equipmentName: "LiveTest excavator", hours: 4, rate: costAmount / 4, costAmount, usageDate: daysAgo(5) } });
    const ledger = (sourceId, amount, suffix = "header") =>
      prisma.costLedgerEntry.create({ data: { orgId, projectId: project.id, sourceKey: `equipment:${sourceId}:${suffix}`, sourceType: "equipment", sourceId, amount, incurredOn: daysAgo(5), activityId: target.a1.id, costType: "equipment" } });
    if (gap) {
      target.dr1 = await report(daysAgo(5));
      await usage(target.dr1.id, 400);
      target.dr2 = await report(daysAgo(4));
      await usage(target.dr2.id, 300);
      await ledger(target.dr2.id, 300);
      target.dr3 = await report(daysAgo(3));
      await usage(target.dr3.id, 500);
      await ledger(target.dr3.id, 500);
      await ledger(target.dr3.id, -500, "reversal");
    } else {
      target.dr1 = await report(daysAgo(5));
      await usage(target.dr1.id, 250);
      await ledger(target.dr1.id, 250);
    }
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    await build(gaps, { gap: true });
    await build(clean, { gap: false });
  }, 120_000);

  afterAll(async () => {
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["auditEvent", "backgroundJob", "outboundEvent", "notification", "projectException"]) await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  }, 120_000);

  it("every rule declares the engine's contract: info/warning only, a permission module, a BOQ flag, words without figures", () => {
    const kinds = RULES.map((rule) => rule.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(RULES.DATA_QUALITY_KINDS).toEqual(kinds);
    for (const rule of RULES) {
      expect(["info", "warning"]).toContain(rule.severity);
      expect(["boq", "cost", "schedule", "progress"]).toContain(rule.module);
      expect(typeof rule.boqDerived).toBe("boolean");
      expect(typeof rule.evaluate).toBe("function");
      expect(typeof rule.label).toBe("string");
      expect(rule.note(3)).not.toMatch(/\d{2,}/);
    }
  });

  // ─── budget and cost provenance ──────────────────────────────────────────

  it("budget_truths_disagree: one row per pair of the three budgets that differ, each figure from its owner", async () => {
    const rows = bySubject(await evaluate("budget_truths_disagree", gaps));
    const pid = gaps.project.id;
    // register 80,000; EV BAC 50,000 + 1,000 = 51,000; waterfall 100,000 + 1,000 = 101,000.
    expect([...rows.keys()].sort()).toEqual([`project:${pid}:ev_bac_vs_contract_waterfall`, `project:${pid}:register_vs_contract_waterfall`, `project:${pid}:register_vs_ev_bac`]);
    const pair = rows.get(`project:${pid}:register_vs_ev_bac`);
    expect([pair.measured.value, pair.limit.value]).toEqual([80000, 51000]);
    expect(pair.measured.basis).toMatch(/budget\.service listBudgetLines/);
    expect(pair.limit.basis).toMatch(/earned-value\.service buildOfficialEvReport totalBudget/);
    expect([rows.get(`project:${pid}:ev_bac_vs_contract_waterfall`).measured.value, rows.get(`project:${pid}:ev_bac_vs_contract_waterfall`).limit.value]).toEqual([51000, 101000]);
    expect(rows.get(`project:${pid}:register_vs_contract_waterfall`).limit.basis).toMatch(/budget-revision\.service listBudgetRevisions/);
    expect(await evaluate("budget_truths_disagree", clean)).toEqual([]);
  });

  it("forecast_without_provenance: a NULL-source forecast and a default the actual passed; an entered forecast never", async () => {
    const rows = bySubject(await evaluate("forecast_without_provenance", gaps));
    expect([...rows.keys()].sort()).toEqual([`cost_record:${gaps.r1.id}`, `cost_record:${gaps.r2.id}`].sort());
    const unknown = rows.get(`cost_record:${gaps.r1.id}`);
    expect(unknown.data.reason).toBe("source_not_recorded");
    // The stored 1,200 beside what the R5-2 default would be now: max(0, the approved allocation 50,000, actual 300).
    expect([unknown.measured.value, unknown.limit.value]).toEqual([1200, 50000]);
    expect(unknown.limit.basis).toMatch(/defaultForecast/);
    const passed = rows.get(`cost_record:${gaps.r2.id}`);
    expect(passed.data.reason).toBe("default_below_actual");
    expect([passed.measured.value, passed.limit.value]).toEqual([9000, 7000]);
    expect(await evaluate("forecast_without_provenance", clean)).toEqual([]);
  });

  it("activity_budget_mismatch: a stored budget that differs from the approved allocations, per activity", async () => {
    const rows = bySubject(await evaluate("activity_budget_mismatch", gaps));
    expect([...rows.keys()].sort()).toEqual([`activity:${gaps.a1.id}`, `activity:${gaps.a2.id}`].sort());
    const a1 = rows.get(`activity:${gaps.a1.id}`);
    expect([a1.measured.value, a1.limit.value, a1.data.field]).toEqual([0, 50000, "cost_record.budget"]);
    expect(a1.limit.basis).toMatch(/getApprovedActivityAllocationTotals/);
    const a2 = rows.get(`activity:${gaps.a2.id}`);
    expect([a2.measured.value, a2.limit.value]).toEqual([7000, 0]);
    expect(await evaluate("activity_budget_mismatch", clean)).toEqual([]);
  });

  it("committed_definition_mixed: the purchase-order register's `committed` alias beside the register's committed cost", async () => {
    const [row, ...rest] = await evaluate("committed_definition_mixed", gaps);
    expect(rest).toEqual([]);
    expect([row.subjectType, row.subjectId, row.measured.value, row.limit.value]).toEqual(["project", gaps.project.id, 5000, 0]);
    expect(row.measured.basis).toMatch(/NOT committed cost/);
    expect(await evaluate("committed_definition_mixed", clean)).toEqual([]);
  });

  it("equipment_cost_unposted: usage cost a daily report carries beyond the ledger's net posting", async () => {
    const rows = bySubject(await evaluate("equipment_cost_unposted", gaps));
    expect([...rows.keys()].sort()).toEqual([`daily_report:${gaps.dr1.id}`, `daily_report:${gaps.dr3.id}`].sort());
    expect([rows.get(`daily_report:${gaps.dr1.id}`).measured.value, rows.get(`daily_report:${gaps.dr1.id}`).limit.value]).toEqual([400, 0]);
    expect([rows.get(`daily_report:${gaps.dr3.id}`).measured.value, rows.get(`daily_report:${gaps.dr3.id}`).limit.value]).toEqual([500, 0]);
    expect(await evaluate("equipment_cost_unposted", clean)).toEqual([]);
  });

  // ─── structure and units ─────────────────────────────────────────────────

  it("structure_missing: one row per structure check the setup readiness raises, its uncapped count measured", async () => {
    const rows = bySubject(await evaluate("structure_missing", gaps));
    const pid = gaps.project.id;
    expect([...rows.keys()].sort()).toEqual(["ACTIVITIES_WITHOUT_WBS", "BOQ_ITEMS_WITHOUT_COST_CODE", "BOQ_ITEMS_WITHOUT_WBS", "NO_LOCATIONS"].map((code) => `project:${pid}:${code}`));
    expect(rows.get(`project:${pid}:ACTIVITIES_WITHOUT_WBS`).measured.value).toBe(3);
    expect(rows.get(`project:${pid}:BOQ_ITEMS_WITHOUT_WBS`).measured.value).toBe(2);
    expect(rows.get(`project:${pid}:BOQ_ITEMS_WITHOUT_COST_CODE`).data.items.map((item) => item.id).sort()).toEqual([gaps.item.id, gaps.item2.id].sort());
    const none = rows.get(`project:${pid}:NO_LOCATIONS`);
    expect([none.measured.value, none.limit.value, none.secondarySubjectType]).toEqual([1, 0, "readiness_check"]);
    expect(none.measured.basis).toMatch(/project-setup-readiness\.service getSetupReadiness/);
    expect(await evaluate("structure_missing", clean)).toEqual([]);
  });

  it("unit_unresolved: the BOQ rows whose unit the organisation's list does not resolve, with the spellings", async () => {
    const [row, ...rest] = await evaluate("unit_unresolved", gaps);
    expect(rest).toEqual([]);
    expect([row.secondarySubjectId, row.measured.value, row.limit.value]).toEqual(["BOQ_UNIT_UNRESOLVED", 1, 0]);
    expect(row.data.units.map((unit) => unit.unit)).toEqual(["cubbits"]);
    expect(row.data.items.map((item) => item.id)).toEqual([gaps.item2.id]);
    expect(await evaluate("unit_unresolved", clean)).toEqual([]);
  });

  it("unit_mismatch: an allocation measured in another unit (readiness) and a BOQ row's SOV quantity in another unit (quantity views)", async () => {
    const rows = bySubject(await evaluate("unit_mismatch", gaps));
    const pid = gaps.project.id;
    expect([...rows.keys()].sort()).toEqual([`boq_item:${gaps.item.id}`, `project:${pid}:UNIT_MISMATCH_COUNT`].sort());
    const allocation = rows.get(`project:${pid}:UNIT_MISMATCH_COUNT`);
    expect([allocation.measured.value, allocation.data.items.map((item) => item.id)]).toEqual([1, [gaps.allocation.id]]);
    const item = rows.get(`boq_item:${gaps.item.id}`);
    expect([item.measured.value, item.measured.unitCode, item.data.columns]).toEqual([1, "m3", [{ figure: "committed", unitCode: "t" }]]);
    expect(item.measured.basis).toMatch(/quantity-views\.service quantityBlocks/);
    expect(await evaluate("unit_mismatch", clean)).toEqual([]);
  });

  // ─── tenancy and read-only ───────────────────────────────────────────────

  it("a rule asked for a project under another organisation sees nothing of it", async () => {
    for (const rule of RULES) {
      let rows;
      try {
        rows = await rule.evaluate({ orgId: other.org.id, projectId: gaps.project.id, cutoff: NOW, ctx: {} });
      } catch (error) {
        expect([rule.kind, error.code || error.status]).toEqual([rule.kind, expect.stringMatching(/NOT_FOUND|404/)]);
        continue;
      }
      expect([rule.kind, rows]).toEqual([rule.kind, []]);
    }
  });

  it("evaluating every rule on both projects writes nothing (every row of the organisation compared)", async () => {
    const scope = { orgId: live.org.id, projectIds: [gaps.project.id, clean.project.id] };
    const before = await everyRow(scope);
    const ctx = {};
    for (const built of [gaps, clean]) {
      for (const rule of RULES) await rule.evaluate({ orgId: live.org.id, projectId: built.project.id, cutoff: NOW, ctx });
    }
    expect(changesBetween(before, await everyRow(scope))).toEqual([]);
  }, 120_000);

  // ─── the engine (after the merge) ────────────────────────────────────────

  engineIt("the engine's rule registry picks the data-quality kinds up", () => {
    const registry = require("../exception-rules");
    const kinds = new Set((Array.isArray(registry) ? registry : registry.RULES || registry.rules || []).map((rule) => rule.kind));
    for (const kind of RULES.DATA_QUALITY_KINDS) expect([kind, kinds.has(kind)]).toEqual([kind, true]);
  });

  engineIt("evaluateProject opens the data-quality rows once, a dry run writes nothing, and a fixed gap resolves", async () => {
    const orgId = live.org.id;
    const projectId = gaps.project.id;
    const scope = { orgId, projectIds: [projectId, clean.project.id] };
    const dqKinds = [...RULES.DATA_QUALITY_KINDS];
    const openRows = () => prisma.projectException.findMany({ where: { orgId, projectId, kind: { in: dqKinds }, resolvedAt: null }, orderBy: [{ kind: "asc" }, { subjectId: "asc" }] });

    const before = await everyRow(scope);
    const dry = await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test", dryRun: true });
    expect(changesBetween(before, await everyRow(scope))).toEqual([]);
    expect(Array.isArray(dry.rows)).toBe(true);

    await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
    const first = await openRows();
    const expected = { budget_truths_disagree: 3, forecast_without_provenance: 2, activity_budget_mismatch: 2, committed_definition_mixed: 1, equipment_cost_unposted: 2 };
    for (const [kind, count] of Object.entries(expected)) expect([kind, first.filter((row) => row.kind === kind).length]).toEqual([kind, count]);
    expect(first.every((row) => ["info", "warning"].includes(row.severity) && row.measuredBasis && row.limitBasis)).toBe(true);
    // The dry run said what the write did.
    for (const [kind, count] of Object.entries(expected)) expect([kind, dry.rows.filter((row) => row.kind === kind).length]).toEqual([kind, count]);

    // Idempotent: a second pass opens nothing new and keeps one open row per subject.
    await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
    const second = await openRows();
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));

    // The clean project opens none of these kinds.
    await engine.evaluateProject({ orgId, projectId: clean.project.id, cutoff: NOW, trigger: "test" });
    expect(await prisma.projectException.count({ where: { orgId, projectId: clean.project.id, kind: { in: dqKinds } } })).toBe(0);

    // A person enters the forecast: the provenance row resolves as cleared.
    await prisma.costRecord.update({ where: { id: gaps.r1.id }, data: { forecastSource: "entered" } });
    try {
      await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
      const resolved = await prisma.projectException.findFirst({ where: { orgId, projectId, kind: "forecast_without_provenance", subjectId: gaps.r1.id } });
      expect([resolved.resolvedAt !== null, resolved.resolvedReason]).toEqual([true, "cleared"]);
    } finally {
      await prisma.costRecord.update({ where: { id: gaps.r1.id }, data: { forecastSource: null } });
    }
  }, 180_000);
});
