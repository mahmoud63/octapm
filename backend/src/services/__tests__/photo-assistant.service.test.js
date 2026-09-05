const store = { conversations: [], messages: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

const photoRow = (overrides = {}) => ({ id: "ph-1", documentId: "doc-1", orgId: "org-1", projectId: "p1", caption: null, tags: ["level 3"], takenAt: new Date("2026-09-05T06:30:00Z"), locationId: "loc-1", location: { id: "loc-1", name: "Level 3", path: "Tower/Level 3" }, thumbnailStatus: "ready", thumbnailKey: "thumb-1", document: { id: "doc-1", originalName: "IMG_0451.jpg", mimeType: "image/jpeg" }, ...overrides });

const mockPrisma = {
  project: { findFirst: jest.fn(async () => ({ name: "Tower", type: "commercial" })) },
  attachment: { findMany: jest.fn(async () => [{ recordType: "daily_log", recordId: "dl-1", role: "photo" }]) },
  photo: { findMany: jest.fn(async ({ where = {} }) => [{ id: "ph-1" }, { id: "ph-2" }].filter((row) => !where.id?.in || where.id.in.includes(row.id))) },
  assistantConversation: {
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("conv"), createdAt: new Date(), ...data };
      store.conversations.push(row);
      return row;
    }),
    findFirst: jest.fn(async ({ where }) => {
      const rows = store.conversations.filter((row) => row.kind === where.kind && row.recordType === where.recordType && row.recordId === where.recordId).sort((a, b) => b.createdAt - a.createdAt);
      const row = rows[0];
      if (!row) return null;
      return { ...row, messages: store.messages.filter((message) => message.conversationId === row.id && message.role === "assistant").slice(-1) };
    }),
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
const mockAttachments = {
  getPhoto: jest.fn(async ({ photoId }) => (photoId === "ph-2" ? photoRow({ id: "ph-2", documentId: "doc-2", caption: "Rebar delivery", tags: [] }) : photoRow())),
  getPhotoFile: jest.fn(async ({ photoId, variant }) => ({ redirectUrl: `https://files.example/${photoId}-${variant}.jpg`, mimeType: "image/jpeg" })),
  updatePhoto: jest.fn(async ({ photoId, payload }) => ({ id: photoId, ...payload })),
  createAttachments: jest.fn(async () => ({ items: [{ id: "att-1" }] })),
};
const mockPunch = { createPunchItem: jest.fn(async ({ payload }) => ({ id: "obs-1", ref: "OBS-007", kind: payload.kind, status: "open", observationType: payload.observationType })) };
const jpeg = Buffer.from("original-jpeg-bytes");
const fetchImpl = jest.fn(async (url) => (url.includes("-original") ? { ok: true, arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) } : { ok: false }));

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../attachment.service", () => mockAttachments);
jest.mock("../punch.service", () => mockPunch);

const service = require("../photo-assistant.service");

const user = { id: "u-1", orgId: "org-1", role: "pm" };
const scope = { orgId: "org-1", projectId: "p1" };
const modelAnswer = () => ({ text: JSON.stringify({ caption: "Rebar fixing on the level 3 slab, east bay", tags: ["Rebar", "slab", "Level 3", "steel fixing", "rebar"], scene: "Steel fixers placing top mesh on a formed slab.", activity: "Rebar fixing", locationHint: "Level 3 east", quality: [{ text: "Spacer blocks missing along the east edge", severity: "medium" }], safety: [{ hazard: "Unprotected slab edge", description: "The east edge has no guardrail while workers are within a metre of it.", severity: "high", confidence: "high" }, { hazard: "Worker without helmet", description: "One worker at the back has no hard hat.", severity: "medium", confidence: "medium" }, { hazard: "", description: "ignored" }], confidence: "high" }), usage: { inputTokens: 1400, outputTokens: 260 } });

