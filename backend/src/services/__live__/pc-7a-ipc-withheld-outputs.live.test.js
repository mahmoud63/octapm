/**
 * The last two outputs that restated an unconfirmed contract value through a
 * certificate's cap-limited totals — the report builder's payment-certificate
 * source and a workflow run's context — and the workflow's certification
 * path, against a real API process and the real local Postgres (PC-7a review,
 * owner decision 2026-09-29 item 2: no unresolved retention/advance
 * disclosure in a client release).
 *
 * Two projects, A and B, in a throwaway "LiveTest <uuid>" organisation
 * dropped afterwards, built call for call the same way (as
 * contract-value-differential.live.test.js builds them).
 *
 * HELD CONSTANT: one owner (company admin, reads the BOQ) and one PM whose
 * permission template sets the BOQ tool to none; one BOQ row at 613.37, one
 * activity with an approved allocation of 20, 100% complete; retention 10%,
 * cap 4%; one approved client change order of 4,321.09; P01 claiming 3,
 * certified while the value was held established (by id, then put back);
 * a project workflow template for payment certificates assigned to the PM;
 * P02 claiming 10 more, submitted (which starts the run).
 *
 * PROTECTED (the only difference): the BOQ row's quantity — 25 in A, 30 in B
 * — so the unconfirmed BOQ fallback, and P02's cap-limited retention, net
 * payable and balance (the cap binds in A, not in B).
 *
 * What is proven:
 * 1. the report builder gives the PM the same rows, sort, filter, grouping
 *    and totals for A and B: P02's totalRet, netPayable and balanceDue are
 *    null and named in withheldColumns; P01, certified, keeps its own; the
 *    owner receives the differing figures;
 * 2. the run started on P02's submission stores no `amount` (it names it in
 *    valueWithheld) — so its stored context, its template choice and every
 *    answer about it are the same for A and B, to the PM and to the owner;
 *    a run stored before that rule (its context carrying the amount) loses
 *    it on the way out to the PM, and keeps it for the owner;
 * 3. the run's final approval ("Certify") cannot certify while the value is
 *    unestablished: the run finishes, its applyStatus is "failed" with
 *    CONTRACT_VALUE_NOT_ESTABLISHED, P02 stays submitted, and nothing
 *    financial is written.
 *
 *   npm run test:live -- src/services/__live__/pc-7a-ipc-withheld-outputs.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const KEYS = ["A", "B"];
const BOQ_QTY = { A: 25, B: 30 };
const RATE = 613.37;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const CAP_COLUMNS = ["totalRet", "netPayable", "balanceDue"];

// Every way a run could use a withheld column: shown, sorted on, filtered on, grouped and aggregated.
const REPORTS = {
  "default columns": { source: "ipc_certificate", sort: { field: "period", dir: "asc" } },
  "sorted by net payable": { source: "ipc_certificate", columns: ["period", "status", "totalCert"], sort: { field: "netPayable", dir: "desc" } },
  "filtered on net payable": { source: "ipc_certificate", columns: ["period", "status"], filters: [{ field: "netPayable", op: "gt", value: 0 }], sort: { field: "period", dir: "asc" } },
  "grouped with totals": {
    source: "ipc_certificate",
    columns: ["period", "status"],
    groupBy: "status",
    aggregates: [{ fn: "count" }, { fn: "sum", field: "netPayable" }, { fn: "sum", field: "totalRet" }, { fn: "max", field: "balanceDue" }, { fn: "sum", field: "totalCert" }],
  },
};

liveDescribe("PC-7a review: the report builder and a workflow run say nothing about an unconfirmed contract value", () => {
  let live;
  let api;
  let pm;
  const projects = {};
  const protectedFigures = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (key, route) => `/api/v1/projects/${projects[key].id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const contractOf = async (key) => {
    const row = await prisma.primeContract.findFirst({ where: { projectId: projects[key].id } });
    expect(row?.id).toBeTruthy();
    return row;
  };
  const setSource = async (key, originalValueSource) => prisma.primeContract.update({ where: { id: (await contractOf(key)).id }, data: { originalValueSource } });

  const normalise = (key, value) => {
    const ids = new Map();
    const walk = (node, name) => {
      if (Array.isArray(node)) return node.map((entry) => walk(entry, name));
      if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
      if (typeof node !== "string") return node;
      if (name === "requestId" || name === "generatedAt") return `<${name}>`;
      const text = node.split(projects[key].name).join("<project>").replace(UUID_RE, (id) => {
        if (!ids.has(id.toLowerCase())) ids.set(id.toLowerCase(), `<id${ids.size}>`);
        return ids.get(id.toLowerCase());
      });
      return text.replace(ISO_RE, "<time>");
    };
    return walk(value);
  };

  // A number as JSON writes it, not inside a longer number.
  const mentions = (text, amount) => new RegExp(`(?<![\\d.])${String(amount).replace(".", "\\.")}(?!\\d)`).test(text);
  const hiddenIn = (text) => {
    const found = [];
    for (const key of KEYS) {
      for (const name of ["originalValue", "revisedValue"]) if (mentions(text, protectedFigures[key][name])) found.push(`${key}.${name}`);
    }
    for (const name of ["totalRet", "netPayable"]) if (mentions(text, protectedFigures.A.p02[name])) found.push(`A.p02.${name}=${protectedFigures.A.p02[name]}`);
    return found;
  };

  const footprint = async (key) => {
    const projectId = projects[key].id;
    const certificates = await prisma.ipcCertificate.findMany({ where: { projectId }, orderBy: { period: "asc" }, select: { period: true, status: true, totalRet: true, netPayable: true, balanceDue: true, certifiedAt: true } });
    return JSON.stringify({
      certificates: certificates.map((row) => ({ ...row, totalRet: String(row.totalRet), netPayable: String(row.netPayable), balanceDue: String(row.balanceDue) })),
      source: (await contractOf(key)).originalValueSource,
      ledger: await prisma.costLedgerEntry.count({ where: { projectId } }),
      invoices: await prisma.ipcInvoice.count({ where: { projectId } }),
    });
  };

  const runOf = async (key) => {
    const runs = await prisma.workflowInstance.findMany({ where: { projectId: projects[key].id, tool: "ipc_certificate" } });
    expect([key, runs.length]).toEqual([key, 1]);
    return runs[0];
  };

  const buildContract = async (key) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest withheld outputs ${key}`, defaultRetentionRate: 10, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    projects[key] = project;
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: pm.id, role: "pm", orgId: live.org.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: pm.id, templateId: pm.templateId } });

    const row = await api.post(at(key, "/boq/items"), { code: "W1.1", description: "Withheld outputs row", quantity: BOQ_QTY[key], unit: "m3", rate: RATE }, auth());
    ok(row, 201);
    const activity = await api.post(at(key, "/activities"), { engineerIds: [live.user.id], name: "Pour withheld", activityCode: "A920", duration: 3, startDate: "2026-02-02", endDate: "2026-02-04" }, auth());
    ok(activity, 201);
    const allocation = await api.post(at(key, "/activity-boq-allocations"), { boqItemId: row.body.data.item.id, activityId: activity.body.data.id, quantity: 20 }, auth());
    ok(allocation, 201);
    for (const step of ["submit", "approve"]) ok(await api.post(at(key, `/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, auth()));
    await prisma.activityProgress.create({ data: { activityId: activity.body.data.id, pctComplete: 100, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") } });

    ok(await api.get(at(key, "/prime-contract"), auth()));
    ok(await api.request("PATCH", at(key, "/prime-contract"), { body: { retentionRate: 10, retentionCapRate: 4, paymentTermsDays: 30 }, headers: as(pm) }));
    const order = await api.post(at(key, "/change-orders"), {
      description: "LiveTest withheld outputs variation",
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

    // P01 certified while the value is held established (by id, put back).
    await setSource(key, "contract_entry");
    const p01 = await api.post(at(key, "/ipc"), { period: "P01" }, auth());
    ok(p01, 201);
    ok(await api.request("PATCH", at(key, `/ipc/P01/items/${p01.body.data.items[0].id}`), { body: { qty: 3 }, headers: auth() }));
    ok(await api.post(at(key, "/ipc/P01/submit"), {}, as(pm)));
    ok(await api.post(at(key, "/ipc/P01/certify"), {}, as(pm)));
    await setSource(key, "boq_fallback");

    // From here a submitted certificate starts a run the PM decides.
    ok(await api.post(at(key, "/workflows/templates"), {
      tool: "ipc_certificate",
      name: "LiveTest IPC certification",
      isDefault: true,
      steps: [{
        key: "certify",
        name: "Certification",
        type: "response",
        assignees: [{ type: "user", userId: pm.id }],
        days: 5,
        responses: [
          { key: "certify", label: "Certify", next: "end_success", tone: "positive" },
          { key: "hold", label: "Hold", next: "end_fail", tone: "negative", requireComment: true },
        ],
      }],
    }, auth()), 201);
    const p02 = await api.post(at(key, "/ipc"), { period: "P02" }, auth());
    ok(p02, 201);
    ok(await api.request("PATCH", at(key, `/ipc/P02/items/${p02.body.data.items[0].id}`), { body: { qty: 10 }, headers: auth() }));
    ok(await api.post(at(key, "/ipc/P02/submit"), {}, as(pm)));
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    pm = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest PM without BOQ", email: `live-withheld-outputs-pm-${tag}@octapm-live.test`, role: "pm" });
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
      protectedFigures[key] = { originalValue: contract.originalValue, revisedValue: contract.revisedValue, p02: { totalRet: p02.totalRet, netPayable: p02.netPayable, balanceDue: p02.balanceDue, status: p02.status } };
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

  it("the setup differs where intended: the cap binds on A's P02 only, and the owner reads both amounts", () => {
    const { A, B } = protectedFigures;
    expect([A.originalValue, B.originalValue]).toEqual([15334.25, 18401.1]);
    expect([A.p02.status, B.p02.status]).toEqual(["submitted", "submitted"]);
    expect([A.p02.totalRet, B.p02.totalRet]).toEqual([602.2, 613.37]);
    expect(A.p02.netPayable).not.toBe(B.p02.netPayable);
  });

  it("the report builder gives the PM the same rows, sort, filter, groups and totals for A and B, with P02's cap-limited totals null; the owner gets the figures", async () => {
    for (const [label, definition] of Object.entries(REPORTS)) {
      const answers = {};
      for (const key of KEYS) {
        const answer = await api.post("/api/v1/reports/preview", { ...definition, projectId: projects[key].id }, as(pm));
        expect([label, key, answer.status, answer.body?.error]).toEqual([label, key, 200, undefined]);
        expect([label, key, hiddenIn(answer.text)]).toEqual([label, key, []]);
        answers[key] = normalise(key, answer.body);
      }
      expect([label, answers.A]).toEqual([label, answers.B]);
    }

    const shown = await api.post("/api/v1/reports/preview", { ...REPORTS["default columns"], projectId: projects.A.id }, as(pm));
    const rows = Object.fromEntries(shown.body.data.rows.map((row) => [row.period, row]));
    for (const column of CAP_COLUMNS) expect([column, rows.P02[column]]).toEqual([column, null]);
    expect(rows.P02.withheldColumns).toEqual(CAP_COLUMNS);
    expect(rows.P02.totalCert).toBe(6133.7);
    // P01 is certified: its retention and net payable are its own record.
    expect(rows.P01.withheldColumns).toBeUndefined();
    expect([rows.P01.totalRet, typeof rows.P01.netPayable]).toEqual([184.01, "number"]);
    expect(shown.body.data.withheld).toMatchObject({ columns: CAP_COLUMNS, projects: 1 });
    expect(shown.body.data.withheld.reason).toContain("retention cap");
    const totals = (await api.post("/api/v1/reports/preview", { ...REPORTS["grouped with totals"], projectId: projects.A.id }, as(pm))).body.data.totals;
    expect([totals.sum_netPayable, totals.sum_totalRet, totals.max_balanceDue, totals.sum_totalCert]).toEqual([null, null, null, 7973.81]);

    // The owner reads the BOQ: each project's own P02 figures, unwithheld.
    for (const key of KEYS) {
      const owner = await api.post("/api/v1/reports/preview", { ...REPORTS["default columns"], projectId: projects[key].id }, auth());
      ok(owner);
      const p02 = owner.body.data.rows.find((row) => row.period === "P02");
      expect([key, p02.totalRet, p02.netPayable, p02.withheldColumns, owner.body.data.withheld]).toEqual([key, protectedFigures[key].p02.totalRet, protectedFigures[key].p02.netPayable, undefined, undefined]);
    }
  });

  it("the run started on P02's submission stores no amount, so every answer about it is the same for A and B; a run stored with one loses it for the PM only", async () => {
    for (const key of KEYS) {
      const run = await runOf(key);
      expect([key, Object.prototype.hasOwnProperty.call(run.contextJson, "amount")]).toEqual([key, false]);
      expect([key, run.contextJson.valueWithheld]).toEqual([key, expect.objectContaining({ keys: ["amount"], source: "boq_fallback" })]);
      expect([key, run.contextJson.totalCert, run.contextJson.status]).toEqual([key, 6133.7, "submitted"]);
    }
    for (const [who, headers] of [["PM", as(pm)], ["owner", auth()]]) {
      for (const route of ["/workflows/instances?tool=ipc_certificate", "__one__"]) {
        const answers = {};
        for (const key of KEYS) {
          const path = route === "__one__" ? `/workflows/instances/${(await runOf(key)).id}` : route;
          const answer = await api.get(at(key, path), headers);
          expect([who, key, route, answer.status]).toEqual([who, key, route, 200]);
          expect([who, key, route, hiddenIn(answer.text)]).toEqual([who, key, route, []]);
          answers[key] = normalise(key, answer.body.data);
        }
        expect([who, route, answers.A]).toEqual([who, route, answers.B]);
      }
    }

    // A run stored before the rule carried the net payable: the PM does not
    // receive it, the owner (a BOQ reader) does. Only A's own run is changed, by id.
    const run = await runOf("A");
    const legacy = { ...run.contextJson, amount: protectedFigures.A.p02.netPayable };
    delete legacy.valueWithheld;
    await prisma.workflowInstance.update({ where: { id: run.id }, data: { contextJson: legacy } });
    try {
      const mine = await api.get(at("A", `/workflows/instances/${run.id}`), as(pm));
      ok(mine);
      expect(hiddenIn(mine.text)).toEqual([]);
      expect(Object.prototype.hasOwnProperty.call(mine.body.data.context, "amount")).toBe(false);
      expect(mine.body.data.context.valueWithheld).toMatchObject({ keys: ["amount"], source: "boq_fallback" });
      const listed = await api.get(at("A", "/workflows/instances?tool=ipc_certificate"), as(pm));
      expect(hiddenIn(listed.text)).toEqual([]);
      const owner = await api.get(at("A", `/workflows/instances/${run.id}`), auth());
      expect(owner.body.data.context.amount).toBe(protectedFigures.A.p02.netPayable);
    } finally {
      await prisma.workflowInstance.update({ where: { id: run.id }, data: { contextJson: run.contextJson } });
    }
  });

  it("the run's final approval cannot certify while the value is unestablished: applyStatus failed with CONTRACT_VALUE_NOT_ESTABLISHED, P02 still submitted, nothing written", async () => {
    const answers = {};
    for (const key of KEYS) {
      const before = await footprint(key);
      const run = await runOf(key);
      const decided = await api.post(at(key, `/workflows/instances/${run.id}/respond`), { response: "certify", comment: "LiveTest" }, as(pm));
      expect([key, decided.status, decided.body?.error]).toEqual([key, 200, undefined]);
      expect([key, hiddenIn(decided.text)]).toEqual([key, []]);
      const stored = await prisma.workflowInstance.findUnique({ where: { id: run.id } });
      expect([key, stored.status, stored.outcome, stored.applyStatus]).toEqual([key, "succeeded", "success", "failed"]);
      expect([key, String(stored.applyError).startsWith("CONTRACT_VALUE_NOT_ESTABLISHED")]).toEqual([key, true]);
      expect([key, decided.body.data.applyStatus]).toEqual([key, "failed"]);
      expect([key, (await prisma.ipcCertificate.findFirst({ where: { projectId: projects[key].id, period: "P02" } })).status]).toEqual([key, "submitted"]);
      expect([key, await footprint(key)]).toEqual([key, before]);
      answers[key] = normalise(key, decided.body.data);
    }
    expect(answers.A).toEqual(answers.B);
  });
});
