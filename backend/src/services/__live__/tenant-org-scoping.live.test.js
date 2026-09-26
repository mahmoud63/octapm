/**
 * The organisation is the row's, never the payload's (enterprise wave ENT-3):
 * the three job handlers that used to trust their payload, search for a
 * company administrator, the direct-cost vendor lookup and the extra services
 * table, each driven against the real database with two throwaway
 * organisations.
 *
 *   npm run test:live -- src/services/__live__/tenant-org-scoping.live.test.js
 *
 * What must hold:
 *   - boq.parse: a job of organisation B naming A's project ends with
 *     BOQ_JOB_PROJECT_NOT_FOUND before the AI is asked; the same payload on
 *     A's job gets past that check;
 *   - webhook delivery: a job of B answers "missing" for A's delivery exactly
 *     as it does for an id that does not exist; A's job delivers it;
 *   - accounting poll: the organisation polled is the job's; a payload naming
 *     another one is refused, a job without one is refused;
 *   - search: a site engineer with no assignment sees nothing, and the same
 *     person as company administrator sees every project of the workspace;
 *   - direct costs: a vendor company id of another organisation lends no name
 *     to the duplicate-invoice check;
 *   - extra services: read per organisation, defaults when it has none, and the
 *     config route lists and replaces the caller's organisation's rows only.
 */
