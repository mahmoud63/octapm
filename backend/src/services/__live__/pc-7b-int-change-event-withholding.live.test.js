/**
 * PC-7b integration (item L) — a change event raised from a BOQ-derived
 * exception is the commercial module's record, readable by change-event
 * readers who may not read the BOQ. Such a reader is given neither the
 * exception it names (the typed link, the source pair and its path) nor what
 * came from it onto the lines (the quantity delta, its unit and the unit
 * cost), with the reason — in every change-event read and write answer and in
 * the audit history — and the event's words never name the kind: the
 * prefilled title and description are generic for a BOQ-derived kind. A PM
 * (a BOQ reader) reads the event as built. A change event raised from an
 * exception that is not BOQ-derived keeps its link for everyone.
 *
 * A real API process (EXCEPTIONS_ENGINE_ENABLED=false), one throwaway
 * "LiveTest <uuid>" organisation; the exceptions are seeded directly.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run -s test:live -- src/services/__live__/pc-7b-int-change-event-withholding.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("PC-7b integration L: change events raised from a BOQ-derived exception, per reader", () => {
  let live;
  let api;
  let project;
  const ids = {};
  const members = {};
  const tag = Date.now();
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const pm = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (label, answer, status = 200) => expect([label, answer.status, answer.body?.error]).toEqual([label, status, undefined]);
  const KIND_WORDS = /Installed quantity over the allocation|quantity_over_allocation/;

  const seedException = (data) =>
    prisma.projectException.create({ data: { orgId: live.org.id, projectId: project.id, measuredBasis: "seeded: owner basis (measured)", limitBasis: "seeded: owner basis (limit)", ...data } });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", EXCEPTIONS_ENGINE_ENABLED: "false" });
    project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-7b int change events", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });
    const member = async (key, role) => {
      const user = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-pc7bint-l-${key.replace(/_/g, "")}-${tag}@octapm-live.test`, role });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role, orgId: live.org.id } });
      const template = await prisma.permissionTemplate.create({ data: { orgId: live.org.id, name: `LiveTest L ${key} ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } } });
      await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: user.id, templateId: template.id } });
      members[key] = user;
    };
    await member("site_noboq", "site_engineer");
    await member("qs_noboq", "qs");

    const item = await api.post(at("/boq/items"), { code: "L7.1", description: "LTSECRET piling", quantity: 40, unit: "m", rate: 31.17 }, pm());
    ok("boq item", item, 201);
    ids.boqItem = item.body.data.item.id;
    const activity = await api.post(at("/activities"), { engineerIds: [live.user.id], name: "LiveTest activity L7", activityCode: "L7A1", duration: 3, startDate: "2026-02-02", endDate: "2026-02-04" }, pm());
    ok("activity", activity, 201);
    ids.activity = activity.body.data.id;
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: ids.boqItem, activityId: ids.activity, quantity: 40 }, pm());
    ok("allocation", allocation, 201);
    ids.allocation = allocation.body.data.id;
    for (const step of ["submit", "approve"]) ok(`allocation ${step}`, await api.post(at(`/activity-boq-allocations/${ids.allocation}/${step}`), {}, pm()));
    const costCode = await prisma.costCode.create({ data: { orgId: live.org.id, code: `LT7L-${tag}`, name: "LiveTest piling" } });
    await prisma.projectCostCode.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: costCode.id } });
    ids.budgetLine = (await prisma.budgetLine.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: costCode.id, description: "LiveTest piling works" } })).id;

    ids.boqException = (await seedException({ kind: "quantity_over_allocation", severity: "critical", subjectType: "allocation", subjectId: ids.allocation, measured: 45, limit: 40, unitCode: "m" })).id;
    ids.moneyException = (await seedException({ kind: "committed_over_budget", severity: "warning", subjectType: "budget_line", subjectId: ids.budgetLine, measured: 1200, limit: 1000 })).id;
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["notification", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent", "projectException"]) await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("the prefill and the raised event of a BOQ-derived exception carry generic words; the kind is named only by the typed link", async () => {
    const prefill = await api.get(at(`/controls/exceptions/${ids.boqException}/change-event-prefill`), pm());
    ok("prefill", prefill);
    expect(prefill.body.data.prefill).toMatchObject({ title: "Raised from a project controls exception", description: "Raised from a project controls exception. The amount is left for the QS to price." });
    expect(JSON.stringify(prefill.body.data.prefill)).not.toMatch(KIND_WORDS);
    const raised = await api.post(at(`/controls/exceptions/${ids.boqException}/raise-change-event`), {}, pm());
    ok("raise", raised, 201);
    const event = raised.body.data.changeEvent;
    ids.boqEvent = event.id;
    ids.boqLine = event.lines[0].id;
    expect(event).toMatchObject({ title: "Raised from a project controls exception", origin: "exception", sourceRecordType: "project_exception", sourceRecordId: ids.boqException });
    expect(event.sourceLinks).toEqual([{ type: "project_exception", id: ids.boqException, path: null }]);
    expect(event.lines[0]).toMatchObject({ description: "Raised from a project controls exception", quantity: 5, unit: "m", unitCost: 0 });
    expect(JSON.stringify(event)).not.toMatch(KIND_WORDS);
    expect(JSON.stringify(event)).not.toMatch(/LTSECRET|L7\.1/);
    // A money (not BOQ-derived) exception keeps its words.
    const money = await api.post(at(`/controls/exceptions/${ids.moneyException}/raise-change-event`), {}, pm());
    ok("raise money", money, 201);
    ids.moneyEvent = money.body.data.changeEvent.id;
    expect(money.body.data.changeEvent.title).toMatch(/^Committed over the revised budget/);
  });

  it("a change-event reader without boq:read is given neither the exception nor the line's quantity, unit and unit cost — on the event, in the list — with the reason", async () => {
    const one = await api.get(at(`/change-events/${ids.boqEvent}`), as(members.site_noboq));
    ok("site get", one);
    const event = one.body.data;
    expect([event.sourceLinks, event.sourceRecordType, event.sourceRecordId, event.sourcePath]).toEqual([[], null, null, null]);
    expect(event.sourceWithheld.reason).toMatch(/available only to members who may read the BOQ/);
    expect(event.lines).toHaveLength(1);
    for (const key of ["quantity", "unit", "unitCost"]) expect([key, Object.prototype.hasOwnProperty.call(event.lines[0], key)]).toEqual([key, false]);
    expect(event.lines[0]).toMatchObject({ id: ids.boqLine, activityId: ids.activity, romAmount: 0 });
    expect(JSON.stringify(event)).not.toContain(ids.boqException);
    expect(JSON.stringify(event)).not.toMatch(KIND_WORDS);
    const listed = await api.get(at("/change-events"), as(members.site_noboq));
    ok("site list", listed);
    const item = listed.body.data.items.find((row) => row.id === ids.boqEvent);
    expect([item.sourceLinks, item.sourceRecordType, item.sourceRecordId]).toEqual([[], null, null]);
    expect(JSON.stringify(listed.body.data)).not.toContain(ids.boqException);
    // The PM reads it as built.
    const full = await api.get(at(`/change-events/${ids.boqEvent}`), pm());
    expect(full.body.data.sourceLinks).toEqual([{ type: "project_exception", id: ids.boqException, path: null }]);
    expect(full.body.data.lines[0]).toMatchObject({ quantity: 5, unit: "m" });
    expect(full.body.data).not.toHaveProperty("sourceWithheld");
    // A change event raised from a money exception keeps its link for the same reader.
    const money = await api.get(at(`/change-events/${ids.moneyEvent}`), as(members.site_noboq));
    expect(money.body.data.sourceLinks).toEqual([{ type: "project_exception", id: ids.moneyException, path: null }]);
  });

  it("a write answer is withheld the same way, and saving the line without the withheld fields keeps the stored quantity, unit and unit cost", async () => {
    const saved = await api.request("PATCH", at(`/change-events/${ids.boqEvent}`), { body: { title: "LiveTest QS title", lines: [{ id: ids.boqLine, description: "LiveTest priced line", romAmount: 250 }] }, headers: as(members.qs_noboq) });
    ok("qs patch", saved);
    expect(saved.body.data.title).toBe("LiveTest QS title");
    expect(saved.body.data.sourceLinks).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(saved.body.data.lines[0], "quantity")).toBe(false);
    expect(JSON.stringify(saved.body.data)).not.toContain(ids.boqException);
    const stored = await prisma.changeEventLine.findUnique({ where: { id: ids.boqLine } });
    expect([Number(stored.quantity), stored.unit, Number(stored.unitCost), Number(stored.romAmount), stored.description]).toEqual([5, "m", 0, 250, "LiveTest priced line"]);
    const closed = await api.post(at(`/change-events/${ids.boqEvent}/void`), { reason: "LiveTest void" }, pm());
    ok("pm void", closed);
    expect(closed.body.data.sourceLinks).toHaveLength(1);
  });

  it("the audit history: the event's creation names the exception to the PM only", async () => {
    const auditOf = async (headers) => (await api.get(at(`/audit?entityType=change_event&entityId=${ids.boqEvent}&limit=100`), headers)).body.data.events;
    const pmEvents = await auditOf(pm());
    const created = pmEvents.find((event) => event.action === "created");
    expect(created.summary.sourceLinks).toEqual({ exceptionId: ids.boqException });
    expect(created.metadata).toMatchObject({ sourceBoqDerived: true });
    const qsEvents = await auditOf(as(members.qs_noboq));
    expect(qsEvents.length).toBe(pmEvents.length);
    expect(JSON.stringify(qsEvents)).not.toContain(ids.boqException);
    expect(qsEvents.find((event) => event.action === "created").boqWithheld.reason).toMatch(/available only to members who may read the BOQ/);
    // The money exception's event keeps its link in the history too.
    const money = (await api.get(at(`/audit?entityType=change_event&entityId=${ids.moneyEvent}&limit=100`), as(members.qs_noboq))).body.data.events.find((event) => event.action === "created");
    expect(money.summary.sourceLinks).toEqual({ exceptionId: ids.moneyException });
  });

  it("an event naming an exception id the project does not have is withheld too (fail closed)", async () => {
    const exceptionService = require("../exception.service");
    const ghost = crypto.randomUUID();
    const set = await exceptionService.boqDerivedExceptionIds({ orgId: live.org.id, projectId: project.id, ids: [ghost, ids.moneyException] });
    expect([set.has(ghost), set.has(ids.moneyException)]).toEqual([true, false]);
  });
});
