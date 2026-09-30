/**
 * A certificate's cap-limited totals restate a withheld contract value, and
 * are withheld with it — proven against a real API process and the real
 * local Postgres (PC-7a item 2, owner decision 2026-09-29).
 *
 * Retention stops at the cap, a rate of the revised value: on a certificate
 * the cap limits, its retention is the cap less what earlier certificates
 * hold, and its net payable, tax and balance follow — the revised value
 * restated. Where that value is a BOQ fallback or unestablished, a member
 * without BOQ read receives a certificate not yet certified without those
 * totals (the IPC list, the period, the statement's summary, current period
 * and periods, and the history's submission events), each with
 * `valueWithheld`. Decided on the source, the cap rate and the status only.
 * Certified work, gross, a certified certificate's held retention and
 * payable stay; a BOQ reader, an established value and a contract with no cap
 * are unaffected.
 *
 * Projects, all in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards, each with one priced row (20 × 613.37 = 12,267.40) allocated to
 * one activity approved complete, retention 10%, and P01 claiming half of
 * it (6,133.70), drafted and submitted:
 * - FALLBACK: no contract value (boq_fallback), cap 4% — the cap binds on P01 (10% is 613.37):
 *   its retention is 4% of 12,267.40 = 490.70, which restates the value;
 * - NOCAP: no contract value (boq_fallback), no cap — nothing withheld;
 * - VALUED: the project's own value (project_value), cap 4% — nothing withheld;
 * - HIST: P01 certified under an established value, whose row is then set to
 *   an unestablished source (NULL: a row that predates the column), and P02
 *   drafted — P01's held retention stays, P02's totals are withheld.
 *
 *   npm run test:live -- src/services/__live__/retention-cap-withholding.live.test.js
 */
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const CAP_KEYS = ["totalRet", "netPayable", "taxAmount", "balanceDue"];
const REVISED = "12267.4";
const CAP = "490.7";

