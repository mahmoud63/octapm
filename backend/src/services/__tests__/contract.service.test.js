const store = { profile: null, conversations: [], messages: [], links: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const day = (key) => new Date(`${key}T00:00:00.000Z`);
const ASOF = day("2026-09-05");

const CONTRACT_TEXT = `GENERAL CONDITIONS. Sub-Clause 8.4 Extension of Time for Completion. The Contractor shall be entitled subject to Sub-Clause 20.1 to an extension of the Time for Completion if and to the extent that completion is or will be delayed by a Variation, a cause of delay giving an entitlement under these Conditions, or exceptionally adverse climatic conditions. Sub-Clause 20.1 Contractor's Claims. If the Contractor considers himself to be entitled to any extension of the Time for Completion, the Contractor shall give notice to the Engineer not later than 28 days after the Contractor became aware of the event. Within 42 days after the Contractor became aware of the event the Contractor shall send a fully detailed claim. Sub-Clause 8.7 Delay Damages: the Contractor shall pay delay damages of 0.1 percent per day up to a maximum of 10 percent of the Contract Price. Sub-Clause 14.7 Payment: the Employer shall pay within 56 days after receiving the Statement. Sub-Clause 11.1 the Defects Notification Period is 365 days.`;

const mockPrisma = {
  project: { findFirst: jest.fn(async () => ({ id: "p1", name: "Tower", clientName: "Skyline Ltd", consultantName: "Arc Engineers", contractorName: "BuildCo", contractType: "FIDIC Red Book", contractNumber: "C-2026-01", completionDate: day("2027-06-30"), endDate: day("2027-06-30"), revisedCompletionDate: null, ldRatePerDay: 5000, weatherAllowanceDays: 20 })) },
  contractProfile: {
    findUnique: jest.fn(async () => store.profile),
    upsert: jest.fn(async ({ create, update }) => {
      store.profile = store.profile ? { ...store.profile, ...update, updatedAt: new Date() } : { id: "cp-1", createdAt: new Date(), updatedAt: new Date(), ...create };
      return store.profile;
    }),
  },
  weatherDelay: { findMany: jest.fn(async () => [{ id: "wd-1", date: day("2026-07-02"), description: "Sandstorm, site closed", delayDays: 2, contractual: true, activityLinks: [{ activityId: "act-1" }] }, { id: "wd-2", date: day("2026-08-30"), description: "Light rain", delayDays: 0, contractual: false, activityLinks: [] }]) },
  changeOrder: { findMany: jest.fn(async () => [{ id: "co-3", ref: "VO-003", description: "Additional pile caps at grid F", status: "pending", value: 120000, scheduleImpact: 5, activityId: "act-2", submittedDate: day("2026-06-01"), createdAt: day("2026-05-28") }]) },
  rfi: { findMany: jest.fn(async () => [{ id: "rfi-9", ref: "RFI-009", subject: "Unforeseen rock at basement", status: "open", activityId: "act-3", raisedDate: day("2026-08-25"), createdAt: day("2026-08-25"), scheduleImpact: 4 }]) },
  eotClaim: {
    findMany: jest.fn(async () => [{ id: "eot-1", ref: "EOT-001", eventName: "Late access to zone B", eventType: "employer_delay", status: "draft", delayDays: 12, createdAt: day("2026-07-20"), activityLinks: [{ activityId: "act-1", delayStart: day("2026-07-10") }] }]),
    findFirst: jest.fn(async ({ where }) =>
      where.id === "eot-1"
        ? { id: "eot-1", ref: "EOT-001", eventName: "Late access to zone B", eventType: "employer_delay", status: "draft", delayDays: 12, eotDaysGranted: 10, analysis: null, claimLetter: "Old letter", entitlementSummaryJson: { criticalPathImpactDays: 9, floatAbsorbedDays: 3, ldApplicableDays: 0 }, activityLinks: [{ activityId: "act-1", delayStart: day("2026-07-10"), delayEnd: day("2026-07-22"), delayDays: 12, floatDays: 3, criticalPathImpactDays: 9, impactBasis: "Access denied by the Employer", activity: { id: "act-1", name: "Zone B excavation", activityCode: "A2100", isCritical: true, totalFloat: 3 } }], weatherDelayLinks: [{ weatherDelayId: "wd-1", delayStart: null, delayEnd: null, delayDays: 2, weatherDelay: { id: "wd-1", date: day("2026-07-02"), description: "Sandstorm, site closed", delayDays: 2, contractual: true } }] }
        : null,
    ),
  },
  correspondence: {
    findMany: jest.fn(async ({ where }) =>
      where.direction === "outgoing"
        ? [
            { id: "cor-10", ref: "COR-010", subject: "Notice of delay — sandstorm 2 July", body: "We give notice under Sub-Clause 20.1…", date: day("2026-07-05"), activityId: "act-1", status: "open" },
            { id: "cor-11", ref: "COR-011", subject: "Notice of variation VO-003 additional pile caps", body: "…", date: day("2026-07-15"), activityId: null, status: "open" },
          ]
        : [{ id: "cor-20", ref: "COR-020", subject: "Engineer's notice: programme revision required", date: day("2026-08-01"), responseRequiredBy: day("2026-08-20"), responseDate: day("2026-08-18"), status: "closed", activityId: null }],
    ),
  },
  commercialCorrespondenceLink: {
    findMany: jest.fn(async ({ where = {} }) => [{ recordType: "weather_delay", recordId: "wd-1", correspondenceId: "cor-10", relationType: "notice" }, ...store.links].filter((row) => (!where.recordType || row.recordType === where.recordType) && (!where.recordId || row.recordId === where.recordId))),
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("link"), ...data };
      store.links.push(row);
      return row;
    }),
  },
  dailyLogDelay: { findMany: jest.fn(async () => [{ id: "dl-1", type: "access", description: "Zone B gate locked by the Employer", hoursLost: 8, activityId: "act-1", dailyLog: { date: day("2026-07-11") } }]) },
  commercialAttachmentRef: { findMany: jest.fn(async () => [{ id: "att-1", fileName: "gate-photo.jpg", description: null }]) },
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
const mockDocumentText = { getDocumentText: jest.fn(async ({ documentId }) => (documentId === "doc-contract" ? { document: { title: "Conditions of Contract" }, text: { status: "ready", text: CONTRACT_TEXT, totalChars: CONTRACT_TEXT.length } } : { document: { title: "Scan" }, text: { status: "unsupported", text: "", totalChars: 0 } })) };
const mockCorrespondence = { createCorrespondence: jest.fn(async ({ payload }) => ({ id: "cor-new", ref: "COR-012", subject: payload.subject, direction: payload.direction, type: payload.type, contractualNotice: payload.contractualNotice })) };
const mockEot = { updateEotClaim: jest.fn(async ({ claimId, payload }) => ({ id: claimId, ref: "EOT-001", status: "draft", ...payload })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../document-text.service", () => mockDocumentText);
jest.mock("../correspondence.service", () => mockCorrespondence);
jest.mock("../eot.service", () => mockEot);

const service = require("../contract.service");

const user = { id: "u-1", orgId: "org-1", role: "pm" };
const scope = { orgId: "org-1", projectId: "p1" };

describe("contract intelligence", () => {
  beforeAll(() => {
    process.env.AI_RETRY_BASE_MS = "1";
  });
  beforeEach(() => {
    store.profile = null;
    store.conversations.length = 0;
    store.messages.length = 0;
    store.links.length = 0;
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it("returns defaults with the form presets and applies a form's periods on save", async () => {
    const empty = await service.getProfile(scope);
    expect(empty).toMatchObject({ exists: false, form: "custom", delayNoticeDays: 28, claimParticularsDays: 42, responseDays: 42, clauses: [] });
    expect(empty.presets.map((preset) => preset.key)).toEqual(["fidic_1999", "fidic_2017", "nec4", "jct_2016", "aia_a201", "custom"]);
    const saved = await service.updateProfile({ ...scope, payload: { form: "nec4", documentIds: ["doc-contract", "doc-contract"], clauses: [{ category: "eot", reference: "Clause 60.1", title: "Compensation events", summary: "Grounds for time and money", days: null, status: "draft" }, { category: "bogus" }] }, actor: user });
    expect(saved).toMatchObject({ exists: true, form: "nec4", formLabel: "NEC4 ECC", delayNoticeDays: 56, claimParticularsDays: 56, responseDays: 14, documentIds: ["doc-contract"] });
    expect(saved.clauses).toHaveLength(1);
    expect(saved.clauses[0]).toMatchObject({ category: "eot", reference: "Clause 60.1", status: "draft", source: "model" });
    const tuned = await service.updateProfile({ ...scope, payload: { delayNoticeDays: 42, confirm: true }, actor: user });
    expect(tuned).toMatchObject({ form: "nec4", delayNoticeDays: 42, responseDays: 14, confirmedBy: "u-1" });
    expect(tuned.clauses[0].status).toBe("confirmed");
  });

  it("extracts clauses from the contract text through the model, and by scanning the text without one", async () => {
    await expect(service.extractClauses({ ...scope, user, payload: {} })).rejects.toMatchObject({ code: "CONTRACT_DOCUMENTS_REQUIRED" });
    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("clauses that govern time, money and notices");
      expect(messages[0].content).toContain("Document: Conditions of Contract");
      expect(messages[0].content).toContain("Sub-Clause 20.1");
      return { text: JSON.stringify({ clauses: [{ category: "notice", reference: "Sub-Clause 20.1", title: "Contractor's claims notice", summary: "Notice to the Engineer within 28 days of awareness; detailed claim within 42 days.", days: 28, excerpt: "the Contractor shall give notice to the Engineer not later than 28 days after the Contractor became aware of the event" }, { category: "eot", reference: "Sub-Clause 8.4", title: "Extension of Time for Completion", summary: "Grounds: Variation, entitlement under the Conditions, exceptionally adverse climatic conditions.", days: null, excerpt: "exceptionally adverse climatic conditions" }, { category: "ld", reference: "Sub-Clause 8.7", title: "Delay damages", summary: "0.1% per day, capped at 10% of the Contract Price.", days: null }, { category: "payment", reference: "Sub-Clause 14.7", title: "Payment", summary: "Within 56 days of the Statement.", days: 56 }, { category: "nonsense" }] }), usage: { inputTokens: 3000, outputTokens: 400 } };
    });
    const result = await service.extractClauses({ ...scope, user, payload: { documentIds: ["doc-contract", "doc-scan"] }, transport });
    expect(result.degraded).toBe(false);
    expect(result.windowsRead).toBe(1);
    expect(result.proposed.map((clause) => [clause.category, clause.reference, clause.days, clause.status, clause.source])).toEqual([["notice", "Sub-Clause 20.1", 28, "draft", "model"], ["eot", "Sub-Clause 8.4", null, "draft", "model"], ["ld", "Sub-Clause 8.7", null, "draft", "model"], ["payment", "Sub-Clause 14.7", 56, "draft", "model"]]); // the nameless clause is dropped
    expect(result.suggestedPeriods).toEqual({ delayNoticeDays: 28, variationNoticeDays: 28, paymentDays: 56, defectsLiabilityDays: null });
    expect(result.documents.map((document) => [document.id, document.readable])).toEqual([["doc-contract", true], ["doc-scan", false]]);
    expect(store.profile).toMatchObject({ documentIds: ["doc-contract", "doc-scan"], extractedModel: "test" });
    expect(store.profile.clausesJson).toHaveLength(4);
    expect(store.conversations[0]).toMatchObject({ kind: "contract_extract", recordType: "project", recordId: "p1" });

    const plain = await service.extractClauses({ ...scope, user, payload: {} });
    expect(plain.degraded).toBe(true);
    expect(plain.reason).toContain("text scan");
    expect(plain.proposed.length).toBeGreaterThanOrEqual(3);
    expect(plain.proposed.map((clause) => clause.source)).toEqual(expect.arrayContaining(["heuristic"]));
    expect(plain.proposed.find((clause) => clause.category === "notice")).toMatchObject({ days: 28, reference: "Sub-Clause 20.1" });
    expect(plain.proposed.find((clause) => clause.category === "defects")).toMatchObject({ days: 365 });
    expect(service.windowsOf("a".repeat(30_000)).length).toBe(3);
  });

  it("monitors notices: served by link, late by reference, due, missed and answered incoming notices", async () => {
    store.profile = { form: "fidic_1999", delayNoticeDays: 28, claimParticularsDays: 42, variationNoticeDays: 28, responseDays: 42, documentIds: [], clausesJson: [] };
    const monitor = await service.noticeMonitor({ ...scope, asOf: ASOF });
    const byKey = Object.fromEntries(monitor.items.map((item) => [`${item.recordType}:${item.recordId}`, item]));
    expect(byKey["weather_delay:wd-1"]).toMatchObject({ kind: "delay", status: "served", periodDays: 28, clauseReference: "Sub-Clause 20.1", deadline: "2026-07-30T00:00:00.000Z", served: expect.objectContaining({ ref: "COR-010", via: "link", lateByDays: 0 }) });
    expect(byKey["weather_delay:wd-2"]).toMatchObject({ status: "not_required", required: false });
    expect(byKey["change_order:co-3"]).toMatchObject({ kind: "variation", status: "late", deadline: "2026-06-29T00:00:00.000Z", served: expect.objectContaining({ ref: "COR-011", via: "reference", lateByDays: 16 }) });
    expect(byKey["rfi:rfi-9"]).toMatchObject({ status: "due", deadline: "2026-09-22T00:00:00.000Z", daysLeft: 17, served: null });
    expect(byKey["eot_claim:eot-1"]).toMatchObject({ status: "missed", date: "2026-07-10T00:00:00.000Z", deadline: "2026-08-07T00:00:00.000Z", served: null });
    expect(byKey["correspondence:cor-20"]).toMatchObject({ kind: "incoming_notice", status: "served", deadline: "2026-08-20T00:00:00.000Z", served: expect.objectContaining({ via: "response" }) });
    expect(monitor.summary).toEqual({ missed: 1, due: 1, late: 1, served: 2, not_required: 1, dueSoon: 0 });
    expect(monitor.items.map((item) => item.status)).toEqual(["missed", "due", "late", "served", "served", "not_required"]);
    expect(monitor.profile).toMatchObject({ form: "fidic_1999", exists: true });
  });

  it("drafts a notice from the facts and the clauses, then creates it as linked correspondence", async () => {
    store.profile = { form: "fidic_1999", delayNoticeDays: 28, claimParticularsDays: 42, variationNoticeDays: 28, responseDays: 42, documentIds: [], clausesJson: [{ id: "c1", category: "notice", reference: "Sub-Clause 20.1", title: "Contractor's claims", summary: "Notice within 28 days of awareness.", days: 28, status: "confirmed" }] };
    const plain = await service.draftNotice({ ...scope, user, payload: { recordType: "rfi", recordId: "rfi-9" } });
    expect(plain.degraded).toBe(true);
    expect(plain.draft.subject).toBe("Notice under Sub-Clause 20.1 — RFI-009 Unforeseen rock at basement");
    expect(plain.draft.body).toContain("Contract: C-2026-01 (FIDIC Red Book)");
    expect(plain.draft.body).toContain("To: Arc Engineers");
    expect(plain.draft.body).toContain("has occurred on 2026-08-25 and is expected to delay the Works by 4 days");
    expect(plain.draft.body).toContain("will follow within 42 days");
    expect(plain.event).toMatchObject({ recordType: "rfi", recordId: "rfi-9", kind: "delay" });
    await expect(service.draftNotice({ ...scope, user, payload: { recordType: "rfi", recordId: "nope" } })).rejects.toMatchObject({ code: "CONTRACT_EVENT_NOT_FOUND" });

    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("formal contractual notices");
      const facts = messages[0].content;
      expect(facts).toContain("Event: RFI-009 — Unforeseen rock at basement (delay) on 2026-08-25, 4 days of delay recorded");
      expect(facts).toContain("Notice period: 28 days (Sub-Clause 20.1)");
      expect(facts).toContain('- Sub-Clause 20.1 (28 days): Notice within 28 days of awareness.');
      expect(facts).toContain("Instructions from the writer: mention the geotechnical report");
      return { text: JSON.stringify({ subject: "Notice of claim under Sub-Clause 20.1 — unforeseen rock, RFI-009", body: "Dear Sirs,\n\nWe give notice…", clauseRefs: ["Sub-Clause 20.1", "Sub-Clause 4.12"] }), usage: { inputTokens: 500, outputTokens: 200 } };
    });
    const drafted = await service.draftNotice({ ...scope, user, payload: { recordType: "rfi", recordId: "rfi-9", instructions: "mention the geotechnical report" }, transport });
    expect(drafted.degraded).toBe(false);
    expect(drafted.draft).toMatchObject({ subject: "Notice of claim under Sub-Clause 20.1 — unforeseen rock, RFI-009", clauseRefs: ["Sub-Clause 20.1", "Sub-Clause 4.12"] });
    expect(drafted.message).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(store.conversations[0]).toMatchObject({ kind: "contract_notice", recordType: "rfi", recordId: "rfi-9" });

    const created = await service.createNotice({ ...scope, user, payload: { recordType: "rfi", recordId: "rfi-9", subject: drafted.draft.subject, body: drafted.draft.body, activityId: "act-3" } });
    expect(mockCorrespondence.createCorrespondence).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", payload: expect.objectContaining({ direction: "outgoing", type: "notice", contractualNotice: true, subject: drafted.draft.subject, activityId: "act-3", status: "open" }), userId: "u-1" }));
    expect(mockPrisma.commercialCorrespondenceLink.create).toHaveBeenCalledWith({ data: expect.objectContaining({ recordType: "rfi", recordId: "rfi-9", correspondenceId: "cor-new", relationType: "notice" }) });
    expect(created).toMatchObject({ linked: true, url: "/projects/p1/doc-control/correspondence?recordId=cor-new", correspondence: { ref: "COR-012" } });
    await expect(service.createNotice({ ...scope, user, payload: { recordType: "rfi", recordId: "rfi-9", subject: "x" } })).rejects.toMatchObject({ code: "CONTRACT_NOTICE_TEXT" });
  });

  it("assesses an EOT claim's entitlement from the record, through the model, and applies the kept text", async () => {
    store.profile = { form: "fidic_1999", delayNoticeDays: 28, claimParticularsDays: 42, variationNoticeDays: 28, responseDays: 42, documentIds: [], clausesJson: [{ id: "c1", category: "eot", reference: "Sub-Clause 8.4", title: "Extension of Time", summary: "Grounds for extension.", status: "confirmed" }] };
    const plain = await service.assessClaim({ ...scope, claimId: "eot-1", user });
    expect(plain.degraded).toBe(true);
    expect(plain.claim).toMatchObject({ ref: "EOT-001", delayDays: 12, eotDaysGranted: 10 });
    expect(plain.notices.map((notice) => [notice.recordType, notice.status])).toEqual([["eot_claim", "missed"], ["weather_delay", "served"]]);
    expect(plain.evidence).toMatchObject({ window: { from: "2026-07-02", to: "2026-07-22" }, logDelays: [expect.objectContaining({ date: "2026-07-11", type: "access", hoursLost: 8 })], attachments: [expect.objectContaining({ fileName: "gate-photo.jpg" })] });
    expect(plain.assessment).toMatchObject({ entitlement: "partial", recommendedDays: 9, claimLetter: "Old letter" });
    expect(plain.assessment.gaps).toEqual(expect.arrayContaining([expect.stringContaining("was not served within the 28 days period")]));
    expect(plain.assessment.gaps).not.toEqual(expect.arrayContaining([expect.stringContaining("No supporting documents")]));
    expect(plain.assessment.basis[0]).toBe("9 days of critical-path impact across 1 linked activity");

    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("delay analyst");
      const text = messages[0].content;
      expect(text).toContain("Claim EOT-001: Late access to zone B (employer_delay), status draft, 12 days claimed, 10 requested; critical-path impact 9 days, float absorbed 3");
      expect(text).toContain("- Zone B excavation (A2100) · delay 12 days from 2026-07-10 to 2026-07-22 · float 3 · critical-path impact 9 · critical · Access denied by the Employer");
      expect(text).toContain("- 2026-07-02 Sandstorm, site closed · 2 days · contractual");
      expect(text).toContain("Notice compliance: EOT-001: missed; 2026-07-02: served (COR-010 on 2026-07-05)");
      expect(text).toContain("Evidence: 1 daily-log delay entry in 2026-07-02 → 2026-07-22 (2026-07-11 access 8h); 1 attachment; 0 linked letters");
      expect(text).toContain("- Sub-Clause 8.4: Grounds for extension.");
      return { text: JSON.stringify({ entitlement: "partial", recommendedDays: 9, basis: ["Access denial is an Employer delay under Sub-Clause 8.4", "9 days on the critical path"], gaps: ["Notice under Sub-Clause 20.1 was not served within 28 days of 10 July"], concurrency: ["Sandstorm of 2 July overlaps the first two days"], noticeCompliance: "Notice was not served in time; the claim is exposed to a time bar.", narrative: "The Employer's denial of access…", claimLetter: "Dear Sirs, we submit our claim…" }), usage: { inputTokens: 1500, outputTokens: 600 } };
    });
    const assessed = await service.assessClaim({ ...scope, claimId: "eot-1", user, transport });
    expect(assessed.degraded).toBe(false);
    expect(assessed.assessment).toMatchObject({ entitlement: "partial", recommendedDays: 9, concurrency: ["Sandstorm of 2 July overlaps the first two days"], claimLetter: "Dear Sirs, we submit our claim…" });
    expect(store.conversations[0]).toMatchObject({ kind: "contract_eot", recordType: "eot_claim", recordId: "eot-1", title: "Entitlement: EOT-001" });

    const applied = await service.applyAssessment({ ...scope, claimId: "eot-1", user, payload: { analysis: assessed.assessment.narrative, claimLetter: assessed.assessment.claimLetter } });
    expect(mockEot.updateEotClaim).toHaveBeenCalledWith(expect.objectContaining({ claimId: "eot-1", payload: { analysis: "The Employer's denial of access…", claimLetter: "Dear Sirs, we submit our claim…" }, userId: "u-1", userRole: "pm" }));
    expect(applied.applied).toEqual({ analysis: true, claimLetter: true });
    await expect(service.applyAssessment({ ...scope, claimId: "eot-1", user, payload: {} })).rejects.toMatchObject({ code: "CONTRACT_APPLY_EMPTY" });
    await expect(service.assessClaim({ ...scope, claimId: "nope", user })).rejects.toMatchObject({ code: "EOT_CLAIM_NOT_FOUND" });
  });
});
