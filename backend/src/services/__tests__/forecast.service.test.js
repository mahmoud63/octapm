const store = { conversations: [], messages: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const day = (key) => new Date(`${key}T00:00:00.000Z`);

const ASOF = day("2026-09-05");
const activities = () => [
  // Slab: critical, behind, slipping at the current velocity, over budget by burn rate.
  { id: "a-slab", name: "Level 3 slab", activityCode: "A1030", isActive: true, isCritical: true, isMilestone: false, startDate: day("2026-08-01"), endDate: day("2026-09-10"), duration: 40, totalFloat: 0, budget: 100000, pctComplete: 40, status: "in_progress" },
  // Façade: on track.
  { id: "a-facade", name: "Façade panels", activityCode: "A2010", isActive: true, isCritical: false, isMilestone: false, startDate: day("2026-08-20"), endDate: day("2026-10-20"), duration: 60, totalFloat: 12, budget: 80000, pctComplete: 28, status: "in_progress" },
  // MEP: stalled with an overdue RFI and a late long-lead delivery, float 5.
  { id: "a-mep", name: "MEP first fix", activityCode: "A3005", isActive: true, isCritical: false, isMilestone: false, startDate: day("2026-08-10"), endDate: day("2026-10-01"), duration: 52, totalFloat: 5, budget: 60000, pctComplete: 20, status: "in_progress" },
  // Done.
  { id: "a-done", name: "Piling", activityCode: "A1000", isActive: true, isCritical: true, isMilestone: false, startDate: day("2026-06-01"), endDate: day("2026-07-15"), duration: 44, totalFloat: 0, budget: 50000, pctComplete: 100, status: "complete" },
];
const mockSchedule = { getProjectSchedule: jest.fn(async () => ({ dataDate: null, revision: { id: "rev-1" }, activities: activities() })) };
const mockEv = { buildOfficialEvReport: jest.fn(async () => ({ spi: 0.8, cpi: 0.9, eac: 322000, totalBudget: 290000, ev: 100000, pv: 125000, ac: 111000 })) };
const mockBudget = { listBudgetLines: jest.fn(async () => ({ items: [{ id: "bl-1", costCode: { code: "03-30", name: "Concrete" }, costType: "material", revised: 120000, forecast: 135000, committed: 100000, actual: 70000 }, { id: "bl-2", costCode: { code: "26-05", name: "Electrical" }, costType: "subcontract", revised: 90000, forecast: 90000, committed: 60000, actual: 20000 }] })) };
const mockPrisma = {
  project: { findFirst: jest.fn(async () => ({ id: "p1", name: "Tower" })) },
  activityProgress: {
    findMany: jest.fn(async () => [
      { activityId: "a-slab", pctComplete: 25, approvedAt: day("2026-08-21"), updatedAt: day("2026-08-21") },
      { activityId: "a-slab", pctComplete: 40, approvedAt: day("2026-09-04"), updatedAt: day("2026-09-04") }, // ~1.07 %/day
      { activityId: "a-facade", pctComplete: 10, approvedAt: day("2026-08-26"), updatedAt: day("2026-08-26") },
      { activityId: "a-facade", pctComplete: 28, approvedAt: day("2026-09-04"), updatedAt: day("2026-09-04") }, // 2 %/day
      { activityId: "a-mep", pctComplete: 20, approvedAt: day("2026-08-15"), updatedAt: day("2026-08-15") },
    ]),
  },
  costRecord: { findMany: jest.fn(async () => [{ activityId: "a-slab", budget: 100000, committed: 90000, actual: 60000, forecast: 0 }, { activityId: "a-facade", budget: 80000, committed: 70000, actual: 20000, forecast: 0 }, { activityId: "a-mep", budget: 60000, committed: 75000, actual: 0, forecast: 0 }]) },
  workflowActivityLink: { findMany: jest.fn(async () => [{ activityId: "a-slab", recordType: "rfi", recordId: "rfi-9", scheduleImpactDays: 3, relationType: "schedule_impact" }]) },
  weatherDelayActivityLink: { findMany: jest.fn(async () => [{ activityId: "a-slab", delayDays: 2, isCritical: true, weatherDelayId: "wd-1" }]) },
  rfi: { findMany: jest.fn(async () => [{ id: "rfi-12", ref: "RFI-012", subject: "Cable tray routing", activityId: "a-mep", responseRequiredBy: day("2026-08-30"), dueDate: null, status: "open" }]) },
  submittal: { findMany: jest.fn(async () => []) },
  longLeadItem: { findMany: jest.fn(async () => [{ id: "ll-1", item: "Switchgear", activityId: "a-mep", status: "ordered", expectedDeliveryDate: day("2026-09-20"), warehouseStatus: "not_received" }]) },
  assistantConversation: {
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("conv"), createdAt: new Date(), ...data };
      store.conversations.push(row);
      return row;
    }),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
  },
  assistantMessage: {
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("msg"), createdAt: new Date(), citationsJson: [], actionsJson: [], sourcesJson: [], ...data };
      store.messages.push(row);
      return row;
    }),
  },
};
const mockRisk = { createRisk: jest.fn(async ({ payload }) => ({ id: "risk-new", ref: "RSK-07", status: payload.status })) };
const mockTask = { createTask: jest.fn(async ({ payload }) => ({ id: "task-new", taskNumber: 52, status: "todo", title: payload.title })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../schedule.service", () => mockSchedule);
jest.mock("../earned-value.service", () => mockEv);
jest.mock("../budget.service", () => mockBudget);
jest.mock("../risk.service", () => mockRisk);
jest.mock("../task.service", () => mockTask);

const service = require("../forecast.service");

const user = { id: "u-1", orgId: "org-1", role: "pm" };

describe("schedule delay and cost overrun prediction", () => {
  beforeAll(() => {
    process.env.AI_RETRY_BASE_MS = "1";
  });
  beforeEach(() => {
    store.conversations.length = 0;
    store.messages.length = 0;
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it("projects every activity from its own progress, float, impacts, open items and burn rate", async () => {
    const forecast = await service.buildForecast({ orgId: "org-1", projectId: "p1", asOf: ASOF });
    expect(forecast.available).toBe(true);
    const byId = Object.fromEntries(forecast.activities.map((row) => [row.id, row]));

    const slab = byId["a-slab"];
    expect(slab.velocity).toBe(1.07);
    expect(slab.expectedPct).toBe(87.5);
    expect(slab.gap).toBe(47.5);
    expect(slab.basis).toBe("velocity");
    expect(slab.projectedFinish).toBe("2026-10-31"); // 60% left at 1.07 %/day ≈ 56 days
    expect(slab.slipDays).toBe(51);
    expect(slab.impactDays).toBe(5);
    expect(slab.floatBreached).toBe(true);
    expect(slab.level).toBe("high");
    expect(slab.reasons).toEqual(expect.arrayContaining([expect.stringContaining("47.5% behind the plan"), expect.stringContaining("Projected to finish 51 days late"), "5 days of recorded impact from RFI, weather", "On the critical path — the slip moves the project finish"]));
    expect(slab.cost).toMatchObject({ budget: 100000, actual: 60000, projected: 150000, basis: "burn", overrun: 50000, overrunPct: 50, level: "high" });
    expect(slab.cost.reasons[0]).toBe("60% of the budget spent at 40% progress");

    const facade = byId["a-facade"];
    expect(facade.velocity).toBe(2);
    expect(facade.projectedFinish).toBe("2026-10-11");
    expect(facade.slipDays).toBe(0);
    expect(facade.level).toBe("low");
    expect(facade.cost.overrun).toBe(0);

    const mep = byId["a-mep"];
    expect(mep.velocity).toBeNull();
    expect(mep.basis).toBe("pace");
    expect(mep.stalledDays).toBe(21);
    expect(mep.blockers.map((blocker) => [blocker.type, blocker.ref || blocker.title, blocker.overdue])).toEqual([["rfi", "RFI-012", true], ["long_lead", "Switchgear", true]]);
    expect(mep.level).toBe("high");
    expect(mep.reasons).toEqual(expect.arrayContaining(["No approved progress for 21 days", "2 open items on it: RFI-012 (overdue), Switchgear (overdue)"]));
    expect(mep.cost).toMatchObject({ projected: 75000, basis: "commitments", overrun: 15000, level: "high" });
    expect(mep.cost.reasons).toEqual(["Commitments of 75000 exceed the budget of 60000"]);

    expect(byId["a-done"]).toMatchObject({ status: "complete", score: 0, level: "low", slipDays: 0 });

    expect(mep.projectedFinish).toBe("2026-12-18"); // 80% left at 1.3 days per % = 104 days
    expect(mep.slipDays).toBe(78);

    expect(forecast.schedule).toMatchObject({ plannedFinish: "2026-10-20", spi: 0.8, cpi: 0.9, basis: "activities", criticalDriver: { name: "MEP first fix", slipDays: 78 } });
    expect(forecast.schedule.evBasedFinish).toBe("2026-10-31"); // 45 days left / 0.8
    expect(forecast.schedule.activityBasedFinish).toBe("2026-12-18");
    expect(forecast.schedule.projectedFinish).toBe("2026-12-18");
    expect(forecast.schedule.slipDays).toBe(59);
    expect(forecast.schedule.topRisks.map((row) => [row.id, row.score])).toEqual([["a-mep", 83], ["a-slab", 81]]);
    expect(forecast.schedule.counts).toMatchObject({ activities: 4, open: 3, complete: 1, critical: 1, atRisk: { high: 2, medium: 0, low: 0 } });
    expect(forecast.cost).toMatchObject({ budget: 290000, eac: 322000, bottomUp: 346428.57, projected: 346428.57, overrun: 56428.57, overrunPct: 19.5, actual: 111000 });
    expect(forecast.cost.topRisks.map((row) => [row.id, row.cost.overrun])).toEqual([["a-slab", 50000], ["a-mep", 15000]]);
    expect(forecast.cost.budgetLines).toEqual([expect.objectContaining({ costCode: "03-30", name: "Concrete", overrun: 15000, overrunPct: 12.5, level: "high" })]);
    expect(forecast.summary).toEqual({ scheduleLevel: "high", costLevel: "high" });
    expect(forecast.dataQuality).toEqual([expect.stringContaining("1 activity in progress has fewer than two approved progress updates")]);
    expect(mockPrisma.activityProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "approved", updatedAt: { gte: new Date(ASOF.getTime() - 45 * 86_400_000) } }) }));
  });

  it("copes without EV, budget lines or a schedule", async () => {
    mockEv.buildOfficialEvReport.mockRejectedValueOnce(new Error("no periods"));
    mockBudget.listBudgetLines.mockRejectedValueOnce(new Error("no budget"));
    const forecast = await service.buildForecast({ orgId: "org-1", projectId: "p1", asOf: ASOF });
    expect(forecast.schedule.spi).toBeNull();
    expect(forecast.schedule.basis).toBe("activities");
    expect(forecast.cost.eac).toBeNull();
    expect(forecast.cost.budget).toBe(290000);
    expect(forecast.cost.budgetLines).toEqual([]);
    expect(forecast.dataQuality).toEqual(expect.arrayContaining([expect.stringContaining("Official earned value could not be computed"), expect.stringContaining("No budget lines")]));

    mockSchedule.getProjectSchedule.mockResolvedValueOnce(null);
    const none = await service.buildForecast({ orgId: "org-1", projectId: "p1", asOf: ASOF });
    expect(none).toMatchObject({ available: false, activities: [] });
    mockSchedule.getProjectSchedule.mockResolvedValueOnce(null);
    await expect(service.explain({ orgId: "org-1", projectId: "p1", user, asOf: ASOF })).rejects.toMatchObject({ code: "FORECAST_UNAVAILABLE" });
  });

  it("explains the forecast through the model with draft actions, and from the forecast itself without one", async () => {
    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("planning and cost lead");
      const text = messages[0].content;
      expect(text).toContain("Project: Tower");
      expect(text).toContain("planned finish 2026-10-20, projected 2026-12-18 (59 days late, basis activities); SPI 0.8, CPI 0.9");
      expect(text).toContain("Main driver: MEP first fix (78 days).");
      expect(text).toContain("[a-slab] Level 3 slab (A1030) · score 81 high · 40% done vs 87.5% expected · velocity 1.07%/day · planned 2026-09-10 → projected 2026-10-31 (51 days + 5 impact) · float 0 · critical");
      expect(text).toContain("Budget lines over:\n- 03-30 Concrete");
      return { text: JSON.stringify({ headline: "MEP and the slab drive a 59-day slip and most of the overrun.", schedule: "Level 3 slab is 47.5% behind…", cost: "Concrete is 15,000 over…", watch: ["MEP first fix", "Switchgear delivery"], actions: [{ type: "create_risk", label: "Register slab delay", activityId: "a-slab", title: "Slab pour rate", description: "Pour rate 1.07 %/day against a 40-day plan", probability: "high", impact: "high", mitigation: "Second crew" }, { type: "create_task", label: "Chase RFI-012", activityId: "a-mep", title: "Chase RFI-012 answer", description: "Overdue since 30 Aug" }, { type: "open", label: "Look at façade", activityId: "a-facade" }, { type: "open", label: "bogus", activityId: "nope" }, { type: "delete", label: "x" }] }), usage: { inputTokens: 800, outputTokens: 200 } };
    });
    const result = await service.explain({ orgId: "org-1", projectId: "p1", user, transport, asOf: ASOF });
    expect(result.degraded).toBe(false);
    expect(result.narrative.headline).toContain("59-day slip");
    expect(result.narrative.actions).toEqual([
      expect.objectContaining({ type: "create_risk", activityId: "a-slab", activityName: "Level 3 slab", probability: "high", impact: "high", mitigation: "Second crew" }),
      expect.objectContaining({ type: "create_task", activityId: "a-mep", title: "Chase RFI-012 answer" }),
      expect.objectContaining({ type: "open", activityId: "a-facade" }),
    ]);
    expect(result.message).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(store.conversations[0]).toMatchObject({ kind: "forecast", recordType: "project", recordId: "p1", title: "Forecast 2026-09-05" });

    const plain = await service.explain({ orgId: "org-1", projectId: "p1", user, asOf: ASOF });
    expect(plain.degraded).toBe(true);
    expect(plain.narrative.headline).toBe("The project is projected to finish 59 days late and 56,429 over budget.");
    expect(plain.narrative.schedule).toContain("Level 3 slab: 47.5% behind the plan");
    expect(plain.narrative.cost).toContain("Level 3 slab projected 50,000 over");
    expect(plain.narrative.watch).toEqual(["MEP first fix", "Level 3 slab", "03-30 Concrete"]);
    expect(plain.narrative.actions.map((action) => [action.type, action.activityId, action.probability, action.impact])).toEqual([["create_risk", "a-mep", "high", "medium"], ["create_risk", "a-slab", "high", "high"]]);
    expect(store.conversations).toHaveLength(1);
    // A BOQ reader's run carries each activity's budget and no marker.
    const prompt = store.messages.find((message) => message.conversationId === store.conversations[0].id && message.role === "user");
    expect(prompt).not.toHaveProperty("usageJson");
  });

  it("marks the run of a reader who may not read the BOQ as built without the bill (owner check, 2026-09-29)", async () => {
    const transport = jest.fn(async () => ({ text: JSON.stringify({ headline: "h", schedule: "s", cost: "c", watch: [], actions: [] }) }));
    const before = store.conversations.length;
    await service.explain({ orgId: "org-1", projectId: "p1", user, transport, asOf: ASOF, access: { boq: false, budget: true } });
    const conversation = store.conversations[before];
    expect(conversation).toMatchObject({ kind: "forecast" });
    const prompt = store.messages.find((message) => message.conversationId === conversation.id && message.role === "user");
    expect(prompt.usageJson).toEqual({ builtWithoutBoq: true });
    expect(prompt.content).not.toMatch(/\[a-slab\].*budget/);
  });

  it("runs confirmed actions through the risk and task services", async () => {
    const risk = await service.executeAction({ orgId: "org-1", user, projectId: "p1", action: { type: "create_risk", activityId: "a-slab", title: "Slab pour rate", description: "Pour rate 1.07 %/day", probability: "high", impact: "medium", mitigation: "Second crew" } });
    expect(mockRisk.createRisk).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", payload: expect.objectContaining({ description: "Slab pour rate: Pour rate 1.07 %/day", probability: "high", impact: "medium", mitigation: "Second crew", status: "open", activityIds: ["a-slab"] }), userId: "u-1", userRole: "pm" }));
    expect(risk).toMatchObject({ type: "create_risk", record: { ref: "RSK-07" }, url: "/projects/p1/schedule/risks?recordId=risk-new" });
    const task = await service.executeAction({ orgId: "org-1", user, projectId: "p1", action: { type: "create_task", activityId: "a-mep", title: "Chase RFI-012", description: "Overdue" } });
    expect(mockTask.createTask).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ title: "Chase RFI-012", activityId: "a-mep" }) }));
    expect(task).toMatchObject({ type: "create_task", record: { ref: "T-52" } });
    await expect(service.executeAction({ orgId: "org-1", user, projectId: "p1", action: { type: "open" } })).rejects.toMatchObject({ code: "FORECAST_ACTION_UNKNOWN" });
    await expect(service.executeAction({ orgId: "org-1", user, projectId: "p1", action: { type: "create_risk" } })).rejects.toMatchObject({ code: "FORECAST_ACTION_DESCRIPTION" });
  });
});
