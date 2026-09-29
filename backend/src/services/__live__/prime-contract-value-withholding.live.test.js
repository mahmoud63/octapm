/**
 * The client contract's original value: classified by the server only,
 * withheld from a member who may not read the BOQ while it is an unconfirmed
 * BOQ fallback (or of a source not established), and confirmed only by an
 * authorized action — proven against a real API process and the real local
 * Postgres (owner decisions 1-3, 2026-09-29).
 *
 * Projects, all in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards:
 * - FALLBACK: no contract value; two priced rows, so ensureContract takes the
 *   bill's total (30,107.08) — boq_fallback;
 * - VALUED: a contract value of its own (41,737.29) — project_value;
 * - ENTRY: a fallback (16,419.69) a contract manager without BOQ access
 *   replaces with an amount of their own;
 * - LEGACY: a fallback whose row predates the classification (NULL) —
 *   unestablished.
 *
 * A: an IPC / contract reader without BOQ access reads the established value,
 *    and is refused the fallback and everything stating it (contract,
 *    statement, audit history, workspace home) — with the reason, never zero.
 * B: a BOQ + commercial reader receives every answer byte for byte as the
 *    service builds it.
 * C: the source cannot be sent by a client; reads and ordinary saves leave a
 *    fallback a fallback; a contract manager without BOQ access cannot
 *    confirm it (but may enter an amount); a contract manager who reads the
 *    BOQ confirms it, which is audited (actor, time) and changes no figure.
 * E: BOQ read alone does not open the contract routes.
 * F: another organisation, and a member not on the project, are refused as
 *    before.
 *
 *   npm run test:live -- src/services/__live__/prime-contract-value-withholding.live.test.js
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
const primeContractService = require("../prime-contract.service");
const auditService = require("../audit.service");
const { startApi } = require("./auth-live-kit");

const FALLBACK_REASON =
  "The original value is the BOQ's total, not yet confirmed as the contract value: it is available only to members who may read the BOQ until a contract manager enters or confirms it";
const UNESTABLISHED_REASON =
  "Where the original value came from is not established: it is available only to members who may read the BOQ until a contract manager enters or confirms it";
const EVENT_REASON =
  "The original value recorded here was not an established contract value: it is available only to members who may read the BOQ";

// FALLBACK's bill: 23 × 613.37 + 9 × 1,777.73 = 30,107.08; the advance agreed
// at 10% of it, 3,010.71.
const FALLBACK_SECRETS = ["30107.08", "3010.71", "14107.51", "15999.57"];
const ENTRY_SECRETS = ["16419.69"];
const LEGACY_SECRETS = ["10370.34"];

liveDescribe("The client contract's original value reaches a member without BOQ read only once it is established", () => {
  let live;
  let other;
  let api;
  const projects = {};
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (key, route) => `/api/v1/projects/${projects[key].id}${route}`;
  const HOME = "/api/v1/projects/workspace-dashboard";

  const storedSource = async (key) =>
    (await prisma.primeContract.findFirst({ where: { projectId: projects[key].id }, select: { originalValueSource: true } }))
      ?.originalValueSource;

  const built = async (key) =>
    primeContractService.serializeContract(
      await primeContractService.ensureContract({ orgId: live.org.id, projectId: projects[key].id }),
    );
  const envelope = (data) => JSON.stringify({ success: true, data: normalizeMoneyTree(data) });
  const history = (key) =>
    auditService.listEvents({
      orgId: live.org.id,
      projectId: projects[key].id,
      entityType: null,
      entityId: null,
      action: null,
      source: "all",
      cursor: null,
      limit: 50,
      order: "asc",
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();

    for (const [key, contractValue] of [["FALLBACK", null], ["VALUED", 41737.29], ["ENTRY", null], ["LEGACY", null]]) {
      projects[key] = await prisma.project.create({
        data: {
          orgId: live.org.id,
          name: `LiveTest contract value ${key}`,
          contractValue,
          startDate: new Date("2026-01-05"),
          endDate: new Date("2026-12-18"),
        },
      });
    }

    // qs / pm without BOQ (ipc kept), a QS who reads both, a member who reads
    // the BOQ but not the IPC, and a QS on no project.
    const addMember = async (key, role, tools) => {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-cvalue-${key.replace(/_/g, "")}-${tag}@octapm-live.test`,
        role,
      });
      if (tools) {
        const template = await prisma.permissionTemplate.create({
          data: { orgId: live.org.id, name: `LiveTest ${key} ${tag}`, baseRole: role, tools: { create: tools } },
        });
        for (const project of Object.values(projects)) {
          await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
          await prisma.projectUserPermission.create({
            data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id },
          });
        }
      } else if (tools === null) {
        for (const project of Object.values(projects)) {
          await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
        }
      }
      members[key] = member;
    };
    await addMember("qs_noboq", "qs", [{ module: "boq", level: "none" }]);
    await addMember("pm_noboq", "pm", [{ module: "boq", level: "none" }]);
    await addMember("qs_reader", "qs", null);
    await addMember("boq_only", "qs", [{ module: "ipc", level: "none" }]);
    await addMember("unassigned", "qs", undefined);

    const createItem = async (key, payload) => {
      const created = await api.post(at(key, "/boq/items"), payload, auth());
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
    };
    await createItem("FALLBACK", { code: "V1.01", description: "VALUESECRET pile caps", quantity: 23, unit: "m3", rate: 613.37 });
    await createItem("FALLBACK", { code: "V1.02", description: "VALUESECRET starter bars", quantity: 9, unit: "t", rate: 1777.73 });
    await createItem("VALUED", { code: "V2.01", description: "Blinding", quantity: 5, unit: "m3", rate: 1234.57 });
    await createItem("ENTRY", { code: "V3.01", description: "Formwork", quantity: 7, unit: "m2", rate: 2345.67 });
    await createItem("LEGACY", { code: "V4.01", description: "Membrane", quantity: 3, unit: "m2", rate: 3456.78 });

    // FALLBACK's terms saved by the owner (contract.manage, BOQ reader) with
    // no original value: the advance becomes 10% of the fallback. A save.
    const terms = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { advanceRate: 10, taxRate: 5 }, headers: auth() });
    expect([terms.status, terms.body?.error, terms.body.data.originalValue, terms.body.data.advanceAmount]).toEqual([200, undefined, 30107.08, 3010.71]);

    // LEGACY: a contract whose row predates the classification — this one
    // row, by its id, in this LiveTest organisation.
    const legacy = await built("LEGACY");
    const org = await prisma.organisation.findUnique({ where: { id: live.org.id }, select: { name: true } });
    expect(org.name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    const row = await prisma.primeContract.findUnique({ where: { id: legacy.id }, select: { orgId: true } });
    expect(row.orgId).toBe(live.org.id);
    await prisma.primeContract.update({ where: { id: legacy.id }, data: { originalValueSource: null } });

    // A contract.manage event as written before the classification: its
    // summaries state the amount and no source. On LEGACY (unestablished
    // now) and on VALUED (project_value now).
    for (const [key, value] of [["LEGACY", 10370.34], ["VALUED", 41737.29]]) {
      await auditService.recordEvent({
        orgId: live.org.id,
        projectId: projects[key].id,
        entityType: auditService.ENTITY_TYPES.PROJECT,
        entityId: projects[key].id,
        action: auditService.ACTIONS.UPDATED,
        actorId: live.user.id,
        summary: { transition: "contract.manage", ref: `LEGACY-${key}` },
        oldSummary: { originalValue: value, retentionRate: 5, advanceRate: 0, taxRate: 0 },
        newSummary: { originalValue: value, retentionRate: 5, advanceRate: 0, taxRate: 2 },
      });
    }
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

  it("classifies on creation, from the server: a project value is established, the bill's total is the fallback", async () => {
    // VALUED and ENTRY have no contract until a first read creates it —
    // here by a member without BOQ access, which decides nothing.
    for (const key of ["VALUED", "ENTRY"]) {
      expect(await storedSource(key)).toBeUndefined();
      expect((await api.get(at(key, "/prime-contract"), as(members.qs_noboq))).status).toBe(200);
    }
    expect(await storedSource("VALUED")).toBe("project_value");
    expect(await storedSource("FALLBACK")).toBe("boq_fallback");
    expect(await storedSource("ENTRY")).toBe("boq_fallback");
    expect(await storedSource("LEGACY")).toBe(null);
  });

  it("B: a BOQ + commercial reader receives the contract, the statement and the history byte for byte", async () => {
    for (const [who, headers] of [["owner", auth()], ["qs_reader", as(members.qs_reader)]]) {
      for (const key of ["FALLBACK", "VALUED", "LEGACY"]) {
        const contract = await api.get(at(key, "/prime-contract"), headers);
        expect([who, key, contract.status, contract.text]).toEqual([who, key, 200, envelope(await built(key))]);
        const statement = await api.get(at(key, "/prime-contract/statement"), headers);
        const builtStatement = await primeContractService.buildStatement({ orgId: live.org.id, projectId: projects[key].id });
        expect([who, key, statement.status, statement.text]).toEqual([who, key, 200, envelope(builtStatement)]);
        const audit = await api.get(at(key, "/audit"), headers);
        expect([who, key, audit.status, audit.text]).toEqual([who, key, 200, envelope(await history(key))]);
      }
    }
    const fallback = (await api.get(at("FALLBACK", "/prime-contract"), auth())).body.data;
    expect([fallback.originalValue, fallback.revisedValue, fallback.originalValueSource]).toEqual([30107.08, 30107.08, "boq_fallback"]);
    expect(fallback).not.toHaveProperty("valueWithheld");
  });

  it("A: a reader without BOQ access reads the established value, and is refused the fallback and everything stating it — with the reason, never zero", async () => {
    const readerValued = await api.get(at("VALUED", "/prime-contract"), auth());
    const readerValuedStatement = await api.get(at("VALUED", "/prime-contract/statement"), auth());
    const readerFallback = (await api.get(at("FALLBACK", "/prime-contract"), auth())).body.data;
    const readerStatement = (await api.get(at("FALLBACK", "/prime-contract/statement"), auth())).body.data;
    const readerHistory = (await api.get(at("FALLBACK", "/audit"), auth())).body.data;

    for (const role of ["qs_noboq", "pm_noboq"]) {
      const headers = as(members[role]);
      expect([role, (await api.get(at("FALLBACK", "/boq"), headers)).status]).toEqual([role, 403]);

      // The established value: exactly the reader's contract; the statement
      // less only its BOQ lines.
      const valued = await api.get(at("VALUED", "/prime-contract"), headers);
      expect([role, valued.status, valued.text]).toEqual([role, 200, readerValued.text]);
      expect(valued.body.data.originalValue).toBe(41737.29);
      const valuedStatement = (await api.get(at("VALUED", "/prime-contract/statement"), headers)).body.data;
      const { lines, ...valuedRest } = readerValuedStatement.body.data;
      expect(lines).toHaveLength(1);
      expect([role, valuedStatement]).toEqual([role, { ...valuedRest, linesWithheld: valuedStatement.linesWithheld }]);
      expect(valuedStatement.summary.originalValue).toBe(41737.29);

      // The fallback: the contract without the amount.
      const contract = await api.get(at("FALLBACK", "/prime-contract"), headers);
      const { originalValue, revisedValue, advanceAmount, ...kept } = readerFallback;
      expect([originalValue, revisedValue, advanceAmount]).toEqual([30107.08, 30107.08, 3010.71]);
      expect([role, contract.status, contract.body.data]).toEqual([
        role,
        200,
        { ...kept, valueWithheld: { keys: ["originalValue", "revisedValue", "advanceAmount"], source: "boq_fallback", reason: FALLBACK_REASON } },
      ]);

      // The statement: the contract as above, the summary without the
      // amount and what states it; certificates, periods stay.
      const statement = await api.get(at("FALLBACK", "/prime-contract/statement"), headers);
      const summary = { ...readerStatement.summary };
      expect([summary.originalValue, summary.revisedValue, summary.remainingToCertify, summary.advanceAmount]).toEqual([30107.08, 30107.08, 30107.08, 3010.71]);
      for (const key of ["originalValue", "revisedValue", "remainingToCertify", "advanceAmount"]) delete summary[key];
      expect([role, statement.status, statement.body.data.summary]).toEqual([
        role,
        200,
        {
          ...summary,
          valueWithheld: { keys: ["originalValue", "revisedValue", "remainingToCertify", "advanceAmount"], source: "boq_fallback", reason: FALLBACK_REASON },
        },
      ]);
      expect(statement.body.data.contract).toEqual(contract.body.data);
      expect([statement.body.data.current, statement.body.data.periods]).toEqual([readerStatement.current, readerStatement.periods]);

      // The history: every contract.manage summary loses the fallback.
      const audit = await api.get(at("FALLBACK", "/audit"), headers);
      expect([role, audit.status]).toEqual([role, 200]);
      const manage = audit.body.data.events.filter((event) => event.summary?.transition === "contract.manage");
      const readerManage = readerHistory.events.filter((event) => event.summary?.transition === "contract.manage");
      expect(readerManage.map((event) => event.newSummary.originalValue)).toEqual([30107.08]);
      expect([role, manage.length]).toEqual([role, 1]);
      expect([role, manage[0].valueWithheld]).toEqual([role, { parts: ["oldSummary", "newSummary"], keys: ["originalValue"], reason: EVENT_REASON }]);
      expect([role, manage[0].actorId, manage[0].newSummary.advanceRate]).toEqual([role, live.user.id, 10]);

      // LEGACY: unestablished, withheld with its own reason.
      const legacy = await api.get(at("LEGACY", "/prime-contract"), headers);
      expect([role, legacy.status, legacy.body.data.valueWithheld]).toEqual([
        role,
        200,
        { keys: ["originalValue", "revisedValue"], source: "unestablished", reason: UNESTABLISHED_REASON },
      ]);

      // An event written before the classification: its amount stays where
      // the contract is project_value now, and is withheld where the source
      // is not established.
      const legacyOf = async (key) =>
        (await api.get(at(key, "/audit"), headers)).body.data.events.find((event) => event.summary?.ref === `LEGACY-${key}`);
      const valuedLegacy = await legacyOf("VALUED");
      expect([role, valuedLegacy.oldSummary.originalValue, valuedLegacy.newSummary.originalValue, "valueWithheld" in valuedLegacy]).toEqual([role, 41737.29, 41737.29, false]);
      const unestablishedLegacy = await legacyOf("LEGACY");
      expect([role, "originalValue" in unestablishedLegacy.oldSummary, "originalValue" in unestablishedLegacy.newSummary, unestablishedLegacy.valueWithheld]).toEqual([
        role,
        false,
        false,
        { parts: ["oldSummary", "newSummary"], keys: ["originalValue"], reason: EVENT_REASON },
      ]);

      // A receipt over the advance agreed (10% of the fallback) is refused
      // without stating the agreed figure (the PM records receipts,
      // ipc:create advance.record); the BOQ reader is told it.
      const over = await api.post(at("FALLBACK", "/prime-contract/advances"), { amount: 999999 }, headers);
      expect([role, over.status, over.body.error?.code]).toEqual(
        role === "pm_noboq" ? [role, 409, "ADVANCE_OVER_AGREED"] : [role, 403, "FORBIDDEN"],
      );
      expect([role, over.text.includes("3010.71")]).toEqual([role, false]);
      const readerOver = await api.post(at("FALLBACK", "/prime-contract/advances"), { amount: 999999 }, auth());
      expect([readerOver.status, readerOver.body.error?.message.includes("3010.71")]).toEqual([409, true]);

      // Never zero, never anywhere: the reads, the history, the home page.
      const home = await api.get(HOME, headers);
      expect([role, home.status]).toEqual([role, 200]);
      const answers = {
        contract,
        statement,
        audit,
        home,
        legacy,
        legacyStatement: await api.get(at("LEGACY", "/prime-contract/statement"), headers),
        legacyAudit: await api.get(at("LEGACY", "/audit"), headers),
        receivables: await api.get(at("FALLBACK", "/prime-contract/receivables"), headers),
        advances: await api.get(at("FALLBACK", "/prime-contract/advances"), headers),
      };
      for (const [name, answer] of Object.entries(answers)) {
        expect([role, name, answer.status]).toEqual([role, name, 200]);
        for (const secret of [...FALLBACK_SECRETS, ...LEGACY_SECRETS]) {
          expect([role, name, secret, answer.text.includes(secret)]).toEqual([role, name, secret, false]);
        }
      }
      for (const holder of [contract.body.data, statement.body.data.contract, statement.body.data.summary, legacy.body.data]) {
        expect([role, "originalValue" in holder, "revisedValue" in holder]).toEqual([role, false, false]);
      }
    }
  });

  it("E: BOQ read alone does not open the contract routes", async () => {
    const headers = as(members.boq_only);
    expect((await api.get(at("FALLBACK", "/boq"), headers)).status).toBe(200);
    for (const [method, route, body] of [
      ["GET", "/prime-contract"],
      ["GET", "/prime-contract/statement"],
      ["PATCH", "/prime-contract", { confirmOriginalValue: true }],
    ]) {
      const answer = await api.request(method, at("FALLBACK", route), { body, headers });
      expect([method, route, answer.status, answer.body?.success]).toEqual([method, route, 403, false]);
      for (const secret of FALLBACK_SECRETS) expect([route, secret, answer.text.includes(secret)]).toEqual([route, secret, false]);
    }
    expect(await storedSource("FALLBACK")).toBe("boq_fallback");
  });

  it("F: another organisation, and a member not on the project, are refused as before", async () => {
    for (const [who, headers] of [["other org", { authorization: `Bearer ${other.token}` }], ["unassigned", as(members.unassigned)]]) {
      for (const [method, route, body] of [
        ["GET", "/prime-contract"],
        ["GET", "/prime-contract/statement"],
        ["PATCH", "/prime-contract", { confirmOriginalValue: true }],
      ]) {
        const answer = await api.request(method, at("FALLBACK", route), { body, headers });
        expect([who, method, route, [403, 404].includes(answer.status), answer.body?.success]).toEqual([who, method, route, true, false]);
        for (const secret of FALLBACK_SECRETS) expect([who, route, secret, answer.text.includes(secret)]).toEqual([who, route, secret, false]);
      }
    }
    expect(await storedSource("FALLBACK")).toBe("boq_fallback");
  });

  it("C: the source is the server's; reads and saves leave the fallback a fallback; confirming it needs contract.manage and BOQ read, and is audited", async () => {
    const before = await prisma.primeContract.findFirst({ where: { projectId: projects.FALLBACK.id } });

    // A client cannot say where the value came from.
    for (const body of [{ originalValueSource: "project_value" }, { originalValueSource: "contract_entry", taxRate: 5 }]) {
      const spoof = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body, headers: auth() });
      expect([spoof.status, spoof.body.error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    }
    const spoofNoBoq = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { originalValueSource: "project_value" }, headers: as(members.pm_noboq) });
    expect([spoofNoBoq.status, spoofNoBoq.body.error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(await storedSource("FALLBACK")).toBe("boq_fallback");

    // Reads and ordinary saves — the terms alone, or the stored value sent
    // back — never promote it.
    for (const headers of [auth(), as(members.qs_reader), as(members.qs_noboq), as(members.pm_noboq)]) {
      await api.get(at("FALLBACK", "/prime-contract"), headers);
      await api.get(at("FALLBACK", "/prime-contract/statement"), headers);
    }
    for (const body of [{ taxRate: 5 }, { originalValue: 30107.08 }, { originalValue: 30107.08, notes: "LiveTest save" }, { confirmOriginalValue: false }]) {
      const save = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body, headers: auth() });
      expect([body, save.status, save.body.data?.originalValueSource]).toEqual([body, 200, "boq_fallback"]);
    }
    const noBoqSave = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { taxRate: 5 }, headers: as(members.pm_noboq) });
    expect([noBoqSave.status, noBoqSave.body.data.valueWithheld?.source]).toEqual([200, "boq_fallback"]);
    for (const secret of FALLBACK_SECRETS) expect([secret, noBoqSave.text.includes(secret)]).toEqual([secret, false]);
    expect(await storedSource("FALLBACK")).toBe("boq_fallback");

    // A contract manager without BOQ access may not confirm the fallback.
    for (const member of [members.pm_noboq, members.qs_noboq]) {
      const refused = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { confirmOriginalValue: true }, headers: as(member) });
      expect([refused.status, refused.body.error?.code]).toEqual([403, "CONTRACT_VALUE_CONFIRM_FORBIDDEN"]);
      for (const secret of FALLBACK_SECRETS) expect([secret, refused.text.includes(secret)]).toEqual([secret, false]);
    }
    expect(await storedSource("FALLBACK")).toBe("boq_fallback");

    // Confirming and entering together is refused.
    const both = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { confirmOriginalValue: true, originalValue: 30107.08 }, headers: auth() });
    expect([both.status, both.body.error?.code]).toEqual([400, "CONTRACT_VALUE_CONFIRM_CONFLICT"]);

    // The owner — contract.manage and BOQ read — confirms it: the source
    // moves, no figure does, and the audit records who and when.
    const startedAt = Date.now();
    const confirmed = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { confirmOriginalValue: true }, headers: auth() });
    expect([confirmed.status, confirmed.body.error, confirmed.body.data.originalValueSource, confirmed.body.data.originalValue]).toEqual([200, undefined, "contract_entry", 30107.08]);
    const after = await prisma.primeContract.findFirst({ where: { projectId: projects.FALLBACK.id } });
    for (const key of ["originalValue", "revisedValue", "approvedChangesValue", "pendingChangesValue", "advanceAmount", "advancePaidAmount", "advanceRecoveredAmount"]) {
      expect([key, String(after[key])]).toEqual([key, String(before[key])]);
    }
    expect([after.originalValueSource, after.updatedBy]).toEqual(["contract_entry", live.user.id]);
    const event = await prisma.auditEvent.findFirst({
      where: { orgId: live.org.id, projectId: projects.FALLBACK.id, entityType: "project" },
      orderBy: { occurredAt: "desc" },
    });
    expect([event.actorId, event.summaryJson, event.oldSummaryJson.originalValueSource, event.newSummaryJson.originalValueSource]).toEqual([
      live.user.id,
      { transition: "contract.manage", ref: after.ref, originalValueConfirmation: "confirmed" },
      "boq_fallback",
      "contract_entry",
    ]);
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(startedAt - 5_000);

    // Established now: the reader without BOQ access receives it as the
    // reader does. The history's earlier fallback summaries stay withheld.
    const reader = await api.get(at("FALLBACK", "/prime-contract"), auth());
    const noBoq = await api.get(at("FALLBACK", "/prime-contract"), as(members.qs_noboq));
    expect([noBoq.status, noBoq.text]).toEqual([200, reader.text]);
    const audit = (await api.get(at("FALLBACK", "/audit"), as(members.qs_noboq))).body.data.events.filter(
      (row) => row.summary?.transition === "contract.manage",
    );
    const last = audit[audit.length - 1];
    expect([last.summary.originalValueConfirmation, last.oldSummary.originalValue, last.newSummary.originalValue, last.valueWithheld.parts]).toEqual([
      "confirmed",
      undefined,
      30107.08,
      ["oldSummary"],
    ]);

    // Nothing left to confirm.
    const again = await api.request("PATCH", at("FALLBACK", "/prime-contract"), { body: { confirmOriginalValue: true }, headers: auth() });
    expect([again.status, again.body.error?.code]).toEqual([409, "CONTRACT_VALUE_ALREADY_ESTABLISHED"]);

    // A contract manager without BOQ access enters an amount of their own
    // through the existing path: established, visible, and revealing
    // nothing of the fallback it replaced.
    const entered = await api.request("PATCH", at("ENTRY", "/prime-contract"), { body: { originalValue: 55555.55 }, headers: as(members.pm_noboq) });
    expect([entered.status, entered.body.data.originalValue, entered.body.data.originalValueSource, entered.body.data.revisedValue]).toEqual([200, 55555.55, "contract_entry", 55555.55]);
    expect(await storedSource("ENTRY")).toBe("contract_entry");
    const enteredAudit = await api.get(at("ENTRY", "/audit"), as(members.pm_noboq));
    const entry = enteredAudit.body.data.events.filter((row) => row.summary?.transition === "contract.manage").pop();
    expect([entry.actorId, entry.summary.originalValueConfirmation, entry.newSummary.originalValue, "originalValue" in entry.oldSummary]).toEqual([
      members.pm_noboq.id,
      "entered",
      55555.55,
      false,
    ]);
    for (const answer of [entered, enteredAudit]) {
      for (const secret of ENTRY_SECRETS) expect([secret, answer.text.includes(secret)]).toEqual([secret, false]);
    }
  });
});
