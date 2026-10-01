/**
 * PC-7b — "Raise change event" from a project record, the workspace
 * dashboard's open-exceptions figure and the critical-exception notice,
 * proven against a real API process and the real local Postgres.
 *
 *  - From an RFI, daily log, NCR, punch item, drawing revision, submittal and
 *    meeting action: ONE shared helper (change-event.service
 *    prefillFromRecord / raiseFromRecord) creates ONE draft change event with
 *    the typed FK, its free-text pair, the origin and the title, amount 0 for
 *    the QS — and writes nothing else (the source record, change orders,
 *    budget, activities, cost: byte-identical). It needs change_event:create
 *    AND the read the record's own module and rule give: the module's read,
 *    an RFI draft only for its creator or manager, a punch item within a
 *    company party's scope, an unpublished drawing revision only for a
 *    document-control editor; anything else is 403 (module) or 404 (record).
 *  - The pair keeps the R5-1 trace: an RFI's recorded days, once its change
 *    event's order is approved, count once (the order's), not twice.
 *  - The workspace tile counts per severity, org-wide, only what the caller
 *    may read on each project; a project whose BOQ they may not read is named
 *    in the marker with the reason, never a count of what was left out.
 *  - notifyOpened (the engine's hook) tells the project's PM and QS — each
 *    only of what they may read — of a newly opened critical exception, once:
 *    not again on a refresh, not while snoozed, not a warning, not one in a
 *    change; again only for a new opening.
 *
 * Throwaway "LiveTest <uuid>" organisations, dropped afterwards; the spawned
 * API runs with EXCEPTIONS_ENGINE_ENABLED=false.
 *
 *   npm run test:live -- src/services/__live__/pc-7b-raise-from-record.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const PROOF = { fileName: "LiveTest proof.pdf", fileUrl: "https://example.test/proof.pdf" };
const BOQ_REASON =
  "Exceptions on the BOQ's items and allocations, and those measured from the BOQ's quantities or its mapping, are available only to members who may read the BOQ";
const TYPED = ["rfiId", "dailyLogId", "ncrId", "punchItemId", "drawingRevisionId", "submittalId", "meetingActionItemId", "exceptionId"];

liveDescribe("PC-7b: raise a change event from a record, the workspace exceptions tile, the critical notice", () => {
  let live;
  let other;
  let api;
  let project;
  let project2;
  let project3;
  let otherProject;
  const members = {};
  const ids = {};
  const records = {};
  const tag = Date.now();
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const pm = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route, p = project) => `/api/v1/projects/${p.id}${route}`;
  const ok = (label, answer, status = 200) => expect([label, answer.status, answer.body?.error]).toEqual([label, status, undefined]);
  const refused = (label, answer, status, code) => expect([label, answer.status, answer.body?.error?.code]).toEqual([label, status, code]);

  // Everything a handoff from a record must never touch, as stored — the
  // source records themselves included.
  const footprint = async () => {
    const where = { projectId: project.id };
    const tables = ["changeOrder", "changeOrderActivityLink", "budgetLine", "budgetLineChange", "budgetRevision", "activity", "costRecord", "rfi", "dailyLog", "ncrRecord", "punchItem", "sheetRevision", "submittal", "meetingActionItem", "workflowActivityLink", "projectException"];
    const rows = await Promise.all(tables.map((table) => prisma[table].findMany({ where, orderBy: { id: "asc" } })));
    return JSON.stringify(rows);
  };

  const member = async (key, role, { projects = [project], noModule = null, noModuleOn = null } = {}) => {
    const user = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-pc7br-${key.replace(/_/g, "")}-${tag}@octapm-live.test`, role });
    for (const p of projects) {
      await prisma.projectAssignment.create({ data: { projectId: p.id, userId: user.id, role, orgId: live.org.id } });
    }
    if (noModule) {
      const template = await prisma.permissionTemplate.create({ data: { orgId: live.org.id, name: `LiveTest ${key} no ${noModule} ${tag}`, baseRole: role, tools: { create: [{ module: noModule, level: "none" }] } } });
      await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: (noModuleOn || project).id, userId: user.id, templateId: template.id } });
    }
    members[key] = user;
    return user;
  };

  const seedException = (data) =>
    prisma.projectException.create({
      data: {
        orgId: data.orgId || live.org.id,
        projectId: data.projectId || project.id,
        subjectId: data.subjectId || crypto.randomUUID(),
        measuredBasis: "seeded: owning service basis (measured)",
        limitBasis: "seeded: owning service basis (limit)",
        measured: 2,
        limit: 1,
        ...data,
      },
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", EXCEPTIONS_ENGINE_ENABLED: "false" });
    const newProject = (org, name) => prisma.project.create({ data: { orgId: org.org.id, name, startDate: new Date("2026-01-05"), endDate: new Date("2027-06-30") } });
    project = await newProject(live, "LiveTest PC-7b records A");
    project2 = await newProject(live, "LiveTest PC-7b records B");
    project3 = await newProject(live, "LiveTest PC-7b records C");
    otherProject = await newProject(other, "LiveTest PC-7b records other org");

    await member("site", "site_engineer");
    await member("qs_norfi", "qs", { noModule: "rfi" });
    await member("cost", "cost_controller");
    await member("pm_member", "pm");
    await member("qs", "qs");
    await member("qs_noboq", "qs", { noModule: "boq" });
    // Reads project A whole and project B without its BOQ; not on C.
    await member("split", "qs", { projects: [project, project2], noModule: "boq", noModuleOn: project2 });
    await member("pm_b", "pm", { projects: [project2] });
    members.other_pm = await createLiveUser(prisma, { orgId: other.org.id, name: "LiveTest other pm", email: `live-pc7br-otherpm-${tag}@octapm-live.test`, role: "pm" });

    // A contractor's person: no assignment, a member of the project's
    // contractor party (company A) — party-scoped, with change_event:create.
    const companyA = await prisma.company.create({ data: { orgId: live.org.id, name: `LiveTest PC-7b Contractor A ${tag}` } });
    const companyB = await prisma.company.create({ data: { orgId: live.org.id, name: `LiveTest PC-7b Sub B ${tag}` } });
    const contractor = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest contractor", email: `live-pc7br-contractor-${tag}@octapm-live.test`, role: "site_engineer" });
    const party = await prisma.projectParty.create({ data: { projectId: project.id, companyId: companyA.id, role: "contractor" } });
    await prisma.projectPartyMember.create({ data: { projectPartyId: party.id, userId: contractor.id } });
    members.contractor = contractor;

    // Two activities through the API, a location.
    for (const [key, code] of [["A", "R7A"], ["D", "R7D"]]) {
      const activity = await api.post(at("/activities"), { engineerIds: [live.user.id], name: `LiveTest activity ${key}`, activityCode: code, duration: 10, startDate: "2027-02-01", endDate: "2027-02-12" }, pm());
      ok(`activity ${key}`, activity, 201);
      ids[key] = activity.body.data.id;
    }
    ids.location = crypto.randomUUID();
    await prisma.location.create({ data: { id: ids.location, orgId: live.org.id, projectId: project.id, name: "LiveTest Zone R", path: ids.location } });

    // The records.
    records.rfi = await prisma.rfi.create({ data: { projectId: project.id, ref: "RFI-R7", subject: "LiveTest anchor bolt clash", status: "open", activityId: ids.A, locationId: ids.location, createdBy: live.user.id } });
    records.rfiDraft = await prisma.rfi.create({ data: { projectId: project.id, ref: "RFI-R7D", subject: "LiveTest draft question", status: "draft", createdBy: live.user.id } });
    records.dailyLog = await prisma.dailyLog.create({ data: { orgId: live.org.id, projectId: project.id, date: new Date("2026-03-05") } });
    records.ncr = await prisma.ncrRecord.create({ data: { projectId: project.id, ref: "NCR-R7", severity: "major", description: "LiveTest cold joint", activityId: ids.A } });
    records.punch = await prisma.punchItem.create({ data: { orgId: live.org.id, projectId: project.id, number: 1, ref: "PI-R7", title: "LiveTest missing sealant", locationId: ids.location, assigneeCompanyId: companyA.id } });
    records.punchOther = await prisma.punchItem.create({ data: { orgId: live.org.id, projectId: project.id, number: 2, ref: "PI-R8", title: "LiveTest another company's item", assigneeCompanyId: companyB.id } });
    const sheet = await prisma.sheet.create({ data: { orgId: live.org.id, projectId: project.id, number: "S-201", title: "Base plates", locationId: ids.location, sortKey: "S-0201" } });
    const document = (n) => prisma.projectDocument.create({ data: { orgId: live.org.id, projectId: project.id, documentType: "drawing", originalName: `${n}.pdf`, fileName: `${n}.pdf`, mimeType: "application/pdf", sizeBytes: 1, sha256: "0".repeat(64), storageProvider: "local", objectKey: `lt-${tag}-${n}`, storageKey: `lt-${tag}-${n}-${crypto.randomUUID()}` } });
    records.revision = await prisma.sheetRevision.create({ data: { orgId: live.org.id, projectId: project.id, sheetId: sheet.id, documentId: (await document("pub")).id, number: "S-201", title: "Base plates", revision: "C", status: "published" } });
    records.revisionPending = await prisma.sheetRevision.create({ data: { orgId: live.org.id, projectId: project.id, sheetId: sheet.id, documentId: (await document("pend")).id, number: "S-201", title: "Base plates", revision: "D", status: "pending_review" } });
    records.submittal = await prisma.submittal.create({ data: { projectId: project.id, ref: "SUB-R7", title: "LiveTest anchor shop drawings", activityId: ids.A } });
    const meeting = await prisma.meeting.create({ data: { orgId: live.org.id, projectId: project.id, meetingNumber: "LT-R7", title: "LiveTest coordination" } });
    records.action = await prisma.meetingActionItem.create({ data: { orgId: live.org.id, projectId: project.id, meetingId: meeting.id, itemNumber: "1", title: "LiveTest price the extra anchors", activityId: ids.D, dueDate: new Date("2026-03-12") } });
    records.rfiOther = await prisma.rfi.create({ data: { projectId: project2.id, ref: "RFI-R9", subject: "LiveTest elsewhere", status: "open" } });
    records.rfiOtherOrg = await prisma.rfi.create({ data: { projectId: otherProject.id, ref: "RFI-R0", subject: "LiveTest other org", status: "open" } });
  }, 240_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["notification", "projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  it("each of the seven records: one draft change event with the typed link, its pair, the origin and the title — nothing else written", async () => {
    const cases = [
      ["rfi", records.rfi.id, "rfiId", "rfi", "rfi", "RFI-R7 LiveTest anchor bolt clash", { activityId: ids.A, locationId: ids.location }],
      ["daily-logs", records.dailyLog.id, "dailyLogId", "daily_log", "daily_log", "Daily log 2026-03-05", { activityId: null, locationId: null }],
      ["ncr", records.ncr.id, "ncrId", "observation", "ncr", "NCR-R7 LiveTest cold joint", { activityId: ids.A, locationId: null }],
      ["punch", records.punch.id, "punchItemId", "observation", "punch_item", "PI-R7 LiveTest missing sealant", { activityId: null, locationId: ids.location }],
      ["drawings/sheets/revisions", records.revision.id, "drawingRevisionId", "other", "sheet_revision", "Drawing S-201 Base plates rev C", { activityId: null, locationId: ids.location }],
      ["submittals", records.submittal.id, "submittalId", "submittal", "submittal", "SUB-R7 LiveTest anchor shop drawings", { activityId: ids.A, locationId: null }],
      ["meetings/action-items", records.action.id, "meetingActionItemId", "meeting", "meeting_action", "Meeting action: LiveTest price the extra anchors", { activityId: ids.D, locationId: null }],
    ];
    const before = await footprint();
    const events = await prisma.changeEvent.count({ where: { projectId: project.id } });
    for (const [mount, id, field, origin, type, title, refs] of cases) {
      const prefill = await api.get(at(`/${mount}/${id}/change-event-prefill`), pm());
      ok(`prefill ${mount}`, prefill);
      expect(prefill.body.data).toMatchObject({ prefill: { title, origin, type: "other", romAmount: 0, scheduleImpactDays: 0, lines: [], ...refs }, links: { [field]: id }, source: { type, id } });
      expect(prefill.body.data.source.path).toContain(`recordId=${id}`);
      // A prefill writes nothing.
      expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events + cases.indexOf(cases.find((row) => row[0] === mount)));

      // The body may not forge another link, origin or pair.
      const raised = await api.post(at(`/${mount}/${id}/raise-change-event`), { origin: "manual", rfiId: records.rfiOther.id, exceptionId: crypto.randomUUID(), sourceRecordType: "risk", sourceRecordId: crypto.randomUUID() }, pm());
      ok(`raise ${mount}`, raised, 201);
      const event = raised.body.data;
      expect(event).toMatchObject({ title, origin, status: "open", romAmount: 0, totals: { rom: 0, quoted: null, estimate: 0 }, changeOrderId: null, lines: [], sourceRecordType: type, sourceRecordId: id, ...refs });
      expect(event.sourceLinks).toEqual([{ type, id, path: expect.stringContaining(`recordId=${id}`) }]);
      expect(event.sourcePath).toBe(event.sourceLinks[0].path);
      const stored = await prisma.changeEvent.findUnique({ where: { id: event.id } });
      for (const name of TYPED) expect([mount, name, stored[name]]).toEqual([mount, name, name === field ? id : null]);
      expect([stored.status, stored.origin, Number(stored.romAmount), stored.createdBy]).toEqual(["open", origin, 0, live.user.id]);
      const audit = await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "change_event", entityId: event.id } });
      expect(audit.action).toBe("created");
      expect(audit.summaryJson.sourceLinks).toEqual({ [field]: id });
    }
    expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events + cases.length);
    expect(await prisma.changeEventLine.count({ where: { projectId: project.id } })).toBe(0);
    expect(await footprint()).toBe(before);

    // The QS's own words and estimate go over the prefill; the link stays the endpoint's.
    const priced = await api.post(at(`/ncr/${records.ncr.id}/raise-change-event`), { title: "LiveTest rework cold joint", type: "error_omission", scheduleImpactDays: 2, lines: [{ description: "Break out and recast", activityId: ids.A, quantity: 3, unit: "m3" }] }, pm());
    ok("raise with overrides", priced, 201);
    expect(priced.body.data).toMatchObject({ title: "LiveTest rework cold joint", type: "error_omission", origin: "observation", scheduleImpactDays: 2, romAmount: 0, sourceRecordType: "ncr", sourceRecordId: records.ncr.id });
    expect(priced.body.data.lines).toEqual([expect.objectContaining({ description: "Break out and recast", quantity: 3, unitCost: 0, romAmount: 0 })]);
    expect(await footprint()).toBe(before);
  });

  it("needs change_event:create and the record module's read: 403 without either", async () => {
    // A cost controller reads RFIs but does not create change events.
    refused("cost rfi prefill", await api.get(at(`/rfi/${records.rfi.id}/change-event-prefill`), as(members.cost)), 403, "FORBIDDEN");
    refused("cost rfi raise", await api.post(at(`/rfi/${records.rfi.id}/raise-change-event`), {}, as(members.cost)), 403, "FORBIDDEN");
    // A QS creates change events, but this one may not read RFIs on the project.
    const events = await prisma.changeEvent.count({ where: { projectId: project.id } });
    refused("qs_norfi rfi prefill", await api.get(at(`/rfi/${records.rfi.id}/change-event-prefill`), as(members.qs_norfi)), 403, "FORBIDDEN");
    refused("qs_norfi rfi raise", await api.post(at(`/rfi/${records.rfi.id}/raise-change-event`), {}, as(members.qs_norfi)), 403, "FORBIDDEN");
    expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events);
    // …and may raise from the records they do read.
    const ncr = await api.post(at(`/ncr/${records.ncr.id}/raise-change-event`), {}, as(members.qs_norfi));
    ok("qs_norfi ncr raise", ncr, 201);
    expect(ncr.body.data.createdBy).toBe(members.qs_norfi.id);
    // A site engineer creates change events and reads every one of these modules.
    ok("site submittal raise", await api.post(at(`/submittals/${records.submittal.id}/raise-change-event`), {}, as(members.site)), 201);
    refused("bad id", await api.post(at("/rfi/not-a-uuid/raise-change-event"), {}, pm()), 400, "VALIDATION_ERROR");
  });

  it("the record's own read rule: an RFI draft, a company party's scope, an unpublished drawing revision — 404, as if absent", async () => {
    const events = await prisma.changeEvent.count({ where: { projectId: project.id } });
    // A draft RFI is its creator's (the PM's): not the site engineer's.
    refused("site draft rfi prefill", await api.get(at(`/rfi/${records.rfiDraft.id}/change-event-prefill`), as(members.site)), 404, "CHANGE_EVENT_SOURCE_NOT_FOUND");
    refused("site draft rfi raise", await api.post(at(`/rfi/${records.rfiDraft.id}/raise-change-event`), {}, as(members.site)), 404, "CHANGE_EVENT_SOURCE_NOT_FOUND");
    ok("site open rfi", await api.get(at(`/rfi/${records.rfi.id}/change-event-prefill`), as(members.site)));
    ok("pm draft rfi", await api.get(at(`/rfi/${records.rfiDraft.id}/change-event-prefill`), pm()));

    // The contractor's person: their company's punch item, not another company's.
    refused("contractor other company's punch", await api.post(at(`/punch/${records.punchOther.id}/raise-change-event`), {}, as(members.contractor)), 404, "CHANGE_EVENT_SOURCE_NOT_FOUND");
    expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events);
    const own = await api.post(at(`/punch/${records.punch.id}/raise-change-event`), {}, as(members.contractor));
    ok("contractor own punch", own, 201);
    expect((await prisma.changeEvent.findUnique({ where: { id: own.body.data.id } })).punchItemId).toBe(records.punch.id);

    // A revision pending review: a document-control editor only.
    refused("site pending revision", await api.get(at(`/drawings/sheets/revisions/${records.revisionPending.id}/change-event-prefill`), as(members.site)), 404, "CHANGE_EVENT_SOURCE_NOT_FOUND");
    ok("site published revision", await api.get(at(`/drawings/sheets/revisions/${records.revision.id}/change-event-prefill`), as(members.site)));
    const pending = await api.get(at(`/drawings/sheets/revisions/${records.revisionPending.id}/change-event-prefill`), pm());
    ok("pm pending revision", pending);
    expect(pending.body.data.prefill.title).toBe("Drawing S-201 Base plates rev D");
    expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events + 1);
  });

  it("tenancy: another project's record is 404 through this project; another organisation's project is 404", async () => {
    refused("other project's rfi", await api.post(at(`/rfi/${records.rfiOther.id}/raise-change-event`), {}, pm()), 404, "CHANGE_EVENT_SOURCE_NOT_FOUND");
    refused("other org's rfi here", await api.post(at(`/rfi/${records.rfiOtherOrg.id}/raise-change-event`), {}, pm()), 404, "CHANGE_EVENT_SOURCE_NOT_FOUND");
    expect((await api.post(at(`/rfi/${records.rfiOtherOrg.id}/raise-change-event`, otherProject), {}, pm())).status).toBe(404);
    expect((await api.post(at(`/rfi/${records.rfi.id}/raise-change-event`), {}, as(members.other_pm))).status).toBe(404);
    expect(await prisma.changeEvent.count({ where: { projectId: otherProject.id } })).toBe(0);
    // The source modules' own routes are still served.
    for (const route of ["/rfi", "/ncr", "/punch", "/submittals", "/meetings"]) ok(`list ${route}`, await api.get(at(route), pm()));
  });

  it("the pair keeps the R5-1 trace: an RFI's days, once its change event's order is approved, count once", async () => {
    const created = await api.post(at("/rfi"), { subject: "LiveTest R5-1 RFI", status: "open", activityLinks: [{ activityId: ids.A, relationType: "schedule_impact", scheduleImpactDays: 3 }, { activityId: ids.D, relationType: "schedule_impact", scheduleImpactDays: 3 }] }, pm());
    ok("rfi", created, 201);
    const raised = await api.post(at(`/rfi/${created.body.data.id}/raise-change-event`), { activityId: ids.A, romAmount: 1000 }, pm());
    ok("raise", raised, 201);
    const converted = await api.post(at(`/change-events/${raised.body.data.id}/convert`), {}, pm());
    ok("convert", converted, 201);
    const orderId = converted.body.data.changeOrder.id;
    ok("patch order", await api.request("PATCH", at(`/change-orders/${orderId}`), { body: { scheduleImpactSummary: "6 days on A", costImpactSummary: "ROM 1000", activityLinks: [{ activityId: ids.A, relationType: "delay", scheduleImpactDays: 6 }], attachmentRefs: [PROOF] }, headers: pm() }));
    ok("submit", await api.post(at(`/change-orders/${orderId}/submit`), {}, pm()));
    ok("approve", await api.post(at(`/change-orders/${orderId}/approve`), { comment: "LiveTest" }, pm()));
    const forecast = await api.get(at("/forecast"), pm());
    ok("forecast", forecast);
    const byId = Object.fromEntries(forecast.body.data.activities.map((row) => [row.id, row]));
    // A: the approved order's 6 days, once — not 6 + the RFI's 3.
    expect([byId[ids.A].impactDays, byId[ids.D].impactDays]).toEqual([6, 3]);
    expect(byId[ids.A].reasons.join(" ")).not.toMatch(/from RFI/);
    expect(byId[ids.D].reasons).toContain("3 days of recorded impact from RFI");
  });

  it("the workspace tile: per severity, org-wide, only what the caller may read on each project; a project withheld from them is named with the reason, never counted", async () => {
    const inChangeEvent = await prisma.changeEvent.create({ data: { orgId: live.org.id, projectId: project2.id, number: 900, ref: "CE-900", title: "LiveTest carrying event" } });
    const later = new Date(Date.now() + 5 * 86_400_000);
    // Project A.
    await seedException({ kind: "quantity_over_boq", severity: "critical", subjectType: "boq_item" });
    await seedException({ kind: "committed_over_budget", severity: "warning", subjectType: "budget_line" });
    await seedException({ kind: "progress_stale", severity: "info", subjectType: "activity" });
    await seedException({ kind: "structure_missing", severity: "critical", subjectType: "activity", snoozedUntil: later });
    await seedException({ kind: "forecast_over_revised", severity: "warning", subjectType: "project", resolvedAt: new Date(), resolvedReason: "dismissed:LiveTest known" });
    await seedException({ kind: "committed_over_budget", severity: "critical", subjectType: "budget_line", resolvedAt: new Date(), resolvedReason: "cleared" });
    // Project B (the split member may not read its BOQ).
    await seedException({ projectId: project2.id, kind: "quantity_over_allocation", severity: "critical", subjectType: "allocation" });
    await seedException({ projectId: project2.id, kind: "actual_over_committed", severity: "critical", subjectType: "commitment", changeEventId: inChangeEvent.id });
    await seedException({ projectId: project2.id, kind: "schedule_slip_on_mapped_item", severity: "warning", subjectType: "activity" });
    await seedException({ projectId: project2.id, kind: "progress_stale", severity: "info", subjectType: "activity" });
    // Project C (not the split member's) and another organisation.
    await seedException({ projectId: project3.id, kind: "committed_over_budget", severity: "critical", subjectType: "budget_line" });
    await seedException({ orgId: other.org.id, projectId: otherProject.id, kind: "committed_over_budget", severity: "critical", subjectType: "budget_line" });

    const full = await api.get("/api/v1/projects/workspace-dashboard", pm());
    ok("pm", full);
    expect(full.body.data.openExceptions).toMatchObject({ total: 7, bySeverity: { critical: 3, warning: 2, info: 2 }, inChange: 1, snoozed: 1 });
    expect(full.body.data.openExceptions.basis).toMatch(/may read/);
    expect(full.body.data.openExceptions).not.toHaveProperty("withheld");

    const split = await api.get("/api/v1/projects/workspace-dashboard", as(members.split));
    ok("split", split);
    // A: the BOQ critical, the cost warning, the stale info (and the snoozed one);
    // B: the stale info (and the cost one in change) — the allocation and
    // mapped-item kinds are not counted there; C is not theirs.
    expect(split.body.data.openExceptions).toMatchObject({ total: 4, bySeverity: { critical: 1, warning: 1, info: 2 }, inChange: 1, snoozed: 1 });
    const withheld = split.body.data.openExceptions.withheld;
    expect(withheld.modules).toEqual(["boq"]);
    expect(withheld.reason).toContain(BOQ_REASON);
    expect(withheld.projects).toEqual([{ projectId: project2.id, name: project2.name, reason: BOQ_REASON, modules: ["boq"] }]);
    // The marker names access, never a number of what it left out.
    expect(JSON.stringify({ ...withheld, projects: withheld.projects.map(({ projectId, name, ...rest }) => rest) })).not.toMatch(/\d/);

    const otherOrg = await api.get("/api/v1/projects/workspace-dashboard", as(members.other_pm));
    ok("other org", otherOrg);
    expect(otherOrg.body.data.openExceptions).toMatchObject({ total: 1, bySeverity: { critical: 1, warning: 0, info: 0 }, inChange: 0, snoozed: 0 });
  });

  it("notifyOpened: the project's PM and QS, each only of what they may read, once per opening; never a warning, a snoozed or an in-change one", async () => {
    const exceptionService = require("../exception.service");
    const carrier = await prisma.changeEvent.create({ data: { orgId: live.org.id, projectId: project.id, number: 901, ref: "CE-901", title: "LiveTest carrier" } });
    const boqCritical = await seedException({ kind: "quantity_over_allocation", severity: "critical", subjectType: "allocation", measured: 45, limit: 40, unitCode: "m" });
    const costCritical = await seedException({ kind: "actual_over_committed", severity: "critical", subjectType: "commitment" });
    const warning = await seedException({ kind: "committed_over_budget", severity: "warning", subjectType: "budget_line" });
    const snoozed = await seedException({ kind: "forecast_over_revised", severity: "critical", subjectType: "budget_line", snoozedUntil: new Date(Date.now() + 86_400_000) });
    const inChange = await seedException({ kind: "committed_over_budget", severity: "critical", subjectType: "budget_line", changeEventId: carrier.id });
    const elsewhere = await seedException({ projectId: project2.id, kind: "committed_over_budget", severity: "critical", subjectType: "budget_line" });
    const notices = async (exception) =>
      (await prisma.notification.findMany({ where: { orgId: live.org.id, entityType: "project_exception", entityId: exception.id }, select: { recipientUserId: true } })).map((row) => row.recipientUserId).sort();

    expect(await exceptionService.notifyOpened({ orgId: live.org.id, projectId: project.id, exceptions: [] })).toEqual({ notified: 0, exceptions: 0 });
    const first = await exceptionService.notifyOpened({ orgId: live.org.id, projectId: project.id, exceptions: [boqCritical, costCritical, warning, snoozed, inChange.id] });
    // The QS-role members on project A: qs, qs_norfi, split read the BOQ there; qs_noboq does not.
    const boqReaders = [members.pm_member.id, members.qs.id, members.qs_norfi.id, members.split.id].sort();
    expect(await notices(boqCritical)).toEqual(boqReaders);
    expect(await notices(costCritical)).toEqual([...boqReaders, members.qs_noboq.id].sort());
    expect(first).toEqual({ notified: 9, exceptions: 2 });
    for (const quiet of [warning, snoozed, inChange]) expect(await notices(quiet)).toEqual([]);

    const row = await prisma.notification.findFirst({ where: { orgId: live.org.id, entityId: boqCritical.id, recipientUserId: members.qs.id } });
    expect(row).toMatchObject({ category: "commercial", type: "project_exception", event: "exception.opened", priority: "high", projectId: project.id });
    expect(row.title).toMatch(/^Critical exception: /);
    expect(row.message).toContain("45 m");
    expect(row.actionUrl).toContain(project.id);

    // A refresh (same opening, new figures) is not a new notice.
    await prisma.projectException.update({ where: { id: boqCritical.id }, data: { lastSeenAt: new Date(), measured: 47 } });
    expect((await exceptionService.notifyOpened({ orgId: live.org.id, projectId: project.id, exceptions: [boqCritical, costCritical] })).notified).toBe(0);
    // Once the snooze has run out it is told — once.
    await prisma.projectException.update({ where: { id: snoozed.id }, data: { snoozedUntil: new Date(Date.now() - 1000) } });
    expect((await exceptionService.notifyOpened({ orgId: live.org.id, projectId: project.id, exceptions: [snoozed] })).notified).toBe(5);
    expect((await exceptionService.notifyOpened({ orgId: live.org.id, projectId: project.id, exceptions: [snoozed] })).notified).toBe(0);
    // A new opening of the same gap (cleared, then opened again) is told again.
    await prisma.projectException.update({ where: { id: costCritical.id }, data: { resolvedAt: new Date(), resolvedReason: "cleared" } });
    const reopened = await seedException({ kind: "actual_over_committed", severity: "critical", subjectType: "commitment", subjectId: costCritical.subjectId });
    expect((await exceptionService.notifyOpened({ orgId: live.org.id, projectId: project.id, exceptions: [reopened] })).notified).toBe(5);
    // Another project's id passed to this project's call notifies nothing; its own call tells its PM only.
    expect((await exceptionService.notifyOpened({ orgId: live.org.id, projectId: project.id, exceptions: [elsewhere] })).notified).toBe(0);
    expect((await exceptionService.notifyOpened({ orgId: live.org.id, projectId: project2.id, exceptions: [elsewhere] })).notified).toBe(2);
    expect(await notices(elsewhere)).toEqual([members.pm_b.id, members.split.id].sort());
    // The site engineer, the cost controller and the org PM (not assigned) are never told.
    const told = await prisma.notification.findMany({ where: { orgId: live.org.id, entityType: "project_exception" }, select: { recipientUserId: true } });
    for (const quiet of [members.site.id, members.cost.id, live.user.id]) expect(told.map((n) => n.recipientUserId)).not.toContain(quiet);
  });
});
