/**
 * The client billing statement carries no BOQ row to a member who may not
 * read the BOQ — proven against a real API process and the real local
 * Postgres (owner check, 2026-09-29).
 *
 * GET /projects/:id/prime-contract/statement is admitted on ipc:read, which
 * the QS, the cost controller, finance and the PM hold. Its schedule of
 * values (`lines`) is not a record the commercial module keeps: each line is
 * a live BoqItem row — id, code, section, description, unit, quantity, rate,
 * amount (as contractAmount) — read off the bill when the statement is built.
 * Four members whose templates set the BOQ tool to none, and who keep ipc
 * (refused GET /boq, admitted to the statement), receive:
 *
 *   the statement without `lines`, with `linesWithheld: { reason }` — and
 *   everything else (the contract, the summary, the current certificate, the
 *   periods) exactly as the BOQ reader receives it;
 *   no BoqItem id, code, description, quantity, rate or amount, and no
 *   allocation id, anywhere in the statement, nor in the contract,
 *   receivables and advances reads beside it.
 *
 * The payment certificate beside it (GET /ipc/:period, the same ipc:read)
 * listed the same rows: each line its BoqItem row, its allocation and its
 * progress link, and the review worked over them. The same members receive
 * the certificate without its lines, its review or the review stamped on it
 * at certification — in the period read, the list, and the certificate that
 * submitting and certifying answer with — and the answer to editing a line
 * names the line and nothing of it.
 *
 * The BOQ reader receives the service's answer, byte for byte.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/billing-statement-boq-withholding.live.test.js
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
const ipcService = require("../ipc.service");
const { startApi } = require("./auth-live-kit");

const WITHHELD_REASON = "The schedule of values is the BOQ's rows, available only to members who may read the BOQ";
const IPC_WITHHELD_REASON =
  "The certificate's lines are the BOQ's rows and their allocations, available only to members who may read the BOQ";
const IPC_BOQ_KEYS = ["items", "certificationReview", "earnedValueAtCertification", "approvedLimitAtCertification", "overCertificationAmount"];

// The certificate a BOQ reader is given, as a member without BOQ read must
// receive it: the same record less the keys worked from the BOQ's rows.
const withoutBoq = (certificate) => {
  const keys = IPC_BOQ_KEYS.filter((key) => key in certificate);
  const kept = Object.fromEntries(Object.entries(certificate).filter(([key]) => !keys.includes(key)));
  return { ...kept, boqWithheld: { keys, reason: IPC_WITHHELD_REASON } };
};

liveDescribe("The client billing statement carries no BOQ row to a member who may not read the BOQ", () => {
  let live;
  let api;
  let project;
  let rows;
  let allocationId;
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest billing statement", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    // The commercial readers the report named — each keeps its role's ipc
    // access; the template takes the BOQ tool away.
    for (const role of ["qs", "cost_controller", "finance", "pm"]) {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${role}`,
        email: `live-billing-${role.replace(/_/g, "")}-${tag}@octapm-live.test`,
        role,
      });
      const template = await prisma.permissionTemplate.create({
        data: {
          orgId: live.org.id,
          name: `LiveTest ${role}, no BOQ ${tag}`,
          baseRole: role,
          tools: { create: [{ module: "boq", level: "none" }] },
        },
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      await prisma.projectUserPermission.create({
        data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id },
      });
      members[role] = member;
    }

    // Two priced rows with figures nothing else in these answers could produce.
    const createItem = async (payload) => {
      const created = await api.post(at("/boq/items"), payload, auth());
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data.item;
    };
    rows = [
      await createItem({ code: "Z9.71", description: "SOVSECRET grout to baseplates", quantity: 37, unit: "m3", rate: 487.61 }),
      await createItem({ code: "Z9.72", description: "SOVSECRET anchor bolts", quantity: 11, unit: "nr", rate: 1311.29 }),
    ];

    // One approved allocation, so the period has an IPC item against a row.
    const activity = await api.post(at("/activities"), {
      engineerIds: [live.user.id],
      name: "Grout baseplates",
      activityCode: "A900",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    expect([activity.status, activity.body?.error]).toEqual([201, undefined]);
    const allocation = await api.post(at("/activity-boq-allocations"), {
      boqItemId: rows[0].id,
      activityId: activity.body.data.id,
      quantity: 37,
    }, auth());
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    allocationId = allocation.body.data.id;
    for (const step of ["submit", "approve"]) {
      const moved = await api.post(at(`/activity-boq-allocations/${allocationId}/${step}`), {}, auth());
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }

    // The contract's own value and terms, entered through the contract
    // (ipc:update contract.manage), and a period to report.
    const terms = await api.request("PATCH", at("/prime-contract"), {
      body: { originalValue: 250000, retentionRate: 5, taxRate: 7.5 },
      headers: auth(),
    });
    expect([terms.status, terms.body?.error]).toEqual([200, undefined]);
    const period = await api.post(at("/ipc"), { period: "P01" }, auth());
    expect([period.status, period.body?.error]).toEqual([201, undefined]);
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

  it("the BOQ reader receives the service's statement byte for byte, with the BOQ rows as its schedule of values", async () => {
    const answer = await api.get(at("/prime-contract/statement"), auth());
    expect(answer.status).toBe(200);
    const built = await primeContractService.buildStatement({ orgId: live.org.id, projectId: project.id });
    expect(answer.text).toBe(JSON.stringify({ success: true, data: normalizeMoneyTree(built) }));
    // What the lines are: the BOQ rows, read live.
    expect(answer.body.data.lines.map((line) => [line.boqItemId, line.code, line.description, line.quantity, line.rate, line.contractAmount])).toEqual([
      [rows[0].id, "Z9.71", "SOVSECRET grout to baseplates", 37, 487.61, 18041.57],
      [rows[1].id, "Z9.72", "SOVSECRET anchor bolts", 11, 1311.29, 14424.19],
    ]);
    expect(answer.body.data).not.toHaveProperty("linesWithheld");
    expect(answer.body.data.current.period).toBe("P01");
  });

  it("a QS, a cost controller, finance and a PM without BOQ read receive the statement without its BOQ rows, and are told why", async () => {
    const reader = await api.get(at("/prime-contract/statement"), auth());
    const { lines, ...rest } = reader.body.data;
    expect(lines).toHaveLength(2);
    const expected = { ...rest, linesWithheld: { reason: WITHHELD_REASON } };

    // What must not reach them, wherever it would sit.
    const secrets = [
      ...rows.map((row) => row.id),
      allocationId,
      "Z9.71",
      "Z9.72",
      "SOVSECRET",
      "487.61",
      "1311.29",
      "18041.57",
      "14424.19",
      "32465.76",
    ];

    for (const [role, member] of Object.entries(members)) {
      const memberAuth = as(member);
      // The BOQ tool is refused them; the statement is not.
      const boq = await api.get(at("/boq"), memberAuth);
      expect([role, boq.status]).toEqual([role, 403]);
      const statement = await api.get(at("/prime-contract/statement"), memberAuth);
      expect([role, statement.status, statement.body.data]).toEqual([role, 200, expected]);
      expect([role, "lines" in statement.body.data]).toEqual([role, false]);

      // Nor through the contract's other reads.
      const sibling = {
        statement,
        contract: await api.get(at("/prime-contract"), memberAuth),
        receivables: await api.get(at("/prime-contract/receivables"), memberAuth),
        advances: await api.get(at("/prime-contract/advances"), memberAuth),
        period: await api.get(at("/prime-contract/statement?period=P01"), memberAuth),
      };
      for (const [name, answer] of Object.entries(sibling)) {
        expect([role, name, answer.status]).toEqual([role, name, 200]);
        for (const secret of secrets) {
          expect([role, name, secret, answer.text.includes(secret)]).toEqual([role, name, secret, false]);
        }
      }
    }
  });

  // The rows the certificate's lines carry, wherever they would sit.
  const ipcSecrets = () => [
    ...rows.map((row) => row.id),
    allocationId,
    "Z9.71",
    "SOVSECRET",
    "487.61",
    "18041.57",
  ];

  it("the BOQ reader receives the payment certificate byte for byte, its lines the BOQ rows with their allocations", async () => {
    const answer = await api.get(at("/ipc/P01"), auth());
    expect(answer.status).toBe(200);
    const built = await ipcService.getIpcPeriod({ orgId: live.org.id, projectId: project.id, period: "P01" });
    expect(answer.text).toBe(JSON.stringify({ success: true, data: normalizeMoneyTree(built) }));
    expect(answer.body.data.items.map((item) => [item.boqItemId, item.boqItem.code, item.boqItem.description, item.boqItem.rate, item.allocation.id, item.allocation.amount])).toEqual([
      [rows[0].id, "Z9.71", "SOVSECRET grout to baseplates", 487.61, allocationId, 18041.57],
    ]);
    expect(answer.body.data.certificationReview).toBeDefined();
    expect(answer.body.data).not.toHaveProperty("boqWithheld");
  });

  it("members without BOQ read receive the payment certificate without its lines or review, and are told why — read, list, edit, submit and certify", async () => {
    const reader = (await api.get(at("/ipc/P01"), auth())).body.data;
    expect(reader.items).toHaveLength(1);
    const itemId = reader.items[0].id;

    for (const [role, member] of Object.entries(members)) {
      const memberAuth = as(member);
      const period = await api.get(at("/ipc/P01"), memberAuth);
      expect([role, period.status, period.body.data]).toEqual([role, 200, withoutBoq(reader)]);
      expect([role, period.body.data.boqWithheld.keys]).toEqual([role, IPC_BOQ_KEYS]);
      const list = await api.get(at("/ipc"), memberAuth);
      expect([role, list.status]).toEqual([role, 200]);
      for (const [name, answer] of Object.entries({ period, list })) {
        for (const secret of ipcSecrets()) {
          expect([role, name, secret, answer.text.includes(secret)]).toEqual([role, name, secret, false]);
        }
      }
    }

    // Editing a line (ipc:update item.update — the QS and the PM): the
    // answer names the line written and nothing of it. The BOQ reader's
    // answer to the same write carries the row.
    const readerEdit = await api.request("PATCH", at(`/ipc/P01/items/${itemId}`), { body: { retentionRate: 5 }, headers: auth() });
    expect([readerEdit.status, readerEdit.body.data.boqItem.code]).toEqual([200, "Z9.71"]);
    for (const role of ["qs", "pm"]) {
      const edit = await api.request("PATCH", at(`/ipc/P01/items/${itemId}`), { body: { retentionRate: 5 }, headers: as(members[role]) });
      expect([role, edit.status, edit.body.data]).toEqual([role, 200, { id: itemId, itemWithheld: { reason: IPC_WITHHELD_REASON } }]);
    }

    // Submitting (the QS) and certifying (the PM) answer with the
    // certificate — certified, it carries the review stamped from the
    // allocation (approvedLimitAtCertification = the allocation's 18041.57).
    const submitted = await api.post(at("/ipc/P01/submit"), {}, as(members.qs));
    expect([submitted.status, submitted.body?.error, submitted.body.data.status]).toEqual([200, undefined, "submitted"]);
    const certified = await api.post(at("/ipc/P01/certify"), { comment: "LiveTest" }, as(members.pm));
    expect([certified.status, certified.body?.error, certified.body.data.status]).toEqual([200, undefined, "certified"]);
    for (const [name, answer] of Object.entries({ submitted, certified })) {
      expect([name, answer.body.data.boqWithheld]).toEqual([
        name,
        { keys: ["earnedValueAtCertification", "approvedLimitAtCertification", "overCertificationAmount"], reason: IPC_WITHHELD_REASON },
      ]);
      for (const secret of ipcSecrets()) {
        expect([name, secret, answer.text.includes(secret)]).toEqual([name, secret, false]);
      }
    }

    // The stamp is there for the BOQ reader, and in nobody else's list.
    const readerList = await api.get(at("/ipc"), auth());
    expect(readerList.body.data[0].approvedLimitAtCertification).toBe(18041.57);
    for (const [role, member] of Object.entries(members)) {
      const list = await api.get(at("/ipc"), as(member));
      expect([role, list.body.data]).toEqual([role, readerList.body.data.map(withoutBoq)]);
      expect([role, list.text.includes("18041.57")]).toEqual([role, false]);
    }
  });
});
