/**
 * Two contracts that differ only in the hidden amount look the same to a
 * member who may not read the BOQ — a differential permission test against a
 * real API process and the real local Postgres (PC-7a item 4, owner decision
 * 2026-09-29).
 *
 * Two projects, A and B, in a throwaway "LiveTest <uuid>" organisation
 * dropped afterwards, built call for call the same way.
 *
 * HELD CONSTANT (every independent commercial input, identical in A and B):
 * - the people: one owner (company admin, reads the BOQ) and one PM whose
 *   permission template sets the BOQ tool to none, assigned to both;
 * - the priced work: one BOQ row at 613.37, one activity, one approved
 *   allocation of 20 of that row (12,267.40), approved 100% complete;
 * - the contract terms: retention 10%, retention cap 4%, advance 7%, advance
 *   recovery 20%, payment terms 30 days, entered by the PM;
 * - the commercial records: one client change order of 4,321.09, submitted
 *   and approved; an advance receipt of 100.00; P01 claiming 3 of the
 *   allocation, submitted, certified (recovering the 100.00 advance) and
 *   invoiced; P02 claiming 10 more, submitted and awaiting certification.
 *   The advance and P01's certification are records made before the
 *   prerequisite existed (d987588): the setup holds each contract's source
 *   established for those two calls, by id, and puts it back.
 *
 * PROTECTED (the only difference): the BOQ row's quantity — 25 in A, 30 in
 * B — so the unconfirmed BOQ fallback, the contract's original value, is
 * 15,334.25 in A and 18,401.10 in B; and every figure derived from it: the
 * revised value (fallback + 4,321.09), the agreed advance (7% of it), the
 * remaining to certify, the retention cap (4% of the revised value) and the
 * totals of a certificate not yet certified that the cap limits (P02's
 * retention, net payable, tax and balance: the cap binds in A, not in B).
 *
 * What is proven:
 * 1. to the PM every answer — contract, statement (current and by period),
 *    receivables, advances, IPC list and periods, the project history, the
 *    change orders, the workspace home's IPC queue and health row, and every
 *    refusal (certify, advance receipt, confirmation, a spoofed source) — is
 *    the same for A and for B once identities (ids, names, times, request
 *    ids) are normalised, and none contains a protected figure of either;
 * 2. the refused actions write nothing (no certificate, advance, ledger,
 *    audit or outbound record moves);
 * 3. the owner, who reads the BOQ, receives the differing amounts;
 * 4. confirmation cannot be spoofed: a source cannot be sent, the PM cannot
 *    confirm, and the PM resending the hidden amount is their own entry, not
 *    an answer about it;
 * 5. once established (A entered by the PM, B confirmed by the owner, each
 *    with its audit record persisted) certification and the advance receipt
 *    work under commercial permissions, once each.
 *
 *   npm run test:live -- src/services/__live__/contract-value-differential.live.test.js
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

const KEYS = ["A", "B"];
const BOQ_QTY = { A: 25, B: 30 };
const RATE = 613.37;
const HOME = "/api/v1/projects/workspace-dashboard";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const round2 = (value) => Math.round(Number(value) * 100) / 100;

// Every read the PM has on a contract's project.
const SURFACES = [
  ["contract", "/prime-contract"],
  ["statement", "/prime-contract/statement"],
  ["statement P01", "/prime-contract/statement?period=P01"],
  ["statement P02", "/prime-contract/statement?period=P02"],
  ["receivables", "/prime-contract/receivables"],
  ["advances", "/prime-contract/advances"],
  ["IPC list", "/ipc"],
  ["IPC P01", "/ipc/P01"],
  ["IPC P02", "/ipc/P02"],
  ["history", "/audit"],
  ["IPC history", "/audit?entityType=ipc_certificate"],
  ["change orders", "/change-orders"],
];

liveDescribe("Two contracts that differ only in the hidden amount look the same to a non-BOQ reader", () => {
  let live;
  let api;
  let pm; // a PM whose template sets the BOQ tool to none
  const projects = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (key, route) => `/api/v1/projects/${projects[key].id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const contractOf = async (key) => {
    const row = await prisma.primeContract.findFirst({ where: { projectId: projects[key].id } });
    expect(row?.id).toBeTruthy();
    return row;
  };
  const setSource = async (key, originalValueSource) =>
    prisma.primeContract.update({ where: { id: (await contractOf(key)).id }, data: { originalValueSource } });

  // An answer with what is each project's own identity taken out: ids by
  // order of first appearance, times, request ids, the project's name (which
  // the contract's reference and title carry) and invoice number.
  const normalise = (key, value) => {
    const ids = new Map();
    const subs = [[projects[key].name, "<project>"], [`INV-DIFF-${key}`, "<invoice>"]];
    const walk = (node, name) => {
      if (Array.isArray(node)) return node.map((entry) => walk(entry, name));
      if (node && typeof node === "object") {
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
      }
      if (typeof node !== "string") return node;
      if (name === "requestId") return "<requestId>";
      let text = node;
      for (const [from, to] of subs) text = text.split(from).join(to);
      text = text.replace(UUID_RE, (id) => {
        if (!ids.has(id.toLowerCase())) ids.set(id.toLowerCase(), `<id${ids.size}>`);
        return ids.get(id.toLowerCase());
      });
      return text.replace(ISO_RE, "<time>");
    };
    return walk(value);
  };
  // History events written by one request (a change order's approval and its
  // status change) land a millisecond or two apart in either order: the
  // events are compared in one fixed order — by record type, status, source
  // and action, then time — rather than in the order they were stamped.
  const tieOrder = (event) =>
    [event.entityType, event.toStatus ?? event.newStatus, event.source, event.action, event.occurredAt].join("|");
  const inFixedOrder = (body) => {
    const events = body?.data?.events;
    if (!Array.isArray(events)) return body;
    const sorted = [...events].sort((a, b) => (tieOrder(a) < tieOrder(b) ? -1 : tieOrder(a) > tieOrder(b) ? 1 : 0));
    return { ...body, data: { ...body.data, events: sorted } };
  };
  const answerOf = (key, answer) => normalise(key, { status: answer.status, body: inFixedOrder(answer.body) });

  // Everything a refused action could have written on the project.
  const footprint = async (key) => {
    const projectId = projects[key].id;
    const contract = await contractOf(key);
    const certificates = await prisma.ipcCertificate.findMany({
      where: { projectId },
      orderBy: { period: "asc" },
      select: { period: true, status: true, totalRet: true, netPayable: true, advanceRecovery: true, balanceDue: true, certifiedAt: true },
    });
    return JSON.stringify({
      contract: {
        originalValueSource: contract.originalValueSource,
        originalValue: String(contract.originalValue),
        revisedValue: String(contract.revisedValue),
        advanceAmount: String(contract.advanceAmount),
        advancePaidAmount: String(contract.advancePaidAmount),
        advanceRecoveredAmount: String(contract.advanceRecoveredAmount),
      },
      certificates: certificates.map((row) => ({ ...row, totalRet: String(row.totalRet), netPayable: String(row.netPayable), advanceRecovery: String(row.advanceRecovery), balanceDue: String(row.balanceDue) })),
      advances: await prisma.primeContractAdvance.count({ where: { projectId } }),
      invoices: await prisma.ipcInvoice.count({ where: { projectId } }),
      ledger: await prisma.costLedgerEntry.count({ where: { projectId } }),
      audit: await prisma.auditEvent.count({ where: { projectId } }),
      outbound: await prisma.outboundEvent.count({ where: { orgId: live.org.id } }),
    });
  };

  const buildContract = async (key) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest differential ${key}`, defaultRetentionRate: 10, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    projects[key] = project;
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: pm.id, role: "pm", orgId: live.org.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: pm.id, templateId: pm.templateId } });

    // The one difference: the row's quantity, so the BOQ total.
    const row = await api.post(at(key, "/boq/items"), { code: "D1.1", description: "Differential row", quantity: BOQ_QTY[key], unit: "m3", rate: RATE }, auth());
    ok(row, 201);
    const activity = await api.post(at(key, "/activities"), {
      engineerIds: [live.user.id],
      name: "Pour differential",
      activityCode: "A910",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    ok(activity, 201);
    const allocation = await api.post(at(key, "/activity-boq-allocations"), { boqItemId: row.body.data.item.id, activityId: activity.body.data.id, quantity: 20 }, auth());
    ok(allocation, 201);
    for (const step of ["submit", "approve"]) ok(await api.post(at(key, `/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, auth()));
    await prisma.activityProgress.create({
      data: { activityId: activity.body.data.id, pctComplete: 100, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
    });

    ok(await api.get(at(key, "/prime-contract"), auth()));
    ok(await api.request("PATCH", at(key, "/prime-contract"), {
      body: { retentionRate: 10, retentionCapRate: 4, advanceRate: 7, advanceRecoveryRate: 20, paymentTermsDays: 30 },
      headers: as(pm),
    }));

    const order = await api.post(at(key, "/change-orders"), {
      description: "LiveTest differential variation",
      category: "variation",
      value: 4321.09,
      scheduleImpactSummary: "LiveTest none",
      costImpactSummary: "LiveTest priced",
      activityLinks: [{ activityId: activity.body.data.id, relationType: "affected", scheduleImpactDays: 0 }],
      attachmentRefs: [{ fileName: "LiveTest proof.pdf", fileUrl: "https://example.test/proof.pdf" }],
    }, as(pm));
    ok(order, 201);
    ok(await api.post(at(key, `/change-orders/${order.body.data.id}/submit`), {}, as(pm)));
    ok(await api.post(at(key, `/change-orders/${order.body.data.id}/approve`), { comment: "LiveTest" }, auth()));

    // Records made before the prerequisite: held established for these calls.
    await setSource(key, "contract_entry");
    ok(await api.post(at(key, "/prime-contract/advances"), { amount: 100, reference: "ADV-DIFF", occurredAt: "2026-02-10T00:00:00.000Z" }, as(pm)), 201);
    const p01 = await api.post(at(key, "/ipc"), { period: "P01" }, auth());
    ok(p01, 201);
    ok(await api.request("PATCH", at(key, `/ipc/P01/items/${p01.body.data.items[0].id}`), { body: { qty: 3 }, headers: auth() }));
    ok(await api.post(at(key, "/ipc/P01/submit"), {}, as(pm)));
    ok(await api.post(at(key, "/ipc/P01/certify"), {}, as(pm)));
    ok(await api.post(at(key, "/ipc/P01/invoice/issue"), { invoiceNumber: `INV-DIFF-${key}`, invoiceDate: "2026-03-02T00:00:00.000Z" }, auth()), 201);
    await setSource(key, "boq_fallback");

    const p02 = await api.post(at(key, "/ipc"), { period: "P02" }, auth());
    ok(p02, 201);
    ok(await api.request("PATCH", at(key, `/ipc/P02/items/${p02.body.data.items[0].id}`), { body: { qty: 10 }, headers: auth() }));
    ok(await api.post(at(key, "/ipc/P02/submit"), {}, as(pm)));
  };

  // The owner's (a BOQ reader's) view of the protected figures.
  const protectedFigures = {};

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    pm = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest PM without BOQ",
      email: `live-contract-diff-pm-${tag}@octapm-live.test`,
      role: "pm",
    });
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest PM, no BOQ ${tag}`, baseRole: "pm", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    pm.templateId = template.id;

    for (const key of KEYS) await buildContract(key);

    for (const key of KEYS) {
      expect([key, (await contractOf(key)).originalValueSource]).toEqual([key, "boq_fallback"]);
      expect([key, (await api.get(at(key, "/boq"), as(pm))).status]).toEqual([key, 403]);
      const contract = (await api.get(at(key, "/prime-contract"), auth())).body.data;
      const p02 = (await api.get(at(key, "/ipc/P02"), auth())).body.data;
      protectedFigures[key] = {
        originalValue: contract.originalValue,
        revisedValue: contract.revisedValue,
        advanceAmount: contract.advanceAmount,
        cap: round2(contract.revisedValue * 0.04),
        p02: { totalRet: p02.totalRet, netPayable: p02.netPayable, balanceDue: p02.balanceDue },
      };
    }
  }, 300_000);

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

  // A number as JSON writes it, not inside a longer number.
  const mentions = (text, amount) => new RegExp(`(?<![\\d.])${String(amount).replace(".", "\\.")}(?!\\d)`).test(text);
  const hiddenIn = (text) => {
    const found = [];
    for (const key of KEYS) {
      const figures = protectedFigures[key];
      for (const name of ["originalValue", "revisedValue", "advanceAmount", "cap"]) {
        if (mentions(text, figures[name])) found.push(`${key}.${name}=${figures[name]}`);
      }
    }
    // A's P02 totals are the capped ones (its balance is nil until invoiced).
    for (const name of ["totalRet", "netPayable"]) {
      if (mentions(text, protectedFigures.A.p02[name])) found.push(`A.p02.${name}=${protectedFigures.A.p02[name]}`);
    }
    return found;
  };

  it("the setup differs where intended: the owner, who reads the BOQ, receives differing amounts, and the cap binds on A's P02 only", () => {
    const { A, B } = protectedFigures;
    expect([A.originalValue, B.originalValue]).toEqual([15334.25, 18401.1]);
    expect([A.revisedValue, B.revisedValue]).toEqual([19655.34, 22722.19]);
    expect(A.advanceAmount).not.toBe(B.advanceAmount);
    // P01 held 184.01; A's cap leaves 786.21 − 184.01 = 602.20 of the 613.37 claimed.
    expect([A.p02.totalRet, B.p02.totalRet]).toEqual([602.2, 613.37]);
    expect(A.p02.netPayable).not.toBe(B.p02.netPayable);
  });

  it("every read the PM receives is the same for A and B, and none states a protected figure", async () => {
    for (const [label, route] of SURFACES) {
      const answers = {};
      for (const key of KEYS) {
        const answer = await api.get(at(key, route), as(pm));
        expect([label, key, answer.status]).toEqual([label, key, 200]);
        expect([label, key, hiddenIn(answer.text)]).toEqual([label, key, []]);
        answers[key] = answerOf(key, answer);
      }
      expect([label, answers.A]).toEqual([label, answers.B]);
    }

    // The workspace home: one answer, holding both projects.
    const home = await api.get(HOME, as(pm));
    ok(home);
    expect(hiddenIn(home.text)).toEqual([]);
    const queue = home.body.data.workflowQueues.find((entry) => entry.key === "ipcActions");
    const itemsOf = (key) => normalise(key, queue.items.filter((item) => item.projectId === projects[key].id));
    const healthOf = (key) => normalise(key, home.body.data.projectHealth.filter((row) => row.id === projects[key].id));
    expect(itemsOf("A").length).toBeGreaterThan(0);
    expect(itemsOf("A")).toEqual(itemsOf("B"));
    expect(healthOf("A")).toEqual(healthOf("B"));
    // P02, submitted: its net payable is withheld. P01, certified: its
    // payment line states the balance it holds, the same in both.
    const submitted = queue.items.filter((item) => item.target?.source === "ipc_certificate" && !String(item.id).startsWith("payment-"));
    expect(submitted.map((item) => [item.title, item.meta, Boolean(item.valueWithheld)])).toEqual([["P02", "USD —", true], ["P02", "USD —", true]]);
  });

  it("the BOQ reader's workspace queue states each project's own net payable (the differential)", async () => {
    const home = await api.get(HOME, auth());
    ok(home);
    const queue = home.body.data.workflowQueues.find((entry) => entry.key === "ipcActions");
    const meta = (key) => queue.items.find((item) => item.projectId === projects[key].id && item.title === "P02");
    for (const key of KEYS) {
      expect([key, meta(key).valueWithheld]).toEqual([key, undefined]);
      expect([key, meta(key).meta]).toEqual([key, `USD ${protectedFigures[key].p02.netPayable.toLocaleString()}`]);
    }
  });

  it("every value-dependent action and every spoofed confirmation is refused the same way for A and B, and writes nothing", async () => {
    const attempts = [
      ["certify", "POST", "/ipc/P02/certify", {}, 409],
      ["certify with a reason", "POST", "/ipc/P02/certify", { overrideReason: "LiveTest" }, 409],
      ["advance receipt", "POST", "/prime-contract/advances", { amount: 50 }, 409],
      ["advance receipt over any agreed advance", "POST", "/prime-contract/advances", { amount: 999999 }, 409],
      ["confirm without BOQ read", "PATCH", "/prime-contract", { confirmOriginalValue: true }, 403],
      ["confirm and enter together", "PATCH", "/prime-contract", { confirmOriginalValue: true, originalValue: 1 }, 400],
      ["a source sent by the client", "PATCH", "/prime-contract", { originalValueSource: "contract_entry" }, 400],
      ["confirmation as a string", "PATCH", "/prime-contract", { confirmOriginalValue: "true" }, 400],
    ];
    const before = {};
    for (const key of KEYS) before[key] = await footprint(key);
    for (const [label, method, route, body, status] of attempts) {
      const answers = {};
      for (const key of KEYS) {
        const answer = await api.request(method, at(key, route), { body, headers: as(pm) });
        expect([label, key, answer.status]).toEqual([label, key, status]);
        expect([label, key, hiddenIn(answer.text)]).toEqual([label, key, []]);
        answers[key] = answerOf(key, answer);
      }
      expect([label, answers.A]).toEqual([label, answers.B]);
    }
    // The owner reads the BOQ and is refused certification and the receipt
    // just the same: the prerequisite is the value's source, not the reader.
    for (const route of ["/ipc/P02/certify", "/prime-contract/advances"]) {
      const answers = {};
      for (const key of KEYS) {
        const answer = await api.post(at(key, route), route.endsWith("advances") ? { amount: 50 } : {}, auth());
        expect([route, key, answer.status, answer.body.error.code]).toEqual([route, key, 409, "CONTRACT_VALUE_NOT_ESTABLISHED"]);
        answers[key] = answerOf(key, answer);
      }
      expect([route, answers.A]).toEqual([route, answers.B]);
    }
    for (const key of KEYS) expect([key, await footprint(key)]).toEqual([key, before[key]]);
  });

  it("the PM resending the hidden amount enters it as their own; the owner confirms B; each is audited, and certification and the advance then work once", async () => {
    // A guess that happens to be the hidden amount is an entry, not an answer.
    const entered = await api.request("PATCH", at("A", "/prime-contract"), { body: { originalValue: protectedFigures.A.originalValue }, headers: as(pm) });
    ok(entered);
    expect([entered.body.data.originalValueSource, entered.body.data.originalValue]).toEqual(["contract_entry", protectedFigures.A.originalValue]);

    const confirmed = await api.request("PATCH", at("B", "/prime-contract"), { body: { confirmOriginalValue: true }, headers: auth() });
    ok(confirmed);
    expect(confirmed.body.data.originalValueSource).toBe("contract_entry");

    // The evidence of who established each value, and how, persisted.
    for (const [key, how, actorId] of [["A", "entered", pm.id], ["B", "confirmed", live.user.id]]) {
      const events = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, projectId: projects[key].id, entityType: "project" }, orderBy: { occurredAt: "asc" } });
      const record = events.filter((event) => event.summaryJson?.originalValueConfirmation === how);
      expect([key, record.length]).toEqual([key, 1]);
      expect([key, record[0].actorId, record[0].oldSummaryJson.originalValueSource, record[0].newSummaryJson.originalValueSource]).toEqual([key, actorId, "boq_fallback", "contract_entry"]);
    }

    for (const key of KEYS) {
      const ledgerBefore = await prisma.costLedgerEntry.count({ where: { projectId: projects[key].id } });
      const certified = await api.post(at(key, "/ipc/P02/certify"), {}, as(pm));
      ok(certified);
      expect([key, certified.body.data.status]).toEqual([key, "certified"]);
      ok(await api.post(at(key, "/prime-contract/advances"), { amount: 50 }, as(pm)), 201);
      // Asking again changes nothing.
      expect([key, (await api.post(at(key, "/ipc/P02/certify"), {}, as(pm))).status]).not.toEqual([key, 200]);
      expect([key, await prisma.primeContractAdvance.count({ where: { projectId: projects[key].id, kind: "payment" } })]).toEqual([key, 2]);
      expect([key, await prisma.ipcCertificate.count({ where: { projectId: projects[key].id, status: "certified" } })]).toEqual([key, 2]);
      expect([key, await prisma.costLedgerEntry.count({ where: { projectId: projects[key].id } })]).toEqual([key, ledgerBefore]);
    }
    const [duplicates] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM (SELECT "sourceKey" FROM "CostLedgerEntry" WHERE "orgId" = ${live.org.id} GROUP BY 1 HAVING COUNT(*) > 1) d`;
    expect(duplicates.n).toBe(0);
  });
});
