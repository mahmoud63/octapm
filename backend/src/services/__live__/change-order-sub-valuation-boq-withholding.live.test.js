/**
 * A change order's and a sub valuation's allocation links carry no BOQ row
 * and no allocation to a member who may not read the BOQ — proven against a
 * real API process and the real local Postgres (owner decision 5,
 * 2026-09-29).
 *
 * GET /projects/:id/change-orders (change_order:read) and GET
 * /projects/:id/sub-valuations (sub_pay_app:read), and the answers to
 * creating, editing, submitting, approving, rejecting and reopening a change
 * order and to editing a valuation, returned each allocation link with the
 * BoqItem row it points at (id, code, ref, description, unit, qty, rate,
 * amount) and its ActivityBoqAllocation (id, quantity, amount, weight,
 * status, the row again, its activity) — checking only the commercial
 * permission. Members whose templates set the BOQ tool to none (refused GET
 * /boq) now receive:
 *
 *   each link without `boqItem`, `allocation`, `boqItemId` and
 *   `allocationId`, and `boqWithheld: { keys, reason }` in their place;
 *   the link's own quantity and amount (a change order's), its quantity,
 *   work done, materials on site and retention (a valuation's), and every
 *   figure of the record itself, exactly as the BOQ reader receives them;
 *   and the workflow still works for them — creating, editing, submitting,
 *   approving, rejecting and reopening.
 *
 * The BOQ reader receives the service's answer byte for byte. The BOQ tool
 * alone opens neither register, and a member of another organisation, or of
 * this one but not of the project, is refused as before.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/change-order-sub-valuation-boq-withholding.live.test.js
 */
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { normalizeMoneyTree } = require("../../utils/money");
const changeOrderService = require("../change-order.service");
const subValuationService = require("../sub-valuation.service");
const { startApi } = require("./auth-live-kit");

const REASON = "The linked BOQ row and its allocation are available only to members who may read the BOQ";
const LINK_BOQ_KEYS = ["allocationId", "boqItemId", "allocation", "boqItem"];

const RELATED_REASON =
  "BOQ items, and the activities a change order reaches through BOQ allocations, are available only to members who may read the BOQ";

// A record as a member without BOQ read must receive it: each allocation
// link less the keys that are the bill's, and (a change order, PC-7b) its
// related records without the BOQ items and the allocation-derived
// activities, the rest untouched.
const withoutBoq = (record) => ({
  ...record,
  allocationLinks: record.allocationLinks.map((link) => {
    const keys = LINK_BOQ_KEYS.filter((key) => key in link);
    const kept = Object.fromEntries(Object.entries(link).filter(([key]) => !keys.includes(key)));
    return { ...kept, boqWithheld: { keys, reason: REASON } };
  }),
  ...("relatedRecords" in record
    ? {
        relatedRecords: {
          activities: record.relatedRecords.activities.filter((entry) => entry.relation !== "via_allocation"),
          boqWithheld: { keys: ["boqItems", "activities.via_allocation"], reason: RELATED_REASON },
        },
      }
    : {}),
});

