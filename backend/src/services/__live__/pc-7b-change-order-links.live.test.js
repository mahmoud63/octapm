/**
 * PC-7b, owner decision R5-5 — a change order's reverse links, proven against
 * a real API process and the real local Postgres.
 *
 * The change-order register and every write's answer carry `relatedRecords`:
 * the activities the order reaches — directly (ChangeOrder.activityId),
 * through an activity link, or only through an allocation link (the BOQ item
 * an allocation maps to the activity) — one row per activity with its
 * strongest relation, and the BOQ items its allocation links name, each with
 * the link that opens its PC-5 drawer. A member who may not read the BOQ gets
 * the direct and activity-link activities, no BOQ item and no
 * allocation-derived activity, and a withheld marker with its reason on every
 * order (never an empty list that reads as "none"). Composing them writes
 * nothing: every change-order, link, budget-revision and contract row is
 * byte-identical before and after the reads. Another organisation is 404.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/pc-7b-change-order-links.live.test.js
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

const RELATED_REASON =
  "BOQ items, and the activities a change order reaches through BOQ allocations, are available only to members who may read the BOQ";
const WITHHELD = { keys: ["boqItems", "activities.via_allocation"], reason: RELATED_REASON };

liveDescribe("PC-7b: a change order's related activities and BOQ items (R5-5)", () => {
  let live;
  let other;
  let api;
  let project;
  const rows = {};
  const acts = {};
  const allocations = {};
  const orders = {};
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const activityHref = (id) => `/o/${live.org.id}/projects/${project.id}/activities?recordId=${id}&source=activity`;
  const boqHref = (id) => `/o/${live.org.id}/projects/${project.id}/boq?recordId=${id}&source=boq_item`;
  const ok = (label, answer, status = 200) => expect([label, answer.status, answer.body?.error]).toEqual([label, status, undefined]);

  const snapshot = async () => {
    const where = { projectId: project.id };
    const [changeOrders, activityLinks, allocationLinks, budgetRevisions, primeContracts, budgetLines, costRecords] = await Promise.all([
      prisma.changeOrder.findMany({ where, orderBy: { id: "asc" } }),
      prisma.changeOrderActivityLink.findMany({ where, orderBy: { id: "asc" } }),
      prisma.changeOrderAllocationLink.findMany({ where, orderBy: { id: "asc" } }),
      prisma.budgetRevision.findMany({ where, orderBy: { id: "asc" } }),
      prisma.primeContract.findMany({ where, orderBy: { id: "asc" } }),
      prisma.budgetLine.findMany({ where, orderBy: { id: "asc" } }),
      prisma.costRecord.findMany({ where, orderBy: { id: "asc" } }),
    ]);
    return JSON.stringify({ changeOrders, activityLinks, allocationLinks, budgetRevisions, primeContracts, budgetLines, costRecords });
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest PC-7b links", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    const member = async (key, role) => {
      const user = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-pc7b-${key.replace(/_/g, "")}-${tag}@octapm-live.test`,
        role,
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role, orgId: live.org.id } });
      const template = await prisma.permissionTemplate.create({
        data: { orgId: live.org.id, name: `LiveTest ${key} ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } },
      });
      await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: user.id, templateId: template.id } });
      members[key] = user;
    };
    // Change-order readers whose templates take the BOQ away.
    await member("cost_noboq", "cost_controller");
    await member("qs_noboq", "qs");

    for (const [key, data] of Object.entries({
      R1: { code: "L7.11", description: "LTSECRET piling", quantity: 40, unit: "m", rate: 31.17 },
      R2: { code: "L7.12", description: "LTSECRET pile caps", quantity: 12, unit: "m3", rate: 88.41 },
    })) {
      const created = await api.post(at("/boq/items"), data, auth());
      ok(`boq ${key}`, created, 201);
      rows[key] = created.body.data.item;
    }
    for (const key of ["A", "B", "C", "D", "E"]) {
      const created = await api.post(at("/activities"), {
        engineerIds: [live.user.id],
        name: `LiveTest activity ${key}-PC7B`,
        activityCode: `P7${key}`,
        duration: 3,
        startDate: "2026-02-02",
        endDate: "2026-02-04",
      }, auth());
      ok(`activity ${key}`, created, 201);
      acts[key] = created.body.data.id;
    }
    // C is mapped to R1, D to R2 — nothing else ties them to an order.
    for (const [key, boqItemId, activityId, quantity] of [["C1", rows.R1.id, acts.C, 40], ["D2", rows.R2.id, acts.D, 12]]) {
      const created = await api.post(at("/activity-boq-allocations"), { boqItemId, activityId, quantity }, auth());
      ok(`allocation ${key}`, created, 201);
      allocations[key] = created.body.data.id;
      for (const step of ["submit", "approve"]) ok(`${key} ${step}`, await api.post(at(`/activity-boq-allocations/${allocations[key]}/${step}`), {}, auth()));
    }

    // 1. A direct activity (the create also records its activity link, 2 days).
    const direct = await api.post(at("/change-orders"), { description: "LiveTest direct", value: 100, activityId: acts.A, scheduleImpact: 2 }, auth());
    ok("direct", direct, 201);
    orders.direct = direct.body.data.id;
    // 2. Only an activity link (no ChangeOrder.activityId): as a legacy or converted order holds it.
    const linkOnly = await prisma.changeOrder.create({
      data: {
        projectId: project.id,
        ref: `VO-LT-${tag}`,
        description: "LiveTest activity link only",
        value: 200,
        activityLinks: { create: [{ projectId: project.id, activityId: acts.B, relationType: "affected", scheduleImpactDays: 4 }] },
      },
    });
    orders.linkOnly = linkOnly.id;
    // 3. Only an allocation link: reaches C through R1's allocation.
    const viaAllocation = await api.post(at("/change-orders"), { description: "LiveTest via allocation", value: 300, allocationLinks: [{ allocationId: allocations.C1, quantity: 2, amount: 62.34 }] }, auth());
    ok("via allocation", viaAllocation, 201);
    orders.viaAllocation = viaAllocation.body.data.id;
    // The create answer reads the links as stored: C is there already.
    expect(viaAllocation.body.data.relatedRecords.activities.map((row) => [row.id, row.relation])).toEqual([[acts.C, "via_allocation"]]);
    // 4. Direct AND an allocation link to the SAME activity D.
    const both = await api.post(at("/change-orders"), { description: "LiveTest both", value: 400, activityId: acts.D, allocationLinks: [{ allocationId: allocations.D2, quantity: 1, amount: 88.41 }] }, auth());
    ok("both", both, 201);
    orders.both = both.body.data.id;
    // 5. Truly none.
    const none = await api.post(at("/change-orders"), { description: "LiveTest none", value: 500 }, auth());
    ok("none", none, 201);
    orders.none = none.body.data.id;
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

  const byId = (list) => Object.fromEntries(list.body.data.orders.map((order) => [order.id, order]));
  const shape = (order) => order.relatedRecords.activities.map((row) => [row.id, row.relation, row.impactDays ?? null]);

  it("a BOQ reader: every authorized relationship, one row per activity, the strongest relation, and the PC-5 drawer links", async () => {
    const list = await api.get(at("/change-orders"), auth());
    ok("list", list);
    const got = byId(list);

    expect(shape(got[orders.direct])).toEqual([[acts.A, "direct", 2]]);
    expect(got[orders.direct].relatedRecords.boqItems).toEqual([]);
    expect(shape(got[orders.linkOnly])).toEqual([[acts.B, "activity_link", 4]]);
    expect(shape(got[orders.viaAllocation])).toEqual([[acts.C, "via_allocation", null]]);
    expect(got[orders.viaAllocation].relatedRecords.boqItems).toEqual([
      { id: rows.R1.id, code: "L7.11", description: "LTSECRET piling", unitCode: rows.R1.unitCode ?? null, relation: "allocation_link", href: boqHref(rows.R1.id) },
    ]);
    // D directly and through its allocation: ONE row, 'direct'.
    expect(shape(got[orders.both])).toEqual([[acts.D, "direct", 0]]);
    expect(got[orders.both].relatedRecords.boqItems.map((row) => row.id)).toEqual([rows.R2.id]);
    expect(got[orders.none].relatedRecords).toEqual({ activities: [], boqItems: [] });

    expect(got[orders.direct].relatedRecords.activities[0]).toEqual({
      id: acts.A, code: "P7A", name: "LiveTest activity A-PC7B", relation: "direct", impactDays: 2, href: activityHref(acts.A),
    });
    expect(got[orders.viaAllocation].relatedRecords.activities[0].href).toBe(activityHref(acts.C));
    for (const order of list.body.data.orders) {
      expect(order.relatedRecords).not.toHaveProperty("boqWithheld");
      const ids = order.relatedRecords.activities.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
    }

    // A write answers with them too.
    const edited = await api.request("PATCH", at(`/change-orders/${orders.both}`), { body: { description: "LiveTest both, edited" }, headers: auth() });
    ok("edit", edited);
    expect(shape(edited.body.data)).toEqual([[acts.D, "direct", 0]]);
    expect(edited.body.data.relatedRecords.boqItems.map((row) => row.id)).toEqual([rows.R2.id]);
  });

  it("the register's reads change no row at all", async () => {
    const before = await snapshot();
    for (let i = 0; i < 2; i += 1) {
      ok("reader", await api.get(at("/change-orders"), auth()));
      ok("non-BOQ", await api.get(at("/change-orders"), as(members.cost_noboq)));
    }
    expect(await snapshot()).toBe(before);
  });

  it("a member without BOQ read: the direct and activity-link activities, no BOQ item, no allocation-derived activity, the marker on every order", async () => {
    for (const key of ["cost_noboq", "qs_noboq"]) {
      expect([key, (await api.get(at("/boq"), as(members[key]))).status]).toEqual([key, 403]);
      const list = await api.get(at("/change-orders"), as(members[key]));
      ok(key, list);
      const got = byId(list);
      for (const order of list.body.data.orders) {
        expect([key, order.ref, order.relatedRecords.boqWithheld]).toEqual([key, order.ref, WITHHELD]);
        expect([key, order.ref, "boqItems" in order.relatedRecords]).toEqual([key, order.ref, false]);
        expect(order.relatedRecords.activities.every((row) => row.relation !== "via_allocation")).toBe(true);
      }
      expect(shape(got[orders.direct])).toEqual([[acts.A, "direct", 2]]);
      expect(shape(got[orders.linkOnly])).toEqual([[acts.B, "activity_link", 4]]);
      // Reached only through an allocation: withheld (with the marker), not "none".
      expect(shape(got[orders.viaAllocation])).toEqual([]);
      // Direct and through an allocation: the direct relationship stays.
      expect(shape(got[orders.both])).toEqual([[acts.D, "direct", 0]]);
      // Nothing of the bill or of C reaches them.
      for (const secret of [rows.R1.id, rows.R2.id, "L7.11", "L7.12", "LTSECRET", acts.C, "activity C-PC7B", allocations.C1, allocations.D2]) {
        expect([key, secret, list.text.includes(secret)]).toEqual([key, secret, false]);
      }
    }

    // A write's answer is withheld the same way.
    const edited = await api.request("PATCH", at(`/change-orders/${orders.viaAllocation}`), { body: { description: "LiveTest via allocation, edited by QS" }, headers: as(members.qs_noboq) });
    ok("qs edit", edited);
    expect(edited.body.data.relatedRecords).toEqual({ activities: [], boqWithheld: WITHHELD });
    expect(edited.text.includes(acts.C)).toBe(false);
  });

  it("another organisation is refused as a missing project", async () => {
    const answer = await api.get(at("/change-orders"), { authorization: `Bearer ${other.token}` });
    expect([answer.status, answer.body.success]).toEqual([404, false]);
    expect(answer.text.includes(acts.A)).toBe(false);
  });
});
