const store = { conversations: [], messages: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

const photos = () => [
  { id: "ph-1", documentId: "doc-1", caption: null, tags: ["formwork"], takenAt: new Date("2026-09-05T06:30:00Z"), location: { id: "loc-1", name: "Level 3" }, document: { id: "doc-1", fileName: "IMG_1.jpg", originalName: "IMG_1.jpg", mimeType: "image/jpeg" }, thumbnailStatus: "ready", thumbnailKey: "thumb-1" },
  { id: "ph-2", documentId: "doc-2", caption: "Rebar delivery at gate 2", tags: [], takenAt: new Date("2026-09-05T09:10:00Z"), location: null, document: { id: "doc-2", fileName: "IMG_2.jpg", originalName: "IMG_2.jpg", mimeType: "image/jpeg" }, thumbnailStatus: "pending", thumbnailKey: null },
];

const mockPrisma = {
  project: { findFirst: jest.fn(async () => ({ id: "p1", name: "Tower", timezone: "Asia/Riyadh" })) },
  photo: {
    findMany: jest.fn(async () => photos()),
    findFirst: jest.fn(async ({ where }) => photos().find((photo) => photo.id === where.id) || null),
  },
  progressSubmission: { findMany: jest.fn(async () => [{ id: "ps-1", method: "quantity", pctComplete: 45, quantityComplete: 120, quantityPlanned: 260, quantityUnit: "m3", status: "submitted", notes: "Pour completed bays 1-3", activity: { id: "act-1", name: "Level 3 slab pour", wbsCode: "1.2.3", p6ActivityId: "A1030" } }]) },
  formInstance: { findMany: jest.fn(async () => [{ id: "fi-1", ref: "ITP-004", type: "itp", title: "Pre-pour inspection", status: "complete", outcome: "pass", completedAt: new Date("2026-09-05T05:00:00Z") }]) },
  punchItem: { findMany: jest.fn(async () => [{ id: "pi-1", ref: "OBS-002", title: "Missing edge protection at L3 east", kind: "observation", observationType: "safety", priority: "high", status: "open", trade: "Formwork", locationText: "L3 east" }]) },
  safetyIncident: { findMany: jest.fn(async () => []) },
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

const dayLog = () => ({
  id: "log-1",
  exists: true,
  date: "2026-09-05",
  status: "open",
  summary: null,
  weather: { summary: "Sunny", condition: "clear", tempMinC: 24, tempMaxC: 41, precipitationMm: 0, windMaxKph: 18, alerts: [{ metric: "heat", message: "Heat above 40 °C" }] },
  sections: {
    manpower: [{ companyName: "Alpha Concrete", trade: "Carpenters", workers: 8, hours: 9, activity: { name: "Level 3 slab pour" } }, { companyName: "Beta Steel", trade: "Steel fixers", workers: 4, hours: 8 }],
    equipment: [{ name: "Tower crane", count: 1, hoursOperated: 7, hoursIdle: 1 }],
    deliveries: [{ description: "Rebar T16", quantity: 12, unit: "t", supplierName: "SteelCo", poRef: "PO-118" }],
    visitors: [],
    delays: [],
    notes: [],
  },
  totals: { workers: 12, manHours: 104, companies: 2, equipmentCount: 1, equipmentHours: 7, idleHours: 1, deliveries: 1, visitors: 0, hoursLost: 0, notes: 0, entries: 4, awaitingReview: 0, suggestedDelays: 0 },
});
const mockDailyLog = {
  NOTE_KINDS: ["general", "safety", "instruction", "inspection", "issue"],
  DELAY_TYPES: ["weather", "access", "design", "material", "labour", "equipment", "inspection", "utility", "other"],
  getLog: jest.fn(async () => dayLog()),
  updateLog: jest.fn(async () => dayLog()),
  addEntry: jest.fn(async () => ({ ...dayLog(), entryId: "entry-1" })),
};
const mockAttachments = {
  getPhotoFile: jest.fn(async ({ photoId }) => ({ redirectUrl: `https://files.example/${photoId}.jpg`, mimeType: "image/jpeg" })),
  updatePhoto: jest.fn(async ({ photoId, payload }) => ({ id: photoId, caption: payload.caption })),
};
const jpeg = Buffer.from("jpegbytes");
const fetchImpl = jest.fn(async (url) =>
  url.endsWith("ph-1.jpg") ? { ok: true, arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) } : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) },
);

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../daily-log.service", () => mockDailyLog);
jest.mock("../attachment.service", () => mockAttachments);