liveDescribe("Change-order and sub-valuation allocation links carry no BOQ row to a member who may not read the BOQ", () => {
  let live;
  let other;
  let api;
  let project;
  let row;
  let activityId;
  let allocationId;
  let valuationId;
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;

  // What must not reach them: the row's id, code, ref, description, rate and
  // amount (29 × 613.37), the allocation's id and amount.
  const secrets = () => [row.id, allocationId, "Z8.41", "COSECRET", "613.37", "17787.73"];
  const expectNoSecrets = (label, answer) => {
    for (const secret of secrets()) {
      expect([label, secret, answer.text.includes(secret)]).toEqual([label, secret, false]);
    }
  };
  const expectLinksWithheld = (label, record) => {
    expect([label, record.allocationLinks.length > 0]).toEqual([label, true]);
    for (const link of record.allocationLinks) {
      for (const key of LINK_BOQ_KEYS) expect([label, key, key in link]).toEqual([label, key, false]);
      expect([label, link.boqWithheld]).toEqual([label, { keys: LINK_BOQ_KEYS, reason: REASON }]);
    }
  };

  const changeOrderBody = (description) => ({
    description,
    category: "variation",
    value: 4321.09,
    scheduleImpactSummary: "LiveTest two days",
    costImpactSummary: "LiveTest priced",
    activityLinks: [{ activityId, relationType: "affected", scheduleImpactDays: 2 }],
    allocationLinks: [{ allocationId, quantity: 7, amount: 1234.56, notes: "LiveTest link note" }],
    attachmentRefs: [{ fileName: "LiveTest proof.pdf", fileUrl: "https://example.test/proof.pdf" }],
  });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest change orders", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    const member = async (key, role, tools) => {
      const user = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-colinks-${key.replace(/_/g, "")}-${tag}@octapm-live.test`,
        role,
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role, orgId: live.org.id } });
      if (tools) {
        const template = await prisma.permissionTemplate.create({
          data: { orgId: live.org.id, name: `LiveTest ${key} ${tag}`, baseRole: role, tools: { create: tools } },
        });
        await prisma.projectUserPermission.create({
          data: { orgId: live.org.id, projectId: project.id, userId: user.id, templateId: template.id },
        });
      }
      members[key] = user;
      return user;
    };
    const noBoq = [{ module: "boq", level: "none" }];
    // The commercial readers — each keeps its role's change-order and/or
    // valuation access; the template takes the BOQ tool away.
    for (const role of ["qs", "cost_controller", "finance", "pm", "planning_engineer", "procurement"]) {
      await member(role, role, noBoq);
    }
    // A QS with both permissions (no template).
    await member("qs_full", "qs", null);
    // The BOQ tool without either register.
    await member("site_engineer", "site_engineer", null);
    await member("qs_boq_only", "qs", [
      { module: "change_order", level: "none" },
      { module: "sub_pay_app", level: "none" },
    ]);
    // In the organisation, not on the project.
    members.unassigned = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest unassigned",
      email: `live-colinks-unassigned-${tag}@octapm-live.test`,
      role: "qs",
    });

    // One priced row with figures nothing else in these answers produces.
    const created = await api.post(at("/boq/items"), { code: "Z8.41", description: "COSECRET structural steel", quantity: 29, unit: "t", rate: 613.37 }, auth());
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    row = created.body.data.item;

    const activity = await api.post(at("/activities"), {
      engineerIds: [live.user.id],
      name: "Erect steel",
      activityCode: "A910",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    expect([activity.status, activity.body?.error]).toEqual([201, undefined]);
    activityId = activity.body.data.id;
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: row.id, activityId, quantity: 29 }, auth());
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    allocationId = allocation.body.data.id;
    for (const step of ["submit", "approve"]) {
      const moved = await api.post(at(`/activity-boq-allocations/${allocationId}/${step}`), {}, auth());
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }

    // A legacy valuation (new ones are refused: SUB_VALUATION_RETIRED) with
    // one allocation link, as the module held them before retirement.
    const valuation = await prisma.subValuation.create({
      data: {
        projectId: project.id,
        ref: `SV-LIVE-${tag}`,
        subcontractor: "LiveTest Steel Ltd",
        period: "2026-02",
        workDone: 5000,
        materialsOnSite: 400,
        grossPayable: 5400,
        retentionRate: 5,
        retention: 270,
        netPayable: 5130,
        allocationLinks: {
          create: [{ projectId: project.id, allocationId, boqItemId: row.id, quantity: 5, workDoneAmount: 2222.22, materialsOnSiteAmount: 333.33, retentionAmount: 127.78, notes: "LiveTest valuation link" }],
        },
      },
    });
    valuationId = valuation.id;
  }, 120_000);

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

  let readerOrder;

  it("B — a member with both permissions receives the change-order and valuation lists byte for byte as the service builds them", async () => {
    const created = await api.post(at("/change-orders"), changeOrderBody("LiveTest CO by the BOQ reader"), auth());
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    // The create answer is the row as inserted, before its links are
    // written (unchanged here); the register carries them.
    expect(created.body.data.allocationLinks).toEqual([]);
    readerOrder = (await api.get(at("/change-orders"), auth())).body.data.orders.find((order) => order.id === created.body.data.id);
    expect(readerOrder.allocationLinks.map((link) => [link.allocationId, link.boqItemId, link.boqItem.code, link.boqItem.description, link.boqItem.rate, link.allocation.id, link.allocation.amount, link.quantity, link.amount])).toEqual([
      [allocationId, row.id, "Z8.41", "COSECRET structural steel", 613.37, allocationId, 17787.73, 7, 1234.56],
    ]);
    expect(readerOrder.allocationLinks[0]).not.toHaveProperty("boqWithheld");
    // A write answers a BOQ reader with the row and the allocation.
    const edited = await api.request("PATCH", at(`/change-orders/${readerOrder.id}`), { body: { description: "LiveTest CO by the BOQ reader, edited" }, headers: as(members.qs_full) });
    expect([edited.status, edited.body.data.allocationLinks[0].boqItem.code, edited.body.data.allocationLinks[0].allocation.id, edited.body.data.allocationLinks[0].boqWithheld]).toEqual([200, "Z8.41", allocationId, undefined]);
    readerOrder = edited.body.data;

    for (const who of [["admin", auth()], ["qs_full", as(members.qs_full)]]) {
      const list = await api.get(at("/change-orders"), who[1]);
      expect([who[0], list.status]).toEqual([who[0], 200]);
      const built = await changeOrderService.listChangeOrders({ orgId: live.org.id, projectId: project.id, query: {} });
      expect([who[0], list.text]).toEqual([who[0], JSON.stringify({ success: true, data: normalizeMoneyTree(built) })]);

      const valuations = await api.get(at("/sub-valuations"), who[1]);
      expect([who[0], valuations.status]).toEqual([who[0], 200]);
      const builtValuations = await subValuationService.listSubValuations({ orgId: live.org.id, projectId: project.id, projectAccess: null });
      expect([who[0], valuations.text]).toEqual([who[0], JSON.stringify({ success: true, data: normalizeMoneyTree(builtValuations) })]);
      expect(valuations.body.data.rows[0].allocationLinks[0].boqItem.code).toBe("Z8.41");
    }
  });

  it("D — change-order readers without BOQ read receive the register with each link's own figures and without its BOQ row or allocation", async () => {
    const full = (await api.get(at("/change-orders"), auth())).body.data;
    for (const role of ["qs", "cost_controller", "finance", "pm", "planning_engineer"]) {
      const memberAuth = as(members[role]);
      const boq = await api.get(at("/boq"), memberAuth);
      expect([role, boq.status]).toEqual([role, 403]);
      const list = await api.get(at("/change-orders"), memberAuth);
      expect([role, list.status]).toEqual([role, 200]);
      expect([role, list.body.data]).toEqual([role, { ...full, orders: full.orders.map(withoutBoq) }]);
      const order = list.body.data.orders.find((entry) => entry.id === readerOrder.id);
      expect([role, order.value, order.allocationLinks[0].quantity, order.allocationLinks[0].amount, order.allocationLinks[0].notes]).toEqual([role, 4321.09, 7, 1234.56, "LiveTest link note"]);
      expectLinksWithheld(`${role} list`, order);
      expectNoSecrets(`${role} list`, list);
    }
  });

  it("D — the change-order workflow still works without BOQ read, and every write and transition answer withholds the link's BOQ row", async () => {
    const qs = as(members.qs);
    const pm = as(members.pm);
    const answers = {};
    const created = await api.post(at("/change-orders"), changeOrderBody("LiveTest CO by a QS without BOQ"), qs);
    expect([created.status, created.body?.error, created.body.data.value, created.body.data.allocationLinks]).toEqual([201, undefined, 4321.09, []]);
    expectNoSecrets("create", created);
    const coId = created.body.data.id;
    answers.update = await api.request("PATCH", at(`/change-orders/${coId}`), { body: { description: "LiveTest CO by a QS without BOQ, edited" }, headers: qs });
    answers.submit = await api.post(at(`/change-orders/${coId}/submit`), {}, qs);
    answers.approve = await api.post(at(`/change-orders/${coId}/approve`), { comment: "LiveTest" }, pm);

    const second = await api.post(at("/change-orders"), changeOrderBody("LiveTest CO to reject"), qs);
    expect([second.status, second.body?.error]).toEqual([201, undefined]);
    const secondId = second.body.data.id;
    expect((await api.post(at(`/change-orders/${secondId}/submit`), {}, qs)).status).toBe(200);
    answers.reject = await api.post(at(`/change-orders/${secondId}/reject`), { reason: "LiveTest rejected" }, pm);
    answers.reopen = await api.post(at(`/change-orders/${secondId}/reopen`), {}, qs);
    expect((await api.post(at(`/change-orders/${secondId}/submit`), {}, qs)).status).toBe(200);
    answers.disapprove = await api.post(at(`/change-orders/${secondId}/disapprove`), { reason: "LiveTest disapproved" }, pm);

    const expectedStatus = { update: 200, submit: 200, approve: 200, reject: 200, reopen: 200, disapprove: 200 };
    const expectedState = { update: "draft", submit: "pending", approve: "approved", reject: "rejected", reopen: "draft", disapprove: "rejected" };
    for (const [name, answer] of Object.entries(answers)) {
      expect([name, answer.status, answer.body?.error, answer.body.data.status]).toEqual([name, expectedStatus[name], undefined, expectedState[name]]);
      const link = answer.body.data.allocationLinks[0];
      expect([name, answer.body.data.value, link.quantity, link.amount]).toEqual([name, 4321.09, 7, 1234.56]);
      expectLinksWithheld(name, answer.body.data);
      expectNoSecrets(name, answer);
    }

    // The link was stored against the row and the allocation all the same.
    const stored = await prisma.changeOrderAllocationLink.findMany({ where: { changeOrderId: coId }, select: { allocationId: true, boqItemId: true } });
    expect(stored).toEqual([{ allocationId, boqItemId: row.id }]);
  });

  it("D — valuation readers without BOQ read receive the valuations with each link's own figures, and the answer to editing one likewise", async () => {
    const full = (await api.get(at("/sub-valuations"), auth())).body.data;
    for (const role of ["qs", "cost_controller", "finance", "pm", "procurement"]) {
      const memberAuth = as(members[role]);
      expect([role, (await api.get(at("/boq"), memberAuth)).status]).toEqual([role, 403]);
      const list = await api.get(at("/sub-valuations"), memberAuth);
      expect([role, list.status]).toEqual([role, 200]);
      expect([role, list.body.data]).toEqual([role, { ...full, rows: full.rows.map(withoutBoq) }]);
      const link = list.body.data.rows[0].allocationLinks[0];
      expect([role, link.quantity, link.workDoneAmount, link.materialsOnSiteAmount, link.retentionAmount, list.body.data.rows[0].netPayable]).toEqual([role, 5, 2222.22, 333.33, 127.78, 5130]);
      expectLinksWithheld(`${role} valuations`, list.body.data.rows[0]);
      expectNoSecrets(`${role} valuations`, list);
    }

    const edit = await api.request("PATCH", at(`/sub-valuations/${valuationId}`), { body: { retentionRate: 5 }, headers: as(members.qs) });
    expect([edit.status, edit.body?.error]).toEqual([200, undefined]);
    const link = edit.body.data.allocationLinks[0];
    expect([link.quantity, link.workDoneAmount, link.materialsOnSiteAmount, link.retentionAmount]).toEqual([5, 2222.22, 333.33, 127.78]);
    expectLinksWithheld("valuation edit", edit.body.data);
    expectNoSecrets("valuation edit", edit);

    const readerEdit = await api.request("PATCH", at(`/sub-valuations/${valuationId}`), { body: { retentionRate: 5 }, headers: as(members.qs_full) });
    expect([readerEdit.status, readerEdit.body.data.allocationLinks[0].boqItem.code, readerEdit.body.data.allocationLinks[0].allocation.id]).toEqual([200, "Z8.41", allocationId]);
  });

  it("E — the BOQ tool alone opens neither register", async () => {
    for (const key of ["site_engineer", "qs_boq_only"]) {
      const memberAuth = as(members[key]);
      expect([key, (await api.get(at("/boq"), memberAuth)).status]).toEqual([key, 200]);
      for (const route of ["/change-orders", "/sub-valuations"]) {
        const answer = await api.get(at(route), memberAuth);
        expect([key, route, answer.status, answer.body.success]).toEqual([key, route, 403, false]);
        expectNoSecrets(`${key} ${route}`, answer);
      }
    }
  });

  it("F — a member of another organisation, or of this one but not on the project, is refused as before", async () => {
    const refusals = [];
    for (const [key, who] of [["other organisation", { authorization: `Bearer ${other.token}` }], ["unassigned", as(members.unassigned)]]) {
      for (const route of ["/change-orders", "/sub-valuations"]) {
        const answer = await api.get(at(route), who);
        refusals.push([key, route, answer.status, answer.body.success]);
        expectNoSecrets(`${key} ${route}`, answer);
      }
    }
    expect(refusals).toEqual([
      ["other organisation", "/change-orders", 404, false],
      ["other organisation", "/sub-valuations", 404, false],
      ["unassigned", "/change-orders", 403, false],
      ["unassigned", "/sub-valuations", 403, false],
    ]);
  });
});
