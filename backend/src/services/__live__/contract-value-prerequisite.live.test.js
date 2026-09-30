/**
 * IPC certification and advance receipts wait for an established contract
 * value — proven against a real API process and the real local Postgres
 * (PC-7a item 1, owner decision 2026-09-29).
 *
 * A BOQ fallback, or a value whose source cannot be shown, is the bill's
 * figure and not yet the contract's. Drafting and review carry on with it;
 * certifying (retention locked against the cap, a rate of the revised value)
 * and recording an advance receipt (checked against the agreed advance, a
 * rate of the original value) are refused with one response — 409
 * CONTRACT_VALUE_NOT_ESTABLISHED — before any amount is looked at, so the
 * answer is the same whatever the stored figure, for a BOQ reader and for a
 * member without BOQ access alike, and nothing is written.
 *
 * Projects, all in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards, each with one priced row allocated to one activity, approved
 * progress, retention cap and advance terms, and an IPC period P01 drafted,
 * claimed and submitted while the value is unestablished:
 * - FALLBACK: no contract value — ensureContract takes the bill (boq_fallback);
 *   a contract manager WITHOUT BOQ access then enters an amount of their own;
 * - LEGACY: a fallback whose row predates the classification (NULL); a
 *   contract manager who reads the BOQ then confirms it as it stands;
 * - VALUED: the project's own contract value (project_value) — unaffected;
 * - NOROW: no contract value and no contract row yet — refused as the
 *   fallback it would be, without creating the row.
 *
 *   npm run test:live -- src/services/__live__/contract-value-prerequisite.live.test.js
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

const CODE = "CONTRACT_VALUE_NOT_ESTABLISHED";
const MESSAGE =
  "Establish the contract value first (Contract terms: enter it, or confirm it if you may read the BOQ)";

liveDescribe("IPC certification and advance receipts wait for an established contract value", () => {
  let live;
  let api;
  let pm; // a PM whose template sets the BOQ tool to none, on every project
  const projects = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (key, route) => `/api/v1/projects/${projects[key].id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);

  // The refusal with its request id taken out: what must not vary.
  const refusal = (answer) => {
    expect(answer.status).toBe(409);
    const { requestId, ...error } = answer.body.error;
    return JSON.stringify({ ...answer.body, error });
  };
  const CANONICAL = JSON.stringify({ success: false, error: { code: CODE, message: MESSAGE } });

  const contractOf = (key) => prisma.primeContract.findFirst({ where: { projectId: projects[key].id } });

  // Everything certification or an advance receipt would write.
  const footprint = async (key) => {
    const projectId = projects[key].id;
    const contract = await contractOf(key);
    const certificate = await prisma.ipcCertificate.findFirst({
      where: { projectId, period: "P01" },
      select: { status: true, totalRet: true, netPayable: true, advanceRecovery: true, retentionStatus: true, certifiedAt: true, certifiedBy: true, balanceDue: true },
    });
    return JSON.stringify({
      contract: contract
        ? { advancePaidAmount: String(contract.advancePaidAmount), advanceRecoveredAmount: String(contract.advanceRecoveredAmount), originalValueSource: contract.originalValueSource }
        : null,
      certificate: certificate && { ...certificate, totalRet: String(certificate.totalRet), netPayable: String(certificate.netPayable), advanceRecovery: String(certificate.advanceRecovery), balanceDue: String(certificate.balanceDue) },
      items: (await prisma.ipcItem.findMany({ where: { projectId }, select: { status: true, certDate: true } })).map((row) => [row.status, row.certDate]),
      advances: await prisma.primeContractAdvance.count({ where: { projectId } }),
      progressLinks: await prisma.ipcItemProgressLink.count({ where: { projectId } }),
      ledger: await prisma.costLedgerEntry.count({ where: { projectId } }),
      certifiedEvents: await prisma.auditEvent.count({ where: { projectId, entityType: "ipc_certificate", action: "certified" } }),
    });
  };

  // One priced row, allocated in full, approved complete; the contract read
  // (created), its retention cap and advance terms saved WITHOUT a value; P01
  // drafted, claimed and submitted.
  const buildBilling = async (key, { contractValue = null, rate, legacy = false }) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest contract prerequisite ${key}`, contractValue, defaultRetentionRate: 10, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    projects[key] = project;
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: pm.id, role: "pm", orgId: live.org.id } });
    await prisma.projectUserPermission.create({
      data: { orgId: live.org.id, projectId: project.id, userId: pm.id, templateId: pm.templateId },
    });
    if (key === "NOROW") return;

    const created = await api.post(at(key, "/boq/items"), { code: `K7.${key.length}`, description: `Row ${key}`, quantity: 20, unit: "m3", rate }, auth());
    ok(created, 201);
    const activity = await api.post(at(key, "/activities"), {
      engineerIds: [live.user.id],
      name: `Pour ${key}`,
      activityCode: "A710",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    ok(activity, 201);
    const allocation = await api.post(at(key, "/activity-boq-allocations"), { boqItemId: created.body.data.item.id, activityId: activity.body.data.id, quantity: 20 }, auth());
    ok(allocation, 201);
    for (const step of ["submit", "approve"]) ok(await api.post(at(key, `/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, auth()));
    await prisma.activityProgress.create({
      data: { activityId: activity.body.data.id, pctComplete: 100, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
    });

    ok(await api.get(at(key, "/prime-contract"), auth()));
    if (legacy) {
      // A row written before the column: this project's one contract, by id.
      const row = await contractOf(key);
      expect(row?.id).toBeTruthy();
      await prisma.primeContract.update({ where: { id: row.id }, data: { originalValueSource: null } });
    }
    // Terms are drafting: saved without a value, the source does not move.
    ok(await api.request("PATCH", at(key, "/prime-contract"), {
      body: { retentionRate: 10, retentionCapRate: 5, advanceRate: 10, advanceRecoveryRate: 20 },
      headers: as(pm),
    }));

    // Drafting and submission are not held back.
    const period = await api.post(at(key, "/ipc"), { period: "P01" }, auth());
    ok(period, 201);
    ok(await api.request("PATCH", at(key, `/ipc/P01/items/${period.body.data.items[0].id}`), { body: { qty: 20 }, headers: auth() }));
    const submitted = await api.post(at(key, "/ipc/P01/submit"), {}, as(pm));
    ok(submitted);
    expect(submitted.body.data.status).toBe("submitted");
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    pm = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest PM without BOQ",
      email: `live-contract-prereq-pm-${tag}@octapm-live.test`,
      role: "pm",
    });
    const template = await prisma.permissionTemplate.create({
      data: {
        orgId: live.org.id,
        name: `LiveTest PM, no BOQ ${tag}`,
        baseRole: "pm",
        tools: { create: [{ module: "boq", level: "none" }] },
      },
    });
    pm.templateId = template.id;

    await buildBilling("FALLBACK", { rate: 613.37 });
    await buildBilling("LEGACY", { rate: 518.52, legacy: true });
    await buildBilling("VALUED", { rate: 402.11, contractValue: 41737.29 });
    await buildBilling("NOROW", {});

    expect((await contractOf("FALLBACK")).originalValueSource).toBe("boq_fallback");
    expect((await contractOf("LEGACY")).originalValueSource).toBe(null);
    expect((await contractOf("VALUED")).originalValueSource).toBe("project_value");
    expect(await contractOf("NOROW")).toBe(null);
    // The PM is refused the BOQ, admitted to certify and to record advances.
    expect((await api.get(at("FALLBACK", "/boq"), as(pm))).status).toBe(403);
  }, 180_000);

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

  it("refuses certification and advance receipts on a fallback, an unestablished value and a project with no contract yet — one response, whatever the hidden amount, nothing written", async () => {
    for (const key of ["FALLBACK", "LEGACY"]) {
      const before = await footprint(key);
      const row = await contractOf(key);
      // Two different hidden amounts on this project's one contract, by id.
      for (const hidden of [Number(row.originalValue), 987654.32]) {
        await prisma.primeContract.update({
          where: { id: row.id },
          data: { originalValue: hidden, revisedValue: hidden, advanceAmount: Math.round(hidden * 10) / 100 },
        });
        for (const [who, headers] of [["owner, reads the BOQ", auth()], ["pm, no BOQ", as(pm)]]) {
          const certify = await api.post(at(key, "/ipc/P01/certify"), {}, headers);
          expect([key, hidden, who, refusal(certify)]).toEqual([key, hidden, who, CANONICAL]);
          const withReason = await api.post(at(key, "/ipc/P01/certify"), { overrideReason: "LiveTest" }, headers);
          expect([key, hidden, who, refusal(withReason)]).toEqual([key, hidden, who, CANONICAL]);
          for (const amount of [1, 50, 999999999]) {
            const advance = await api.post(at(key, "/prime-contract/advances"), { amount }, headers);
            expect([key, hidden, who, amount, refusal(advance)]).toEqual([key, hidden, who, amount, CANONICAL]);
          }
        }
      }
      // Put the stored figures back as ensureContract made them.
      await prisma.primeContract.update({
        where: { id: row.id },
        data: { originalValue: row.originalValue, revisedValue: row.revisedValue, advanceAmount: row.advanceAmount },
      });
      expect([key, await footprint(key)]).toEqual([key, before]);
      expect((await prisma.ipcCertificate.findFirst({ where: { projectId: projects[key].id, period: "P01" } })).status).toBe("submitted");
    }

    // No contract row and no project value: the fallback it would be. The
    // refusal creates no contract.
    for (const headers of [auth(), as(pm)]) {
      const advance = await api.post(at("NOROW", "/prime-contract/advances"), { amount: 10 }, headers);
      expect(refusal(advance)).toBe(CANONICAL);
    }
    expect(await prisma.primeContract.count({ where: { projectId: projects.NOROW.id } })).toBe(0);
    expect(await prisma.primeContractAdvance.count({ where: { projectId: projects.NOROW.id } })).toBe(0);
  });

  it("an established value is unaffected: VALUED certifies and takes an advance receipt as before", async () => {
    const certified = await api.post(at("VALUED", "/ipc/P01/certify"), {}, as(pm));
    ok(certified);
    expect(certified.body.data.status).toBe("certified");
    const advance = await api.post(at("VALUED", "/prime-contract/advances"), { amount: 100 }, as(pm));
    ok(advance, 201);
    expect(await prisma.primeContractAdvance.count({ where: { projectId: projects.VALUED.id, kind: "payment" } })).toBe(1);
  });

  it("a contract manager without BOQ access cannot confirm the fallback but may enter an amount; then certification and the advance proceed", async () => {
    // Confirming would reveal the bill: refused, and it unlocks nothing.
    const confirm = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { confirmOriginalValue: true }, headers: as(pm) });
    expect([confirm.status, confirm.body.error.code]).toEqual([403, "CONTRACT_VALUE_CONFIRM_FORBIDDEN"]);
    expect(refusal(await api.post(at("FALLBACK", "/ipc/P01/certify"), {}, as(pm)))).toBe(CANONICAL);

    // A separately known amount, entered through the existing path.
    const entered = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { originalValue: 10000 }, headers: as(pm) });
    ok(entered);
    expect((await contractOf("FALLBACK")).originalValueSource).toBe("contract_entry");

    const certified = await api.post(at("FALLBACK", "/ipc/P01/certify"), {}, as(pm));
    ok(certified);
    expect(certified.body.data.status).toBe("certified");
    // 10% retention on 12,267.40 is 1,226.74, held to the cap: 5% of the 10,000 entered.
    expect(Number((await prisma.ipcCertificate.findFirst({ where: { projectId: projects.FALLBACK.id, period: "P01" } })).totalRet)).toBe(500);
    ok(await api.post(at("FALLBACK", "/prime-contract/advances"), { amount: 100 }, as(pm)), 201);
    expect(await prisma.primeContractAdvance.count({ where: { projectId: projects.FALLBACK.id, kind: "payment" } })).toBe(1);
  });

  it("a contract manager who reads the BOQ confirms an unestablished value; then certification and the advance proceed", async () => {
    const confirmed = await api.request("PATCH", at("LEGACY", "/prime-contract"), { body: { confirmOriginalValue: true }, headers: auth() });
    ok(confirmed);
    expect((await contractOf("LEGACY")).originalValueSource).toBe("contract_entry");

    const certified = await api.post(at("LEGACY", "/ipc/P01/certify"), {}, auth());
    ok(certified);
    expect(certified.body.data.status).toBe("certified");
    ok(await api.post(at("LEGACY", "/prime-contract/advances"), { amount: 100 }, auth()), 201);
    expect(await prisma.primeContractAdvance.count({ where: { projectId: projects.LEGACY.id, kind: "payment" } })).toBe(1);
  });
});
