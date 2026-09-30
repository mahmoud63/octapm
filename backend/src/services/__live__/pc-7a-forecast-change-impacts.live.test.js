/**
 * PC-7a item 4 — the forecast's one "recorded impact" list takes in approved
 * change orders (docs/project-controls/OCTAPM_CHANGE_INTELLIGENCE.md §3), and
 * the data-quality notes come twice: dataQuality as the string[] every client
 * types, and dataQualityItems as { kind, severity, subject, message } in the
 * same order. Proven against a real API process and the real local Postgres.
 *
 * One project in a throwaway "LiveTest <uuid>" organisation, four open
 * activities (planned after today, so each is open):
 *   A  RFI-1 records 3 days; RFI-1 is raised as a change event, converted to
 *      CO-1, and CO-1 is approved with 6 days on A → A counts 6 (the approved
 *      order, once), not 9.
 *   B  CO-2, raised directly and approved with 4 days on B → B counts 4.
 *   C  CO-3 submitted, not approved, with 5 days on C (and 5 typed as its
 *      approved impact) → C counts 0: only an approved order is source.
 *   D  RFI-1 also records 3 days on D; CO-1 does not touch D → D keeps 3.
 * A second LiveTest organisation asks for the project's forecast and gets the
 * 404 a missing id gets. Nothing outside the two organisations is written.
 *
 *   npm run test:live -- src/services/__live__/pc-7a-forecast-change-impacts.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const PROOF = { fileName: "LiveTest proof.pdf", fileUrl: "https://example.test/proof.pdf" };

liveDescribe("PC-7a item 4: approved change-order impacts in the forecast, counted once", () => {
  let live;
  let other;
  let api;
  const built = { activities: {} };

  const auth = (who = live) => ({ authorization: `Bearer ${who.token}` });
  const at = (route) => `/api/v1/projects/${built.project.id}${route}`;
  const send = async (route, body, expected = 201) => {
    const response = await api.post(route, body, auth());
    expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
    return response.body.data;
  };
  const patch = async (route, body) => {
    const response = await api.request("PATCH", route, { body, headers: auth() });
    expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
    return response.body.data;
  };
  const approve = async (orderId) => {
    await send(at(`/change-orders/${orderId}/submit`), {}, 200);
    await send(at(`/change-orders/${orderId}/approve`), { comment: "LiveTest" }, 200);
  };
  const forecast = async () => {
    const response = await api.get(at("/forecast"), auth());
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data;
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    built.project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest PC-7a change impacts", startDate: new Date("2026-01-05"), endDate: new Date("2027-06-30") },
    });
    for (const [index, name] of ["A", "B", "C", "D"].entries()) {
      const activity = await send(at("/activities"), { name: `Activity ${name}`, activityCode: `CI${index + 1}0`, duration: 10, startDate: "2027-02-01", endDate: "2027-02-12", engineerIds: [live.user.id] });
      built.activities[name] = activity.id;
    }
    const { A, B, C, D } = built.activities;

    // RFI-1: 3 days on A and 3 on D.
    const rfi = await send(at("/rfi"), { subject: "LiveTest RFI-1 embed depth", status: "open", activityLinks: [{ activityId: A, relationType: "schedule_impact", scheduleImpactDays: 3 }, { activityId: D, relationType: "schedule_impact", scheduleImpactDays: 3 }] });
    built.rfiId = rfi.id;
    // RFI-1 becomes CO-1 through a change event; CO-1 is approved with 6 days on A.
    const event = await send(at("/change-events"), { title: "LiveTest from RFI-1", sourceRecordType: "rfi", sourceRecordId: rfi.id, activityId: A, romAmount: 1000 });
    const converted = await send(at(`/change-events/${event.id}/convert`), {});
    built.co1 = converted.changeOrder.id;
    await patch(at(`/change-orders/${built.co1}`), { scheduleImpactSummary: "6 days on A", costImpactSummary: "ROM 1000", activityLinks: [{ activityId: A, relationType: "delay", scheduleImpactDays: 6 }], attachmentRefs: [PROOF] });
    await approve(built.co1);
    // CO-2: approved, 4 days on B.
    const co2 = await send(at("/change-orders"), { description: "LiveTest CO-2", category: "variation", value: 500, scheduleImpactSummary: "4 days", costImpactSummary: "priced", activityLinks: [{ activityId: B, relationType: "delay", scheduleImpactDays: 4 }], attachmentRefs: [PROOF] });
    built.co2 = co2.id;
    await approve(co2.id);
    // CO-3: submitted only, 5 days on C.
    const co3 = await send(at("/change-orders"), { description: "LiveTest CO-3", category: "variation", value: 700, scheduleImpactSummary: "5 days", costImpactSummary: "priced", activityLinks: [{ activityId: C, relationType: "delay", scheduleImpactDays: 5, approvedScheduleImpactDays: 5 }], attachmentRefs: [PROOF] });
    built.co3 = co3.id;
    await send(at(`/change-orders/${co3.id}/submit`), {}, 200);
  }, 300_000);

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

  it("the stored facts are what the scenario says (the product paths wrote them)", async () => {
    const orders = await prisma.changeOrder.findMany({ where: { projectId: built.project.id }, select: { id: true, status: true } });
    const status = Object.fromEntries(orders.map((row) => [row.id, row.status]));
    expect([status[built.co1], status[built.co2], status[built.co3]]).toEqual(["approved", "approved", "pending"]);
    const links = await prisma.changeOrderActivityLink.findMany({ where: { projectId: built.project.id, scheduleImpactDays: { gt: 0 } }, select: { changeOrderId: true, activityId: true, scheduleImpactDays: true, approvedScheduleImpactDays: true } });
    const byOrder = (id) => links.filter((row) => row.changeOrderId === id).map((row) => [row.activityId, row.scheduleImpactDays, row.approvedScheduleImpactDays]);
    expect(byOrder(built.co1)).toEqual([[built.activities.A, 6, 6]]);
    expect(byOrder(built.co2)).toEqual([[built.activities.B, 4, 4]]);
    // CO-3 carries an "approved" figure typed on a pending order: still not counted.
    expect(byOrder(built.co3)).toEqual([[built.activities.C, 5, 5]]);
    const event = await prisma.changeEvent.findFirst({ where: { projectId: built.project.id, sourceRecordId: built.rfiId }, select: { sourceRecordType: true, changeOrderId: true } });
    expect(event).toEqual({ sourceRecordType: "rfi", changeOrderId: built.co1 });
    const rfiLinks = await prisma.workflowActivityLink.findMany({ where: { projectId: built.project.id, recordType: "rfi", recordId: built.rfiId }, select: { activityId: true, scheduleImpactDays: true } });
    expect(rfiLinks.map((row) => row.scheduleImpactDays)).toEqual([3, 3]);
  });

  it("an approved order's impact counts once and wins over the RFI it took over; a pending order does not count", async () => {
    const data = await forecast();
    expect(data.available).toBe(true);
    const byId = Object.fromEntries(data.activities.map((row) => [row.id, row]));
    const { A, B, C, D } = built.activities;
    expect([byId[A].impactDays, byId[B].impactDays, byId[C].impactDays, byId[D].impactDays]).toEqual([6, 4, 0, 3]);
    expect(byId[A].reasons).toContain("6 days of recorded impact from change order");
    expect(byId[B].reasons).toContain("4 days of recorded impact from change order");
    expect(byId[D].reasons).toContain("3 days of recorded impact from RFI");
    expect(byId[C].reasons.join(" ")).not.toMatch(/recorded impact/);
  });

  it("dataQuality stays string[] and dataQualityItems is the same list with a kind, severity and subject", async () => {
    const data = await forecast();
    expect(Array.isArray(data.dataQuality)).toBe(true);
    expect(data.dataQuality.length).toBeGreaterThan(0);
    for (const note of data.dataQuality) expect(typeof note).toBe("string");
    expect(data.dataQualityItems.map((item) => item.message)).toEqual(data.dataQuality);
    for (const item of data.dataQualityItems) {
      expect(Object.keys(item).sort()).toEqual(["kind", "message", "severity", "subject"]);
      expect(["info", "warning"]).toContain(item.severity);
      expect(item.kind).toMatch(/^[a-z_]+$/);
    }
    // A project with no zone of its own, no cost loading and no actuals:
    // the SPI, CPI and time-zone notes are there, keyed.
    const byKind = Object.fromEntries(data.dataQualityItems.map((item) => [item.kind, item]));
    expect(byKind.spi_unavailable).toMatchObject({ severity: "warning", subject: "SPI" });
    expect(byKind.cpi_unavailable).toMatchObject({ severity: "warning", subject: "CPI" });
    expect(byKind.timezone_default).toMatchObject({ severity: "info", subject: "Time zone", message: "Project timezone is not configured; UTC is being used" });
  });

  it("another organisation's caller gets the 404 a missing project gets", async () => {
    const response = await api.get(at("/forecast"), auth(other));
    expect(response.status).toBe(404);
    expect(response.body.data).toBeUndefined();
  });
});