describe("photo and safety intelligence", () => {
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
    delete process.env.AI_VISION;
    delete process.env.AI_PHOTO_AUTO;
  });

  it("analyses a photo with its context, normalises the findings and stores the run", async () => {
    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("SAFETY");
      expect(system).toContain("Never identify");
      const content = messages[0].content;
      expect(content[0].text).toContain("Project: Tower (commercial)");
      expect(content[0].text).toContain("Location on record: Level 3 (Tower/Level 3)");
      expect(content[0].text).toContain("Current tags: level 3");
      expect(content[0].text).toContain("Attached to: daily_log (photo)");
      expect(content[1]).toEqual({ type: "image", mediaType: "image/jpeg", data: jpeg.toString("base64") });
      return modelAnswer();
    });
    const result = await service.analyzePhoto({ ...scope, photoId: "ph-1", user, transport, fetchImpl });
    expect(mockAttachments.getPhotoFile).toHaveBeenCalledWith(expect.objectContaining({ photoId: "ph-1", variant: "original" }));
    expect(result.degraded).toBe(false);
    expect(result.cached).toBe(false);
    expect(result.image).toEqual({ variant: "original", bytes: jpeg.length });
    expect(result.analysis).toMatchObject({ caption: "Rebar fixing on the level 3 slab, east bay", tags: ["rebar", "slab", "level 3", "steel fixing"], activity: "Rebar fixing", locationHint: "Level 3 east", confidence: "high" });
    expect(result.analysis.quality).toEqual([{ text: "Spacer blocks missing along the east edge", severity: "medium" }]);
    expect(result.analysis.safety).toEqual([
      { hazard: "Unprotected slab edge", description: "The east edge has no guardrail while workers are within a metre of it.", severity: "high", confidence: "high" },
      { hazard: "Worker without helmet", description: "One worker at the back has no hard hat.", severity: "medium", confidence: "medium" },
    ]);
    expect(result.photo).toMatchObject({ id: "ph-1", locationName: "Level 3", thumbnailUrl: "/api/v1/projects/p1/photos/ph-1/thumbnail" });
    expect(result.message).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(store.conversations[0]).toMatchObject({ kind: "photo_analysis", recordType: "photo", recordId: "ph-1", title: "Photo: Rebar fixing on the level 3 slab, east bay" });

    const latest = await service.latestAnalysis({ ...scope, photoId: "ph-1" });
    expect(latest.analysis.safety).toHaveLength(2);
    expect(latest.message.id).toBe(result.message.id);
    const again = await service.analyzePhoto({ ...scope, photoId: "ph-1", user });
    expect(again.cached).toBe(true);
    expect(again.analysis.caption).toBe("Rebar fixing on the level 3 slab, east bay");
  });

  it("degrades without a vision provider and reports what is configured", async () => {
    const plain = await service.analyzePhoto({ ...scope, photoId: "ph-2", user });
    expect(plain).toMatchObject({ degraded: true, analysis: null, cached: false });
    expect(plain.reason).toContain("not configured");
    expect(service.status()).toMatchObject({ enabled: false, autoOnUpload: false, batchLimit: 10 });
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.AI_VISION = "off";
    const noVision = await service.analyzePhoto({ ...scope, photoId: "ph-2", user });
    expect(noVision.reason).toContain("does not read images");
    expect(service.status()).toMatchObject({ enabled: false, provider: "openai" });
    delete process.env.AI_VISION;
    process.env.AI_PHOTO_AUTO = "on";
    expect(service.status()).toMatchObject({ enabled: true, autoOnUpload: true });
    const failing = jest.fn(async () => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    });
    const outage = await service.analyzePhoto({ ...scope, photoId: "ph-2", user, transport: failing, fetchImpl });
    expect(outage.degraded).toBe(true);
    expect(outage.reason).toContain("did not answer");
    fetchImpl.mockResolvedValueOnce({ ok: false });
    fetchImpl.mockResolvedValueOnce({ ok: false });
    await expect(service.analyzePhoto({ ...scope, photoId: "ph-2", user, transport: jest.fn(), fetchImpl, force: true })).rejects.toMatchObject({ code: "PHOTO_AI_UNREADABLE" });
  });

  it("analyses a batch of uncaptioned photos and counts the safety findings", async () => {
    const transport = jest.fn(async () => modelAnswer());
    const batch = await service.analyzeBatch({ ...scope, user, payload: { from: "2026-09-05", to: "2026-09-05", limit: 5 }, transport, fetchImpl });
    expect(mockPrisma.photo.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: "p1", caption: null, takenAt: expect.any(Object) }), take: 5 }));
    expect(batch.items.map((item) => item.photoId)).toEqual(["ph-1", "ph-2"]);
    expect(batch).toMatchObject({ analyzed: 2, cached: 0, safetyFindings: 4, limit: 5 });
    expect(transport).toHaveBeenCalledTimes(2);
    const again = await service.analyzeBatch({ ...scope, user, payload: { photoIds: ["ph-1"] } });
    expect(again).toMatchObject({ analyzed: 0, cached: 1 });
  });

  it("applies the kept caption and tags, and raises a safety observation with the photo as evidence", async () => {
    const applied = await service.applyAnalysis({ ...scope, photoId: "ph-1", payload: { caption: "Rebar fixing on the level 3 slab", tags: ["Rebar", "slab", "level 3"] }, actor: { id: "u-1", role: "pm" } });
    expect(mockAttachments.updatePhoto).toHaveBeenCalledWith(expect.objectContaining({ photoId: "ph-1", payload: { caption: "Rebar fixing on the level 3 slab", tags: ["level 3", "rebar", "slab"] }, userId: "u-1", userRole: "pm" }));
    expect(applied.applied).toEqual({ caption: true, tags: true });
    const kept = await service.applyAnalysis({ ...scope, photoId: "ph-2", payload: { caption: "New caption" }, actor: { id: "u-1", role: "pm" } });
    expect(kept.applied).toEqual({});
    expect(mockAttachments.updatePhoto).toHaveBeenCalledTimes(1);
    const forced = await service.applyAnalysis({ ...scope, photoId: "ph-2", payload: { caption: "New caption", overwrite: true }, actor: { id: "u-1", role: "pm" } });
    expect(forced.applied).toEqual({ caption: true });

    const raised = await service.raiseObservation({ ...scope, photoId: "ph-1", payload: { hazard: "Unprotected slab edge", description: "No guardrail on the east edge.", severity: "high", trade: "Formwork" }, actor: { id: "u-1", role: "pm", name: "Sam" } });
    expect(mockPunch.createPunchItem).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", payload: expect.objectContaining({ kind: "observation", observationType: "safety", title: "Unprotected slab edge", hazard: "Unprotected slab edge", priority: "high", locationId: "loc-1", sourceRecordType: "photo", sourceRecordId: "ph-1", trade: "Formwork" }), actor: expect.objectContaining({ id: "u-1" }) }));
    expect(mockAttachments.createAttachments).toHaveBeenCalledWith(expect.objectContaining({ recordType: "punch_item", recordId: "obs-1", role: "evidence", documentIds: ["doc-1"], userId: "u-1" }));
    expect(raised).toMatchObject({ item: { ref: "OBS-007", kind: "observation", observationType: "safety" }, attached: true, url: "/projects/p1/quality/observations?recordId=obs-1" });
    await expect(service.raiseObservation({ ...scope, photoId: "ph-1", payload: {}, actor: { id: "u-1" } })).rejects.toMatchObject({ code: "PHOTO_AI_HAZARD_REQUIRED" });
  });

  it("runs as a background job for the uploader", async () => {
    const transport = jest.fn(async () => modelAnswer());
    process.env.OPENAI_API_KEY = "sk-test";
    const spy = jest.spyOn(require("../ai-provider.service"), "complete").mockImplementation(async (args) => ({ ...(await transport(args)), provider: "openai", model: "gpt-test" }));
    const originalFetch = global.fetch;
    global.fetch = fetchImpl; // the job has no injected fetch; the S3-style redirect goes through the global one
    let result;
    try {
      result = await service.runPhotoAnalyzeJob({ job: { orgId: "org-1", projectId: "p1", requestedBy: "u-9" }, payload: { photoId: "ph-2", force: true } });
    } finally {
      global.fetch = originalFetch;
      spy.mockRestore();
    }
    expect(result.degraded).toBe(false);
    expect(store.conversations[0]).toMatchObject({ kind: "photo_analysis", recordId: "ph-2", userId: "u-9" });
  });
});
