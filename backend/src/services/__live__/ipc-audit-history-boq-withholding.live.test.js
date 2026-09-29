/**
 * A payment certificate's history carries no certification review to a
 * member who may not read the BOQ — proven against a real API process and
 * the real local Postgres (owner check, 2026-09-29, follow-up to 78a2500).
 *
 * Certifying a period (ipc.service certifyIpcPeriod) records the
 * certification review — worked from the certificate's lines, the BoqItem
 * row and its ActivityBoqAllocation: the allocation's amount as
 * approvedLimitAmount, what approved progress earned against it, the
 * over-earned amount, the over-approved quantity, the count of lines
 * needing an override — and the count of lines linked to progress evidence,
 * in the ipc_certificate audit event's summary and in the approval event's
 * metadata. GET /projects/:id/audit is admitted on audit:read, which every
 * role holds; the IPC workbook's status history reads it.
 *
 * A PM, a finance member and a site engineer (who holds no IPC read) whose
 * templates set the BOQ tool to none receive the
 * history with every event — who certified, when, the status, the
 * certificate's totals and the override reason — and without the review or
 * the progress-link count: `boqWithheld` names them and says why. The stored
 * rows are not changed. A BOQ reader (the PM who owns the organisation, and a
 * finance member on the role's own access) receives the history exactly as
 * the service builds it, byte for byte.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/ipc-audit-history-boq-withholding.live.test.js
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
const auditService = require("../audit.service");
const { startApi } = require("./auth-live-kit");

const REVIEW_WITHHELD =
  "The certification review is worked from the BOQ's rows and their allocations, available only to members who may read the BOQ";
const MARKER = { keys: ["certificationReview", "progressLinks"], reason: REVIEW_WITHHELD };
const WITHHELD_KEYS = MARKER.keys;

const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

liveDescribe("A payment certificate's history carries no certification review to a member who may not read the BOQ", () => {
  let live;
  let api;
  let project;
  let row;
  let allocationId;
  let certificateId;
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;

  // The history reads the IPC workbook and the audit screen make.
  const QUERIES = {
    "the certificate's history": { entityType: "ipc_certificate", entityId: () => certificateId },
    "the certificate's audit events": { entityType: "ipc_certificate", source: "audit" },
    "the certificate's approval events": { entityType: "ipc_certificate", source: "approval" },
    "the whole project history": {},
  };
  const queryString = (query) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) params.set(key, typeof value === "function" ? value() : value);
    const text = params.toString();
    return text ? `?${text}` : "";
  };

  // What the review is made of, and the row and allocation behind it.
  let secrets;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest IPC audit history", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    const addMember = async (key, role, { noBoq }) => {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-ipc-history-${key.replace(/[^a-z]/gi, "").toLowerCase()}-${tag}@octapm-live.test`,
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
    await addMember("siteEngineer", "site_engineer", { noBoq: true });
    await addMember("financeReader", "finance", { noBoq: false });

    // One priced row of 37 m3, 30 of them allocated to one activity and
    // approved: the allocation's amount (14628.30) is not the bill's total
    // (18041.57, which also seeds the prime contract — a separate, pending
    // owner question this test does not decide).
    const created = await api.post(at("/boq/items"), { code: "Z9.82", description: "HISTORYSECRET grout to baseplates", quantity: 37, unit: "m3", rate: 487.61 }, auth());
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    row = created.body.data.item;
    const activity = await api.post(at("/activities"), {
      engineerIds: [live.user.id],
      name: "Grout baseplates",
      activityCode: "A920",
      duration: 3,
      startDate: "2026-02-02",
      endDate: "2026-02-04",
    }, auth());
    expect([activity.status, activity.body?.error]).toEqual([201, undefined]);
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: row.id, activityId: activity.body.data.id, quantity: 30 }, auth());
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    allocationId = allocation.body.data.id;
    for (const step of ["submit", "approve"]) {
      const moved = await api.post(at(`/activity-boq-allocations/${allocationId}/${step}`), {}, auth());
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }

    // The work approved complete, and 25 of the allocated 30 m3 claimed on P01 ...
    const progress = await prisma.activityProgress.create({
      data: { activityId: activity.body.data.id, pctComplete: 100, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
    });
    const terms = await api.request("PATCH", at("/prime-contract"), { body: { originalValue: 250000, retentionRate: 5 }, headers: auth() });
    expect([terms.status, terms.body?.error]).toEqual([200, undefined]);
    const period = await api.post(at("/ipc"), { period: "P01" }, auth());
    expect([period.status, period.body?.error]).toEqual([201, undefined]);
    certificateId = period.body.data.id;
    expect(period.body.data.items).toHaveLength(1);
    const claimed = await api.request("PATCH", at(`/ipc/P01/items/${period.body.data.items[0].id}`), { body: { qty: 25 }, headers: auth() });
    expect([claimed.status, claimed.body?.error]).toEqual([200, undefined]);
    // ... then the approved progress taken back to 10% (this project's one
    // progress row, by its id): the claim is now more than approved progress
    // earned, and certifying needs a PM override.
    await prisma.activityProgress.update({ where: { id: progress.id }, data: { pctComplete: 10 } });
    const submitted = await api.post(at("/ipc/P01/submit"), {}, auth());
    expect([submitted.status, submitted.body?.error, submitted.body.data.status]).toEqual([200, undefined, "submitted"]);

    // The PM without BOQ read certifies it with an override reason.
    const certified = await api.post(at("/ipc/P01/certify"), { overrideReason: "LiveTest override" }, as(members.pm));
    expect([certified.status, certified.body?.error, certified.body.data.status]).toEqual([200, undefined, "certified"]);
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

  // The two certification events as stored, and the review they record.
  const certificationEvents = (events) =>
    events.filter((event) => event.recordType === "ipc_certificate" && event.action === "certified");

  it("a BOQ reader is given the history exactly as the service builds it, the review included", async () => {
    for (const reader of [null, members.financeReader]) {
      const who = reader ? "finance reader" : "owner PM";
      if (reader) expect([who, (await api.get(at("/boq"), as(reader))).status]).toEqual([who, 200]);
      for (const [name, query] of Object.entries(QUERIES)) {
        const answer = await api.get(at(`/audit${queryString(query)}`), reader ? as(reader) : auth());
        expect([who, name, answer.status]).toEqual([who, name, 200]);
        const built = await auditService.listEvents({
          orgId: live.org.id,
          projectId: project.id,
          entityType: query.entityType || null,
          entityId: typeof query.entityId === "function" ? query.entityId() : null,
          action: null,
          source: query.source || "all",
          cursor: null,
          limit: 50,
          order: "asc",
        });
        expect([who, name, answer.text]).toEqual([who, name, JSON.stringify({ success: true, data: normalizeMoneyTree(built) })]);
      }
    }

    // What the review is: the allocation's amount, 10% of it earned, the
    // claim over that, on one line — in the audit summary and the approval
    // metadata alike.
    const history = (await api.get(at(`/audit?entityType=ipc_certificate`), auth())).body.data.events;
    const [audit, approval] = ["audit", "approval"].map((source) =>
      certificationEvents(history).find((event) => event.source === source),
    );
    const review = audit.summary.certificationReview;
    expect(review).toMatchObject({ approvedLimitAmount: 14628.3, earnedAmount: 1462.83, overrideLineCount: 1, requiresPmOverride: true });
    expect(review.overEarnedAmount).toBeGreaterThan(0);
    expect(approval.metadata.certificationReview).toEqual(review);
    expect(audit.summary.progressLinks).toBe(1);
    secrets = [
      row.id,
      allocationId,
      "Z9.82",
      "HISTORYSECRET",
      "487.61",
      String(review.approvedLimitAmount),
      String(review.earnedAmount),
      String(review.overEarnedAmount),
      "approvedLimitAmount",
      "earnedAmount",
      "overEarnedAmount",
      "overApprovedLimitAmount",
      "overApprovedQuantity",
      "overrideLineCount",
      "requiresPmOverride",
      "missingProgressEvidenceCount",
    ];
  });

  it("a PM, a finance member and a site engineer without BOQ read are given every event without the review", async () => {
    expect(secrets).toBeDefined();
    for (const [who, member] of Object.entries({ pm: members.pm, finance: members.finance, "site engineer": members.siteEngineer })) {
      // The BOQ tool is refused them; the history is not.
      expect([who, (await api.get(at("/boq"), as(member))).status]).toEqual([who, 403]);
      if (who === "site engineer") expect([who, (await api.get(at("/ipc"), as(member))).status]).toEqual([who, 403]);

      for (const [name, query] of Object.entries(QUERIES)) {
        const readerAnswer = await api.get(at(`/audit${queryString(query)}`), auth());
        const answer = await api.get(at(`/audit${queryString(query)}`), as(member));
        expect([who, name, answer.status]).toEqual([who, name, 200]);
        for (const secret of secrets) {
          expect([who, name, secret, answer.text.includes(secret)]).toEqual([who, name, secret, false]);
        }

        // Every certificate event stays, each as the reader's but for the
        // review and the progress-link count, which `boqWithheld` names.
        const certificateEvents = (body) => body.data.events.filter((event) => event.recordType === "ipc_certificate");
        const theirs = certificateEvents(answer.body);
        const readers = certificateEvents(readerAnswer.body);
        expect([who, name, theirs.map((event) => event.id)]).toEqual([who, name, readers.map((event) => event.id)]);
        for (const [index, event] of readers.entries()) {
          const carried = ["summary", "newSummary", "oldSummary", "metadata"].some(
            (part) => event[part] && WITHHELD_KEYS.some((key) => key in event[part]),
          );
          const expected = carried
            ? {
                ...event,
                summary: without(event.summary, WITHHELD_KEYS),
                metadata: without(event.metadata, WITHHELD_KEYS),
                boqWithheld: MARKER,
              }
            : event;
          expect([who, name, event.id, theirs[index]]).toEqual([who, name, event.id, expected]);
        }
        // The certification itself is there: who, when, the totals, the reason.
        if (query.source !== "approval") {
          const audit = certificationEvents(theirs).find((event) => event.source === "audit");
          expect([who, name, audit.actorId, audit.newStatus, audit.summary.overrideReason, "totalCert" in audit.summary, "netPayable" in audit.summary]).toEqual([
            who, name, members.pm.id, "certified", "LiveTest override", true, true,
          ]);
        }
      }
    }

    // The stored rows are as written: the review is still in them.
    const stored = await prisma.auditEvent.findFirst({
      where: { orgId: live.org.id, projectId: project.id, entityType: "ipc_certificate", entityId: certificateId, action: "certified" },
    });
    expect(stored.summaryJson.certificationReview.approvedLimitAmount).toBe(14628.3);
  });
});
