/**
 * Owner decision R5-2 (2026-09-30) — the default cost forecast, proven against
 * a real API process and the real local Postgres.
 *
 * max(budget, actual) is the INITIAL default only when the forecast is
 * genuinely missing (CostRecord.forecastSource 'default'); a supplied forecast
 * — 0 and "0" included — is stored as given ('entered') and never overwritten
 * by an unrelated edit, a ledger posting or a commitment recompute; a default
 * is re-derived only by a write that changes the budget; a row whose source was
 * not recorded (NULL, older than the column) is treated as entered; the server
 * alone sets forecastSource; every read labels the basis honestly; and the
 * earned-value EAC (revised budget ÷ CPI, D2) and the Overview's forecast at
 * completion never read a cost record's forecast.
 *
 * One UTC project in a throwaway "LiveTest <uuid>" organisation: a BOQ item of
 * 60,000 allocated 10,000 to each of six activities (approved), and a store of
 * cement at 10 a bag. Nothing outside that organisation is written; the
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
  default: "Default forecast: the larger of budget and actual when it was set (no forecast was entered)",
  notRecorded: "Stored forecast (its source was not recorded)",
};
const NAMES = ["fresh", "zero", "zeroText", "invalid", "legacy", "ev"];

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

    const boq = await send(at("/boq/items"), { code: "1.1", description: "Concrete", quantity: 600, unit: "m3", rate: 100 });
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
    for (const forecast of ["lots", "", "-1", -1, "1.234"]) {
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

  it("a legacy row whose source was not recorded (NULL) is treated as entered: a budget edit leaves it, and it is labelled as not recorded", async () => {
    await send(at(`/cost/activity/${built.activities.legacy}`), {});
    const made = await stored("legacy");
    // As a row written before the column existed would be (LiveTest org only).
    await prisma.costRecord.update({ where: { id: made.id }, data: { forecast: 7_777, forecastSource: null } });
    const edited = await patch(made.id, { budget: 20_000 });
    expect([edited.status, edited.body?.data?.forecast, edited.body?.data?.forecastSource, edited.body?.data?.forecastBasis]).toEqual([200, 7_777, null, BASIS.notRecorded]);
    const row = await stored("legacy");
    expect([row.budget.toString(), Number(row.forecast), row.forecastSource]).toEqual(["20000", 7_777, null]);
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
    const reader = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest cost reader", email: `live-r52-cost-${Date.now()}@octapm-live.test`, role: "cost_controller" });
    await prisma.projectAssignment.create({ data: { projectId: built.project.id, userId: reader.id, role: "cost_controller", orgId: live.org.id } });
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest R5-2 cost reader, no BOQ ${Date.now()}`, baseRole: "cost_controller", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: built.project.id, userId: reader.id, templateId: template.id } });
    const as = { authorization: `Bearer ${mintAccessToken(reader)}` };

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

  it("read-only: the certified project's cost records are byte-identical (forecast and forecastSource included) and it still reconciles", async () => {
    const after = await certifiedFingerprint();
    expect(after).toEqual(certifiedBefore);
    if (after) expect(after.balanced).toBe(true);
  });
});