liveDescribe("A certificate's cap-limited totals are withheld with an unconfirmed contract value", () => {
  let live;
  let api;
  let pm; // a PM whose template sets the BOQ tool to none, on every project
  const projects = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (key, route) => `/api/v1/projects/${projects[key].id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const contractOf = (key) => prisma.primeContract.findFirst({ where: { projectId: projects[key].id } });

  const buildBilling = async (key, { contractValue = null, capRate = null }) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest retention cap ${key}`, contractValue, defaultRetentionRate: 10, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    projects[key] = project;
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: pm.id, role: "pm", orgId: live.org.id } });
    await prisma.projectUserPermission.create({
      data: { orgId: live.org.id, projectId: project.id, userId: pm.id, templateId: pm.templateId },
    });
    const created = await api.post(at(key, "/boq/items"), { code: `K8.${key.length}`, description: `Row ${key}`, quantity: 20, unit: "m3", rate: 613.37 }, auth());
    ok(created, 201);
    const activity = await api.post(at(key, "/activities"), {
      engineerIds: [live.user.id],
      name: `Pour ${key}`,
      activityCode: "A810",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    ok(activity, 201);
    const allocation = await api.post(at(key, "/activity-boq-allocations"), { boqItemId: created.body.data.item.id, activityId: activity.body.data.id, quantity: 20 }, auth());
    ok(allocation, 201);
    for (const step of ["submit", "approve"]) ok(await api.post(at(key, `/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, auth()));
    await prisma.activityProgress.create({
      data: { activityId: activity.body.data.id, pctComplete: 100, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
    });
    ok(await api.get(at(key, "/prime-contract"), auth()));
    ok(await api.request("PATCH", at(key, "/prime-contract"), {
      body: { retentionRate: 10, retentionCapRate: capRate },
      headers: auth(),
    }));
    const period = await api.post(at(key, "/ipc"), { period: "P01" }, auth());
    ok(period, 201);
    ok(await api.request("PATCH", at(key, `/ipc/P01/items/${period.body.data.items[0].id}`), { body: { qty: 10 }, headers: auth() }));
    ok(await api.post(at(key, "/ipc/P01/submit"), {}, auth()));
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    pm = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest PM without BOQ",
      email: `live-retention-cap-pm-${tag}@octapm-live.test`,
      role: "pm",
    });
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest PM, no BOQ ${tag}`, baseRole: "pm", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    pm.templateId = template.id;

    await buildBilling("FALLBACK", { capRate: 4 });
    await buildBilling("NOCAP", {});
    await buildBilling("VALUED", { contractValue: 12267.4, capRate: 4 });
    await buildBilling("HIST", { contractValue: 12267.4, capRate: 4 });

    // HIST: P01 certified under an established value, then its contract row
    // (this project's one, by id) set to a source that predates the column.
    ok(await api.post(at("HIST", "/ipc/P01/certify"), {}, auth()));
    const hist = await contractOf("HIST");
    expect(hist?.id).toBeTruthy();
    await prisma.primeContract.update({ where: { id: hist.id }, data: { originalValueSource: null } });
    ok(await api.post(at("HIST", "/ipc"), { period: "P02" }, auth()), 201);

    expect((await contractOf("FALLBACK")).originalValueSource).toBe("boq_fallback");
    expect((await contractOf("NOCAP")).originalValueSource).toBe("boq_fallback");
    expect((await contractOf("VALUED")).originalValueSource).toBe("project_value");
    // The cap binds on FALLBACK's P01: 10% of 6,133.70 is 613.37; held to 4% of 12,267.40.
    expect(String(Number((await prisma.ipcCertificate.findFirst({ where: { projectId: projects.FALLBACK.id, period: "P01" } })).totalRet))).toBe(CAP);
    expect((await api.get(at("FALLBACK", "/boq"), as(pm))).status).toBe(403);
  }, 240_000);

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

  const withheldTotals = (row) => {
    for (const key of CAP_KEYS) expect([row.period, key, row[key]]).toEqual([row.period, key, undefined]);
    expect(row.valueWithheld.keys.length).toBeGreaterThan(0);
    expect(row.valueWithheld.reason).toMatch(/retention cap/);
    expect(Number(row.totalCert)).toBeGreaterThan(0);
  };

  it("a member without BOQ read receives FALLBACK's submitted certificate, statement and history without the cap-limited totals — nowhere in the answers is the cap or the value", async () => {
    const list = await api.get(at("FALLBACK", "/ipc"), as(pm));
    ok(list);
    withheldTotals(list.body.data[0]);
    const period = await api.get(at("FALLBACK", "/ipc/P01"), as(pm));
    ok(period);
    withheldTotals(period.body.data);
    expect(Number(period.body.data.grossThisPeriod)).toBeGreaterThan(0);

    const statement = await api.get(at("FALLBACK", "/prime-contract/statement"), as(pm));
    ok(statement);
    const { summary, current, periods } = statement.body.data;
    for (const key of ["retentionThisPeriod", "taxAmount", "totalDue", "revisedValue", "originalValue", "remainingToCertify"]) {
      expect([key, summary[key]]).toEqual([key, undefined]);
      expect(summary.valueWithheld.keys).toContain(key);
    }
    expect(summary.grossThisPeriod).toBe(6133.7);
    for (const key of ["totalRet", "netPayable", "balanceDue"]) {
      expect([key, current[key], periods[0][key]]).toEqual([key, undefined, undefined]);
    }
    expect(current.valueWithheld.reason).toMatch(/retention cap/);

    const history = await api.get(`${at("FALLBACK", "/audit")}?entityType=ipc_certificate`, as(pm));
    ok(history);
    const submits = history.body.data.events.filter((event) => event.newStatus === "submitted");
    expect(submits.length).toBeGreaterThan(0);
    for (const event of submits) {
      for (const part of ["oldSummary", "newSummary", "summary", "metadata"]) {
        if (event[part]) expect([part, event[part].netPayable, event[part].totalRet]).toEqual([part, undefined, undefined]);
      }
      expect(event.valueWithheld.reason).toMatch(/retention cap/);
    }

    for (const answer of [list, period, statement, history]) {
      const text = JSON.stringify(answer.body);
      expect([text.includes(CAP), text.includes(REVISED)]).toEqual([false, false]);
    }
  });

  it("a BOQ reader receives the same answers with every total (the differential)", async () => {
    const period = await api.get(at("FALLBACK", "/ipc/P01"), auth());
    ok(period);
    expect(String(period.body.data.totalRet)).toBe(CAP);
    expect(period.body.data.valueWithheld).toBeUndefined();
    const statement = await api.get(at("FALLBACK", "/prime-contract/statement"), auth());
    expect(String(statement.body.data.summary.retentionThisPeriod)).toBe(CAP);
    expect(String(statement.body.data.current.totalRet)).toBe(CAP);
    const history = await api.get(`${at("FALLBACK", "/audit")}?entityType=ipc_certificate`, auth());
    const submit = history.body.data.events.find((event) => event.newStatus === "submitted" && event.summary);
    expect(submit.summary.netPayable).not.toBeUndefined();
  });

  it("no cap, or an established value: the member without BOQ read receives every total", async () => {
    for (const key of ["NOCAP", "VALUED"]) {
      const period = await api.get(at(key, "/ipc/P01"), as(pm));
      ok(period);
      expect([key, period.body.data.valueWithheld]).toEqual([key, undefined]);
      expect([key, Number(period.body.data.totalRet) > 0, Number(period.body.data.netPayable) > 0]).toEqual([key, true, true]);
      const statement = await api.get(at(key, "/prime-contract/statement"), as(pm));
      expect([key, typeof statement.body.data.summary.retentionThisPeriod, typeof statement.body.data.current.totalRet]).toEqual([key, "number", "number"]);
    }
  });

  it("history: a certified certificate's held retention stays; the draft after it is withheld", async () => {
    const list = await api.get(at("HIST", "/ipc"), as(pm));
    ok(list);
    const p01 = list.body.data.find((row) => row.period === "P01");
    const p02 = list.body.data.find((row) => row.period === "P02");
    expect(p01.status).toBe("certified");
    expect(String(p01.totalRet)).toBe(CAP);
    expect(p01.valueWithheld).toBeUndefined();
    for (const key of CAP_KEYS) expect([key, p02[key]]).toEqual([key, undefined]);
    expect(p02.valueWithheld.reason).toMatch(/retention cap/);

    const statement = await api.get(at("HIST", "/prime-contract/statement"), as(pm));
    ok(statement);
    const byPeriod = Object.fromEntries(statement.body.data.periods.map((row) => [row.period, row]));
    expect(String(byPeriod.P01.totalRet)).toBe(CAP);
    expect(byPeriod.P02.totalRet).toBeUndefined();
    expect(statement.body.data.current.period).toBe("P02");
    expect(statement.body.data.summary.retentionThisPeriod).toBeUndefined();
    expect(statement.body.data.summary.retentionCumulative).toBe(490.7);

    const history = await api.get(`${at("HIST", "/audit")}?entityType=ipc_certificate`, as(pm));
    const certify = history.body.data.events.find((event) => event.newStatus === "certified" && event.newSummary);
    // The recorded after-state is the held retention (stored as the event wrote it).
    expect(certify.newSummary.totalRet).toBeDefined();
    expect(certify.newSummary.netPayable).toBeDefined();
    expect(certify.valueWithheld?.parts || []).not.toContain("newSummary");
  });
});
