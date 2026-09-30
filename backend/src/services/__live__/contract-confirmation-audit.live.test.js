/**
 * A contract-value confirmation (or entry) and its audit record are written
 * together or not at all — proven against a real API process and the real
 * local Postgres (PC-7a item 3, owner decision 2026-09-29).
 *
 * PATCH /prime-contract writes the contract and its contract.manage audit
 * event on one transaction. This API is started with a forced audit-insert
 * failure (__live__/fixtures/audit-insert-fault.js) for ONE project of a
 * throwaway "LiveTest <uuid>" organisation: that project's contract.manage
 * event is inserted with the id of an audit event that already exists, so
 * Postgres refuses it inside the caller's transaction. Every other project and
 * every other audit event is written as usual.
 *
 * - FAULT: a BOQ fallback. Confirming it, entering a new value, and saving
 *   terms each answer 503 CONTRACT_AUDIT_UNAVAILABLE, and the contract row,
 *   its audit events, history snapshots and outbound events are exactly as
 *   they were: the update that ran first in the transaction was rolled back.
 * - OK: a BOQ fallback. Confirming it and then entering a value each answer
 *   200 and write exactly one contract.manage event (with its history
 *   snapshot) that names the actor and the confirmation.
 *
 *   npm run test:live -- src/services/__live__/contract-confirmation-audit.live.test.js
 */
const path = require("path");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const FAULT_FIXTURE = path.resolve(__dirname, "..", "..", "__live__", "fixtures", "audit-insert-fault.js").replace(/\\/g, "/");
const CODE = "CONTRACT_AUDIT_UNAVAILABLE";
const MESSAGE = "The contract terms were not saved because their audit record could not be written; try again";

liveDescribe("a contract-value confirmation and its audit record are written together or not at all", () => {
  let live;
  let api;
  let seedEvent;
  const projects = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (key, route) => `/api/v1/projects/${projects[key].id}${route}`;
  const patch = (key, body) => api.request("PATCH", at(key, "/prime-contract"), { body, headers: auth() });
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);

  const contractOf = (key) => prisma.primeContract.findFirst({ where: { projectId: projects[key].id } });
  const manageEvents = async (key) =>
    (await prisma.auditEvent.findMany({ where: { projectId: projects[key].id }, orderBy: { occurredAt: "asc" } })).filter(
      (event) => event.summaryJson?.transition === "contract.manage"
    );

  // Everything a contract-terms save writes, on this project.
  const footprint = async (key) => {
    const projectId = projects[key].id;
    return JSON.stringify({
      contract: await contractOf(key),
      audit: await prisma.auditEvent.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
      snapshots: await prisma.recordHistorySnapshot.count({ where: { projectId } }),
      outbound: await prisma.outboundEvent.count({ where: { projectId } }),
    });
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    for (const key of ["FAULT", "OK"]) {
      projects[key] = await prisma.project.create({
        data: { orgId: live.org.id, name: `LiveTest confirmation audit ${key}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
      });
    }
    // The audit event whose id the faulted insert reuses: in this throwaway
    // organisation, on the OK project, never a contract.manage event.
    seedEvent = await prisma.auditEvent.create({
      data: { orgId: live.org.id, projectId: projects.OK.id, entityType: "project", entityId: projects.OK.id, action: "updated", summaryJson: { transition: "livetest.seed" } },
    });
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);

    api = await startApi({
      DATABASE_CONNECTION_LIMIT: "4",
      NODE_OPTIONS: `--require "${FAULT_FIXTURE}"`,
      LIVE_AUDIT_FAULT_PROJECT_ID: projects.FAULT.id,
      LIVE_AUDIT_FAULT_DUPLICATE_ID: seedEvent.id,
    });

    // One priced row, no project contract value: the contract takes the bill.
    for (const [key, rate] of [["FAULT", 613.37], ["OK", 518.52]]) {
      ok(await api.post(at(key, "/boq/items"), { code: `K9.${key.length}`, description: `Row ${key}`, quantity: 20, unit: "m3", rate }, auth()), 201);
      ok(await api.get(at(key, "/prime-contract"), auth()));
      expect([key, (await contractOf(key)).originalValueSource]).toEqual([key, "boq_fallback"]);
    }
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

  it("refuses a confirmation, an entry and a terms save whose audit record cannot be written, and rolls each back", async () => {
    const before = await footprint("FAULT");
    const stored = await contractOf("FAULT");
    for (const body of [
      { confirmOriginalValue: true },
      { originalValue: 9876543.21 },
      { taxRate: 5, retentionRate: 7 },
    ]) {
      const answer = await patch("FAULT", body);
      const { requestId, ...error } = answer.body?.error || {};
      expect([body, answer.status, answer.body?.success, error]).toEqual([body, 503, false, { code: CODE, message: MESSAGE }]);
      // The contract update ran first in the transaction; it did not survive.
      expect([body, await footprint("FAULT")]).toEqual([body, before]);
    }
    const after = await contractOf("FAULT");
    expect([after.originalValueSource, String(after.originalValue), after.taxRate]).toEqual(["boq_fallback", String(stored.originalValue), stored.taxRate]);
    expect(await manageEvents("FAULT")).toEqual([]);
    // What failed was the audit insert itself, refused by Postgres (unique
    // violation), once per request.
    expect(api.proc.output().match(/\[prime-contract-audit\] P2002/g)).toHaveLength(3);
    // The reused id still names the one seed event, untouched.
    expect(await prisma.auditEvent.findUnique({ where: { id: seedEvent.id } })).toEqual(seedEvent);
  });

  it("writes a confirmation and an entry with exactly one audit record each, naming the actor", async () => {
    const stored = await contractOf("OK");
    expect(await manageEvents("OK")).toEqual([]);

    const confirmed = await patch("OK", { confirmOriginalValue: true });
    ok(confirmed);
    expect(confirmed.body.data.originalValueSource).toBe("contract_entry");
    const afterConfirm = await contractOf("OK");
    expect([afterConfirm.originalValueSource, String(afterConfirm.originalValue)]).toEqual(["contract_entry", String(stored.originalValue)]);
    let events = await manageEvents("OK");
    expect(events.map((event) => [event.actorId, event.summaryJson.originalValueConfirmation, event.oldSummaryJson.originalValueSource, event.newSummaryJson.originalValueSource])).toEqual([
      [live.user.id, "confirmed", "boq_fallback", "contract_entry"],
    ]);
    expect(await prisma.recordHistorySnapshot.count({ where: { auditEventId: events[0].id } })).toBe(1);

    const entered = await patch("OK", { originalValue: 12345.67 });
    ok(entered);
    const afterEntry = await contractOf("OK");
    expect([afterEntry.originalValueSource, String(afterEntry.originalValue)]).toEqual(["contract_entry", "12345.67"]);
    events = await manageEvents("OK");
    expect(events.map((event) => [event.actorId, event.summaryJson.originalValueConfirmation, event.newSummaryJson.originalValue])).toEqual([
      [live.user.id, "confirmed", Number(stored.originalValue)],
      [live.user.id, "entered", 12345.67],
    ]);
    expect(await prisma.recordHistorySnapshot.count({ where: { auditEventId: events[1].id } })).toBe(1);
  });
});
