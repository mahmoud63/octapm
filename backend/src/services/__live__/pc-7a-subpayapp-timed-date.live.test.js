/**
 * PC-7a item 3c, the subcontractor pay-application writer — proven end to end
 * against a real API process and the real local Postgres.
 *
 * Certifying a pay application posts its cost to the ledger
 * (sub-pay-app.service postCertifiedCost). Its economic date:
 *
 *   periodEnd given  -> incurredOn = periodEnd, a calendar date typed in,
 *                       kept as entered (00:00 UTC of that date), whatever
 *                       the zone and whenever it is approved;
 *   no periodEnd     -> incurredAt = the approval instant, which the ledger
 *                       dates on the calendar day it falls on in the
 *                       project's reporting zone (Project.timezone ->
 *                       Organisation.defaultTimezone -> UTC), stored 00:00 UTC.
 *
 * The approval instant is the server's "now", so the project's zone is picked
 * at run time to make that local day differ from the UTC day (UTC-11 before
 * 10:00Z, UTC+14 from 10:00Z), and the API's own process zone (TZ) is one
 * whose day is the UTC day then (Asia/Kolkata, America/Sao_Paulo): dating the
 * instant in UTC or in the server's zone gives a different date and fails.
 * Official AC is then cut on that local day: counted on it, never on the day
 * before.
 *
 * The commitment goes through the API (create, submit, approve, execute with
 * an agreement document row); the applications through the API (create,
 * claim, submit, approve with a stated compliance override: the LiveTest
 * vendor has no insurance on file). Everything lives in a throwaway
 * "LiveTest <uuid>" organisation dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/pc-7a-subpayapp-timed-date.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const localDate = (instant, timeZone) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
const shiftDate = (date, days) => {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

liveDescribe("PC-7a 3c: a certified pay application's cost is dated by its period end, else on the approval's local reporting day", () => {
  let live;
  let api;
  let project;
  let activityId;
  let commitment;
  // UTC-11 before 10:00Z, UTC+14 from then: the local day is never the UTC
  // day. The server's zone is one whose day is the UTC day at that hour.
  const zone =
    new Date().getUTCHours() < 10
      ? { timeZone: "Pacific/Pago_Pago", offsetDays: -1, serverZone: "Asia/Kolkata" }
      : { timeZone: "Pacific/Kiritimati", offsetDays: 1, serverZone: "America/Sao_Paulo" };

  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const send = async (method, route, body, expected = 200) => {
    const response = method === "post" ? await api.post(route, body, auth()) : await api.request(method.toUpperCase(), route, { body, headers: auth() });
    expect([method, route, response.status, response.body?.error]).toEqual([method, route, expected, undefined]);
    return response.body.data;
  };
  const ledger = (payAppId) =>
    prisma.costLedgerEntry.findMany({ where: { projectId: project.id, sourceType: "sub_pay_app", sourceId: payAppId }, select: { incurredOn: true, amount: true, activityId: true } });
  const ac = async (cutoffDate) => {
    const response = await api.get(at(`/reports/ev?cutoffDate=${cutoffDate}`), auth());
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data.ac;
  };

  // One application: created, claimed, submitted and certified through the API.
  const certify = async ({ periodLabel, periodEnd, amount }) => {
    const created = await send("post", at("/pay-apps"), { commitmentId: commitment.id, periodLabel, ...(periodEnd ? { periodEnd } : {}) }, 201);
    const sovLineId = created.lines[0].sovLineId;
    await send("patch", at(`/pay-apps/${created.id}`), { lines: [{ sovLineId, thisPeriodAmount: amount }] });
    await send("post", at(`/pay-apps/${created.id}/submit`), {});
    await send("post", at(`/pay-apps/${created.id}/approve`), { complianceOverrideReason: "LiveTest PC-7a 3c: no insurance on file for the LiveTest vendor" });
    const stored = await prisma.subPayApp.findUnique({ where: { id: created.id }, select: { status: true, approvedAt: true, periodEnd: true } });
    expect(stored.status).toBe("approved");
    return { id: created.id, ...stored };
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    // The server's own zone must not matter.
    api = await startApi({ TZ: zone.serverZone, DATABASE_CONNECTION_LIMIT: "4" });
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest PC-7a 3c pay app ${zone.timeZone}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18"), timezone: zone.timeZone },
    });
    const stamp = Date.now().toString(36);
    const code = await send("post", "/api/v1/company/cost-codes", { code: `LT3C-SUB-${stamp}`, name: "LiveTest subcontract", category: "subcontract" }, 201);
    await send("put", at("/budget/cost-codes"), { costCodeIds: [code.id] });
    const line = await send("post", at("/budget/lines"), { costCodeId: code.id, costType: "subcontract", originalBudget: 50000 }, 201);
    const activity = await send("post", at("/activities"), { name: "Formwork", activityCode: "S100", duration: 5, startDate: "2026-01-05", endDate: "2026-01-09", engineerIds: [live.user.id] }, 201);
    activityId = activity.id;
    const vendor = await prisma.company.create({ data: { orgId: live.org.id, name: "LiveTest Formwork Ltd" } });
    commitment = await send("post", at("/commitments"), { title: "LiveTest subcontract", type: "subcontract", vendorCompanyId: vendor.id, lines: [{ description: "Formwork", budgetLineId: line.id, activityId, qty: 1, rate: 30000, amount: 30000 }] }, 201);
    await send("post", at(`/commitments/${commitment.id}/submit`), {});
    await send("post", at(`/commitments/${commitment.id}/approve`), {});
    const document = await prisma.projectDocument.create({
      data: { orgId: live.org.id, projectId: project.id, documentType: "workflow_attachment", originalName: "agreement.pdf", fileName: "agreement.pdf", mimeType: "application/pdf", sizeBytes: 1, sha256: "0".repeat(64), storageProvider: "local", objectKey: `livetest/${commitment.id}`, storageKey: `livetest/${commitment.id}/${stamp}` },
    });
    await send("post", at(`/commitments/${commitment.id}/execute`), { documentId: document.id });
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("with a period end: the cost is dated on the period end as typed, not on the approval", async () => {
    const payApp = await certify({ periodLabel: "2026-03", periodEnd: "2026-03-31", amount: 1000 });
    expect(payApp.periodEnd.toISOString()).toBe("2026-03-31T00:00:00.000Z");
    const rows = await ledger(payApp.id);
    expect(rows.map((row) => [row.incurredOn.toISOString(), Number(row.amount), row.activityId])).toEqual([["2026-03-31T00:00:00.000Z", 1000, activityId]]);
    // The approval was today; the cost is not.
    expect(localDate(payApp.approvedAt, zone.timeZone)).not.toBe("2026-03-31");
  });

  it("without a period end: the cost is dated on the calendar day the approval falls on in the project's zone — not the UTC day, not the server's — and official AC is cut on that day", async () => {
    const payApp = await certify({ periodLabel: "current", amount: 2000 });
    expect(payApp.periodEnd).toBeNull();
    const local = localDate(payApp.approvedAt, zone.timeZone);
    const utc = payApp.approvedAt.toISOString().slice(0, 10);
    // The case discriminates: the local day is not the UTC day, nor the
    // server process's day.
    expect(local).toBe(shiftDate(utc, zone.offsetDays));
    expect(local).not.toBe(localDate(payApp.approvedAt, zone.serverZone));

    const rows = await ledger(payApp.id);
    expect(rows.map((row) => [row.incurredOn.toISOString(), Number(row.amount), row.activityId])).toEqual([[`${local}T00:00:00.000Z`, 2000, activityId]]);
    // The activity's cost record is actual through that day (the ledger's
    // projection), and official AC is cut on it.
    const record = await prisma.costRecord.findFirst({ where: { projectId: project.id, activityId }, select: { actual: true, actualThroughDate: true } });
    expect([Number(record.actual), record.actualThroughDate.toISOString()]).toEqual([3000, `${local}T00:00:00.000Z`]);
    expect(await ac(local)).toBe(3000);
    // The day before the local day never counts it.
    expect(await ac(shiftDate(local, -1))).toBe(0);
  });
});