const service = require("../daily-log-assistant.service");
const aiProvider = require("../ai-provider.service");

const user = { id: "u-1", orgId: "org-1", role: "pm" };
const scope = { orgId: "org-1", projectId: "p1", date: "2026-09-05" };

describe("daily report auto-draft", () => {
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
    delete process.env.AI_PROVIDER;
    delete process.env.AI_VISION;
    delete process.env.AI_TRANSCRIPTION;
  });

  it("bounds the day in the project's time zone", () => {
    expect(service.dayWindow("2026-09-05", "Asia/Riyadh")).toMatchObject({ key: "2026-09-05", start: new Date("2026-09-04T21:00:00.000Z"), end: new Date("2026-09-05T20:59:59.999Z") });
    expect(service.dayWindow("2026-09-05", null).start.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(service.dayWindow("2026-01-15", "America/New_York").start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(() => service.dayWindow("nope")).toThrow();
  });

  it("drafts the day from the records, the photos (as images) and the dictated notes, and stores the run", async () => {
    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("daily site report");
      const content = messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      const text = content[0].text;
      expect(text).toContain("Project: Tower\nDate: 2026-09-05");
      expect(text).toContain("Weather: Sunny, 24–41 °C, wind 18 km/h, ALERT Heat above 40 °C");
      expect(text).toContain("- Alpha Concrete · Carpenters · 8 × 9 h · Level 3 slab pour");
      expect(text).toContain("- Rebar T16 · 12 t · SteelCo · PO PO-118");
      expect(text).toContain("- progress:ps-1 · Level 3 slab pour → 45% by quantity (120 m3 of 260) · submitted · Pour completed bays 1-3");
      expect(text).toContain("- ITP-004 Pre-pour inspection (itp) · complete · pass");
      expect(text).toContain("- OBS-002 Missing edge protection at L3 east · observation (safety) · high · Formwork · L3 east");
      expect(text).toContain("- P1 06:30 UTC · Level 3 · no caption · tags formwork");
      expect(text).toContain('- P2 09:10 UTC · "Rebar delivery at gate 2"');
      expect(text).toContain("Dictated / typed notes from the site team:\ncrane down one hour");
      expect(content[1]).toEqual({ type: "text", text: "Photo P1 (Level 3)" });
      expect(content.filter((block) => block.type === "image")).toEqual([{ type: "image", mediaType: "image/jpeg", data: jpeg.toString("base64") }]);
      expect(content[content.length - 1].text).toContain("Write the daily report JSON now.");
      return {
        text: JSON.stringify({
          summary: "Level 3 slab pour reached 45% with bays 1-3 poured; the tower crane was down for one hour.",
          workPerformed: [{ text: "Bays 1-3 of the level 3 slab poured", activity: "Level 3 slab pour", sources: ["progress:ps-1", "P1"] }],
          notes: [{ kind: "safety", text: "Edge protection missing at L3 east (OBS-002)" }, { kind: "bogus", text: "Crane down for an hour" }],
          delays: [{ type: "equipment", description: "Tower crane breakdown", hoursLost: 1 }, { type: "nope", description: "" }],
          photoCaptions: [{ photo: "p1", caption: "Formwork to the level 3 slab edge" }, { photo: "P9", caption: "ignored" }],
          missing: ["Visitors"],
          confidence: "high",
        }),
        usage: { inputTokens: 1200, outputTokens: 300 },
      };
    });
    // A BOQ reader (boqFigureAccess): the evidence states the submission's quantities.
    const result = await service.draftReport({ ...scope, payload: { notes: "crane down one hour" }, user, access: { boq: true, budget: true }, transport, fetchImpl });
    expect(mockPrisma.progressSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ submittedAt: { gte: new Date("2026-09-04T21:00:00.000Z"), lte: new Date("2026-09-05T20:59:59.999Z") } }, expect.anything()] }) }));
    expect(mockDailyLog.getLog).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", date: "2026-09-05" }));
    expect(mockAttachments.getPhotoFile).toHaveBeenCalledWith(expect.objectContaining({ photoId: "ph-1", variant: "thumbnail" }));
    expect(result.degraded).toBe(false);
    expect(result.draft).toMatchObject({
      summary: expect.stringContaining("45%"),
      workPerformed: [{ text: "Bays 1-3 of the level 3 slab poured", activity: "Level 3 slab pour", sources: ["progress:ps-1", "P1"] }],
      notes: [{ kind: "safety", text: "Edge protection missing at L3 east (OBS-002)" }, { kind: "general", text: "Crane down for an hour" }],
      delays: [{ type: "equipment", description: "Tower crane breakdown", hoursLost: 1 }],
      photoCaptions: [{ photoId: "ph-1", ref: "P1", caption: "Formwork to the level 3 slab edge", existing: null }],
      missing: ["Visitors"],
      confidence: "high",
    });
    expect(result.evidence).toMatchObject({ counts: { photos: 2, progress: 1, inspections: 1, punch: 1, safety: 0, entries: 4, notes: true }, includedImages: 1 });
    expect(result.evidence.photos.map((photo) => [photo.ref, photo.included, photo.thumbnailUrl])).toEqual([
      ["P1", true, "/api/v1/projects/p1/photos/ph-1/thumbnail"],
      ["P2", false, "/api/v1/projects/p1/attachments/documents/doc-2"],
    ]);
    expect(result.message).toEqual(expect.objectContaining({ id: expect.any(String), model: "test" }));
    expect(store.conversations[0]).toMatchObject({ kind: "daily_log_draft", recordType: "daily_log", recordId: "log-1", title: "Daily report draft 2026-09-05", userId: "u-1" });
    expect(store.messages[1].usageJson).toEqual({ inputTokens: 1200, outputTokens: 300 });
    // It showed a quantity: a BOQ-bearing run, served back only while its author may read the BOQ.
    expect(store.messages[0].usageJson).toBeUndefined();
  });

  it("the evidence for a member who may not read the BOQ: percentage, method and status — no typed, planned or unit figure; the stored run says it was built without the bill", async () => {
    const evidence = await service.collectEvidence({ ...scope });
    const reader = service.evidenceBlock({ ...evidence, access: { boq: true, budget: true } });
    expect(reader).toContain("- progress:ps-1 · Level 3 slab pour → 45% by quantity (120 m3 of 260) · submitted · Pour completed bays 1-3");
    for (const access of [{ boq: false, budget: true }, { boq: false, budget: false }, undefined]) {
      const text = service.evidenceBlock({ ...evidence, ...(access ? { access } : {}) });
      expect(text).toContain("- progress:ps-1 · Level 3 slab pour → 45% by quantity · submitted · Pour completed bays 1-3");
      expect(text).not.toMatch(/\b120\b|\b260\b|\bm3\b/);
      // Everything else in the evidence is the same as the reader's.
      expect(text.replace(" (120 m3 of 260)", "")).toBe(reader.replace(" (120 m3 of 260)", ""));
    }
    // A submission with no typed figure reads the same for both.
    const percent = { id: "ps-2", method: "percent", pctComplete: 30, quantityComplete: null, status: "approved", activity: { name: "Blockwork" } };
    expect(service.progressLine(percent, { boq: true })).toBe(service.progressLine(percent, { boq: false }));
    expect(service.progressLine(percent, { boq: false })).toBe("- progress:ps-2 · Blockwork → 30% by percent · approved");

    let sent = null;
    const transport = jest.fn(async ({ messages }) => {
      sent = typeof messages[0].content === "string" ? messages[0].content : messages[0].content[0].text;
      return { text: JSON.stringify({ summary: "Slab pour at 45%.", confidence: "medium" }), usage: { inputTokens: 10, outputTokens: 5 } };
    });
    const result = await service.draftReport({ ...scope, payload: { includePhotos: false }, user, access: { boq: false, budget: true }, transport });
    expect(result.degraded).toBe(false);
    expect(sent).toContain("→ 45% by quantity · submitted");
    expect(sent).not.toMatch(/\b120\b|\b260\b|\bm3\b/);
    expect(store.messages[0].content).toBe(sent);
    expect(store.messages[0].usageJson).toEqual({ builtWithoutBoq: true });
  });

  it("builds a factual draft from the records when no provider answers", async () => {
    const plain = await service.draftReport({ ...scope, payload: { notes: "crane down one hour", includePhotos: false }, user });
    expect(plain.degraded).toBe(true);
    expect(plain.reason).toContain("not configured");
    expect(plain.draft.summary).toContain("Weather: Sunny, up to 41 °C.");
    expect(plain.draft.summary).toContain("12 workers from 2 companies on site (104 man-hours).");
    expect(plain.draft.summary).toContain("1 item of equipment, 7 operating hours and 1 idle.");
    expect(plain.draft.summary).toContain("Progress recorded on Level 3 slab pour (45%).");
    expect(plain.draft.summary).toContain("Inspections: ITP-004 pass.");
    expect(plain.draft.summary).toContain("1 punch item / observation raised (OBS-002).");
    expect(plain.draft.summary).toContain("2 site photos taken.");
    expect(plain.draft.summary).toContain("Site notes: crane down one hour");
    expect(plain.draft.notes).toEqual([{ kind: "general", text: "crane down one hour" }, { kind: "safety", text: "OBS-002 Missing edge protection at L3 east" }]);
    expect(plain.draft.workPerformed).toEqual([{ text: "Level 3 slab pour to 45%", activity: "Level 3 slab pour", sources: ["progress:ps-1"] }]);
    expect(plain.draft.missing).toEqual(["Captions on today's photos"]);
    expect(plain.draft.confidence).toBe("low");
    expect(plain.message).toBeNull();
    expect(mockAttachments.getPhotoFile).not.toHaveBeenCalled();
    expect(store.conversations).toHaveLength(0);

    const failing = jest.fn(async () => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    });
    const outage = await service.draftReport({ ...scope, payload: { includePhotos: false }, user, transport: failing });
    expect(outage.degraded).toBe(true);
    expect(outage.reason).toContain("did not answer");
    expect(outage.draft.summary).toContain("12 workers");
  });

  it("applies only what was kept, through the daily log and photo services", async () => {
    const actor = { id: "u-1", role: "pm" };
    const result = await service.applyDraft({
      ...scope,
      payload: {
        summary: "Final summary",
        notes: [{ kind: "safety", text: "Edge protection missing at L3 east" }, { text: "   " }],
        delays: [{ type: "equipment", description: "Tower crane breakdown", hoursLost: 1.5 }],
        photoCaptions: [{ photoId: "ph-1", caption: "Formwork to the slab edge" }, { photoId: "ph-2", caption: "Rebar" }, { photoId: "missing", caption: "x" }],
      },
      actor,
      viewer: { id: "u-1" },
    });
    expect(mockDailyLog.updateLog).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", date: "2026-09-05", payload: { summary: "Final summary" }, actor }));
    expect(mockDailyLog.addEntry).toHaveBeenCalledTimes(2);
    expect(mockDailyLog.addEntry).toHaveBeenCalledWith(expect.objectContaining({ section: "notes", payload: expect.objectContaining({ kind: "safety", text: "Edge protection missing at L3 east" }) }));
    expect(mockDailyLog.addEntry).toHaveBeenCalledWith(expect.objectContaining({ section: "delays", payload: expect.objectContaining({ type: "equipment", description: "Tower crane breakdown", hoursLost: 1.5 }) }));
    expect(mockAttachments.updatePhoto).toHaveBeenCalledTimes(1);
    expect(mockAttachments.updatePhoto).toHaveBeenCalledWith(expect.objectContaining({ photoId: "ph-1", payload: { caption: "Formwork to the slab edge" }, userId: "u-1", userRole: "pm" }));
    expect(result.applied).toEqual({ summary: true, notes: 1, delays: 1, captions: 1, skippedCaptions: 1 });
    expect(result.log.id).toBe("log-1");

    await service.applyDraft({ ...scope, payload: { photoCaptions: [{ photoId: "ph-2", caption: "Rebar at gate 2" }], overwriteCaptions: true }, actor });
    expect(mockAttachments.updatePhoto).toHaveBeenCalledTimes(2);
    expect(mockDailyLog.updateLog).toHaveBeenCalledTimes(1);
  });

  it("transcribes voice notes through the provider and reports what is configured", async () => {
    await expect(service.transcribe({ file: { buffer: Buffer.from("x"), mimetype: "audio/webm", originalname: "a.webm" } })).rejects.toMatchObject({ code: "AI_TRANSCRIPTION_NOT_CONFIGURED" });
    expect(service.status()).toMatchObject({ enabled: false, vision: false, transcription: false, maxPhotos: 8 });

    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = jest.fn(async (url, init) => {
      expect(url).toContain("/v1/audio/transcriptions");
      expect(init.headers.authorization).toBe("Bearer sk-test");
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.body.get("model")).toBe("whisper-1");
      expect(init.body.get("language")).toBe("en");
      expect(init.body.get("file")).toBeInstanceOf(Blob);
      return { ok: true, status: 200, text: async () => JSON.stringify({ text: " Crane down for one hour. " }) };
    });
    const spoken = await service.transcribe({ file: { buffer: Buffer.from("audio"), mimetype: "audio/webm", originalname: "note.webm" }, language: "en", fetchImpl: fetchMock });
    expect(spoken).toEqual({ text: "Crane down for one hour.", provider: "openai", model: "whisper-1" });
    expect(service.status()).toMatchObject({ enabled: true, provider: "openai", vision: true, transcription: true });
    process.env.AI_VISION = "off";
    expect(service.status().vision).toBe(false);
    process.env.AI_TRANSCRIPTION = "off";
    expect(service.status().transcription).toBe(false);

    const failed = jest.fn(async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { message: "slow down" } }) }));
    delete process.env.AI_TRANSCRIPTION;
    await expect(service.transcribe({ file: { buffer: Buffer.from("audio"), mimetype: "audio/webm" }, fetchImpl: failed })).rejects.toMatchObject({ code: "AI_TRANSCRIPTION_FAILED", retryable: true });
  });

  it("shapes image and text blocks for each provider", () => {
    const blocks = [{ type: "text", text: "hi" }, { type: "image", mediaType: "image/png", data: "AAA" }];
    expect(aiProvider.providerContent("anthropic", blocks)).toEqual([{ type: "text", text: "hi" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }]);
    expect(aiProvider.providerContent("openai", blocks)).toEqual([{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }]);
    expect(aiProvider.providerContent("gemini", blocks)).toEqual([{ text: "hi" }, { inlineData: { mimeType: "image/png", data: "AAA" } }]);
    expect(aiProvider.providerContent("gemini", "plain")).toEqual([{ text: "plain" }]);
    expect(aiProvider.providerContent("openai", "plain")).toBe("plain");
    expect(aiProvider.providerContent("anthropic", "plain")).toBe("plain");
  });
});
