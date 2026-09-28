/**
 * PC-4 acceptance, round 1 — the fixes that live in the API, proven against
 * a real API process and the real local Postgres.
 *
 *   rollback: a rollback whose previous revision stored no activities is
 *     refused with its own message (not activation's "no staged
 *     activities"), and the revision list says how many activities each
 *     revision stores, so the screen offers Rollback only when there is
 *     something to restore
 *   forecast notes: one data-quality note per missing index, each naming
 *     its own cause — SPI needs approved cost loading through the cutoff,
 *     CPI needs official cost-record actuals — so a project with SPI and no
 *     CPI is not told its cost loading is missing
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards. The API is started on a free port.
 *
 *   npm run test:live -- src/services/__live__/pc-4-controls-acceptance.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const SPI_NOTE = /^SPI is not available yet: no approved time-phased cost loading through the cutoff/;
const CPI_NOTE = /^CPI is not available yet: no official cost-record actuals through the cutoff/;

liveDescribe("PC-4 acceptance: rollback refusals and forecast notes a user can act on", () => {
  let live;
  let api;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const post = (route, body) => api.post(route, body, auth());
  const get = (route) => api.get(route, auth());

  const newProject = (name) =>
    prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest PC-4 ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
  const createActivity = async (projectId, payload) => {
    const created = await post(`/api/v1/projects/${projectId}/activities`, {
      engineerIds: [live.user.id],
      duration: 5,
      startDate: "2026-02-02",
      endDate: "2026-02-06",
      ...payload,
    });
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    return created.body.data;
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ RATE_LIMIT_AI_MAX: "1000", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" });
  });

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

  describe("rollback", () => {
    it("is refused in words that fit a rollback when the previous revision stored no activities, and the list says what each revision stores", async () => {
      const project = await newProject("rollback");
      await createActivity(project.id, { name: "Pour foundations", activityCode: "A100" });
      // Rev A: active once, recorded without a snapshot of its activities.
      // Rev B: active now, with the activity stored, rolled forward from A.
      const revA = await prisma.scheduleRevision.create({
        data: { projectId: project.id, label: "Rev A", status: "superseded", isActive: false, activityCount: 1, approvedAt: new Date(), activatedAt: new Date() },
      });
      const revB = await prisma.scheduleRevision.create({
        data: {
          projectId: project.id,
          label: "Rev B",
          status: "approved",
          isActive: true,
          activityCount: 1,
          approvedAt: new Date(),
          activatedAt: new Date(),
          previousActiveRevisionId: revA.id,
          snapshotJson: { activities: [{ id: "A100", activityCode: "A100", name: "Pour foundations", duration: 5 }] },
        },
      });

      const listed = await get(`/api/v1/projects/${project.id}/schedule/revisions`);
      expect([listed.status, listed.body?.error]).toEqual([200, undefined]);
      const count = (id) => listed.body.data.find((revision) => revision.id === id).snapshotActivityCount;
      expect([count(revA.id), count(revB.id)]).toEqual([0, 1]);

      const refused = await post(`/api/v1/projects/${project.id}/schedule/revisions/${revB.id}/rollback`, { reason: "LiveTest: roll back" });
      expect([refused.status, refused.body?.error?.code, refused.body?.error?.message]).toEqual([
        409,
        "ROLLBACK_TARGET_HAS_NO_ACTIVITIES",
        "The previous revision has no stored activities to restore; import or activate a revision instead.",
      ]);
      // Nothing moved.
      const after = await prisma.scheduleRevision.findUnique({ where: { id: revB.id }, select: { isActive: true } });
      expect(after.isActive).toBe(true);
    });
  });

  describe("forecast data-quality notes", () => {
    it("with neither index, one note for each, each naming its own cause", async () => {
      const project = await newProject("forecast none");
      await createActivity(project.id, { name: "Excavate", activityCode: "A100" });
      const forecast = await get(`/api/v1/projects/${project.id}/forecast`);
      expect([forecast.status, forecast.body?.error]).toEqual([200, undefined]);
      const { schedule, dataQuality } = forecast.body.data;
      expect([schedule.spi, schedule.cpi]).toEqual([null, null]);
      expect(dataQuality.filter((note) => SPI_NOTE.test(note))).toHaveLength(1);
      expect(dataQuality.filter((note) => CPI_NOTE.test(note))).toHaveLength(1);
      expect(dataQuality.join("\n")).not.toMatch(/SPI \/ CPI/);
    });

    it("with SPI and no CPI (progress and cost loading, no actuals), only the CPI note — never blaming the cost loading", async () => {
      const project = await newProject("forecast progress no actual");
      const activity = await createActivity(project.id, { name: "Pour foundations", activityCode: "A100" });
      const item = await post(`/api/v1/projects/${project.id}/boq/items`, { code: "1.1", description: "Concrete", quantity: 100, unit: "m3", rate: 200 });
      expect([item.status, item.body?.error]).toEqual([201, undefined]);
      const route = `/api/v1/projects/${project.id}/activity-boq-allocations`;
      const allocation = await post(route, { boqItemId: item.body.data.item.id, activityId: activity.id, quantity: 100 });
      expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
      for (const step of ["submit", "approve"]) {
        const moved = await post(`${route}/${allocation.body.data.id}/${step}`, {});
        expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
      }
      // Planned value through the cutoff, and half the work approved.
      await prisma.activityCostLoading.create({
        data: { projectId: project.id, activityId: activity.id, plannedDate: new Date("2026-02-06"), plannedValue: 20000, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-01") },
      });
      await prisma.activityProgress.create({
        data: { activityId: activity.id, pctComplete: 50, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
      });

      const forecast = await get(`/api/v1/projects/${project.id}/forecast`);
      expect([forecast.status, forecast.body?.error]).toEqual([200, undefined]);
      const { schedule, dataQuality, cost } = forecast.body.data;
      expect(schedule.spi).not.toBeNull();
      expect(schedule.cpi).toBeNull();
      expect(dataQuality.filter((note) => CPI_NOTE.test(note))).toHaveLength(1);
      expect(dataQuality.filter((note) => SPI_NOTE.test(note))).toHaveLength(0);
      expect(dataQuality.join("\n")).not.toMatch(/cost loading/);
      // The figure itself is unchanged: with no CPI the EV estimate is the budget.
      expect(cost.eac).toBe(cost.budget);
    });
  });
});
