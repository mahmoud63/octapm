/**
 * PC-7a item 1 — the Original Budget guard, proven against a real API process
 * and the real local Postgres (owner decision 2026-09-29).
 *
 * A budget line's originalBudget stops moving at the FIRST of, per line:
 * (1) an approved financial/budget baseline — none exists in this codebase,
 * so the condition is inert; (2) an approved change on it (a revision, a
 * transfer or an approved change order); (3) an executed commitment against
 * it; (4) a cost-ledger posting on it; (5) the snapshot of a LOCKED reporting
 * period including it. An ad-hoc snapshot, an open period's snapshot and a
 * schedule baseline never lock it. After the lock PATCH answers 409
 * BUDGET_ORIGINAL_LOCKED naming the condition and pointing to revisions, an
 * import keeps the original and lists the line in lockedLines, and
 * re-activating an archived line keeps its original whatever the payload says.
 *
 * Everything runs in throwaway "LiveTest <uuid>" organisations dropped
 * afterwards; the database's legacy opening balances (the certified 12
 * entries, 12,568,290.33) are only read, before and after.
 *
 *   npm run test:live -- src/services/__live__/pc-7a-budget-truths.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const cents = (value) => Math.round(Number(value || 0) * 100);

liveDescribe("PC-7a: the Original Budget cannot be rewritten once changes, postings or a locked period stand on it", () => {
  let live;
  let other;
  let api;
  const projects = {};
  const codes = {};
  const lines = {};
  let activityId;
  let certifiedBefore;
  let lockedPeriodId;

  const auth = (who = live) => ({ authorization: `Bearer ${who.token}` });
  const at = (key, route) => `/api/v1/projects/${projects[key].id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const patchLine = (key, lineId, body, who) => api.request("PATCH", at(key, `/budget/lines/${lineId}`), { body, headers: auth(who) });
  const getLine = async (key, lineId, who) => {
    const answer = await api.get(at(key, `/budget/lines/${lineId}`), auth(who));
    ok(answer);
    return answer.body.data;
  };
  const stored = (lineId) => prisma.budgetLine.findUnique({ where: { id: lineId }, select: { originalBudget: true, updatedAt: true, description: true, status: true } });

  const expectLocked = async (key, lineId, proposed, condition) => {
    const before = await stored(lineId);
    const refused = await patchLine(key, lineId, { originalBudget: proposed });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("BUDGET_ORIGINAL_LOCKED");
    expect(refused.body.error.message).toContain(`condition ${condition}`);
    expect(refused.body.error.message).toContain(`/budget/lines/${lineId}/revisions`);
    expect(refused.body.error.message).toContain("Revised Budget");
    // Nothing written: the row is byte-identical, updatedAt included.
    expect(await stored(lineId)).toEqual(before);
    return refused;
  };

  const newCode = async (who, key, suffix, category = "material") => {
    const created = await api.post("/api/v1/company/cost-codes", { code: `LT7A-${suffix}-${Date.now().toString(36)}`, name: `LiveTest ${suffix}`, category }, auth(who));
    ok(created, 201);
    codes[suffix] = created.body.data;
    ok(await api.request("PUT", at(key, "/budget/cost-codes"), { body: { costCodeIds: [created.body.data.id] }, headers: auth(who) }));
    return created.body.data;
  };
  const newLine = async (who, key, suffix, costType, originalBudget) => {
    const code = codes[suffix] || (await newCode(who, key, suffix));
    const created = await api.post(at(key, "/budget/lines"), { costCodeId: code.id, costType, originalBudget, description: `${suffix} ${costType}` }, auth(who));
    ok(created, 201);
    lines[`${suffix}:${costType}`] = created.body.data.id;
    return created.body.data;
  };
  const newProject = async (who, key, name) => {
    projects[key] = await prisma.project.create({ data: { orgId: who.org.id, name: `LiveTest PC-7a ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });
  };

  // What a second organisation's run must leave untouched (§122).
  const fingerprint = async (orgId) => {
    const projectIds = (await prisma.project.findMany({ where: { orgId }, select: { id: true } })).map((row) => row.id);
    const budget = await prisma.budgetLine.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } });
    const changes = await prisma.budgetLineChange.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } });
    const ledger = await prisma.costLedgerEntry.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } });
    const records = await prisma.costRecord.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } });
    const ev = await prisma.evPeriodSnapshot.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } });
    const snapshots = await prisma.budgetSnapshot.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } });
    return JSON.stringify({ budget, changes, ledger, records, ev, snapshots });
  };

  // The migration's opening balances across the database (read only).
  const certifiedOpenings = async () => {
    const rows = await prisma.costLedgerEntry.findMany({ where: { sourceType: "legacy_opening_balance" }, select: { id: true, amount: true } });
    return { count: rows.length, total: rows.reduce((sum, row) => sum + cents(row.amount), 0), ids: rows.map((row) => row.id).sort() };
  };

  beforeAll(async () => {
    certifiedBefore = await certifiedOpenings();
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    await newProject(live, "GUARD", "guard");
    await newProject(live, "PERIOD", "locked period");
    await newProject(other, "OTHER", "second organisation");
    const activity = await api.post(at("GUARD", "/activities"), { engineerIds: [live.user.id], name: "Pour slab", activityCode: "A7A", duration: 3, startDate: "2026-02-02", endDate: "2026-02-04" }, auth());
    ok(activity, 201);
    activityId = activity.body.data.id;
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  it("an unlocked line takes a new original and an echo; an ad-hoc snapshot, an open period's snapshot and a schedule baseline lock nothing", async () => {
    const line = await newLine(live, "GUARD", "FREE", "material", 100000);
    let answer = await patchLine("GUARD", line.id, { originalBudget: 120000 });
    ok(answer);
    expect(answer.body.data.originalBudget).toBe(120000);
    answer = await patchLine("GUARD", line.id, { originalBudget: 120000.004, description: "echo" });
    ok(answer);
    expect(answer.body.data.originalBudget).toBe(120000);

    ok(await api.post(at("GUARD", "/budget/snapshots"), { label: "LiveTest ad hoc" }, auth()), 201);
    ok(await patchLine("GUARD", line.id, { originalBudget: 110000 }));

    const period = await api.post(at("GUARD", "/reports/periods"), { code: "P-OPEN", periodStart: "2026-01-01", periodEnd: "2026-01-31", cutoffDate: "2026-01-31" }, auth());
    ok(period, 201);
    const periodId = period.body.data.id || period.body.data.period?.id;
    expect(periodId).toBeTruthy();
    ok(await api.post(at("GUARD", "/budget/snapshots"), { label: "LiveTest open period", reportingPeriodId: periodId }, auth()), 201);
    expect((await prisma.reportingPeriod.findUnique({ where: { id: periodId } })).status).toBe("open");
    ok(await patchLine("GUARD", line.id, { originalBudget: 105000 }));

    // A schedule baseline is a separate control: this project's own baselined revision.
    await prisma.scheduleRevision.create({ data: { projectId: projects.GUARD.id, label: "LiveTest baseline", status: "baselined", isActive: true, baselinedBy: live.user.id, baselinedAt: new Date() } });
    await prisma.project.update({ where: { id: projects.GUARD.id }, data: { baselineDate: new Date("2026-01-05") } });
    answer = await patchLine("GUARD", line.id, { originalBudget: 100000 });
    ok(answer);
    expect(answer.body.data.originalBudget).toBe(100000);
  });

  it("condition 2 — the owner's example: original 100,000 + approved revision +50,000 reads revised 150,000, original 100,000; a PATCH is refused and the sibling stays editable", async () => {
    const line = await newLine(live, "GUARD", "REV", "material", 100000);
    const sibling = await newLine(live, "GUARD", "REV", "labour", 40000);
    ok(await api.post(at("GUARD", `/budget/lines/${line.id}/revisions`), { amount: 50000, note: "LiveTest: scope grew" }, auth()), 201);
    await expectLocked("GUARD", line.id, 150000, 2);
    const read = await getLine("GUARD", line.id);
    expect([read.originalBudget, read.revisedBudget]).toEqual([100000, 150000]);
    // An echo of the locked figure passes (the edit dialog sends it back).
    ok(await patchLine("GUARD", line.id, { originalBudget: 100000, description: "echo on a locked line" }));
    const again = await patchLine("GUARD", sibling.id, { originalBudget: 45000 });
    ok(again);
    expect(again.body.data.originalBudget).toBe(45000);
  });

  it("condition 3 — an executed commitment against the line locks it, not its sibling", async () => {
    const line = await newLine(live, "GUARD", "SUB", "subcontract", 80000);
    const sibling = await newLine(live, "GUARD", "SUB", "equipment", 20000);
    const vendor = await prisma.company.create({ data: { orgId: live.org.id, name: "LiveTest Formwork Ltd" } });
    const created = await api.post(at("GUARD", "/commitments"), { title: "LiveTest subcontract", type: "subcontract", vendorCompanyId: vendor.id, lines: [{ description: "Formwork", budgetLineId: line.id, activityId, qty: 1, rate: 30000, amount: 30000 }] }, auth());
    ok(created, 201);
    const commitmentId = created.body.data.id;
    // Approved but not executed: no lock yet.
    ok(await api.post(at("GUARD", `/commitments/${commitmentId}/submit`), {}, auth()));
    ok(await api.post(at("GUARD", `/commitments/${commitmentId}/approve`), {}, auth()));
    ok(await patchLine("GUARD", line.id, { originalBudget: 85000 }));
    const document = await prisma.projectDocument.create({
      data: { orgId: live.org.id, projectId: projects.GUARD.id, documentType: "workflow_attachment", originalName: "agreement.pdf", fileName: "agreement.pdf", mimeType: "application/pdf", sizeBytes: 1, sha256: "0".repeat(64), storageProvider: "local", objectKey: `livetest/${commitmentId}`, storageKey: `livetest/${commitmentId}/${Date.now()}` },
    });
    ok(await api.post(at("GUARD", `/commitments/${commitmentId}/execute`), { documentId: document.id }, auth()));
    await expectLocked("GUARD", line.id, 90000, 3);
    expect((await getLine("GUARD", line.id)).originalBudget).toBe(85000);
    ok(await patchLine("GUARD", sibling.id, { originalBudget: 25000 }));
  });

  it("condition 4 — a ledger posting on the line locks it, not its sibling", async () => {
    const line = await newLine(live, "GUARD", "DC", "material", 60000);
    const sibling = await newLine(live, "GUARD", "DC", "other", 10000);
    const cost = await api.post(at("GUARD", "/direct-costs"), { description: "LiveTest invoice", costDate: "2026-02-03", type: "invoice", vendorName: "LiveTest supplier", lines: [{ description: "Rebar", budgetLineId: line.id, activityId, costType: "material", amount: 1234.56 }] }, auth());
    ok(cost, 201);
    ok(await api.post(at("GUARD", `/direct-costs/${cost.body.data.id}/submit`), {}, auth()));
    ok(await api.post(at("GUARD", `/direct-costs/${cost.body.data.id}/approve`), {}, auth()));
    expect(await prisma.costLedgerEntry.count({ where: { projectId: projects.GUARD.id, budgetLineId: line.id } })).toBe(1);
    await expectLocked("GUARD", line.id, 70000, 4);
    ok(await patchLine("GUARD", sibling.id, { originalBudget: 12000 }));
  });

  it("an import never overwrites a locked original: it is listed in lockedLines, its description is written, a new line is created", async () => {
    const locked = lines["REV:material"];
    const response = await api.post(at("GUARD", "/budget/lines/import"), {
      rows: [
        { code: codes.REV.code, costType: "material", originalBudget: 999, description: "imported description" },
        { code: codes.FREE.code, costType: "material", originalBudget: 101000 },
        { code: `LT7A-NEW-${Date.now().toString(36)}`, name: "LiveTest new", costType: "material", originalBudget: 5000 },
      ],
    }, auth());
    ok(response, 201);
    expect(response.body.data).toMatchObject({ created: 1, updated: 1, missingCodes: [] });
    expect(response.body.data.lockedLines).toEqual([
      expect.objectContaining({ code: codes.REV.code, costType: "material", existing: 100000, proposed: 999, conditions: [expect.objectContaining({ condition: "approved_change", number: 2 })] }),
    ]);
    const row = await getLine("GUARD", locked);
    expect([row.originalBudget, row.revisedBudget, row.description]).toEqual([100000, 150000, "imported description"]);
    expect((await getLine("GUARD", lines["FREE:material"])).originalBudget).toBe(101000);
  });

  it("re-activating an archived line keeps its original, locked or not, whatever the payload says", async () => {
    const lockedId = lines["DC:material"];
    ok(await api.request("DELETE", at("GUARD", `/budget/lines/${lockedId}`), { headers: auth() }));
    const again = await api.post(at("GUARD", "/budget/lines"), { costCodeId: codes.DC.id, costType: "material", originalBudget: 1 }, auth());
    ok(again, 201);
    expect(again.body.data.id).toBe(lockedId);
    expect(again.body.data.status).toBe("active");
    expect(again.body.data.originalBudget).toBe(60000);
    expect(again.body.data.originalBudgetKept).toMatchObject({ existing: 60000, proposed: 1, locked: true, conditions: [expect.objectContaining({ number: 4 })] });

    const freeId = lines["DC:other"];
    ok(await api.request("DELETE", at("GUARD", `/budget/lines/${freeId}`), { headers: auth() }));
    const back = await api.post(at("GUARD", "/budget/lines"), { costCodeId: codes.DC.id, costType: "other", originalBudget: 77 }, auth());
    ok(back, 201);
    expect(back.body.data.originalBudget).toBe(12000);
    expect(back.body.data.originalBudgetKept).toMatchObject({ existing: 12000, proposed: 77, locked: false, conditions: [] });
    expect((await stored(freeId)).originalBudget.toString()).toBe("12000");
  });

  it("condition 5 — a LOCKED period's snapshot locks the lines in it; a line added after the lock stays editable", async () => {
    const line = await newLine(live, "PERIOD", "PER", "material", 50000);
    const period = await api.post(at("PERIOD", "/reports/periods"), { code: "P01", periodStart: "2026-01-01", periodEnd: "2026-01-31", cutoffDate: "2026-01-31" }, auth());
    ok(period, 201);
    const periodId = period.body.data.id || period.body.data.period?.id;
    ok(await api.post(at("PERIOD", `/reports/periods/${periodId}/lock`), { overrideReason: "LiveTest PC-7a: lock over the setup gate" }, auth()));
    const snapshot = await prisma.budgetSnapshot.findUnique({ where: { reportingPeriodId: periodId } });
    expect(snapshot.linesJson.map((row) => row.id)).toContain(line.id);
    await expectLocked("PERIOD", line.id, 55000, 5);
    const later = await newLine(live, "PERIOD", "PER", "labour", 9000);
    ok(await patchLine("PERIOD", later.id, { originalBudget: 9500 }));
    lockedPeriodId = periodId;
  });

  // PC-7a item 2 — three truths. Labels only: each figure says whether it is
  // source, derived or a projection, and from what; no figure moves, nothing
  // stored takes the labels, and a reader who may not read the BOQ receives
  // the same labels and no more figures than before.
  const withoutTruth = (value) => {
    const copy = { ...value };
    delete copy.truth;
    return copy;
  };

  it("three truths — budget lines, cost summary, forecast and EV report label every figure; stored snapshots keep figures only", async () => {
    // A typed forecast on one line, the default on the others.
    ok(await patchLine("GUARD", lines["FREE:material"], { forecast: 111000 }));
    const register = await api.get(at("GUARD", "/budget/lines"), auth());
    ok(register);
    const items = register.body.data.items;
    expect(items.length).toBeGreaterThan(3);
    for (const line of items) {
      expect(line.truth).toMatchObject({ originalBudget: "source", revised: "derived", committed: "derived", actual: "derived" });
      expect(line.truth.forecast).toBe(line.forecastIsManual ? "projection:typed" : "projection:greatest_of_revised_actual_committed");
      expect(Object.keys(line.truth.derivedFrom).sort()).toEqual(["actual", "committed", "forecast", "originalBudget", "revised"]);
    }
    expect(items.find((line) => line.id === lines["FREE:material"]).truth.forecast).toBe("projection:typed");
    // The default forecast is still max(revised, actual, committed): a label, not a formula change.
    for (const line of items.filter((row) => !row.forecastIsManual)) {
      expect(line.forecast).toBe(Math.max(line.revisedBudget, line.actual, line.committed));
    }

    // An ad-hoc snapshot stores the figures only — the register's lines
    // without their labels, figure for figure.
    const taken = await api.post(at("GUARD", "/budget/snapshots"), { label: "LiveTest truths" }, auth());
    ok(taken, 201);
    const stored = await prisma.budgetSnapshot.findUnique({ where: { id: taken.body.data.id } });
    expect(stored.linesJson.some((row) => Object.prototype.hasOwnProperty.call(row, "truth"))).toBe(false);
    const figures = (row) => [row.id, row.originalBudget, row.revisedBudget, row.committed, row.actual, row.forecast, row.variance];
    const registerAll = await api.get(at("GUARD", "/budget/lines?includeArchived=true"), auth());
    ok(registerAll);
    expect(stored.linesJson.map(figures)).toEqual(registerAll.body.data.items.map(figures));
    // And the locked period's snapshot (taken at the lock) carries none either.
    const lockedBudget = await prisma.budgetSnapshot.findUnique({ where: { reportingPeriodId: lockedPeriodId } });
    expect(lockedBudget.linesJson.some((row) => Object.prototype.hasOwnProperty.call(row, "truth"))).toBe(false);

    // Cost summary: the register's budget is "Budget"; the other two are named apart.
    const summary = await api.get(at("GUARD", "/cost/summary"), auth());
    ok(summary);
    const cost = summary.body.data;
    expect(cost.budget).toMatchObject({ label: "Budget", source: "budget_register" });
    expect(cost.truth.budget).toMatchObject({ truth: "derived", label: "Budget" });
    expect(cost.truth.budget.otherBudgets.map((row) => row.label)).toEqual(["Budget at completion (EV basis)", "Contract value + approved changes"]);
    expect(cost.truth.totals).toMatchObject({ budget: "derived", committed: "derived", actual: "derived", forecast: "projection:estimate_at_completion" });
    expect(cost.truth.records.forecast).toBe("projection:typed_or_budget_plus_1.1x_actual_minus_budget");
    expect(cost.truth.records.derivedFrom.forecast).toContain("budget + 1.1 × (actual − budget)");
    expect(cost.truth.eac.truth).toBe("projection:estimate_at_completion");

    // EV report, live and locked: the EAC is a projection whose rule is
    // eacBasis; the BAC is the "Budget at completion (EV basis)".
    const report = await api.get(at("GUARD", "/reports/ev"), auth());
    ok(report);
    expect(report.body.data.truth).toMatchObject({ pv: "derived", ev: "derived", ac: "derived", totalBudget: "derived", eac: "projection:eacBasis", labels: { totalBudget: "Budget at completion (EV basis)" } });
    const locked = await api.get(at("PERIOD", `/reports/ev?periodId=${lockedPeriodId}`), auth());
    ok(locked);
    expect(locked.body.data.reporting.isSnapshot).toBe(true);
    expect(locked.body.data.truth).toEqual(report.body.data.truth);
    const evSnapshot = await prisma.evPeriodSnapshot.findFirst({ where: { reportingPeriodId: lockedPeriodId } });
    expect(Object.prototype.hasOwnProperty.call(evSnapshot.basisJson || {}, "truth")).toBe(false);

    // Forecast cost block.
    const forecast = await api.get(at("GUARD", "/forecast"), auth());
    ok(forecast);
    if (forecast.body.data.cost) {
      expect(forecast.body.data.cost.truth).toMatchObject({ budget: "derived", bac: "derived", actual: "derived", eac: "projection:eacBasis", projected: "projection:greater_of_eac_and_bottom_up" });
    } else {
      // No schedule: no cost block to label (the service answers available: false).
      expect(forecast.body.data.available).toBe(false);
    }
  });

  it("three truths — a purchase order summary's orderValue is order value, not committed cost; committed stays as its alias and the register ignores it", async () => {
    const projectId = projects.GUARD.id;
    const registerBefore = await api.get(at("GUARD", "/budget/lines"), auth());
    ok(registerBefore);
    await prisma.procurementOrder.create({ data: { projectId, ref: `LT7A-PO-${Date.now()}`, item: "LiveTest rebar", status: "approved", value: 4321.5 } });
    await prisma.procurementOrder.create({ data: { projectId, ref: `LT7A-PL-${Date.now()}`, item: "LiveTest planned", status: "planned", value: 1000 } });
    const list = await api.get(at("GUARD", "/purchase-orders"), auth());
    ok(list);
    expect(list.body.data.summary).toMatchObject({ orderValue: 4321.5, committed: 4321.5, orderValueLabel: "Order value — not committed cost" });
    const registerAfter = await api.get(at("GUARD", "/budget/lines"), auth());
    ok(registerAfter);
    expect(registerAfter.body.data.summary.totals.committed).toBe(registerBefore.body.data.summary.totals.committed);
  });

  it("three truths — a cost reader who may not read the BOQ gets the same labels and still no allocation-derived figure", async () => {
    const reader = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest cost reader", email: `live-7a-cost-${Date.now()}@octapm-live.test`, role: "cost_controller" });
    await prisma.projectAssignment.create({ data: { projectId: projects.GUARD.id, userId: reader.id, role: "cost_controller", orgId: live.org.id } });
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest cost reader, no BOQ ${Date.now()}`, baseRole: "cost_controller", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: projects.GUARD.id, userId: reader.id, templateId: template.id } });
    const as = { authorization: `Bearer ${mintAccessToken(reader)}` };

    const full = (await api.get(at("GUARD", "/cost/summary"), auth())).body.data;
    const partial = await api.get(at("GUARD", "/cost/summary"), as);
    ok(partial);
    // The labels are the same object for both readers: they describe keys, not values.
    expect(partial.body.data.truth).toEqual(full.truth);
    // And the figures built from allocations are still withheld, reason given.
    expect(partial.body.data.activityBudgetsWithheld).toBe(true);
    expect(partial.body.data.totals).not.toHaveProperty("forecast");
    expect(partial.body.data.totals).not.toHaveProperty("budget");
    expect(partial.body.data.budget).not.toHaveProperty("allocatedToActivities");
    expect(withoutTruth(partial.body.data.budget)).toEqual(withoutTruth({ ...full.budget, allocatedToActivities: undefined, }));

    const fullReport = (await api.get(at("GUARD", "/reports/ev"), auth())).body.data;
    const partialReport = await api.get(at("GUARD", "/reports/ev"), as);
    ok(partialReport);
    expect(partialReport.body.data.truth).toEqual(fullReport.truth);
    expect(partialReport.body.data).not.toHaveProperty("activityBreakdown");
    expect(partialReport.body.data).not.toHaveProperty("unallocatedBoqAmount");
  });

  it("§139: the guarded project reconciles to 0.00 — ledger = line actuals = cost-record actuals, register committed = executed SOV", async () => {
    const projectId = projects.GUARD.id;
    const ledger = (await prisma.costLedgerEntry.findMany({ where: { projectId }, select: { amount: true } })).reduce((sum, row) => sum + cents(row.amount), 0);
    const lineActual = (await prisma.budgetLine.findMany({ where: { projectId }, select: { actual: true } })).reduce((sum, row) => sum + cents(row.actual), 0);
    const recordActual = (await prisma.costRecord.findMany({ where: { projectId }, select: { actual: true } })).reduce((sum, row) => sum + cents(row.actual), 0);
    expect([ledger, lineActual, recordActual]).toEqual([123456, 123456, 123456]);
    const register = await api.get(at("GUARD", "/budget/lines"), auth());
    ok(register);
    expect(cents(register.body.data.summary.totals.committed)).toBe(cents(30000));
    // One revision, one ledger entry: nothing was posted twice.
    expect(await prisma.budgetLineChange.count({ where: { projectId } })).toBe(1);
    expect(await prisma.costLedgerEntry.count({ where: { projectId } })).toBe(1);
  });

  it("§122: the same run under a second organisation leaves the first organisation's budget, ledger and EV rows byte-identical; the certification project's openings are unchanged", async () => {
    const before = await fingerprint(live.org.id);
    const line = await newLine(other, "OTHER", "OTH", "material", 100000);
    ok(await api.post(at("OTHER", `/budget/lines/${line.id}/revisions`), { amount: 50000, note: "LiveTest: other org" }, auth(other)), 201);
    const refused = await patchLine("OTHER", line.id, { originalBudget: 150000 }, other);
    expect(refused.status).toBe(409);
    ok(await api.post(at("OTHER", "/budget/lines/import"), { rows: [{ code: codes.OTH.code, costType: "material", originalBudget: 1 }] }, auth(other)), 201);
    // The first organisation's line answers the second as a missing one does.
    expect((await patchLine("OTHER", lines["REV:material"], { originalBudget: 1 }, other)).status).toBe(404);
    expect(await fingerprint(live.org.id)).toBe(before);
    expect(await certifiedOpenings()).toEqual(certifiedBefore);
    expect(certifiedBefore.count).toBe(12);
    expect(certifiedBefore.total).toBe(1256829033);
  });
});