process.env.ANTHROPIC_API_KEY ||= "live-test-placeholder-key";

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("Tenant org scoping (jobs, search, masters)", () => {
  const prisma = new PrismaClient();
  let a;
  let b;
  let projectA;
  let api;

  const membership = (org, user, extra = {}) =>
    prisma.organizationMembership.create({
      data: { orgId: org.id, userId: user.id, role: user.role, kind: "member", isAdmin: Boolean(user.isCompanyAdmin), isOwner: Boolean(user.isCompanyAdmin), status: "active", ...extra },
    });

  beforeAll(async () => {
    a = await createLiveOrg(prisma);
    b = await createLiveOrg(prisma);
    await membership(a.org, a.user);
    await membership(b.org, b.user);
    projectA = await prisma.project.create({ data: { orgId: a.org.id, name: "Scoping A", status: "active" } });
    api = await startApi();
  });

  afterAll(async () => {
    await api?.stop();
    await dropLiveOrg(prisma, a?.org?.id);
    await dropLiveOrg(prisma, b?.org?.id);
    await prisma.$disconnect();
  });

  test("boq.parse loads the project inside the job's organisation", async () => {
    const { runBoqActivityJob } = require("../boq.service");
    const items = [{ code: "1", description: "Excavation", qty: 10, unit: "m3", rate: 5, amount: 50 }];
    const run = (orgId) =>
      runBoqActivityJob({ job: { id: crypto.randomUUID(), orgId, projectId: projectA.id, requestedBy: a.user.id }, payload: { projectId: projectA.id, items }, updateProgress: () => {} });

    await expect(run(b.org.id)).rejects.toMatchObject({ code: "BOQ_JOB_PROJECT_NOT_FOUND", retryable: false });

    // Positive control: A's own job gets past the project check and on to the
    // AI, which the placeholder key cannot reach — any error but that code.
    let error = null;
    await run(a.org.id).catch((e) => (error = e));
    expect(error).not.toBeNull();
    expect(error.code).not.toBe("BOQ_JOB_PROJECT_NOT_FOUND");
  });

  test("webhook delivery is loaded inside the job's organisation, and a foreign id reads as missing", async () => {
    const { runDeliveryJob } = require("../webhook.service");
    const subscription = await prisma.webhookSubscription.create({
      data: { orgId: a.org.id, name: "ERP", url: "https://erp.example.test/hook", secret: crypto.randomBytes(16).toString("hex"), eventTypes: ["*"], status: "active" },
    });
    const delivery = await prisma.webhookDelivery.create({
      data: { orgId: a.org.id, subscriptionId: subscription.id, eventId: crypto.randomUUID(), eventType: "rfi.created", payloadJson: { hello: "world" } },
    });
    const fetchImpl = jest.fn(async () => ({ status: 202, text: async () => "queued" }));

    await expect(runDeliveryJob({ job: { orgId: b.org.id }, payload: { deliveryId: delivery.id }, fetchImpl })).resolves.toEqual({ skipped: "missing" });
    await expect(runDeliveryJob({ job: { orgId: b.org.id }, payload: { deliveryId: crypto.randomUUID() }, fetchImpl })).resolves.toEqual({ skipped: "missing" });
    await expect(runDeliveryJob({ payload: { deliveryId: delivery.id }, fetchImpl })).resolves.toEqual({ skipped: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(runDeliveryJob({ job: { orgId: a.org.id }, payload: { deliveryId: delivery.id }, fetchImpl })).resolves.toMatchObject({ delivered: true, responseStatus: 202 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("accounting poll runs for the job's organisation and refuses a payload naming another", async () => {
    const { runPollJob } = require("../accounting.service");
    await expect(runPollJob({ job: { orgId: a.org.id }, payload: { orgId: b.org.id } })).rejects.toMatchObject({ code: "JOB_ORG_MISMATCH", retryable: false });
    await expect(runPollJob({ payload: { orgId: a.org.id } })).rejects.toMatchObject({ code: "JOB_ORG_REQUIRED", retryable: false });
    await expect(runPollJob({ job: { orgId: a.org.id }, payload: {} })).resolves.toEqual({ checked: 0, paid: 0 });
  });

  test("a company administrator searches every project of the workspace; the same person without the flag sees only assignments", async () => {
    const { listAccessibleProjects } = require("../search.service");
    const engineer = await prisma.user.create({
      data: { orgId: a.org.id, name: "Site Engineer", email: `se-${crypto.randomUUID()}@octapm-live.test`, passwordHash: "x", role: "site_engineer", isCompanyAdmin: false },
    });
    await membership(a.org, engineer);

    const asMember = await listAccessibleProjects({ orgId: a.org.id, userId: engineer.id, role: "site_engineer", isCompanyAdmin: false });
    expect(asMember.map(({ project }) => project.id)).toEqual([]);

    const asAdmin = await listAccessibleProjects({ orgId: a.org.id, userId: engineer.id, role: "site_engineer", isCompanyAdmin: true });
    expect(asAdmin.map(({ project }) => project.id)).toEqual([projectA.id]);
    expect(asAdmin[0].access).toMatchObject({ scope: "org", role: "site_engineer" });

    // Never across the workspace boundary, flag or not.
    const acrossOrgs = await listAccessibleProjects({ orgId: b.org.id, userId: engineer.id, role: "site_engineer", isCompanyAdmin: true });
    expect(acrossOrgs).toEqual([]);
  });

  test("a vendor company of another organisation lends no name to the duplicate-invoice check", async () => {
    const { assertNoDuplicateInvoice } = require("../direct-cost.service");
    await prisma.directCost.create({
      data: { orgId: a.org.id, projectId: projectA.id, number: 1, ref: "DC-001", description: "Diesel", costDate: new Date("2027-02-01"), vendorName: "Acme Fuels", invoiceNumber: "INV-77", status: "approved" },
    });
    const acmeInB = await prisma.company.create({ data: { orgId: b.org.id, name: "Acme Fuels" } });
    const acmeInA = await prisma.company.create({ data: { orgId: a.org.id, name: "Acme Fuels" } });

    // B's company id names nothing in A: no name, no clash.
    await expect(assertNoDuplicateInvoice({ orgId: a.org.id, projectId: projectA.id, vendorCompanyId: acmeInB.id, invoiceNumber: "INV-77" })).resolves.toBeUndefined();
    // A's own company of that name is the vendor the text-only row meant.
    await expect(assertNoDuplicateInvoice({ orgId: a.org.id, projectId: projectA.id, vendorCompanyId: acmeInA.id, invoiceNumber: "INV-77" })).rejects.toMatchObject({ code: "DIRECT_COST_DUPLICATE_INVOICE" });
  });

  test("extra services are the organisation's: read per org, defaults when none, and the route lists and replaces the caller's only", async () => {
    const { calculateFinancials, getExtraServices, getDefaultExtraServices } = require("../boq-calculation.service");
    const auth = (token) => ({ authorization: `Bearer ${token}` });

    // A company administrator of A sets A's list through the route.
    const put = await api.request("PUT", "/api/v1/config/extra-services", { body: { services: [{ label: "VAT", percentage: 7.5 }, { label: "Bond", percentage: 1 }] }, headers: auth(a.token) });
    expect(put.status).toBe(200);
    expect(put.body.data.map((row) => [row.label, row.percentage, row.orgId])).toEqual([["VAT", 7.5, a.org.id], ["Bond", 1, a.org.id]]);

    // A repeated label, and an outsider's attempt, are refused.
    const duplicate = await api.request("PUT", "/api/v1/config/extra-services", { body: { services: [{ label: "VAT", percentage: 1 }, { label: "vat", percentage: 2 }] }, headers: auth(a.token) });
    expect(duplicate.status).toBe(400);
    const engineer = await prisma.user.create({
      data: { orgId: a.org.id, name: "Plain Member", email: `pm-${crypto.randomUUID()}@octapm-live.test`, passwordHash: "x", role: "site_engineer", isCompanyAdmin: false },
    });
    await membership(a.org, engineer);
    const { mintAccessToken } = require("../../__live__/helpers");
    const forbidden = await api.request("PUT", "/api/v1/config/extra-services", { body: { services: [] }, headers: auth(mintAccessToken(engineer)) });
    expect(forbidden.status).toBe(403);

    // Each organisation reads its own: A its rows, B the platform defaults.
    const listA = await api.get("/api/v1/config/extra-services", auth(a.token));
    expect(listA.body.data.map((row) => row.label)).toEqual(["VAT", "Bond"]);
    const listB = await api.get("/api/v1/config/extra-services", auth(b.token));
    expect(listB.body.data).toEqual(getDefaultExtraServices());

    expect((await getExtraServices({ orgId: b.org.id })).map((row) => row.label)).toEqual(["VAT", "Contractor Overhead", "Contingency"]);
    expect((await getExtraServices({ projectId: projectA.id })).map((row) => row.percentage)).toEqual([7.5, 1]);
    const totals = await calculateFinancials([{ amount: 1000 }], null, { projectId: projectA.id });
    expect(totals.extraServices.map((row) => [row.label, row.value])).toEqual([["VAT", 75], ["Bond", 10]]);
    expect(totals.totalProjectCost).toBe(1085);
  });
});
