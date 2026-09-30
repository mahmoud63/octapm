/**
 * Change-order audit events store the order's value as a number, never as a
 * Prisma Decimal's internals — proven against a real API process and the
 * real local Postgres (Round 6 residual, api item 1).
 *
 * A reviewer saw change-order audit events whose summary held the value as
 * { d: [...], e, s, constructor: "function Decimal…" }: the audit serialiser
 * walked the Decimal field by field. The writer now stores the amount; the
 * rows already written are history (not rewritten) and the read path decodes
 * them.
 *
 * - WRITE: a change order created, submitted and approved through the API in
 *   a throwaway "LiveTest <uuid>" organisation. Every AuditEvent row, every
 *   RecordHistorySnapshot row and the outbound event for it carry the value
 *   4321.09 as a number; no column anywhere on the project holds a `d` word
 *   array, a `constructor` key or a function's source text.
 * - READ: an audit row seeded with exactly the old shape (in the throwaway
 *   organisation) is answered by GET /projects/:id/audit with the amount as a
 *   number, the stored row untouched.
 *
 *   npm run test:live -- src/services/__live__/r6-audit-decimal-summaries.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const VALUE = 4321.09;
const OLD_SHAPE_TEXT = /"d":\s*\[|"constructor"|function Decimal|function \(/;

liveDescribe("change-order audit events store the order's value as a number, never as a Decimal's internals", () => {
  let live;
  let api;
  let project;
  let activityId;
  let coId;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest audit decimals", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    const activity = await api.post(at("/activities"), {
      engineerIds: [live.user.id],
      name: "Erect steel",
      activityCode: "A910",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    ok(activity, 201);
    activityId = activity.body.data.id;
  }, 120_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("writes the value as a number on create, submit and approve — on the audit event, its history snapshot and its outbound event", async () => {
    const created = await api.post(at("/change-orders"), {
      description: "LiveTest audit decimals",
      category: "variation",
      value: VALUE,
      scheduleImpactSummary: "LiveTest two days",
      costImpactSummary: "LiveTest priced",
      activityLinks: [{ activityId, relationType: "affected", scheduleImpactDays: 2, costImpact: 1234.56 }],
      attachmentRefs: [{ fileName: "LiveTest proof.pdf", fileUrl: "https://example.test/proof.pdf" }],
    }, auth());
    ok(created, 201);
    coId = created.body.data.id;
    ok(await api.post(at(`/change-orders/${coId}/submit`), {}, auth()));
    ok(await api.post(at(`/change-orders/${coId}/approve`), { comment: "LiveTest approved" }, auth()));

    const where = { orgId: live.org.id, projectId: project.id, entityType: "change_order", entityId: coId };
    const events = await prisma.auditEvent.findMany({ where, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    const snapshots = await prisma.recordHistorySnapshot.findMany({ where, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    const outbound = await prisma.outboundEvent.findMany({ where, orderBy: { createdAt: "asc" } });

    expect(events.map((event) => [event.summaryJson.transition, event.newStatus])).toEqual([
      ["change_order.create", "draft"],
      ["change_order.submit", "pending"],
      ["change_order.approve", "approved"],
    ]);
    for (const event of events) {
      const label = event.summaryJson.transition;
      expect([label, event.summaryJson.value, event.newSummaryJson.value]).toEqual([label, VALUE, VALUE]);
      // The create summary is taken from the row as inserted, before its links
      // are written (0); the transitions sum the links' cost impact.
      expect([label, typeof event.newSummaryJson.costImpact, event.newSummaryJson.costImpact]).toEqual([label, "number", label === "change_order.create" ? 0 : 1234.56]);
      if (event.oldSummaryJson) expect([label, event.oldSummaryJson.value]).toEqual([label, VALUE]);
    }
    expect(snapshots).toHaveLength(events.length);
    for (const snapshot of snapshots) {
      expect([snapshot.action, snapshot.snapshotJson.value]).toEqual([snapshot.action, VALUE]);
      if (snapshot.previousSnapshotJson) expect([snapshot.action, snapshot.previousSnapshotJson.value]).toEqual([snapshot.action, VALUE]);
    }
    expect(outbound.length).toBeGreaterThanOrEqual(3);
    for (const row of outbound) expect([row.action, row.payloadJson.summary.value]).toEqual([row.action, VALUE]);

    // Nothing written on this project, in any JSON column of any audit-family
    // table, carries a Decimal's internals.
    const everything = JSON.stringify({
      events,
      snapshots,
      outbound,
      approvals: await prisma.approvalWorkflowEvent.findMany({ where: { orgId: live.org.id, projectId: project.id } }),
    });
    expect(everything).not.toMatch(OLD_SHAPE_TEXT);

    // The history the screens read answers numbers too.
    const history = await api.get(at(`/audit?entityType=change_order&entityId=${coId}&source=audit`), auth());
    ok(history);
    expect(history.body.data.events.map((event) => event.summary.value)).toEqual([VALUE, VALUE, VALUE]);
    expect(history.text).not.toMatch(OLD_SHAPE_TEXT);
  });

  it("reads a row stored with the old Decimal-internals shape as the amount, and leaves the row as it is", async () => {
    const { Prisma } = require("@prisma/client");
    const decimal = new Prisma.Decimal("1500.00");
    const oldShape = { d: [...decimal.d], e: decimal.e, s: decimal.s, constructor: String(decimal.constructor) };
    const seeded = await prisma.auditEvent.create({
      data: {
        orgId: live.org.id,
        projectId: project.id,
        entityType: "change_order",
        entityId: coId,
        action: "updated",
        occurredAt: new Date("2026-09-10T10:00:00.000Z"),
        summaryJson: { transition: "change_order.update", ref: "VO-OLD", value: oldShape },
        newSummaryJson: { ref: "VO-OLD", value: oldShape, links: [{ amount: oldShape }] },
        oldSummaryJson: { ref: "VO-OLD", value: oldShape },
      },
    });
    expect(JSON.stringify(seeded)).toMatch(OLD_SHAPE_TEXT);

    const history = await api.get(at(`/audit?entityType=change_order&entityId=${coId}&source=audit&order=asc`), auth());
    ok(history);
    const shown = history.body.data.events.find((event) => event.id === seeded.id);
    expect(shown.summary).toEqual({ transition: "change_order.update", ref: "VO-OLD", value: 1500 });
    expect(shown.newSummary).toEqual({ ref: "VO-OLD", value: 1500, links: [{ amount: 1500 }] });
    expect(shown.oldSummary).toEqual({ ref: "VO-OLD", value: 1500 });
    expect(history.text).not.toMatch(OLD_SHAPE_TEXT);

    // No repair of history: the row is exactly as seeded.
    expect(await prisma.auditEvent.findUnique({ where: { id: seeded.id } })).toEqual(seeded);
  });
});
