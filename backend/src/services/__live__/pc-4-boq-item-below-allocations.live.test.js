/**
 * A BOQ row repriced or re-measured below what its allocations already take
 * is a business refusal, not a server fault (review of the Round-4 closure
 * patch, P2).
 *
 * The database refuses the update itself (trigger
 * validate_boq_item_allocation_capacity, migration 20260608170000: RAISE,
 * SQLSTATE P0001), and PATCH /boq/items/:id answered it with 500
 * INTERNAL_ERROR. The E2 refusals send a user to "price its rows (BOQ page)",
 * and repricing an allocated row is part of that. It now answers
 *
 *   409 BOQ_ITEM_BELOW_ALLOCATIONS — "This BOQ row's allocations to
 *   activities exceed its new amount. Reduce or reject them first (Project
 *   Controls › Mapping), then change the row's rate or quantity."
 *
 * (and the quantity variant), with nothing written: the row keeps its rate,
 * quantity and amount. An edit that stays above the allocations goes
 * through.
 *
 * Proven against a real API process and the real local Postgres, through the
 * product's own API, in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards.
 *
 *   npm run test:live -- src/services/__live__/pc-4-boq-item-below-allocations.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("PC-4: a BOQ row edited below its allocations is refused 409 BOQ_ITEM_BELOW_ALLOCATIONS, never a 500", () => {
  let live;
  let api;
  let project;
  let item;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const post = (route, body) => api.post(at(route), body, auth());
  const patchItem = (body) => api.request("PATCH", at(`/boq/items/${item.id}`), { body, headers: auth() });
  const storedItem = () =>
    prisma.boqItem.findUnique({ where: { id: item.id }, select: { qty: true, rate: true, amount: true } }).then((row) => ({
      qty: Number(row.qty),
      rate: Number(row.rate),
      amount: Number(row.amount),
    }));

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" });
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest BOQ row below allocations", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    // A row of 20 m3 at 100 (2000), half of it allocated and approved.
    const created = await post("/boq/items", { code: "1.1", description: "Concrete in foundations", quantity: 20, unit: "m3", rate: 100 });
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    item = created.body.data.item;
    const activity = await post("/activities", {
      engineerIds: [live.user.id],
      name: "Pour foundations",
      activityCode: "A100",
      duration: 5,
      startDate: "2026-02-02",
      endDate: "2026-02-06",
    });
    expect([activity.status, activity.body?.error]).toEqual([201, undefined]);
    const allocation = await post("/activity-boq-allocations", { boqItemId: item.id, activityId: activity.body.data.id, quantity: 10 });
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    for (const step of ["submit", "approve"]) {
      const moved = await post(`/activity-boq-allocations/${allocation.body.data.id}/${step}`, {});
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }
    expect(await storedItem()).toEqual({ qty: 20, rate: 100, amount: 2000 });
  }, 120_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("a rate that leaves the row's amount below its approved allocation is refused 409, with the way out, and nothing is written", async () => {
    const response = await patchItem({ rate: 0 });
    expect([response.status, response.body?.error?.code, response.body?.error?.message, response.body?.error?.details]).toEqual([
      409,
      "BOQ_ITEM_BELOW_ALLOCATIONS",
      "This BOQ row's allocations to activities exceed its new amount. Reduce or reject them first (Project Controls › Mapping), then change the row's rate or quantity.",
      { boqItemId: item.id, exceeded: "amount" },
    ]);
    expect(await storedItem()).toEqual({ qty: 20, rate: 100, amount: 2000 });
  });

  it("a quantity below the approved allocation's is refused 409 with the quantity named, and nothing is written", async () => {
    const response = await patchItem({ quantity: 5 });
    expect([response.status, response.body?.error?.code, response.body?.error?.message, response.body?.error?.details]).toEqual([
      409,
      "BOQ_ITEM_BELOW_ALLOCATIONS",
      "This BOQ row's allocations to activities exceed its new quantity. Reduce or reject them first (Project Controls › Mapping), then change the row's quantity.",
      { boqItemId: item.id, exceeded: "quantity" },
    ]);
    expect(await storedItem()).toEqual({ qty: 20, rate: 100, amount: 2000 });
  });

  it("an edit that stays above the allocation goes through", async () => {
    const response = await patchItem({ quantity: 12 });
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    expect(await storedItem()).toEqual({ qty: 12, rate: 100, amount: 1200 });
  });
});
