/**
 * Owner decision R5-2 (2026-09-30) — the default cost forecast, proven against
 * a real API process and the real local Postgres.
 *
 * max(budget, actual) is the INITIAL default only when the forecast is
 * genuinely missing (CostRecord.forecastSource 'default'); a supplied forecast
 * — 0 and "0" included — is stored as given ('entered') and never overwritten
 * by an unrelated edit, a ledger posting or a commitment recompute; a default
 * is re-derived only by a write that changes the budget; a row whose source was
 * not recorded (NULL, older than the column) is treated as entered and the
 * projected final cost counts it by the rule that predates the column (the
 * stored figure when above 0 and not below actual, else max(budget, actual),
 * owner decision D3 — proven on the summary's totals, not only the row); the server
 * alone sets forecastSource; every read labels the basis honestly; and the
 * earned-value EAC (revised budget ÷ CPI, D2) and the Overview's forecast at
 * completion never read a cost record's forecast.
 *
 * The review's findings, each proven here too: the cost records' projected
 * final cost counts an ENTERED 0 as 0 (never the budget); every creator that
 * is not the cost API — a ledger's first posting, a commitment recompute, the
 * post-import seed — works the default from the activity's approved
 * allocation; GET /forecast never reports a default as "the cost forecast";
 * an executed commitment and an approved equipment posting leave forecast and
 * forecastSource alone; a null money field writes nothing and an array is
 * refused; a member who may not read the BOQ is given neither a default
 * forecast nor its ORDER (GET /cost?sortBy=forecast), and the report builder
 * gives them none of it as a cell, a filter, a sort, an aggregate or an export.
 *
 * One UTC project in a throwaway "LiveTest <uuid>" organisation: a BOQ item of
 * 120,000 allocated 10,000 to each of eleven activities (approved), and a store
 * of cement at 10 a bag. Nothing outside that organisation is written; the
 * certified project is only read, before and after, and must be byte-identical.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run -s test:live -- src/services/__live__/r5-2-default-forecast.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { reconcile } = require("../cost-reconciliation.service");

const CERTIFIED_PROJECT = "0ce999f2-b175-432b-8551-20182b4fc990";
const ALLOCATED = 10_000;
const BASIS = {
  entered: "Entered forecast",
  default: "Default forecast: the larger of the budget and the actual cost as they stood when it was set; it does not follow them afterwards (no forecast was entered)",
  notRecorded: "Stored forecast (its source was not recorded)",
};
const NAMES = ["fresh", "zero", "zeroText", "invalid", "legacy", "ev", "descoped", "ledger", "over", "commit", "equip"];
const ExcelJS = require("exceljs");

// Read-only: what the certified project's cost records are, and that it reconciles.
const certifiedFingerprint = async () => {
  const project = await prisma.project.findUnique({ where: { id: CERTIFIED_PROJECT }, select: { orgId: true } });
  if (!project) return null;
  const records = await prisma.costRecord.findMany({
    where: { projectId: CERTIFIED_PROJECT },
    orderBy: { id: "asc" },
    select: { id: true, budget: true, committed: true, actual: true, forecast: true, forecastSource: true, updatedAt: true },
  });
  const report = await reconcile({ orgId: project.orgId, projectId: CERTIFIED_PROJECT });
  return {
    records: crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex"),
    count: records.length,
    balanced: report.balanced,
    ledger: report.ledger.total,
  };
};

liveDescribe("R5-2: the default cost forecast — initial only when missing, labelled honestly, never overwriting an entered one", () => {
  let live;
  let api;
  let certifiedBefore;
  const built = { activities: {} };

  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${built.project.id}${route}`;
  const send = async (route, body, expected = 201) => {
    const response = await api.post(route, body, auth());
    expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
    return response.body.data;
  };
  const patch = (id, body, headers = auth()) => api.request("PATCH", at(`/cost/${id}`), { body, headers });
  const stored = (name) => prisma.costRecord.findFirst({ where: { projectId: built.project.id, activityId: built.activities[name] } });
  const figures = (row) => ({ forecast: Number(row.forecast), forecastSource: row.forecastSource });
  const issue = (name, qty) =>
    send("/api/v1/inventory/stock/issue", { itemId: built.itemId, warehouseId: built.warehouseId, quantity: qty, projectId: built.project.id, activityId: built.activities[name] });
  const whole = (row) => ({ budget: Number(row.budget), committed: Number(row.committed), actual: Number(row.actual), forecast: Number(row.forecast), forecastSource: row.forecastSource });
  const get = async (route, headers = auth()) => {
    const response = await api.get(route, headers);
    expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
    return response.body.data;
  };
  const nameOf = (activityId) => Object.keys(built.activities).find((name) => built.activities[name] === activityId);
  // A cost controller on the project under a template that takes the BOQ away:
  // cost read and update, no BOQ read. Made once.
  const noBoqReader = async () => {
    if (built.reader) return built.reader;
    const reader = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest cost reader", email: `live-r52-cost-${Date.now()}@octapm-live.test`, role: "cost_controller" });
    await prisma.projectAssignment.create({ data: { projectId: built.project.id, userId: reader.id, role: "cost_controller", orgId: live.org.id } });
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest R5-2 cost reader, no BOQ ${Date.now()}`, baseRole: "cost_controller", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: built.project.id, userId: reader.id, templateId: template.id } });
    built.reader = { authorization: `Bearer ${mintAccessToken(reader)}` };
    return built.reader;
  };

  beforeAll(async () => {
    certifiedBefore = await certifiedFingerprint();
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    built.project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest R5-2 default forecast", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    const stamp = Date.now().toString(36);
    const warehouse = await send("/api/v1/inventory/warehouses", { code: `W52${stamp}`.slice(0, 30), name: "LiveTest store R5-2", kind: "site", projectId: built.project.id });
    const item = await send("/api/v1/inventory/items", { sku: `LT52-${stamp}`, name: "LiveTest cement", unit: "bag" });
    built.warehouseId = warehouse.id;
    built.itemId = item.id;
    await send("/api/v1/inventory/stock/receive", { itemId: item.id, warehouseId: warehouse.id, quantity: 5000, unitCost: 10, projectId: built.project.id });

    const boq = await send(at("/boq/items"), { code: "1.1", description: "Concrete", quantity: 1200, unit: "m3", rate: 100 });
    for (const [index, name] of NAMES.entries()) {
      const activity = await send(at("/activities"), { name: `Activity ${name}`, activityCode: `R${index + 1}00`, duration: 5, startDate: "2026-01-05", endDate: "2026-01-09", engineerIds: [live.user.id] });
      const allocation = await send(at("/activity-boq-allocations"), { boqItemId: boq.item.id, activityId: activity.id, quantity: 100 });
      for (const step of ["submit", "approve"]) await send(at(`/activity-boq-allocations/${allocation.id}/${step}`), {}, 200);
      built.activities[name] = activity.id;
    }
  }, 300_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("create WITHOUT a forecast stores max(0, budget, actual) and forecastSource 'default', labelled as the default", async () => {
    const record = await send(at(`/cost/activity/${built.activities.fresh}`), {});
    expect({ budget: record.budget, forecast: record.forecast, forecastSource: record.forecastSource, forecastBasis: record.forecastBasis }).toEqual({
      budget: ALLOCATED,
      forecast: ALLOCATED,
      forecastSource: "default",
      forecastBasis: BASIS.default,
    });
    expect(figures(await stored("fresh"))).toEqual({ forecast: ALLOCATED, forecastSource: "default" });
  });

  it("create with forecast 0 stores 0 and 'entered'; so does \"0\" — a falsy forecast is a forecast", async () => {
    const zero = await send(at(`/cost/activity/${built.activities.zero}`), { forecast: 0 });
    expect({ forecast: zero.forecast, forecastSource: zero.forecastSource, forecastBasis: zero.forecastBasis }).toEqual({ forecast: 0, forecastSource: "entered", forecastBasis: BASIS.entered });
    expect(figures(await stored("zero"))).toEqual({ forecast: 0, forecastSource: "entered" });

    const zeroText = await send(at(`/cost/activity/${built.activities.zeroText}`), { forecast: "0" });
    expect({ forecast: zeroText.forecast, forecastSource: zeroText.forecastSource }).toEqual({ forecast: 0, forecastSource: "entered" });
    expect(figures(await stored("zeroText"))).toEqual({ forecast: 0, forecastSource: "entered" });
  });

  it("an invalid supplied forecast is 400 — never a silent 0 — and nothing is written", async () => {
    // An array is not an amount: [7] read as "7" to the text check and was
    // then stored as 0, marked entered.
    for (const forecast of ["lots", "", "-1", -1, "1.234", [7], [0], ["12.5"]]) {
      const created = await api.post(at(`/cost/activity/${built.activities.invalid}`), { forecast }, auth());
      expect([JSON.stringify(forecast), created.status]).toEqual([JSON.stringify(forecast), 400]);
      const edited = await patch((await stored("zero")).id, { forecast });
      expect([JSON.stringify(forecast), edited.status]).toEqual([JSON.stringify(forecast), 400]);
    }
    expect(await stored("invalid")).toBeNull();
    expect(figures(await stored("zero"))).toEqual({ forecast: 0, forecastSource: "entered" });
  });

  it("a client that sends forecastSource is refused with VALIDATION_ERROR, on create and on edit; the row is unchanged", async () => {
    const created = await api.post(at(`/cost/activity/${built.activities.invalid}`), { forecastSource: "entered" }, auth());
    expect([created.status, created.body?.error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(JSON.stringify(created.body.error)).toContain("forecastSource is set by the server");
    expect(await stored("invalid")).toBeNull();

    const fresh = await stored("fresh");
    for (const body of [{ forecastSource: "entered" }, { forecastSource: "entered", forecast: 1 }, { forecastSource: null }]) {
      const edited = await patch(fresh.id, body);
      expect([JSON.stringify(body), edited.status, edited.body?.error?.code]).toEqual([JSON.stringify(body), 400, "VALIDATION_ERROR"]);
    }
    expect(figures(await stored("fresh"))).toEqual({ forecast: ALLOCATED, forecastSource: "default" });
  });

  it("approved ledger postings move actual only: an entered and a default forecast keep figure and source", async () => {
    await issue("fresh", 300); // AC 3,000 on the default record
    await issue("zero", 200); // AC 2,000 on the entered-0 record
    const fresh = await stored("fresh");
    const zero = await stored("zero");
    expect([fresh.actual.toString(), zero.actual.toString()]).toEqual(["3000", "2000"]);
    expect(figures(fresh)).toEqual({ forecast: ALLOCATED, forecastSource: "default" });
    expect(figures(zero)).toEqual({ forecast: 0, forecastSource: "entered" });
  });

  it("a budget edit never moves an ENTERED forecast (even 0, below actual)", async () => {
    const zero = await stored("zero");
    const response = await patch(zero.id, { budget: 12_345 });
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    expect({ forecast: response.body.data.forecast, forecastSource: response.body.data.forecastSource }).toEqual({ forecast: 0, forecastSource: "entered" });
    const row = await stored("zero");
    expect([row.budget.toString(), ...Object.values(figures(row))]).toEqual(["12345", 0, "entered"]);
  });

  it("a budget edit on a DEFAULT record re-derives max(0, new budget, current actual) and it stays 'default'; an echo re-derives nothing", async () => {
    const fresh = await stored("fresh");
    const up = await patch(fresh.id, { budget: 12_000 });
    expect([up.status, up.body?.data?.forecast, up.body?.data?.forecastSource]).toEqual([200, 12_000, "default"]);
    const down = await patch(fresh.id, { budget: 1_000 }); // actual 3,000 → the default never falls below it
    expect([down.status, down.body?.data?.forecast, down.body?.data?.forecastSource]).toEqual([200, 3_000, "default"]);
    await issue("fresh", 100); // AC 4,000: the default does not follow actual on its own
    const echo = await patch(fresh.id, { budget: 1_000 });
    expect([echo.status, echo.body?.data?.forecast]).toEqual([200, 3_000]);
    expect(figures(await stored("fresh"))).toEqual({ forecast: 3_000, forecastSource: "default" });
  });

  it("category, committed and through-date edits never change forecast or forecastSource", async () => {
    for (const name of ["fresh", "zero"]) {
      const before = await stored(name);
      const edited = await patch(before.id, { labour: 500, material: 250, committed: 100, actualThroughDate: "2026-01-06" });
      expect([name, edited.status, edited.body?.error]).toEqual([name, 200, undefined]);
      const after = await stored(name);
      expect([name, figures(after)]).toEqual([name, figures(before)]);
      expect(after.labour.toString()).toBe("500");
    }
    // The upsert route too.
    const again = await send(at(`/cost/activity/${built.activities.fresh}`), { subcontract: 75 });
    expect([again.forecast, again.forecastSource]).toEqual([3_000, "default"]);
  });

  it("a legacy row whose source was not recorded (NULL) is treated as entered: a budget edit leaves it, it is labelled as not recorded, and the projected final cost counts it by the old rule (stored when > 0 and not below actual, else max(budget, actual))", async () => {
    const before = await get(at("/cost/summary"));
    await send(at(`/cost/activity/${built.activities.legacy}`), {});
    const made = await stored("legacy");
    // As a row written before the column existed would be (LiveTest org only).
    await prisma.costRecord.update({ where: { id: made.id }, data: { forecast: 7_777, forecastSource: null } });
    const edited = await patch(made.id, { budget: 20_000 });
    expect([edited.status, edited.body?.data?.forecast, edited.body?.data?.forecastSource, edited.body?.data?.forecastBasis]).toEqual([200, 7_777, null, BASIS.notRecorded]);
    const row = await stored("legacy");
    expect([row.budget.toString(), Number(row.forecast), row.forecastSource]).toEqual(["20000", 7_777, null]);

    // Owner decision D3, live: the summary counts the NULL-source row exactly
    // as it did before the column — its stored 7,777 (above 0, not below its
    // actual of 0), not the default rule's max(budget, actual) = 10,000. Every
    // row written before the column is one of these, so this is the rule that
    // keeps every existing project's figure where it is.
    const phaseOf = (summary) => summary.byPhase.reduce((sum, entry) => sum + entry.forecast, 0);
    const movedBy = (summary) => ({ forecast: summary.totals.forecast - before.totals.forecast, byPhase: phaseOf(summary) - phaseOf(before), mostLikely: summary.eac.mostLikely - before.eac.mostLikely });
    const withStored = await get(at("/cost/summary"));
    expect(movedBy(withStored)).toEqual({ forecast: 7_777, byPhase: 7_777, mostLikely: 7_777 });
    expect(withStored.forecastSources.notRecorded).toBe(before.forecastSources.notRecorded + 1);
    const summarised = withStored.records.find((record) => record.activityId === built.activities.legacy);
    // The summary's budget is the activity's approved allocation, not the row's own 20,000.
    expect([summarised.budget, summarised.forecast, summarised.forecastSource, summarised.forecastBasis]).toEqual([ALLOCATED, 7_777, null, BASIS.notRecorded]);

    // Stored 0 with no source: max(budget, actual) — the allocation — as it always was.
    await prisma.costRecord.update({ where: { id: made.id }, data: { forecast: 0, forecastSource: null } });
    expect(movedBy(await get(at("/cost/summary"))).forecast).toBe(ALLOCATED);

    // Stored below what the record has cost: max(budget, actual) again, not the stored figure.
    await issue("legacy", 60); // AC 600
    await prisma.costRecord.update({ where: { id: made.id }, data: { forecast: 500, forecastSource: null } });
    const spentRow = await stored("legacy");
    expect([Number(spentRow.actual), ...Object.values(figures(spentRow))]).toEqual([600, 500, null]);
    const belowActual = await get(at("/cost/summary"));
    expect({ forecast: belowActual.totals.forecast - before.totals.forecast, actual: belowActual.totals.actual - before.totals.actual }).toEqual({ forecast: ALLOCATED, actual: 600 });

    // Back to the stored 7,777 (above its actual of 600): counted as stored. The later reads rely on it.
    await prisma.costRecord.update({ where: { id: made.id }, data: { forecast: 7_777, forecastSource: null } });
    expect(movedBy(await get(at("/cost/summary"))).forecast).toBe(7_777);
    expect(figures(await stored("legacy"))).toEqual({ forecast: 7_777, forecastSource: null });
  });

  it("every read labels the basis: the register, the summary's mix (not the default rule for every record) and the activity detail", async () => {
    const list = await api.get(at("/cost?limit=100"), auth());
    expect(list.status).toBe(200);
    const byActivity = new Map(list.body.data.rows.map((row) => [row.activityId, row]));
    expect([byActivity.get(built.activities.fresh).forecastSource, byActivity.get(built.activities.fresh).forecastBasis]).toEqual(["default", BASIS.default]);
    expect([byActivity.get(built.activities.zero).forecastSource, byActivity.get(built.activities.zero).forecastBasis]).toEqual(["entered", BASIS.entered]);
    expect([byActivity.get(built.activities.legacy).forecastSource, byActivity.get(built.activities.legacy).forecastBasis]).toEqual([null, BASIS.notRecorded]);

    const summary = (await api.get(at("/cost/summary"), auth())).body.data;
    // fresh (default), zero + zeroText (entered), legacy (not recorded)
    expect(summary.forecastSources).toEqual({ entered: 2, default: 1, notRecorded: 1, total: 4 });
    expect(summary.truth.records.forecast).toBe("projection:entered_or_default_per_record");
    expect(summary.truth.records.basis).toEqual(BASIS);
    expect(summary.truth.totals.labels.forecast).toBe("Projected final cost (cost records)");
    expect(summary.truth.totals.derivedFrom.forecast).toContain("Not the earned-value EAC");
    expect(summary.truth.eac.label).not.toMatch(/\bEAC\b/);

    const detail = await api.get(at(`/activities/${built.activities.fresh}/detail`), auth());
    expect(detail.status).toBe(200);
    expect(detail.body.data.sections.cost.forecast).toMatchObject({ value: 3_000, truth: "projection", basis: BASIS.default, forecastSource: "default" });
    const zeroDetail = (await api.get(at(`/activities/${built.activities.zero}/detail`), auth())).body.data;
    expect(zeroDetail.sections.cost.forecast).toMatchObject({ value: 0, basis: BASIS.entered, forecastSource: "entered" });
  });

  it("a cost reader who may not read the BOQ gets no default forecast (it is built from the allocation) — a dash and the reason; an entered one stays", async () => {
    const as = await noBoqReader();

    const list = await api.get(at("/cost?limit=100"), as);
    expect(list.status).toBe(200);
    const byActivity = new Map(list.body.data.rows.map((row) => [row.activityId, row]));
    const fresh = byActivity.get(built.activities.fresh);
    expect(fresh).not.toHaveProperty("forecast");
    expect(fresh).not.toHaveProperty("budget");
    expect([fresh.forecastSource, fresh.forecastWithheld, typeof fresh.forecastWithheldReason]).toEqual(["default", true, "string"]);
    expect(byActivity.get(built.activities.zero).forecast).toBe(0);
    expect(byActivity.get(built.activities.legacy).forecast).toBe(7_777);

    const summary = (await api.get(at("/cost/summary"), as)).body.data;
    expect(summary.records.find((row) => row.activityId === built.activities.fresh)).not.toHaveProperty("forecast");

    const detail = (await api.get(at(`/activities/${built.activities.fresh}/detail`), as)).body.data;
    expect(detail.sections.cost.forecast).toMatchObject({ value: null, withheld: true, forecastSource: "default" });
    expect(JSON.stringify(detail.sections.cost)).not.toContain("3000");
  });

  it("the EV report's EAC and the Overview's forecast at completion do not read a cost record's forecast: identical before and after the default moves", async () => {
    // Progress and actual on the EV activity, so there is a CPI to divide by.
    await send(at(`/cost/activity/${built.activities.ev}`), {});
    const progress = await api.post(at(`/activities/${built.activities.ev}/progress`), { pctComplete: 50, status: "submitted" }, auth());
    expect(progress.status).toBe(200);
    const submission = await prisma.progressSubmission.findFirst({ where: { projectId: built.project.id, activityId: built.activities.ev }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
    if (submission && submission.status !== "approved") {
      await send(at(`/activities/${built.activities.ev}/progress-submissions/${submission.id}/approve`), {}, 200);
    }
    await issue("ev", 200); // AC 2,000

    const read = async () => {
      const ev = await api.get(at("/reports/ev"), auth());
      const forecast = await api.get(at("/forecast"), auth());
      expect([ev.status, forecast.status]).toEqual([200, 200]);
      return { eac: ev.body.data.eac, eacBasis: ev.body.data.eacBasis, overview: forecast.body.data.cost?.eac ?? null, overviewBasis: forecast.body.data.cost?.eacBasis ?? null };
    };
    const before = await read();
    expect(typeof before.eac).toBe("number");
    // A real projection, not the budget handed back: revised budget ÷ CPI.
    expect([before.eacBasis, before.overviewBasis, before.overview]).toEqual(["budget_over_cpi", "budget_over_cpi", before.eac]);

    const ev = await stored("ev");
    const moved = await patch(ev.id, { budget: 55_555 }); // the default follows the budget
    expect([moved.status, moved.body?.data?.forecast, moved.body?.data?.forecastSource]).toEqual([200, 55_555, "default"]);
    const typed = await patch((await stored("fresh")).id, { forecast: 999_999 });
    expect([typed.status, typed.body?.data?.forecastSource]).toEqual([200, "entered"]);

    const after = await read();
    expect(after).toEqual(before);
  });

  it("the projected final cost counts an ENTERED 0 as 0 — not the budget — and never below the record's actual; the row, the mix and the label agree", async () => {
    const before = await get(at("/cost/summary"));
    const created = await send(at(`/cost/activity/${built.activities.descoped}`), { forecast: 0 });
    expect([created.budget, created.forecast, created.forecastSource]).toEqual([ALLOCATED, 0, "entered"]);

    const after = await get(at("/cost/summary"));
    // The record joins with its allocation as budget and 0 as its projection:
    // the headline moves by 0, where it used to move by the budget.
    expect({ budget: after.totals.budget - before.totals.budget, forecast: after.totals.forecast - before.totals.forecast, mostLikely: after.eac.mostLikely - before.eac.mostLikely }).toEqual({ budget: ALLOCATED, forecast: 0, mostLikely: 0 });
    expect(after.forecastSources.entered).toBe(before.forecastSources.entered + 1);
    const phaseOf = (summary) => summary.byPhase.reduce((sum, row) => sum + row.forecast, 0);
    expect(phaseOf(after) - phaseOf(before)).toBe(0);
    const row = after.records.find((record) => record.activityId === built.activities.descoped);
    expect([row.budget, row.forecast, row.forecastSource, row.forecastBasis]).toEqual([ALLOCATED, 0, "entered", BASIS.entered]);
    expect(after.truth.totals.derivedFrom.forecast).toContain("An entered forecast counts as entered — 0 included — and never below the record's actual");

    // Cost lands on it: the projection is what it has cost, not the budget.
    await issue("descoped", 30); // AC 300
    const spent = await get(at("/cost/summary"));
    expect({ actual: spent.totals.actual - before.totals.actual, forecast: spent.totals.forecast - before.totals.forecast }).toEqual({ actual: 300, forecast: 300 });
    expect(figures(await stored("descoped"))).toEqual({ forecast: 0, forecastSource: "entered" });
  });

  it("the record a ledger's FIRST posting creates gets its default from the activity's approved allocation — not from a budget of 0 — and the projected final cost counts the allocation, before and after the next posting", async () => {
    expect(await stored("ledger")).toBeNull();
    const before = await get(at("/cost/summary"));
    await issue("ledger", 50); // AC 500, below the 10,000 allocated
    expect(whole(await stored("ledger"))).toEqual({ budget: 0, committed: 0, actual: 500, forecast: ALLOCATED, forecastSource: "default" });

    const register = await get(at("/cost?limit=100"));
    const row = register.rows.find((record) => record.activityId === built.activities.ledger);
    expect({ budget: row.budget, generatedBudget: row.generatedBudget, actual: row.actual, forecast: row.forecast, forecastSource: row.forecastSource, forecastBasis: row.forecastBasis }).toEqual({
      budget: ALLOCATED,
      generatedBudget: 0,
      actual: 500,
      forecast: ALLOCATED,
      forecastSource: "default",
      forecastBasis: BASIS.default,
    });
    const first = await get(at("/cost/summary"));
    expect({ budget: first.totals.budget - before.totals.budget, forecast: first.totals.forecast - before.totals.forecast }).toEqual({ budget: ALLOCATED, forecast: ALLOCATED });

    await issue("ledger", 30); // AC 800: the record exists — actual only
    expect(whole(await stored("ledger"))).toEqual({ budget: 0, committed: 0, actual: 800, forecast: ALLOCATED, forecastSource: "default" });
    const second = await get(at("/cost/summary"));
    expect(second.totals.forecast - before.totals.forecast).toBe(ALLOCATED);

    // A first posting ABOVE the allocation: the default is that actual.
    await issue("over", 1200); // AC 12,000
    expect(whole(await stored("over"))).toEqual({ budget: 0, committed: 0, actual: 12_000, forecast: 12_000, forecastSource: "default" });
  });

  it("GET /forecast never reports a DEFAULT as the cost forecast: the basis stays 'budget' and no 'Cost forecast … above the budget'; an entered forecast is reported", async () => {
    const costOf = async () => {
      const forecast = await get(at("/forecast"));
      const activity = forecast.activities.find((entry) => entry.id === built.activities.over);
      const risk = (forecast.schedule?.topRisks || []).find((entry) => entry.id === built.activities.over);
      return { cost: activity.cost, riskCost: risk ? risk.cost : null };
    };
    const byDefault = await costOf();
    expect(byDefault.cost).toMatchObject({ budget: ALLOCATED, actual: 12_000, projected: 12_000, basis: "budget" });
    for (const cost of [byDefault.cost, byDefault.riskCost].filter(Boolean)) {
      expect(cost.basis).toBe("budget");
      expect(cost.reasons.join(" | ")).not.toContain("Cost forecast");
    }

    const over = await stored("over");
    const typed = await patch(over.id, { forecast: 15_000 });
    expect([typed.status, typed.body?.data?.forecastSource]).toEqual([200, "entered"]);
    const entered = await costOf();
    expect(entered.cost).toMatchObject({ projected: 15_000, basis: "forecast" });
    expect(entered.cost.reasons).toContain("Cost forecast 15000 above the budget");
  });

  it("an executed commitment writes committed only: an entered and a default forecast keep figure and source, and the record it CREATES is a default from the allocation", async () => {
    const code = (await api.post("/api/v1/company/cost-codes", { code: `LT52-${Date.now().toString(36)}`, name: "LiveTest R5-2", category: "subcontract" }, auth())).body.data;
    const selected = await api.request("PUT", at("/budget/cost-codes"), { body: { costCodeIds: [code.id] }, headers: auth() });
    expect([selected.status, selected.body?.error]).toEqual([200, undefined]);
    const line = await send(at("/budget/lines"), { costCodeId: code.id, costType: "subcontract", originalBudget: 80_000, description: "R5-2 commitment" });
    const vendor = await prisma.company.create({ data: { orgId: live.org.id, name: "LiveTest R5-2 Formwork Ltd" } });

    expect(await stored("commit")).toBeNull();
    const before = { zero: whole(await stored("zero")), ev: whole(await stored("ev")) };
    expect([before.zero.forecastSource, before.ev.forecastSource]).toEqual(["entered", "default"]);

    const commitment = await send(at("/commitments"), {
      title: "LiveTest R5-2 subcontract",
      type: "subcontract",
      vendorCompanyId: vendor.id,
      lines: [
        { description: "Over an entered 0", budgetLineId: line.id, activityId: built.activities.zero, qty: 1, rate: 5_000, amount: 5_000 },
        { description: "Over a default", budgetLineId: line.id, activityId: built.activities.ev, qty: 1, rate: 6_000, amount: 6_000 },
        { description: "On an activity with no record", budgetLineId: line.id, activityId: built.activities.commit, qty: 1, rate: 7_000, amount: 7_000 },
      ],
    });
    await send(at(`/commitments/${commitment.id}/submit`), {}, 200);
    await send(at(`/commitments/${commitment.id}/approve`), {}, 200);
    const document = await prisma.projectDocument.create({
      data: { orgId: live.org.id, projectId: built.project.id, documentType: "workflow_attachment", originalName: "agreement.pdf", fileName: "agreement.pdf", mimeType: "application/pdf", sizeBytes: 1, sha256: "0".repeat(64), storageProvider: "local", objectKey: `livetest/${commitment.id}`, storageKey: `livetest/${commitment.id}/${Date.now()}` },
    });
    await send(at(`/commitments/${commitment.id}/execute`), { documentId: document.id }, 200);

    // committed moved; nothing else did.
    expect(whole(await stored("zero"))).toEqual({ ...before.zero, committed: 5_000 });
    expect(whole(await stored("ev"))).toEqual({ ...before.ev, committed: 6_000 });
    // The record the recompute had to create: a default, from the allocation.
    expect(whole(await stored("commit"))).toEqual({ budget: 0, committed: 7_000, actual: 0, forecast: ALLOCATED, forecastSource: "default" });
  });

  it("an approved equipment posting moves actual and the equipment category only: an entered and a default forecast keep figure and source", async () => {
    await send(at(`/cost/activity/${built.activities.equip}`), { forecast: 4_321 });
    const equipment = await send(at("/equipment"), { name: "LiveTest R5-2 excavator", rateType: "hourly", rate: 1_500 });
    const before = { equip: await stored("equip"), ledger: await stored("ledger") };
    expect([before.equip.forecastSource, before.ledger.forecastSource]).toEqual(["entered", "default"]);

    for (const [name, date] of [["equip", "2026-01-06"], ["ledger", "2026-01-07"]]) {
      const report = await send(at("/daily-reports"), { activityId: built.activities[name], date, equipment: [{ equipmentId: equipment.id, name: "LiveTest R5-2 excavator", hours: 4 }], notes: "R5-2 equipment posting" });
      const reportId = report.id || report.report?.id;
      for (const step of ["submit", "approve"]) {
        const moved = await api.post(at(`/daily-reports/${reportId}/${step}`), {}, auth());
        expect([name, step, moved.status, moved.body?.error]).toEqual([name, step, 200, undefined]);
      }
      const after = await stored(name);
      // 4 h at 1,500: 6,000 on actual and on the equipment category.
      expect([name, Number(after.actual) - Number(before[name].actual), Number(after.equipment) - Number(before[name].equipment)]).toEqual([name, 6_000, 6_000]);
      expect([name, figures(after)]).toEqual([name, figures(before[name])]);
    }
    expect(figures(await stored("equip"))).toEqual({ forecast: 4_321, forecastSource: "entered" });
    expect(figures(await stored("ledger"))).toEqual({ forecast: ALLOCATED, forecastSource: "default" });
  });

  it("a money field sent as null is not supplied — budget: null writes nothing and leaves a default alone — and one that is not an amount is refused", async () => {
    for (const name of ["ledger", "equip"]) {
      const before = await stored(name);
      for (const body of [{ budget: null }, { budget: null, labour: null, committed: null, actual: null, forecast: null }]) {
        const edited = await patch(before.id, body);
        expect([name, JSON.stringify(body), edited.status, edited.body?.error]).toEqual([name, JSON.stringify(body), 200, undefined]);
      }
      const upserted = await send(at(`/cost/activity/${built.activities[name]}`), { budget: null, material: null });
      expect([name, upserted.forecast, upserted.forecastSource]).toEqual([name, Number(before.forecast), before.forecastSource]);
      const after = await stored(name);
      expect([name, whole(after), Number(after.labour), Number(after.material)]).toEqual([name, whole(before), Number(before.labour), Number(before.material)]);
    }
    const ledger = await stored("ledger");
    for (const body of [{ budget: [7] }, { labour: ["12.5"] }, { committed: [0] }]) {
      const edited = await patch(ledger.id, body);
      expect([JSON.stringify(body), edited.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(whole(await stored("ledger"))).toEqual(whole(ledger));
  });

  it("sortBy=forecast gives a member who may not read the BOQ no order of the defaults: they follow the visible forecasts by id, and nothing moves when a hidden default does", async () => {
    const as = await noBoqReader();
    const hidden = await stored("ledger");
    expect(hidden.forecastSource).toBe("default");
    const orderFor = async (headers, dir, extra = "") => {
      const data = await get(at(`/cost?limit=100&sortBy=forecast&sortDir=${dir}${extra}`), headers);
      return { data, ids: data.rows.map((row) => row.id), names: data.rows.map((row) => nameOf(row.activityId)) };
    };

    for (const dir of ["asc", "desc"]) {
      const { data } = await orderFor(as, dir);
      // The server says so, and why.
      expect([dir, data.sortWithheld?.sortBy, typeof data.sortWithheld?.reason]).toEqual([dir, "forecast", "string"]);
      const visible = data.rows.filter((row) => "forecast" in row);
      const withheld = data.rows.filter((row) => !("forecast" in row));
      expect(withheld.length).toBeGreaterThanOrEqual(3);
      expect(visible.length).toBeGreaterThanOrEqual(4);
      // Every visible forecast first, in order; every withheld one after, by id.
      expect([dir, data.rows.map((row) => row.id)]).toEqual([dir, [...visible, ...withheld].map((row) => row.id)]);
      const sortedVisible = [...visible].sort((a, b) => (a.forecast - b.forecast) * (dir === "desc" ? -1 : 1) || (a.id < b.id ? -1 : 1) * (dir === "desc" ? -1 : 1));
      expect([dir, visible.map((row) => row.id)]).toEqual([dir, sortedVisible.map((row) => row.id)]);
      expect([dir, withheld.map((row) => row.id)]).toEqual([dir, withheld.map((row) => row.id).sort()]);
      expect(withheld.every((row) => row.forecastSource === "default" && row.forecastWithheld === true)).toBe(true);
    }

    // The differential: the PM moves the hidden default across the visible
    // forecasts (0 … 999,999). The BOQ reader's order follows it; the other
    // member's does not move at all — a bisection reads nothing.
    const reference = { asc: (await orderFor(as, "asc")).ids, desc: (await orderFor(as, "desc")).ids };
    const pmPositions = new Set();
    // A default is not counted as a forecast by the projected final cost: the
    // record counts the larger of its budget (its allocation) and its actual,
    // wherever its stored default is moved to.
    const projected = (await get(at("/cost/summary"))).totals.forecast;
    for (const budget of [900, 4_500, 20_000, 1_234_567.89]) {
      const moved = await patch(hidden.id, { budget });
      expect([budget, moved.status, moved.body?.data?.forecast, moved.body?.data?.forecastSource]).toEqual([budget, 200, Math.max(budget, Number(hidden.actual)), "default"]);
      expect([budget, (await get(at("/cost/summary"))).totals.forecast]).toEqual([budget, projected]);
      for (const dir of ["asc", "desc"]) expect([budget, dir, (await orderFor(as, dir)).ids]).toEqual([budget, dir, reference[dir]]);
      const pm = await orderFor(auth(), "asc");
      expect(pm.data.sortWithheld).toBeUndefined();
      expect(pm.data.rows.map((row) => row.forecast)).toEqual([...pm.data.rows.map((row) => row.forecast)].sort((a, b) => a - b));
      pmPositions.add(pm.ids.indexOf(hidden.id));
    }
    expect(pmPositions.size).toBeGreaterThanOrEqual(3);

    // Pages walk the same order, by the cursor.
    const paged = [];
    let cursor = "";
    for (let page = 0; page < 20; page += 1) {
      const data = await get(at(`/cost?limit=3&sortBy=forecast&sortDir=asc${cursor}`), as);
      paged.push(...data.rows.map((row) => row.id));
      if (!data.pagination.nextCursor) break;
      cursor = `&cursor=${data.pagination.nextCursor}`;
    }
    expect(paged).toEqual(reference.asc);
    // Any other sort is the database's, for every reader.
    expect((await get(at("/cost?limit=100&sortBy=actual&sortDir=desc"), as)).sortWithheld).toBeUndefined();
  });

  it("the report builder gives a member who may not read the BOQ no default forecast — not as a cell, a sort, a filter, an aggregate, a group or an export — and the BOQ reader's reports carry it", async () => {
    const as = await noBoqReader();
    // A default no other figure here states: 31,337.77.
    const hidden = await stored("ledger");
    const SECRET = 31_337.77;
    const set = await patch(hidden.id, { budget: SECRET });
    expect([set.status, set.body?.data?.forecast, set.body?.data?.forecastSource]).toEqual([200, SECRET, "default"]);

    const definitions = {
      columns: { source: "cost_record", columns: ["activity.name", "forecast", "forecastSource"], sort: { field: "activity.name", dir: "asc" } },
      "sorted by forecast": { source: "cost_record", columns: ["activity.name", "forecastSource"], sort: { field: "forecast", dir: "desc" } },
      "filtered on forecast": { source: "cost_record", columns: ["activity.name", "forecastSource"], filters: [{ field: "forecast", op: "gt", value: 31_337 }, { field: "forecast", op: "lt", value: 31_338 }] },
      aggregated: { source: "cost_record", columns: ["activity.name"], aggregates: [{ fn: "count" }, { fn: "sum", field: "forecast" }, { fn: "max", field: "forecast" }, { fn: "min", field: "forecast" }, { fn: "avg", field: "forecast" }] },
      "grouped by source": { source: "cost_record", columns: ["activity.name"], groupBy: "forecastSource", aggregates: [{ fn: "count" }, { fn: "sum", field: "forecast" }, { fn: "max", field: "forecast" }] },
    };
    const run = async (headers) => {
      const result = {};
      for (const [name, definition] of Object.entries(definitions)) {
        const response = await api.post("/api/v1/reports/preview", { ...definition, projectId: built.project.id }, headers);
        expect([name, response.status, response.body?.error]).toEqual([name, 200, undefined]);
        result[name] = { text: response.text, data: response.body.data };
      }
      return result;
    };
    const exported = async (definition, headers) => {
      const response = await fetch(`${api.base}/api/v1/reports/export`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ ...definition, projectId: built.project.id, format: "xlsx", name: "LiveTest R5-2 export" }) });
      expect(response.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const cells = [];
      workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value)))));
      return cells;
    };
    const leaks = (text) => String(text).includes("31337");

    // The BOQ reader: the figure, the filter's match, the aggregates.
    const pm = await run(auth());
    const pmRow = pm.columns.data.rows.find((row) => row["activity.name"] === "Activity ledger");
    expect([pmRow.forecast, pmRow.forecastSource, "withheldColumns" in pmRow, "withheld" in pm.columns.data]).toEqual([SECRET, "default", false, false]);
    expect(pm["filtered on forecast"].data.rows.map((row) => row["activity.name"])).toEqual(["Activity ledger"]);
    expect(pm.aggregated.data.totals.max_forecast).toBeGreaterThanOrEqual(SECRET);
    expect((await exported(definitions.columns, auth())).some(leaks)).toBe(true);

    // The member without BOQ read.
    const mine = await run(as);
    for (const [name, { text }] of Object.entries(mine)) expect([name, leaks(text)]).toEqual([name, false]);
    const defaults = mine.columns.data.rows.filter((row) => row.forecastSource === "default");
    const others = mine.columns.data.rows.filter((row) => row.forecastSource !== "default");
    expect(defaults.length).toBeGreaterThanOrEqual(3);
    for (const row of defaults) expect([row["activity.name"], row.forecast, row.withheldColumns]).toEqual([row["activity.name"], null, ["forecast"]]);
    // An entered forecast, and one whose source was not recorded, stay.
    expect(others.length).toBeGreaterThanOrEqual(4);
    for (const row of others) expect([row["activity.name"], typeof row.forecast, "withheldColumns" in row]).toEqual([row["activity.name"], "number", false]);
    expect(others.find((row) => row["activity.name"] === "Activity equip").forecast).toBe(4_321);
    expect(mine.columns.data.withheld).toMatchObject({ columns: ["forecast"], projects: 1 });
    expect(mine.columns.data.columns.find((column) => column.key === "forecast")).toMatchObject({ withheld: true });
    // A filter on the forecast matches no withheld row.
    expect(mine["filtered on forecast"].data.rows).toEqual([]);
    // No aggregate over rows that include a withheld forecast: null, never a sum of the rest.
    expect([mine.aggregated.data.totals.sum_forecast, mine.aggregated.data.totals.max_forecast, mine.aggregated.data.totals.min_forecast, mine.aggregated.data.totals.avg_forecast]).toEqual([null, null, null, null]);
    const group = (label) => mine["grouped by source"].data.groups.find((entry) => entry.label === label);
    expect([group("default").sum_forecast, group("default").max_forecast]).toEqual([null, null]);
    expect(typeof group("entered").sum_forecast).toBe("number");
    // Sorted by forecast, the withheld rows tie — ordered by id — and the
    // order does not move when the hidden default does.
    const orderBefore = mine["sorted by forecast"].data.rows.map((row) => row.id);
    expect((await patch(hidden.id, { budget: 1 })).status).toBe(200);
    const orderAfter = (await run(as))["sorted by forecast"].data.rows.map((row) => row.id);
    expect(orderAfter).toEqual(orderBefore);
    expect((await patch(hidden.id, { budget: SECRET })).status).toBe(200);
    // The export goes the same way.
    const cells = await exported(definitions.columns, as);
    expect(cells.some(leaks)).toBe(false);
    expect(cells).toContain("4321");
  });

  it("the post-import seed marks every record it creates 'default', worked from the activity's approved allocation", async () => {
    // "invalid" was refused a record every time above: it has none.
    expect(await stored("invalid")).toBeNull();
    const count = await prisma.costRecord.count({ where: { projectId: built.project.id } });
    const seeded = await api.post(at("/import/seed-linked-modules"), {}, auth());
    expect([seeded.status, seeded.body?.error]).toEqual([200, undefined]);
    expect(await prisma.costRecord.count({ where: { projectId: built.project.id } })).toBe(count + 1);
    expect(whole(await stored("invalid"))).toEqual({ budget: 0, committed: 0, actual: 0, forecast: ALLOCATED, forecastSource: "default" });
    const row = (await get(at("/cost?limit=100"))).rows.find((record) => record.activityId === built.activities.invalid);
    expect([row.budget, row.forecast, row.forecastSource, row.forecastBasis]).toEqual([ALLOCATED, ALLOCATED, "default", BASIS.default]);
    // ... and a member who may not read the BOQ is not given it.
    const theirs = (await get(at("/cost?limit=100"), await noBoqReader())).rows.find((record) => record.activityId === built.activities.invalid);
    expect(["forecast" in theirs, theirs.forecastWithheld, theirs.forecastSource]).toEqual([false, true, "default"]);
  });

  it("read-only: the certified project's cost records are byte-identical (forecast and forecastSource included) and it still reconciles", async () => {
    const after = await certifiedFingerprint();
    expect(after).toEqual(certifiedBefore);
    if (after) expect(after.balanced).toBe(true);
  });
});
