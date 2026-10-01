/**
 * PC-6 (core) — the daily log's quantities section (§4), proven against a
 * real API process and the real local Postgres.
 *
 * In a throwaway "LiveTest <uuid>" organisation: a bill of three rows
 * (concrete in m3, rebar in t, blockwork in m2 — never allocated), a
 * programme of three activities — the pour (concrete 100 m3 allocated and
 * approved, measured by quantity), the fixing (rebar 10 t, measured by
 * quantity) and the wall (nothing allocated) — a PM, a site engineer assigned
 * to the pour, a site engineer who may not read the BOQ (a permission
 * template with boq: none), and a second organisation for the tenant rule.
 *
 * - the allocated-items picker: the BOQ reader's full line; the non-BOQ
 *   member's id + description + unit only, with the server's reason;
 * - recording rows: against an allocated item only, in its unit or an alias,
 *   never negative, under the progress assignment rule (the recorder's), with
 *   clientRequestId replay; the row is a site record — no entry exists;
 * - submitting the log mints one SUBMITTED entry per row (source daily_log,
 *   the log's date, the row's author as recordedBy, dailyLogId +
 *   dailyLogQuantityId) and NOTHING official: no ActivityProgress row, EV 0;
 * - editing a row before approval updates its entry; approving the log
 *   approves the log and the rows' review state and leaves every entry
 *   submitted; reopening, adding and removing rows: no pending ghost;
 * - the one writer: a progress submission that bundles a daily-log entry,
 *   approved by the PM, writes ONE ActivityProgress row at installed ÷
 *   planned and marks that entry official; the log then shows it so, the
 *   row is locked, and removing the row leaves the approved entry (SET NULL);
 *   a bundled pending entry holds its row; a rejected one locks it;
 * - a second day: a row the site team rejects after the submit takes its
 *   pending entry with it (a date bundle finds nothing); a row approved
 *   back, or added to the submitted day, is pending at once; approving the
 *   log mints a row left unminted and approves no entry; a row whose entry
 *   is bundled or official cannot be rejected by the site team;
 * - the non-BOQ member records against the picker and reads the log without
 *   the item's code or allocation (description, unit and quantity stay);
 * - a client-sent submissionId / dailyLogId on POST /quantity-progress is
 *   ignored (provenance is the server's);
 * - the tenant 404 on every route; the audit trail; the PDF export.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run test:live -- src/services/__live__/pc-6-daily-log-quantities.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("PC-6: the daily log's quantities section mints pending entries that only the progress writer makes official", () => {
  let live;
  let other;
  let api;
  let project;
  let concrete;
  let rebar;
  let blocks;
  let pour;
  let fix;
  let wall;
  const members = {};
  const DAY = "2026-09-07";
  const DAY2 = "2026-09-08";
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const refused = (answer, status, code) => expect([answer.status, answer.body?.error?.code]).toEqual([status, code]);

  const activityIds = () => [pour.id, fix.id, wall.id];
  const entryRows = async (where = {}) => prisma.quantityProgressEntry.findMany({ where: { projectId: project.id, ...where }, orderBy: { createdAt: "asc" } });
  const officialCount = async () => prisma.activityProgress.count({ where: { activityId: { in: activityIds() } } });
  const evRow = async (activityId) => {
    const answer = await api.get(at("/reports/ev"), bearer(live.token));
    ok(answer);
    const code = [pour, fix, wall].find((row) => row.id === activityId).activityCode;
    return answer.body.data.activityBreakdown.find((row) => row.activityId === code);
  };
  const getLog = async (token = live.token, day = DAY) => {
    const answer = await api.get(at(`/daily-logs/${day}`), bearer(token));
    ok(answer);
    return answer.body.data;
  };
  const addRow = (payload, token = members.site.token, day = DAY) => api.post(at(`/daily-logs/${day}/entries/quantities`), payload, bearer(token));
  const editRow = (rowId, payload, token = members.site.token, day = DAY) => api.request("PATCH", at(`/daily-logs/${day}/entries/quantities/${rowId}`), { body: payload, headers: bearer(token) });
  const removeRow = (rowId, token = members.site.token, day = DAY) => api.request("DELETE", at(`/daily-logs/${day}/entries/quantities/${rowId}`), { headers: bearer(token) });
  const rowOf = (log, rowId) => log.sections.quantities.find((row) => row.id === rowId);
  const reviewRow = (rowId, decision, reason = null, token = live.token, day = DAY) => api.post(at(`/daily-logs/${day}/entries/quantities/${rowId}/review`), { decision, ...(reason ? { reason } : {}) }, bearer(token));
  const submitProgress = (activityId, payload, token = live.token) => api.post(at(`/activities/${activityId}/progress`), { method: "quantity", ...payload }, bearer(token));
  const approveProgress = (activityId, submissionId, token = live.token) => api.post(at(`/activities/${activityId}/progress-submissions/${submissionId}/approve`), {}, bearer(token));
  const rejectProgress = (activityId, submissionId, reason, token = live.token) => api.post(at(`/activities/${activityId}/progress-submissions/${submissionId}/reject`), { reason }, bearer(token));

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "4" }, { appOnly: true });
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-6 daily-log quantities", timezone: "America/Chicago", startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const tag = live.org.id.slice(0, 8);
    for (const [key, role, template] of [
      ["site", "site_engineer", false],
      ["noBoq", "site_engineer", true],
    ]) {
      const member = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-dlq-${key.toLowerCase()}-${tag}@octapm-live.test`, role });
      member.token = mintAccessToken(member);
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      if (template) {
        const row = await prisma.permissionTemplate.create({
          data: { orgId: live.org.id, name: `LiveTest ${role}, no BOQ ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } },
        });
        await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: row.id } });
      }
      members[key] = member;
    }

    const item = async (payload) => {
      const created = await api.post(at("/boq/items"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data.item;
    };
    concrete = await item({ code: "1.1", description: "Concrete in foundations", quantity: 300, unit: "Cu.M", rate: 100 });
    rebar = await item({ code: "1.2", description: "Reinforcement", quantity: 50, unit: "t", rate: 1000 });
    blocks = await item({ code: "2.1", description: "Blockwork", quantity: 800, unit: "m2", rate: 40 });
    expect([concrete.unitCode, rebar.unitCode, blocks.unitCode]).toEqual(["m3", "t", "m2"]);

    const activity = async (payload) => {
      const created = await api.post(at("/activities"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data;
    };
    pour = await activity({ name: "Pour foundations", activityCode: "A100", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [live.user.id, members.site.id, members.noBoq.id] });
    fix = await activity({ name: "Fix reinforcement", activityCode: "A110", duration: 6, startDate: "2026-01-26", endDate: "2026-02-01", engineerIds: [live.user.id] });
    wall = await activity({ name: "Blockwork", activityCode: "A120", duration: 10, startDate: "2026-02-09", endDate: "2026-02-20", engineerIds: [live.user.id, members.site.id] });

    for (const [boqItemId, activityId, quantity] of [[concrete.id, pour.id, 100], [rebar.id, fix.id, 10]]) {
      const created = await api.post(at("/activity-boq-allocations"), { boqItemId, activityId, quantity }, bearer(live.token));
      ok(created, 201);
      for (const step of ["submit", "approve"]) ok(await api.post(at(`/activity-boq-allocations/${created.body.data.id}/${step}`), {}, bearer(live.token)));
    }
    for (const [activityId, quantityUnit] of [[pour.id, "m3"], [fix.id, "t"]]) {
      ok(await api.request("PUT", at(`/activities/${activityId}/progress-method`), { body: { method: "quantity", quantityUnit }, headers: bearer(live.token) }));
    }
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  const ids = {};
  let evBefore;

  it("the allocated-items picker: the full line for a BOQ reader; id, description and unit only for a member who may not read the BOQ", async () => {
    evBefore = JSON.stringify((await api.get(at("/reports/ev"), bearer(live.token))).body.data.activityBreakdown);
    const full = await api.get(at(`/activities/${pour.id}/allocated-items`), bearer(live.token));
    ok(full);
    expect(full.body.data).toMatchObject({ activityId: pour.id, activity: { id: pour.id, name: "Pour foundations", code: "A100" } });
    expect(full.body.data.items).toEqual([{ id: concrete.id, code: "1.1", description: "Concrete in foundations", unit: "Cu.M", unitCode: "m3", allocationId: expect.any(String), allocationIds: [expect.any(String)], allocatedQuantity: 100 }]);
    expect(full.body.data.boqWithheld).toBeUndefined();
    ids.pourAllocation = full.body.data.items[0].allocationId;

    const least = await api.get(at(`/activities/${pour.id}/allocated-items`), bearer(members.noBoq.token));
    ok(least);
    expect(least.body.data.items).toEqual([{ id: concrete.id, description: "Concrete in foundations", unit: "Cu.M", unitCode: "m3" }]);
    expect(least.body.data.boqWithheld).toEqual({ keys: ["code", "allocationId", "allocationIds", "allocatedQuantity"], reason: expect.stringContaining("available only to members who may read the BOQ") });

    const none = await api.get(at(`/activities/${wall.id}/allocated-items`), bearer(members.site.token));
    ok(none);
    expect(none.body.data.items).toEqual([]);
    refused(await api.get(at(`/activities/${pour.id}/allocated-items`), bearer(other.token)), 404, "PROJECT_NOT_FOUND");
    refused(await api.get(at(`/activities/00000000-0000-4000-8000-000000000000/allocated-items`), bearer(live.token)), 404, "ACTIVITY_NOT_FOUND");
  });

  it("rows are recorded against an allocated item, in its unit or an alias, under the recorder's assignment rule — and are site records: no entry exists", async () => {
    refused(await addRow({ activityId: pour.id, boqItemId: blocks.id, quantity: 5 }), 400, "DAILY_LOG_QUANTITY_NOT_ALLOCATED");
    refused(await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 5, unit: "t" }), 400, "QUANTITY_UNIT_MISMATCH");
    refused(await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: -1 }), 400, "VALIDATION_ERROR");
    refused(await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 5, allocationId: "00000000-0000-4000-8000-000000000000" }), 400, "QUANTITY_ALLOCATION_MISMATCH");
    // The site engineer is assigned to the pour, not to the fixing: the progress submission's rule, applied when the row is recorded.
    refused(await addRow({ activityId: fix.id, boqItemId: rebar.id, quantity: 1 }), 403, "ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED");
    refused(await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 5 }, other.token), 404, "PROJECT_NOT_FOUND");

    const first = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 40, unit: "cum", notes: "bays 1-2", clientRequestId: "dlq-row-1" });
    ok(first, 201);
    ids.row1 = first.body.data.entryId;
    expect(first.body.data.replayed).toBe(false);
    const replay = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 999, clientRequestId: "dlq-row-1" });
    ok(replay, 201);
    expect([replay.body.data.entryId, replay.body.data.replayed]).toEqual([ids.row1, true]);
    expect(await prisma.dailyLogQuantity.count({ where: { projectId: project.id } })).toBe(1);

    const second = await addRow({ activityId: fix.id, boqItemId: rebar.id, quantity: 2.5, clientRequestId: "dlq-row-2" }, live.token);
    ok(second, 201);
    ids.row2 = second.body.data.entryId;
    const third = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 7, clientRequestId: "dlq-row-3" });
    ok(third, 201);
    ids.row3 = third.body.data.entryId;

    const log = await getLog();
    expect(log.status).toBe("open");
    expect(rowOf(log, ids.row1)).toMatchObject({
      section: "quantities",
      status: "approved",
      activityId: pour.id,
      activity: { id: pour.id, name: "Pour foundations", code: "A100" },
      boqItemId: concrete.id,
      boqItem: { id: concrete.id, code: "1.1", description: "Concrete in foundations", unit: "Cu.M", unitCode: "m3" },
      allocationId: ids.pourAllocation,
      quantity: 40,
      unitCode: "m3",
      notes: "bays 1-2",
      createdBy: members.site.id,
      clientRequestId: "dlq-row-1",
      progressEntry: null,
    });
    expect(rowOf(log, ids.row2)).toMatchObject({ quantity: 2.5, unitCode: "t", createdBy: live.user.id, progressEntry: null });
    expect(log.totals).toMatchObject({ quantityRows: 3, quantities: [{ unitCode: "m3", quantity: 47, rows: 2 }, { unitCode: "t", quantity: 2.5, rows: 1 }], entries: 3 });
    expect(await entryRows()).toEqual([]);
    expect(await officialCount()).toBe(0);
  });

  it("before the log is submitted, an edit and a removal touch the row alone", async () => {
    ok(await editRow(ids.row1, { quantity: 45 }));
    ok(await removeRow(ids.row3));
    const log = await getLog();
    expect(rowOf(log, ids.row1).quantity).toBe(45);
    expect(rowOf(log, ids.row3)).toBeUndefined();
    expect(await entryRows()).toEqual([]);
  });

  it("submitting the log mints one SUBMITTED entry per row — dated the log's day, recorded by the row's author, linked to the log and the row — and nothing official", async () => {
    const answer = await api.post(at(`/daily-logs/${DAY}/submit`), {}, bearer(members.site.token));
    ok(answer);
    expect(answer.body.data.status).toBe("submitted");
    const entries = await entryRows();
    expect(entries).toHaveLength(2);
    const byRow = new Map(entries.map((entry) => [entry.dailyLogQuantityId, entry]));
    ids.log = answer.body.data.id;
    expect(byRow.get(ids.row1)).toMatchObject({ source: "daily_log", status: "submitted", activityId: pour.id, boqItemId: concrete.id, allocationId: ids.pourAllocation, unitCode: "m3", dailyLogId: ids.log, createdBy: members.site.id, submissionId: null, approvedBy: null, note: "bays 1-2", clientRequestId: `daily_log:${ids.row1}` });
    expect(byRow.get(ids.row1).quantity.toString()).toBe("45");
    expect(byRow.get(ids.row1).date.toISOString().slice(0, 10)).toBe(DAY);
    expect(byRow.get(ids.row2)).toMatchObject({ source: "daily_log", status: "submitted", activityId: fix.id, boqItemId: rebar.id, unitCode: "t", createdBy: live.user.id });
    ids.e1 = byRow.get(ids.row1).id;
    ids.e2 = byRow.get(ids.row2).id;
    expect(await officialCount()).toBe(0);
    expect(await evRow(pour.id)).toMatchObject({ pct: 0, progressStatus: "missing" });
    // The log carries each row's pending figure and its provenance; the entries list names the log.
    expect(rowOf(answer.body.data, ids.row1).progressEntry).toEqual({ id: ids.e1, status: "submitted", official: false, source: "daily_log", submissionId: null, submissionStatus: null, recordedBy: members.site.id, recordedAt: expect.any(String), approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null });
    const listed = await api.get(at(`/quantity-progress?dailyLogId=${ids.log}`), bearer(live.token));
    ok(listed);
    expect(listed.body.data.map((entry) => [entry.id, entry.provenance.source, entry.provenance.dailyLogId, entry.provenance.dailyLogQuantityId, entry.provenance.official])).toEqual(expect.arrayContaining([[ids.e1, "daily_log", ids.log, ids.row1, false], [ids.e2, "daily_log", ids.log, ids.row2, false]]));
    const audit = await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "daily_log", entityId: ids.log, newStatus: "submitted" } });
    expect(audit.summaryJson).toMatchObject({ transition: "daily_log.submit", quantityEntries: { minted: 2, synced: 0, kept: 0, retired: 0 } });
    // Submitting again (idempotent for the entries): the same two, synced, none minted.
    ok(await api.post(at(`/daily-logs/${DAY}/submit`), {}, bearer(live.token)));
    expect((await entryRows()).map((entry) => entry.id).sort()).toEqual([ids.e1, ids.e2].sort());
  });

  it("an edit before approval follows the pending entry; the activity and the item are not moved", async () => {
    ok(await editRow(ids.row1, { quantity: 50, notes: "bays 1-3" }));
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.e1 } })).toMatchObject({ status: "submitted", note: "bays 1-3", dailyLogQuantityId: ids.row1 });
    expect((await prisma.quantityProgressEntry.findUnique({ where: { id: ids.e1 } })).quantity.toString()).toBe("50");
    refused(await editRow(ids.row1, { boqItemId: rebar.id }), 400, "QUANTITY_ENTRY_IMMUTABLE_FIELD");
    refused(await editRow(ids.row1, { quantity: 5, unit: "t" }), 400, "QUANTITY_UNIT_MISMATCH");
    const events = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: ids.e1 }, orderBy: { occurredAt: "asc" } });
    // created at the first submit; synced by the idempotent resubmit; synced by the edit.
    expect(events.map((event) => [event.action, event.summaryJson.transition])).toEqual([["created", "quantity_entry.submit"], ["updated", "quantity_entry.daily_log_sync"], ["updated", "quantity_entry.daily_log_sync"]]);
    expect(await entryRows()).toHaveLength(2);
  });

  it("approving the log approves the log and the rows' review state — and NOT the entries: still submitted, nothing official, EV 0", async () => {
    const answer = await api.post(at(`/daily-logs/${DAY}/approve`), {}, bearer(live.token));
    ok(answer);
    expect(answer.body.data.status).toBe("approved");
    expect(rowOf(answer.body.data, ids.row1)).toMatchObject({ status: "approved", progressEntry: { id: ids.e1, status: "submitted", official: false, approvedBy: null } });
    for (const id of [ids.e1, ids.e2]) expect(await prisma.quantityProgressEntry.findUnique({ where: { id } })).toMatchObject({ status: "submitted", approvedBy: null, approvedAt: null, submissionId: null });
    expect(await officialCount()).toBe(0);
    expect(await evRow(pour.id)).toMatchObject({ pct: 0, progressStatus: "missing" });
    expect(await evRow(fix.id)).toMatchObject({ pct: 0, progressStatus: "missing" });
    expect(await prisma.auditEvent.count({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", action: "approved" } })).toBe(0);
    // An approved day is closed to edits of every section.
    refused(await editRow(ids.row1, { quantity: 51 }), 409, "DAILY_LOG_APPROVED");
  });

  it("reopened: a row added and removed before resubmission mints nothing; a row removed after resubmission takes its pending entry with it (no ghost)", async () => {
    ok(await api.post(at(`/daily-logs/${DAY}/reopen`), { reason: "bay 4 missed" }, bearer(live.token)));
    const added = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 3, clientRequestId: "dlq-row-4" });
    ok(added, 201);
    ok(await removeRow(added.body.data.entryId));
    expect(await entryRows()).toHaveLength(2);

    const fourth = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 5, clientRequestId: "dlq-row-5" });
    ok(fourth, 201);
    ids.row4 = fourth.body.data.entryId;
    const resubmitted = await api.post(at(`/daily-logs/${DAY}/submit`), {}, bearer(members.site.token));
    ok(resubmitted);
    const entries = await entryRows();
    expect(entries).toHaveLength(3);
    ids.e4 = entries.find((entry) => entry.dailyLogQuantityId === ids.row4).id;
    expect(entries.find((entry) => entry.id === ids.e4)).toMatchObject({ status: "submitted", source: "daily_log", dailyLogId: ids.log });
    const audit = await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "daily_log", entityId: ids.log, newStatus: "submitted" }, orderBy: { occurredAt: "desc" } });
    expect(audit.summaryJson.quantityEntries).toEqual({ minted: 1, synced: 2, kept: 0, retired: 0 });

    ok(await removeRow(ids.row4));
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.e4 } })).toBeNull();
    expect(await prisma.quantityProgressEntry.count({ where: { projectId: project.id, status: { in: ["draft", "submitted"] }, dailyLogQuantityId: null } })).toBe(0);
    expect(await entryRows()).toHaveLength(2);
    expect(await officialCount()).toBe(0);
  });

  it("the one writer: a progress submission bundling the daily-log entry, approved by the PM, writes ONE ActivityProgress row and makes that entry official; the log shows it; the row is locked; removing it leaves the entry", async () => {
    const submitted = await submitProgress(pour.id, { entryIds: [ids.e1] });
    ok(submitted, 200);
    ids.s1 = submitted.body.data.submission.id;
    expect(submitted.body.data.submission).toMatchObject({ pctComplete: 50, quantityComplete: 50, quantityPlanned: 100, quantityUnit: "m3", progressSource: { source: "manual", dailyLogId: ids.log, entries: 1 } });
    // Bundled, not yet approved: the row is held, not changed, not removed.
    refused(await editRow(ids.row1, { quantity: 52 }), 409, "QUANTITY_ENTRY_BUNDLED");
    refused(await removeRow(ids.row1), 409, "QUANTITY_ENTRY_BUNDLED");
    expect(await officialCount()).toBe(0);
    refused(await approveProgress(pour.id, ids.s1, members.site.token), 403, "FORBIDDEN");

    const approved = await approveProgress(pour.id, ids.s1);
    ok(approved);
    expect(approved.body.data).toMatchObject({ status: "approved", pctComplete: 50, quantityComplete: 50, quantityPlanned: 100, approvedProgressId: expect.any(String) });
    const rows = await prisma.activityProgress.findMany({ where: { activityId: pour.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ submissionId: ids.s1, pctComplete: 50, quantityComplete: 50, quantityPlanned: 100, progressMethod: "quantity", status: "approved", approvedBy: live.user.id });
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.e1 } })).toMatchObject({ status: "approved", submissionId: ids.s1, approvedBy: live.user.id, dailyLogId: ids.log, dailyLogQuantityId: ids.row1, source: "daily_log" });
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.e2 } })).toMatchObject({ status: "submitted", submissionId: null });
    expect(await evRow(pour.id)).toMatchObject({ pct: 50, progressMethod: "quantity", progressStatus: "approved" });
    expect(await evRow(fix.id)).toMatchObject({ pct: 0, progressStatus: "missing" });
    const activity = await api.get(at(`/activities/${pour.id}`), bearer(live.token));
    ok(activity);
    expect(activity.body.data.progressSource).toMatchObject({ source: "manual", submissionId: ids.s1, dailyLogId: ids.log, approvedBy: live.user.id, entries: 1 });

    const log = await getLog();
    expect(rowOf(log, ids.row1).progressEntry).toMatchObject({ id: ids.e1, status: "approved", official: true, submissionId: ids.s1, submissionStatus: "approved", approvedBy: live.user.id, approvedAt: expect.any(String), recordedBy: members.site.id });
    refused(await editRow(ids.row1, { quantity: 52 }), 409, "DAILY_LOG_QUANTITY_LOCKED");
    // The site record may go; the official figure stays, its link to the row nulled.
    ok(await removeRow(ids.row1));
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.e1 } })).toMatchObject({ status: "approved", dailyLogQuantityId: null, dailyLogId: ids.log, submissionId: ids.s1 });
    expect(await prisma.activityProgress.count({ where: { activityId: pour.id } })).toBe(1);
    expect(JSON.stringify((await prisma.activityProgress.findMany({ where: { activityId: pour.id } }))[0])).toBe(JSON.stringify(rows[0]));
    expect(await evRow(pour.id)).toMatchObject({ pct: 50, progressStatus: "approved" });
  });

  it("a rejected bundle leaves the entry rejected and its row locked; progress untouched", async () => {
    const submitted = await submitProgress(fix.id, { entryIds: [ids.e2] });
    ok(submitted, 200);
    ids.s2 = submitted.body.data.submission.id;
    ok(await rejectProgress(fix.id, ids.s2, "Bay 2 was measured twice"));
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.e2 } })).toMatchObject({ status: "rejected", rejectedBy: live.user.id, rejectionReason: "Bay 2 was measured twice", dailyLogQuantityId: ids.row2 });
    expect(rowOf(await getLog(), ids.row2).progressEntry).toMatchObject({ status: "rejected", official: false, rejectedBy: live.user.id, rejectionReason: "Bay 2 was measured twice" });
    refused(await editRow(ids.row2, { quantity: 2 }, live.token), 409, "DAILY_LOG_QUANTITY_LOCKED");
    // Resubmitting the log does not re-mint for a settled row.
    ok(await api.post(at(`/daily-logs/${DAY}/submit`), {}, bearer(live.token)));
    expect(await entryRows({ dailyLogQuantityId: ids.row2 })).toHaveLength(1);
    expect(await prisma.activityProgress.count({ where: { activityId: fix.id } })).toBe(0);
    expect(await evRow(fix.id)).toMatchObject({ pct: 0, progressStatus: "missing" });
  });

  it("day two: a row the site team rejects after the submit takes its pending entry with it — nothing is left for a date bundle", async () => {
    const added = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 10, clientRequestId: "dlq-d2-a" }, members.site.token, DAY2);
    ok(added, 201);
    ids.rowA = added.body.data.entryId;
    expect(rowOf(added.body.data, ids.rowA).progressEntry).toBeNull();
    const submitted = await api.post(at(`/daily-logs/${DAY2}/submit`), {}, bearer(members.site.token));
    ok(submitted);
    ids.log2 = submitted.body.data.id;
    const entryA = rowOf(submitted.body.data, ids.rowA).progressEntry;
    expect(entryA).toMatchObject({ status: "submitted", official: false, submissionId: null });
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: entryA.id } })).toMatchObject({ status: "submitted", dailyLogId: ids.log2, dailyLogQuantityId: ids.rowA });

    const rejected = await reviewRow(ids.rowA, "reject", "Bay 5 was measured twice", live.token, DAY2);
    ok(rejected);
    expect(rowOf(rejected.body.data, ids.rowA)).toMatchObject({ status: "rejected", rejectionReason: "Bay 5 was measured twice", progressEntry: null });
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: entryA.id } })).toBeNull();
    expect(await entryRows({ dailyLogQuantityId: ids.rowA })).toEqual([]);
    const trail = await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: entryA.id, action: "deleted" } });
    expect(trail).toMatchObject({ actorId: live.user.id, reason: "Bay 5 was measured twice" });
    expect(trail.summaryJson).toMatchObject({ transition: "quantity_entry.daily_log_row_rejected", dailyLogQuantityId: ids.rowA });
    // The pour has no free submitted entry left: a bundle by date finds nothing, and the rejected figure can never become official.
    refused(await submitProgress(pour.id, { bundleSubmittedThrough: "2026-09-30" }), 400, "QUANTITY_NO_ENTRIES_TO_BUNDLE");
    expect(await officialCount()).toBe(1);
    expect(await evRow(pour.id)).toMatchObject({ pct: 50, progressStatus: "approved" });
  });

  it("day two: a row approved back by the site team, or added to the submitted day, is pending at once; approving the log mints a row left unminted and approves no entry", async () => {
    const back = await reviewRow(ids.rowA, "approve", null, live.token, DAY2);
    ok(back);
    const rowA = rowOf(back.body.data, ids.rowA);
    expect(rowA).toMatchObject({ status: "approved", progressEntry: { status: "submitted", official: false, recordedBy: members.site.id } });
    ids.eA = rowA.progressEntry.id;
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.eA } })).toMatchObject({ status: "submitted", source: "daily_log", dailyLogId: ids.log2, dailyLogQuantityId: ids.rowA, createdBy: members.site.id, clientRequestId: `daily_log:${ids.rowA}` });

    // Added by the PM to the submitted day: pending the moment it is recorded.
    const late = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 7, clientRequestId: "dlq-d2-b" }, live.token, DAY2);
    ok(late, 201);
    ids.rowB = late.body.data.entryId;
    expect(rowOf(late.body.data, ids.rowB).progressEntry).toMatchObject({ status: "submitted", official: false, recordedBy: live.user.id });
    const eBFirst = rowOf(late.body.data, ids.rowB).progressEntry.id;
    expect(await entryRows({ dailyLogId: ids.log2 })).toHaveLength(2);
    // A row left unminted on a submitted day (recorded before this hole was closed): the day's approval is the net under it.
    await prisma.quantityProgressEntry.delete({ where: { id: eBFirst } });
    expect(await entryRows({ dailyLogId: ids.log2 })).toHaveLength(1);

    const approved = await api.post(at(`/daily-logs/${DAY2}/approve`), {}, bearer(live.token));
    ok(approved);
    expect(approved.body.data.status).toBe("approved");
    expect(rowOf(approved.body.data, ids.rowA).progressEntry).toMatchObject({ id: ids.eA, status: "submitted", official: false, approvedBy: null });
    expect(rowOf(approved.body.data, ids.rowB).progressEntry).toMatchObject({ status: "submitted", official: false, recordedBy: live.user.id });
    ids.eB = rowOf(approved.body.data, ids.rowB).progressEntry.id;
    const entries = await entryRows({ dailyLogId: ids.log2 });
    expect(entries.map((entry) => [entry.dailyLogQuantityId, entry.status, entry.approvedBy, entry.submissionId]).sort()).toEqual([[ids.rowA, "submitted", null, null], [ids.rowB, "submitted", null, null]].sort());
    const audit = await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "daily_log", entityId: ids.log2, newStatus: "approved" }, orderBy: { occurredAt: "desc" } });
    expect(audit.summaryJson.quantityEntries).toEqual({ minted: 1, synced: 1, kept: 0, retired: 0 });
    expect(await prisma.auditEvent.count({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", action: "approved" } })).toBe(1); // e1, by the writer, earlier
    expect(await officialCount()).toBe(1);
    expect(await evRow(pour.id)).toMatchObject({ pct: 50, progressStatus: "approved" });
    refused(await api.post(at(`/daily-logs/${DAY2}/submit`), {}, bearer(live.token)), 409, "DAILY_LOG_APPROVED");
    refused(await reviewRow(ids.rowB, "reject", "no", live.token, DAY2), 409, "DAILY_LOG_APPROVED");
  });

  it("day two: the site team cannot reject a row whose entry is bundled into a pending submission or is official progress", async () => {
    ok(await api.post(at(`/daily-logs/${DAY2}/reopen`), { reason: "review" }, bearer(live.token)));
    const bundled = await submitProgress(pour.id, { entryIds: [ids.eA] });
    ok(bundled, 200);
    ids.s3 = bundled.body.data.submission.id;
    expect(bundled.body.data.submission).toMatchObject({ quantityComplete: 60, quantityPlanned: 100, pctComplete: 60 });
    refused(await reviewRow(ids.rowA, "reject", "no", live.token, DAY2), 409, "QUANTITY_ENTRY_BUNDLED");
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.eA } })).toMatchObject({ status: "submitted", submissionId: ids.s3 });
    ok(await approveProgress(pour.id, ids.s3));
    expect(await officialCount()).toBe(2);
    expect(await evRow(pour.id)).toMatchObject({ pct: 60, progressStatus: "approved" });
    refused(await reviewRow(ids.rowA, "reject", "no", live.token, DAY2), 409, "DAILY_LOG_QUANTITY_LOCKED");
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.eA } })).toMatchObject({ status: "approved", submissionId: ids.s3, dailyLogQuantityId: ids.rowA });
    expect(rowOf(await getLog(live.token, DAY2), ids.rowA)).toMatchObject({ status: "approved", progressEntry: { id: ids.eA, status: "approved", official: true } });
    // The row the site team can still reject is the pending one; its entry goes, the official one stays.
    ok(await reviewRow(ids.rowB, "reject", "Bay 6 not poured", live.token, DAY2));
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.eB } })).toBeNull();
    expect(await prisma.activityProgress.count({ where: { activityId: pour.id } })).toBe(2);
    expect(await evRow(pour.id)).toMatchObject({ pct: 60, progressStatus: "approved" });

    // A row that stopped counting without the service (a rejected row whose entry stayed, the pre-fix shape): the day's next submit retires its free pending entry.
    const extra = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 2, clientRequestId: "dlq-d2-c" }, members.site.token, DAY2);
    ok(extra, 201);
    ids.rowC = extra.body.data.entryId;
    expect(rowOf(extra.body.data, ids.rowC).progressEntry).toBeNull(); // the day is open again
    const resubmitted = await api.post(at(`/daily-logs/${DAY2}/submit`), {}, bearer(live.token));
    ok(resubmitted);
    const eC = rowOf(resubmitted.body.data, ids.rowC).progressEntry.id;
    await prisma.dailyLogQuantity.update({ where: { id: ids.rowC }, data: { status: "rejected", rejectionReason: "stale" } });
    const again = await api.post(at(`/daily-logs/${DAY2}/submit`), {}, bearer(live.token));
    ok(again);
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: eC } })).toBeNull();
    expect(rowOf(again.body.data, ids.rowC).progressEntry).toBeNull();
    const retired = await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "daily_log", entityId: ids.log2, newStatus: "submitted" }, orderBy: { occurredAt: "desc" } });
    expect(retired.summaryJson.quantityEntries).toEqual({ minted: 0, synced: 0, kept: 1, retired: 1 });
    expect(await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: eC, action: "deleted" } })).toMatchObject({ summaryJson: expect.objectContaining({ transition: "quantity_entry.daily_log_row_retired" }) });
    refused(await submitProgress(pour.id, { bundleSubmittedThrough: "2026-09-30" }), 400, "QUANTITY_NO_ENTRIES_TO_BUNDLE");
  });

  it("a member who may not read the BOQ records against the picker and reads the log without the item's code or allocation", async () => {
    const added = await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 8, unitCode: "m3", clientRequestId: "dlq-row-6" }, members.noBoq.token);
    ok(added, 201);
    ids.row6 = added.body.data.entryId;
    const row = rowOf(added.body.data, ids.row6);
    // The day is already submitted, so the row is pending the moment it is recorded — by its author, with no quantity on the entry block.
    expect(row).toMatchObject({ quantity: 8, unitCode: "m3", boqItemId: concrete.id, boqItem: { id: concrete.id, description: "Concrete in foundations", unit: "Cu.M", unitCode: "m3" }, activity: { name: "Pour foundations" }, createdBy: members.noBoq.id, progressEntry: { status: "submitted", official: false, source: "daily_log", recordedBy: members.noBoq.id }, boqWithheld: { keys: ["allocationId", "boqItem.code"], reason: expect.stringContaining("may read the BOQ") } });
    expect(row.progressEntry).not.toHaveProperty("quantity");
    expect(row).not.toHaveProperty("allocationId");
    expect(row.boqItem).not.toHaveProperty("code");
    expect(added.body.data.totals.quantities).toEqual(expect.arrayContaining([{ unitCode: "m3", quantity: 8, rows: 1 }]));
    // The same log to a BOQ reader carries the code and the allocation; the row's allocation was resolved by the server.
    const full = rowOf(await getLog(), ids.row6);
    expect(full).toMatchObject({ allocationId: ids.pourAllocation, boqItem: { code: "1.1" } });
    expect(full.boqWithheld).toBeUndefined();
    // The list of days carries the per-unit tally for everyone who may read progress.
    const days = await api.get(at(`/daily-logs?from=${DAY}&to=${DAY}`), bearer(members.noBoq.token));
    ok(days);
    expect(days.body.data.items[0].totals.quantities).toEqual(expect.arrayContaining([{ unitCode: "m3", quantity: 8, rows: 1 }]));
    const pdf = await api.request("GET", at(`/daily-logs/${DAY}/export.pdf`), { headers: bearer(live.token) });
    expect(pdf.status).toBe(200);
  });

  it("PROGRESS SOURCE links are the server's: a client-sent submissionId or dailyLogId on a direct entry is ignored", async () => {
    const answer = await api.post(at("/quantity-progress"), { activityId: pour.id, boqItemId: concrete.id, quantity: 1, date: DAY, submissionId: ids.s1, dailyLogId: ids.log, dailyLogQuantityId: ids.row6, status: "submitted" }, bearer(live.token));
    ok(answer, 201);
    const entry = await prisma.quantityProgressEntry.findUnique({ where: { id: answer.body.data.entry.id } });
    expect(entry).toMatchObject({ source: "manual", submissionId: null, dailyLogId: null, dailyLogQuantityId: null, createdBy: live.user.id });
    expect(await prisma.quantityProgressEntry.count({ where: { submissionId: ids.s1 } })).toBe(1);
    expect(await prisma.activityProgress.count({ where: { activityId: pour.id } })).toBe(2);
  });

  it("a member of another organisation gets the tenant 404 on every route and writes nothing", async () => {
    const token = other.token;
    const before = JSON.stringify(await entryRows());
    refused(await api.get(at(`/daily-logs/${DAY}`), bearer(token)), 404, "PROJECT_NOT_FOUND");
    refused(await addRow({ activityId: pour.id, boqItemId: concrete.id, quantity: 1 }, token), 404, "PROJECT_NOT_FOUND");
    refused(await editRow(ids.row6, { quantity: 1 }, token), 404, "PROJECT_NOT_FOUND");
    refused(await removeRow(ids.row6, token), 404, "PROJECT_NOT_FOUND");
    refused(await api.post(at(`/daily-logs/${DAY}/submit`), {}, bearer(token)), 404, "PROJECT_NOT_FOUND");
    refused(await api.post(at(`/daily-logs/${DAY}/approve`), {}, bearer(token)), 404, "PROJECT_NOT_FOUND");
    expect(JSON.stringify(await entryRows())).toBe(before);
    expect(await officialCount()).toBe(2);
    // The daily log wrote nothing to any other activity's EV row: only the pour's official figure moved, through the writer.
    const after = (await api.get(at("/reports/ev"), bearer(live.token))).body.data.activityBreakdown;
    const strip = (rows) => JSON.stringify(rows.filter((row) => row.activityId !== "A100"));
    expect(strip(after)).toBe(strip(JSON.parse(evBefore)));
  });
});
