/**
 * PC-7b integration fixer — what a change event raised from a BOQ-derived
 * exception took from that exception (its prefill provenance) is withheld
 * from a change-event reader without boq:read.
 *
 * Item 1: a change event raised from an exception on an ALLOCATION carries
 * the activity the allocation maps to (event.activityId, lines[].activityId)
 * and the cost code of the BOQ item (lines[].costCodeId / costCode). The
 * creation records the prefill's provenance in the creation audit's metadata
 * (metadata.prefillProvenance — no schema change); a reader without boq:read
 * is given none of those fields while they still equal the provenance — on
 * the event, in the list, in a write answer, in the audit history — and the
 * activity drawer never lists the event for that reader by an activity it
 * has only through the provenance. A person who later sets the activity by
 * hand makes it the event's own: visible, and listed in that activity's
 * drawer. An event raised before the provenance was recorded fails closed.
 * The reason is neutral: it never says "BOQ".
 *
 * A real API process (EXCEPTIONS_ENGINE_ENABLED=false), one throwaway
 * "LiveTest <uuid>" organisation; the exception is seeded directly.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run -s test:live -- src/services/__live__/pc-7b-int-change-event-provenance.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("PC-7b integration fixer: a change event's prefill provenance, per reader", () => {
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
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const drawerEvents = async (activityId, headers) => {
    const detail = await api.get(at(`/activities/${activityId}/detail`), headers);
    ok("drawer", detail);
    const section = detail.body.data.sections.changes.changeEvents;
    return { ids: (section.items || []).map((entry) => entry.id), section, body: JSON.stringify(detail.body.data) };
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", EXCEPTIONS_ENGINE_ENABLED: "false" });
    project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-7b fixer provenance", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });
    const member = async (key, role) => {
      const user = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-pc7bfix-${key.replace(/_/g, "")}-${tag}@octapm-live.test`, role });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role, orgId: live.org.id } });
      const template = await prisma.permissionTemplate.create({ data: { orgId: live.org.id, name: `LiveTest fixer ${key} ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } } });
      await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: user.id, templateId: template.id } });
      members[key] = user;
    };
    await member("site_noboq", "site_engineer");
    await member("qs_noboq", "qs");

    const costCode = await prisma.costCode.create({ data: { orgId: live.org.id, code: `LTCC-${tag}`, name: "LiveTest mapped cost code" } });
    await prisma.projectCostCode.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: costCode.id } });
    ids.costCode = costCode.id;
    ids.costCodeCode = costCode.code;
    const item = await api.post(at("/boq/items"), { code: "P1.1", description: "LTSECRET mapped piling", quantity: 40, unit: "m", rate: 31.17 }, pm());
    ok("boq item", item, 201);
    ids.boqItem = item.body.data.item.id;
    await prisma.boqItem.update({ where: { id: ids.boqItem }, data: { costCodeId: costCode.id } });
    const activity = async (code) => {
      const created = await api.post(at("/activities"), { engineerIds: [live.user.id], name: `LiveTest activity ${code}`, activityCode: code, duration: 3, startDate: "2026-02-02", endDate: "2026-02-04" }, pm());
      ok(`activity ${code}`, created, 201);
      return created.body.data.id;
    };
    ids.mapped = await activity("PRVA1");
    ids.other = await activity("PRVB1");
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: ids.boqItem, activityId: ids.mapped, quantity: 40 }, pm());
    ok("allocation", allocation, 201);
    ids.allocation = allocation.body.data.id;
    for (const step of ["submit", "approve"]) ok(`allocation ${step}`, await api.post(at(`/activity-boq-allocations/${ids.allocation}/${step}`), {}, pm()));
    ids.exception = (await prisma.projectException.create({
      data: { orgId: live.org.id, projectId: project.id, kind: "quantity_over_allocation", severity: "critical", subjectType: "allocation", subjectId: ids.allocation, measured: 45, limit: 40, unitCode: "m", measuredBasis: "seeded (measured)", limitBasis: "seeded (limit)" },
    })).id;

    const raised = await api.post(at(`/controls/exceptions/${ids.exception}/raise-change-event`), {}, pm());
    ok("raise", raised, 201);
    ids.event = raised.body.data.changeEvent.id;
    ids.line = raised.body.data.changeEvent.lines[0].id;
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["notification", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent", "projectException"]) await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("the raise stores the mapped activity and the BOQ item's cost code, and records their provenance in the creation audit", async () => {
    const event = await prisma.changeEvent.findUnique({ where: { id: ids.event }, include: { lines: true } });
    expect([event.activityId, event.lines[0].activityId, event.lines[0].costCodeId]).toEqual([ids.mapped, ids.mapped, ids.costCode]);
    const created = await prisma.auditEvent.findFirst({ where: { entityType: "change_event", entityId: ids.event, action: "created" } });
    expect(created.metadataJson).toMatchObject({ sourceBoqDerived: true, prefillProvenance: { activityId: ids.mapped, lines: [{ id: ids.line, activityId: ids.mapped, costCodeId: ids.costCode, quantity: 5, unit: "m" }] } });
  });

  it("a change-event reader without boq:read is given neither the mapped activity nor the cost code — on the event and in the list — with a neutral reason", async () => {
    const one = await api.get(at(`/change-events/${ids.event}`), as(members.site_noboq));
    ok("site get", one);
    const event = one.body.data;
    for (const key of ["activityId", "activity"]) expect([key, has(event, key)]).toEqual([key, false]);
    for (const key of ["activityId", "activity", "costCodeId", "costCode", "quantity", "unit", "unitCost"]) expect([key, has(event.lines[0], key)]).toEqual([key, false]);
    expect(event.lines[0]).toMatchObject({ id: ids.line, romAmount: 0 });
    expect(event.sourceWithheld.keys).toEqual(expect.arrayContaining(["activityId", `lines[${ids.line}].activityId`, `lines[${ids.line}].costCodeId`, `lines[${ids.line}].quantity`, `lines[${ids.line}].unit`, `lines[${ids.line}].unitCost`]));
    expect(event.sourceWithheld.reason).not.toMatch(/BOQ|bill/i);
    const text = JSON.stringify(event);
    for (const secret of [ids.mapped, ids.costCode, ids.costCodeCode, ids.exception, "PRVA1"]) expect([secret, text.includes(secret)]).toEqual([secret, false]);
    const listed = await api.get(at("/change-events"), as(members.site_noboq));
    ok("site list", listed);
    const item = listed.body.data.items.find((row) => row.id === ids.event);
    expect([has(item, "activityId"), has(item, "activity")]).toEqual([false, false]);
    expect(JSON.stringify(listed.body.data)).not.toContain(ids.mapped);
    // The PM reads it as built.
    const full = await api.get(at(`/change-events/${ids.event}`), pm());
    expect([full.body.data.activityId, full.body.data.lines[0].activityId, full.body.data.lines[0].costCodeId]).toEqual([ids.mapped, ids.mapped, ids.costCode]);
    expect(full.body.data).not.toHaveProperty("sourceWithheld");
  });

  it("a write answer is withheld the same way, and the save keeps the stored activity and cost code", async () => {
    const saved = await api.request("PATCH", at(`/change-events/${ids.event}`), { body: { title: "LiveTest QS title" }, headers: as(members.qs_noboq) });
    ok("qs patch", saved);
    expect(has(saved.body.data, "activityId")).toBe(false);
    expect(JSON.stringify(saved.body.data)).not.toContain(ids.mapped);
    const stored = await prisma.changeEvent.findUnique({ where: { id: ids.event }, include: { lines: true } });
    expect([stored.activityId, stored.lines[0].activityId, stored.lines[0].costCodeId]).toEqual([ids.mapped, ids.mapped, ids.costCode]);
  });

  it("the activity drawer does not list the event for that reader by the mapped activity; the PM's does", async () => {
    const site = await drawerEvents(ids.mapped, as(members.site_noboq));
    expect(site.ids).not.toContain(ids.event);
    expect(site.body).not.toContain(ids.event);
    const full = await drawerEvents(ids.mapped, pm());
    expect(full.ids).toContain(ids.event);
  });

  it("the audit history gives that reader no provenance", async () => {
    const auditOf = async (headers) => (await api.get(at(`/audit?entityType=change_event&entityId=${ids.event}&limit=100`), headers)).body.data.events;
    const qs = await auditOf(as(members.qs_noboq));
    const text = JSON.stringify(qs);
    for (const secret of [ids.mapped, ids.costCode]) expect([secret, text.includes(secret)]).toEqual([secret, false]);
    const created = qs.find((event) => event.action === "created");
    expect(created.metadata || {}).not.toHaveProperty("prefillProvenance");
    expect((await auditOf(pm())).find((event) => event.action === "created").metadata.prefillProvenance.activityId).toBe(ids.mapped);
  });

  it("an activity set by hand is the event's own: visible to that reader and listed in that activity's drawer", async () => {
    const full = (await api.get(at(`/change-events/${ids.event}`), pm())).body.data;
    const lines = full.lines.map((line) => ({ id: line.id, description: line.description, activityId: ids.other, costCodeId: line.costCodeId, quantity: line.quantity, unit: line.unit, unitCost: line.unitCost, romAmount: line.romAmount }));
    ok("pm sets the activity", await api.request("PATCH", at(`/change-events/${ids.event}`), { body: { activityId: ids.other, lines }, headers: pm() }));
    const event = (await api.get(at(`/change-events/${ids.event}`), as(members.site_noboq))).body.data;
    expect([event.activityId, event.lines[0].activityId]).toEqual([ids.other, ids.other]);
    // The cost code still equals the provenance: still withheld.
    expect([has(event.lines[0], "costCodeId"), has(event.lines[0], "costCode")]).toEqual([false, false]);
    expect(event.sourceWithheld.keys).not.toContain("activityId");
    expect(event.sourceWithheld.keys).not.toContain(`lines[${ids.line}].activityId`);
    expect((await drawerEvents(ids.other, as(members.site_noboq))).ids).toContain(ids.event);
  });

  it("an event raised before the provenance was recorded fails closed", async () => {
    ok("pm void", await api.post(at(`/change-events/${ids.event}/void`), { reason: "LiveTest void" }, pm()));
    const again = await api.post(at(`/controls/exceptions/${ids.exception}/raise-change-event`), {}, pm());
    ok("raise again", again, 201);
    const legacy = again.body.data.changeEvent.id;
    await prisma.auditEvent.deleteMany({ where: { entityType: "change_event", entityId: legacy, action: "created" } });
    const event = (await api.get(at(`/change-events/${legacy}`), as(members.site_noboq))).body.data;
    expect([has(event, "activityId"), has(event.lines[0], "activityId"), has(event.lines[0], "costCodeId")]).toEqual([false, false, false]);
    expect(JSON.stringify(event)).not.toContain(ids.mapped);
    expect((await drawerEvents(ids.mapped, as(members.site_noboq))).ids).not.toContain(legacy);
    ids.legacy = legacy;
  });

  // Item 2: what a member was not shown is never overwritten by that member's
  // save — a withheld field sent back is refused (409, with the reason), one
  // left out keeps the stored value; a BOQ reader saves as before.
  it("a save by a reader without boq:read that sends a withheld field is refused, and nothing is written", async () => {
    ok("pm void legacy", await api.post(at(`/change-events/${ids.legacy}/void`), { reason: "LiveTest void" }, pm()));
    const raised = await api.post(at(`/controls/exceptions/${ids.exception}/raise-change-event`), {}, pm());
    ok("raise third", raised, 201);
    ids.third = raised.body.data.changeEvent.id;
    ids.thirdLine = raised.body.data.changeEvent.lines[0].id;
    const rowOf = async (id) => JSON.stringify(await prisma.changeEvent.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } } } }));
    const before = await rowOf(ids.third);
    const refusedSave = async (label, body) => {
      const answer = await api.request("PATCH", at(`/change-events/${ids.third}`), { body, headers: as(members.qs_noboq) });
      expect([label, answer.status, answer.body?.error?.code]).toEqual([label, 409, "CHANGE_EVENT_FIELD_WITHHELD"]);
      expect(answer.body.error.message).toMatch(/^Part of this change event is withheld from you/);
      expect(JSON.stringify(answer.body)).not.toContain(ids.mapped);
    };
    const line = { id: ids.thirdLine, description: "LiveTest QS line", romAmount: 120 };
    await refusedSave("quantity 0 and unit null (what the web dialog sent)", { lines: [{ ...line, quantity: 0, unit: null, unitCost: 0 }] });
    await refusedSave("the line's activity cleared", { lines: [{ ...line, activityId: null }] });
    await refusedSave("the line's cost code cleared", { lines: [{ ...line, costCodeId: null }] });
    await refusedSave("the event's activity cleared", { activityId: null });
    expect(await rowOf(ids.third)).toBe(before);
  });

  it("a save that leaves the withheld fields out keeps every stored one; a BOQ reader still sets them", async () => {
    const saved = await api.request("PATCH", at(`/change-events/${ids.third}`), { body: { title: "LiveTest QS saves", lines: [{ id: ids.thirdLine, description: "LiveTest QS line", romAmount: 120 }] }, headers: as(members.qs_noboq) });
    ok("qs save", saved);
    expect(saved.body.data.lines[0]).toMatchObject({ id: ids.thirdLine, description: "LiveTest QS line", romAmount: 120 });
    const stored = await prisma.changeEvent.findUnique({ where: { id: ids.third }, include: { lines: true } });
    expect([stored.activityId, stored.lines[0].activityId, stored.lines[0].costCodeId, stored.lines[0].quantity, stored.lines[0].unit, Number(stored.lines[0].unitCost), Number(stored.lines[0].romAmount)]).toEqual([ids.mapped, ids.mapped, ids.costCode, 5, "m", 0, 120]);
    const pmSave = await api.request("PATCH", at(`/change-events/${ids.third}`), { body: { lines: [{ id: ids.thirdLine, description: "LiveTest PM line", activityId: ids.mapped, costCodeId: ids.costCode, quantity: 6, unit: "m", unitCost: 10 }] }, headers: pm() });
    ok("pm save", pmSave);
    const after = await prisma.changeEventLine.findUnique({ where: { id: ids.thirdLine } });
    expect([after.quantity, Number(after.unitCost), Number(after.romAmount)]).toEqual([6, 10, 60]);
  });

  // Item 3: the vendor portal shows a line's quantity, unit and activity; a
  // sender without boq:read may not send an external party a line whose
  // figures were withheld from them — 409 CHANGE_EVENT_LINE_WITHHELD with the
  // reason, nothing written. Lines of their own go; a BOQ reader is unaffected.
  it("an RFQ by a sender without boq:read that includes a withheld line is refused; their own lines go; a BOQ reader sends it", async () => {
    ok("pm void third", await api.post(at(`/change-events/${ids.third}/void`), { reason: "LiveTest void" }, pm()));
    const raised = await api.post(at(`/controls/exceptions/${ids.exception}/raise-change-event`), {}, pm());
    ok("raise fourth", raised, 201);
    const event = raised.body.data.changeEvent;
    const withheldLine = event.lines[0];
    // A line the PM adds by hand: the event's own, nothing withheld.
    const own = await api.request("PATCH", at(`/change-events/${event.id}`), {
      body: { lines: [{ id: withheldLine.id, description: withheldLine.description, activityId: withheldLine.activityId, costCodeId: withheldLine.costCodeId, quantity: withheldLine.quantity, unit: withheldLine.unit, unitCost: withheldLine.unitCost }, { description: "LiveTest own scope", quantity: 2, unit: "nr", unitCost: 15 }] },
      headers: pm(),
    });
    ok("pm adds a line", own);
    const ownLine = own.body.data.lines.find((line) => line.description === "LiveTest own scope");
    const recipients = [{ companyName: "LiveTest Vendor", contactEmail: `vendor-${tag}@octapm-live.test` }];
    const rfqCount = () => prisma.rfq.count({ where: { changeEventId: event.id } });
    const send = (headers, body) => api.post(at(`/change-events/${event.id}/rfqs`), { recipients, ...body }, headers);
    for (const [label, body] of [["the withheld line", { lineIds: [withheldLine.id] }], ["all lines", {}], ["both lines", { lineIds: [withheldLine.id, ownLine.id] }]]) {
      const refused = await send(as(members.qs_noboq), body);
      expect([label, refused.status, refused.body?.error?.code]).toEqual([label, 409, "CHANGE_EVENT_LINE_WITHHELD"]);
      expect(refused.body.error.message).toMatch(/Part of this change event is withheld from you/);
    }
    expect(await rfqCount()).toBe(0);
    expect((await prisma.changeEvent.findUnique({ where: { id: event.id } })).status).toBe("open");
    // Their own line goes, and the vendor's portal shows only it.
    const sent = await send(as(members.qs_noboq), { lineIds: [ownLine.id] });
    ok("qs sends their own line", sent, 201);
    expect(sent.body.data.rfqs[0].lineIds).toEqual([ownLine.id]);
    const token = new URL(sent.body.data.rfqs[0].portalUrl).pathname.split("/").pop();
    const portal = await api.get(`/api/v1/public/rfqs/${token}`);
    ok("portal", portal);
    expect(portal.body.data.changeEvent.lines.map((line) => line.id)).toEqual([ownLine.id]);
    // A BOQ reader sends the withheld line as before.
    const pmSent = await api.post(at(`/change-events/${event.id}/rfqs`), { recipients: [{ companyName: "LiveTest Vendor 2", contactEmail: `vendor2-${tag}@octapm-live.test` }], lineIds: [withheldLine.id] }, pm());
    ok("pm sends the withheld line", pmSent, 201);
  });

  // Second fixer, item 7: the web dialog never shows or sends a line's notes
  // or budget line. A kept line whose body leaves a field out keeps the
  // stored value — for every member, on any event; an explicit null still
  // clears it, and a new line starts empty.
  it("a save that leaves a kept line's notes or budget line out keeps them; null clears; a new line starts empty", async () => {
    const budgetLine = await prisma.budgetLine.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: ids.costCode, costType: "material", description: "LiveTest kept budget line" } });
    const created = await api.post(at("/change-events"), { title: "LiveTest kept notes", type: "owner_change", origin: "manual", lines: [{ description: "LiveTest noted line", costCodeId: ids.costCode, budgetLineId: budgetLine.id, quantity: 2, unit: "nr", unitCost: 50, notes: "LiveTest chk note" }] }, pm());
    ok("pm creates", created, 201);
    const event = created.body.data;
    const lineId = event.lines[0].id;
    const stored = () => prisma.changeEventLine.findMany({ where: { changeEventId: event.id }, orderBy: { sortOrder: "asc" } });
    expect((await stored()).map((line) => [line.notes, line.budgetLineId])).toEqual([["LiveTest chk note", budgetLine.id]]);
    // The exact body the web dialog sends for a line it was given in full.
    const dialogLine = { id: lineId, description: "LiveTest noted line", commitmentId: null, costCodeId: ids.costCode, activityId: null, quantity: 2, unit: "nr", unitCost: 50 };
    for (const [label, headers] of [["no-BOQ QS", as(members.qs_noboq)], ["PM", pm()]]) {
      const saved = await api.request("PATCH", at(`/change-events/${event.id}`), { body: { title: `LiveTest kept notes ${label}`, lines: [dialogLine] }, headers });
      ok(`${label} dialog save`, saved);
      expect([label, (await stored()).map((line) => [line.notes, line.budgetLineId, line.costCodeId, line.quantity, Number(line.romAmount)])]).toEqual([label, [["LiveTest chk note", budgetLine.id, ids.costCode, 2, 100]]]);
    }
    const cleared = await api.request("PATCH", at(`/change-events/${event.id}`), { body: { lines: [{ ...dialogLine, notes: null, budgetLineId: null }, { description: "LiveTest new line", quantity: 1, unitCost: 5 }] }, headers: pm() });
    ok("pm clears", cleared);
    expect((await stored()).map((line) => [line.description, line.notes, line.budgetLineId])).toEqual([["LiveTest noted line", null, null], ["LiveTest new line", null, null]]);
  });

  // Third fixer, item 1: a BOQ-derived field stays withheld until a person who
  // may read it ADOPTS it by an explicit act. Converting the event to a change
  // order, and accepting a commitment vendor's quote with a commitment change
  // order, copy the event's activity and its lines' activity / cost code into
  // a commercial record — so a caller without boq:read is refused (409
  // CHANGE_EVENT_FIELD_WITHHELD, the neutral reason, nothing written) while
  // the event still carries a withheld field; a BOQ reader's act proceeds and
  // the copied values are the new record's own.
  it("convert and accept-with-commitment-change-order are refused to a caller without boq:read while fields are withheld; a BOQ reader adopts them", async () => {
    const live4 = await prisma.changeEvent.findFirst({ where: { projectId: project.id, exceptionId: ids.exception, status: { notIn: ["void", "closed"] } } });
    ok("pm void fourth", await api.post(at(`/change-events/${live4.id}/void`), { reason: "LiveTest void" }, pm()));
    const raised = await api.post(at(`/controls/exceptions/${ids.exception}/raise-change-event`), {}, pm());
    ok("raise fifth", raised, 201);
    const event = raised.body.data.changeEvent;
    const line = event.lines[0];
    const commitment = await prisma.commitment.create({ data: { orgId: live.org.id, projectId: project.id, number: 1, ref: `SC-ADOPT-${tag}`, title: "LiveTest adoption subcontract", type: "subcontract", status: "executed" } });
    const sent = await api.post(at(`/change-events/${event.id}/rfqs`), { recipients: [{ commitmentId: commitment.id, companyName: "LiveTest Sub", contactEmail: `sub-${tag}@octapm-live.test` }], lineIds: [line.id] }, pm());
    ok("pm sends the rfq", sent, 201);
    const rfq = sent.body.data.rfqs[0];
    const token = new URL(rfq.portalUrl).pathname.split("/").pop();
    ok("vendor quotes", await api.request("PUT", `/api/v1/public/rfqs/${token}/quote`, { body: { lines: [{ lineId: line.id, amount: 300 }] } }));

    const footprint = async () => JSON.stringify({
      changeOrders: await prisma.changeOrder.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }),
      activityLinks: await prisma.changeOrderActivityLink.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }),
      commitmentChangeOrders: await prisma.commitmentChangeOrder.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }),
      budgetRevisions: await prisma.budgetRevision.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }),
      event: await prisma.changeEvent.findUnique({ where: { id: event.id }, include: { lines: { orderBy: { sortOrder: "asc" } } } }),
      rfqs: await prisma.rfq.findMany({ where: { changeEventId: event.id }, orderBy: { id: "asc" } }),
    });
    const before = await footprint();
    const refused = async (label, answer) => {
      expect([label, answer.status, answer.body?.error?.code]).toEqual([label, 409, "CHANGE_EVENT_FIELD_WITHHELD"]);
      expect(answer.body.error.message).toMatch(/^Part of this change event is withheld from you/);
      expect(answer.body.error.message).not.toMatch(/BOQ|bill/i);
      for (const secret of [ids.mapped, ids.costCode]) expect([label, secret, JSON.stringify(answer.body).includes(secret)]).toEqual([label, secret, false]);
    };
    await refused("qs accepts with a commitment change order", await api.post(at(`/change-events/rfqs/${rfq.id}/accept`), { createCommitmentChangeOrder: true }, as(members.qs_noboq)));
    await refused("qs converts", await api.post(at(`/change-events/${event.id}/convert`), {}, as(members.qs_noboq)));
    await refused("qs converts without commitment change orders", await api.post(at(`/change-events/${event.id}/convert`), { includeCommitmentChangeOrders: false }, as(members.qs_noboq)));
    expect(await footprint()).toBe(before);

    // A BOQ reader's acceptance and conversion proceed: the activity and cost
    // code become the commercial records' own.
    const accepted = await api.post(at(`/change-events/rfqs/${rfq.id}/accept`), { createCommitmentChangeOrder: true }, pm());
    ok("pm accepts", accepted);
    const cco = await prisma.commitmentChangeOrder.findUnique({ where: { id: accepted.body.data.commitmentChangeOrder.id } });
    expect(cco.linesJson).toEqual([expect.objectContaining({ activityId: ids.mapped, costCodeId: ids.costCode, amount: 300 })]);
    const converted = await api.post(at(`/change-events/${event.id}/convert`), {}, pm());
    ok("pm converts", converted, 201);
    const orderId = converted.body.data.changeOrder.id;
    expect((await prisma.changeOrder.findUnique({ where: { id: orderId } })).activityId).toBe(ids.mapped);
    expect((await prisma.changeOrderActivityLink.findMany({ where: { changeOrderId: orderId } })).map((link) => link.activityId)).toEqual([ids.mapped]);
    const register = async (headers) => {
      const listed = await api.get(at("/change-orders"), headers);
      ok("change-order register", listed);
      return listed.body.data.orders.find((order) => order.id === orderId);
    };
    // A change-order reader with BOQ read sees the order's activity.
    expect((await register(pm())).activityId).toBe(ids.mapped);
    // Adoption: the order is a commercial record an authorized person created;
    // its activity follows the change-order permissions (a change-order reader
    // without boq:read sees it too — documented in §2, the owner may reverse it).
    expect((await register(as(members.qs_noboq))).activityId).toBe(ids.mapped);
  });

  // Third fixer, item 2: a stored figure a member was not shown is never
  // removed by that member. A save without boq:read that would delete a line
  // carrying a withheld field — by leaving it out of `lines` — is refused (409
  // CHANGE_EVENT_LINE_WITHHELD, "cannot be removed by you"), and so is deleting
  // the whole event (409 CHANGE_EVENT_FIELD_WITHHELD); nothing is written. Lines
  // of their own come and go; a BOQ reader removes the line as before.
  it("a caller without boq:read cannot remove a line carrying withheld fields, nor delete the event; a BOQ reader can", async () => {
    const exception = await prisma.projectException.create({
      data: { orgId: live.org.id, projectId: project.id, kind: "quantity_over_boq", severity: "critical", subjectType: "boq_item", subjectId: ids.boqItem, measured: 45, limit: 40, unitCode: "m", measuredBasis: "seeded (measured)", limitBasis: "seeded (limit)" },
    });
    const raised = await api.post(at(`/controls/exceptions/${exception.id}/raise-change-event`), {}, pm());
    ok("raise from the BOQ item", raised, 201);
    const event = raised.body.data.changeEvent;
    const line = event.lines[0];
    expect([line.costCodeId, line.quantity, line.unit]).toEqual([ids.costCode, 5, "m"]);
    const rowOf = async () => JSON.stringify(await prisma.changeEvent.findUnique({ where: { id: event.id }, include: { lines: { orderBy: { sortOrder: "asc" } } } }));
    const before = await rowOf();
    for (const [label, lines] of [["no lines", []], ["only a new line", [{ description: "LiveTest QS replacement", quantity: 1, unitCost: 5 }]]]) {
      const refused = await api.request("PATCH", at(`/change-events/${event.id}`), { body: { title: "LiveTest QS removes", lines }, headers: as(members.qs_noboq) });
      expect([label, refused.status, refused.body?.error?.code]).toEqual([label, 409, "CHANGE_EVENT_LINE_WITHHELD"]);
      expect(refused.body.error.message).toMatch(/^Part of this change event is withheld from you/);
      expect(refused.body.error.message).toMatch(/cannot be removed by you/);
    }
    const deleted = await api.request("DELETE", at(`/change-events/${event.id}`), { headers: as(members.qs_noboq) });
    expect([deleted.status, deleted.body?.error?.code]).toEqual([409, "CHANGE_EVENT_FIELD_WITHHELD"]);
    expect(deleted.body.error.message).toMatch(/^Part of this change event is withheld from you/);
    expect(await rowOf()).toBe(before);
    // Their own line comes and goes; the withheld line stays as stored.
    const kept = { id: line.id, description: line.description };
    const added = await api.request("PATCH", at(`/change-events/${event.id}`), { body: { lines: [kept, { description: "LiveTest QS own line", quantity: 1, unitCost: 5 }] }, headers: as(members.qs_noboq) });
    ok("qs adds a line", added);
    ok("qs removes its own line", await api.request("PATCH", at(`/change-events/${event.id}`), { body: { lines: [kept] }, headers: as(members.qs_noboq) }));
    const stored = await prisma.changeEventLine.findMany({ where: { changeEventId: event.id } });
    expect(stored.map((row) => [row.id, row.costCodeId, row.quantity, row.unit])).toEqual([[line.id, ids.costCode, 5, "m"]]);
    // A BOQ reader removes it.
    ok("pm removes the line", await api.request("PATCH", at(`/change-events/${event.id}`), { body: { lines: [] }, headers: pm() }));
    expect(await prisma.changeEventLine.count({ where: { changeEventId: event.id } })).toBe(0);
  });
});
