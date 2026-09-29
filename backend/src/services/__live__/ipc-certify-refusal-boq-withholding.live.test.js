/**
 * An IPC certification refused for want of a PM override carries no BOQ
 * figure to a member who may not read the BOQ — proven against a real API
 * process and the real local Postgres (owner check, 2026-09-29).
 *
 * POST /projects/:id/ipc/:period/certify is admitted on ipc:certify (the PM
 * and finance). A period that claims more than approved progress earned
 * needs a PM override: certify refuses it with 400
 * IPC_PM_OVERRIDE_REASON_REQUIRED (no reason given) or 403
 * IPC_PM_OVERRIDE_REQUIRED (a reason, but not a PM), and states the
 * certification review as error.details — worked from the BoqItem row and
 * its ActivityBoqAllocation: the allocation's amount as approvedLimitAmount,
 * what approved progress earned against it, the over-earned amount, the
 * over-approved quantity, the count of lines needing an override. Every
 * non-production API sends error.details.
 *
 * A PM and a finance member whose templates set the BOQ tool to none (both
 * refused GET /boq, both admitted to certify) receive each refusal with its
 * status, code and message — the business reason — and `boqWithheld` in
 * place of the review: no allocation amount, earned or over-earned figure,
 * quantity or override count, no BoqItem id, code, description or rate, no
 * allocation id. With a reason the PM certifies, as before.
 *
 * The BOQ reader (the PM who owns the organisation, and a finance member on
 * the role's own access) receives the review exactly as the service states
 * it, byte for byte.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/ipc-certify-refusal-boq-withholding.live.test.js
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
const ipcService = require("../ipc.service");
const { startApi } = require("./auth-live-kit");

const REVIEW_WITHHELD =
  "The certification review is worked from the BOQ's rows and their allocations, available only to members who may read the BOQ";
const WITHHELD_DETAILS = { boqWithheld: { keys: ["certificationReview"], reason: REVIEW_WITHHELD } };

liveDescribe("An IPC certification refused for want of a PM override carries no BOQ figure to a member who may not read the BOQ", () => {
  let live;
  let api;
  let project;
  let row;
  let allocationId;
  let progressId;
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;

  // The refusal the service itself states, and the envelope a BOQ reader is
  // given for it: the same code, message and review, byte for byte.
  const serviceRefusal = async (args) => {
    try {
      await ipcService.certifyIpcPeriod({ orgId: live.org.id, projectId: project.id, period: "P01", ...args });
    } catch (error) {
      return error;
    }
    throw new Error("certify did not refuse");
  };
  const envelope = (error, requestId) =>
    JSON.stringify({
      success: false,
      error: { code: error.code, message: error.message, details: normalizeMoneyTree(error.details), requestId },
    });

  // What the review is made of, and the row and allocation behind it —
  // wherever it would sit in a refusal.
  const secrets = () => [
    row.id,
    allocationId,
    "Z9.81",
    "REVIEWSECRET",
    "487.61",
    "18041.57",
    "1804.16",
    "16237.41",
    "earnedAmount",
    "approvedLimitAmount",
    "overEarnedAmount",
    "overApprovedQuantity",
    "overrideLineCount",
    "requiresPmOverride",
  ];

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest IPC certify refusal", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    // The two roles that may certify, each without the BOQ tool; and a
    // finance member on the role's own access, who reads the BOQ.
    const addMember = async (key, role, { noBoq }) => {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-ipc-refusal-${key.replace(/[^a-z]/g, "")}-${tag}@octapm-live.test`,
        role,
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      if (noBoq) {
        const template = await prisma.permissionTemplate.create({
          data: {
            orgId: live.org.id,
            name: `LiveTest ${key}, no BOQ ${tag}`,
            baseRole: role,
            tools: { create: [{ module: "boq", level: "none" }] },
          },
        });
        await prisma.projectUserPermission.create({
          data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id },
        });
      }
      members[key] = member;
    };
    await addMember("pm", "pm", { noBoq: true });
    await addMember("finance", "finance", { noBoq: true });
    await addMember("financeReader", "finance", { noBoq: false });

    // One priced row, allocated in full to one activity and approved.
    const created = await api.post(at("/boq/items"), { code: "Z9.81", description: "REVIEWSECRET grout to baseplates", quantity: 37, unit: "m3", rate: 487.61 }, auth());
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    row = created.body.data.item;
    const activity = await api.post(at("/activities"), {
      engineerIds: [live.user.id],
      name: "Grout baseplates",
      activityCode: "A910",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    expect([activity.status, activity.body?.error]).toEqual([201, undefined]);
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: row.id, activityId: activity.body.data.id, quantity: 37 }, auth());
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    allocationId = allocation.body.data.id;
    for (const step of ["submit", "approve"]) {
      const moved = await api.post(at(`/activity-boq-allocations/${allocationId}/${step}`), {}, auth());
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }

    // The work approved complete, the whole row claimed on P01 ...
    const progress = await prisma.activityProgress.create({
      data: { activityId: activity.body.data.id, pctComplete: 100, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
    });
    progressId = progress.id;
    const terms = await api.request("PATCH", at("/prime-contract"), { body: { originalValue: 250000, retentionRate: 5 }, headers: auth() });
    expect([terms.status, terms.body?.error]).toEqual([200, undefined]);
    const period = await api.post(at("/ipc"), { period: "P01" }, auth());
    expect([period.status, period.body?.error]).toEqual([201, undefined]);
    expect(period.body.data.items).toHaveLength(1);
    const claimed = await api.request("PATCH", at(`/ipc/P01/items/${period.body.data.items[0].id}`), { body: { qty: 37 }, headers: auth() });
    expect([claimed.status, claimed.body?.error]).toEqual([200, undefined]);

    // ... then the approved progress taken back to 10% (this project's one
    // progress row, by its id), and the period submitted: it now claims
    // more than approved progress earned, and certifying needs an override.
    await prisma.activityProgress.update({ where: { id: progressId }, data: { pctComplete: 10 } });
    const submitted = await api.post(at("/ipc/P01/submit"), {}, auth());
    expect([submitted.status, submitted.body?.error, submitted.body.data.status]).toEqual([200, undefined, "submitted"]);
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

  it("a BOQ reader is refused with the certification review as the service states it, byte for byte", async () => {
    // No reason: 400, the PM who owns the organisation.
    const noReason = await serviceRefusal({ userId: live.user.id, userRole: "pm" });
    expect(noReason.code).toBe("IPC_PM_OVERRIDE_REASON_REQUIRED");
    const answer = await api.post(at("/ipc/P01/certify"), {}, auth());
    expect(answer.status).toBe(400);
    expect(answer.text).toBe(envelope(noReason, answer.body.error.requestId));
    // What the review is: the allocation's amount, 10% of it earned, the
    // rest over-earned, on one line.
    expect(answer.body.error.details).toMatchObject({
      currentClaimedAmount: 18041.57,
      earnedAmount: 1804.16,
      approvedLimitAmount: 18041.57,
      overEarnedAmount: 16237.41,
      overrideLineCount: 1,
      requiresPmOverride: true,
    });

    // A reason, but not a PM: 403, finance on the role's own access.
    const notPm = await serviceRefusal({ userId: members.financeReader.id, userRole: "finance", overrideReason: "LiveTest" });
    expect(notPm.code).toBe("IPC_PM_OVERRIDE_REQUIRED");
    const boq = await api.get(at("/boq"), as(members.financeReader));
    expect(boq.status).toBe(200);
    const finance = await api.post(at("/ipc/P01/certify"), { overrideReason: "LiveTest" }, as(members.financeReader));
    expect(finance.status).toBe(403);
    expect(finance.text).toBe(envelope(notPm, finance.body.error.requestId));
    expect(finance.body.error.details.approvedLimitAmount).toBe(18041.57);
  });

  it("a PM and finance without BOQ read are refused with the reason and without the review, and the PM certifies with a reason", async () => {
    const reader = (await api.post(at("/ipc/P01/certify"), {}, auth())).body.error;
    const readerNotPm = (await api.post(at("/ipc/P01/certify"), { overrideReason: "LiveTest" }, as(members.financeReader))).body.error;

    const refusals = {
      "pm, no reason": [members.pm, {}, 400, reader],
      "finance, no reason": [members.finance, {}, 400, reader],
      "finance, a reason": [members.finance, { overrideReason: "LiveTest" }, 403, readerNotPm],
    };
    for (const [name, [member, body, status, readerError]] of Object.entries(refusals)) {
      // The BOQ tool is refused them; certifying is not.
      const boq = await api.get(at("/boq"), as(member));
      expect([name, boq.status]).toEqual([name, 403]);

      const answer = await api.post(at("/ipc/P01/certify"), body, as(member));
      expect([name, answer.status]).toEqual([name, status]);
      // The business reason stays: the same code and message the reader is given.
      expect([name, answer.body.error]).toEqual([
        name,
        { code: readerError.code, message: readerError.message, details: WITHHELD_DETAILS, requestId: answer.body.error.requestId },
      ]);
      for (const secret of secrets()) {
        expect([name, secret, answer.text.includes(secret)]).toEqual([name, secret, false]);
      }
    }

    // The period is still submitted; with a reason the PM certifies it, and
    // the certificate answered carries no review either.
    const certified = await api.post(at("/ipc/P01/certify"), { overrideReason: "LiveTest override" }, as(members.pm));
    expect([certified.status, certified.body?.error, certified.body.data.status]).toEqual([200, undefined, "certified"]);
    expect(certified.body.data.boqWithheld.keys).toEqual(["earnedValueAtCertification", "approvedLimitAtCertification", "overCertificationAmount"]);
    for (const secret of [row.id, allocationId, "Z9.81", "REVIEWSECRET", "487.61", "1804.16", "16237.41", "earnedAmount", "overrideLineCount"]) {
      expect(["certified", secret, certified.text.includes(secret)]).toEqual(["certified", secret, false]);
    }
  });
});
