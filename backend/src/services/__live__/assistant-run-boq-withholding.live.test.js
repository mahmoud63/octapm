/**
 * A stored AI run built from the bill is served to its owner only while the
 * owner may read the BOQ on the run's project — proven against a real API
 * process and the real local Postgres (owner check, 2026-09-29).
 *
 * Before 6468eb0 the scope-gap review stored the uncovered BOQ rows (code,
 * description) and the BOQ counts in the run's prompt and answer for every
 * member who asked, BOQ reader or not. A run is served back through
 * GET /assistant/conversations/:id (and under a project), the answer to
 * POST /assistant/messages/:id/feedback, and the history a follow-up
 * POST /assistant/ask sends the model. Owning the run is no exemption.
 *
 * The spawned API's model is the echo fixture (fixtures/echo-model.js): it
 * answers with every user message it was sent, history included, so what a
 * follow-up sent the model is in the answer.
 *
 *  - a member whose template sets the BOQ tool to none reads their own
 *    legacy-shaped scope_gap run (seeded here as the old code stored it,
 *    with BOQ rows in the prompt, the answer and a source) without any of
 *    it, on every read path — the stored rows untouched;
 *  - the BOQ reader's run is served byte for byte as the service builds it;
 *  - a PM who made a run while reading the BOQ and then lost boq:read is
 *    served it withheld;
 *  - the same member's new run, built without the bill and marked so, is
 *    served as it is.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/assistant-run-boq-withholding.live.test.js
 */
const crypto = require("crypto");
const path = require("path");
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { normalizeMoneyTree } = require("../../utils/money");
const assistantService = require("../assistant.service");
const { startApi } = require("./auth-live-kit");

const WITHHELD = { reason: "This AI run was built from the BOQ's rows or the mapping, available only to members who may read the BOQ" };
const ECHO_MODEL = path.join(__dirname, "fixtures", "echo-model.js").split(path.sep).join("/");

const SPEC_TEXT = [
  "SECTION 03 30 00",
  "CAST-IN-PLACE CONCRETE",
  "PART 1 - GENERAL",
  "A. This section covers cast-in-place concrete for foundations and suspended slabs including formwork.",
  "END OF SECTION",
  "",
  "SECTION 09 91 00 – PAINTING",
  "PART 1 - GENERAL",
  "A. This section covers surface preparation and field painting of exposed surfaces.",
  "END OF SECTION",
].join("\n");

liveDescribe("A stored AI run built from the bill is withheld from a reader who may not read the BOQ now, its owner included", () => {
  let live;
  let api;
  let project;
  let rows;
  let noBoq;
  let lapsed;
  let legacy;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const tag = Date.now();

  const withoutBoq = async (member) => {
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest ${member.role} ${member.id.slice(0, 8)}, no BOQ ${tag}`, baseRole: member.role, tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id } });
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({
      DATABASE_CONNECTION_LIMIT: "4",
      NODE_OPTIONS: `--require "${ECHO_MODEL}"`,
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "live-test-echo",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      AI_MODEL: "",
      AI_RETRY_BASE_MS: "1",
    });
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest assistant runs", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    for (const [key, role] of [["noBoq", "site_engineer"], ["lapsed", "pm"]]) {
      const member = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${role}`, email: `live-run-${key.toLowerCase()}-${tag}@octapm-live.test`, role });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      if (key === "noBoq") noBoq = member;
      else lapsed = member;
    }
    await withoutBoq(noBoq);

    const createItem = async (payload) => {
      const created = await api.post(at("/boq/items"), payload, auth());
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data.item;
    };
    rows = [
      await createItem({ code: "Q7.41", description: "RUNSECRET concrete to suspended slabs incl. formwork", quantity: 5123.25, unit: "m3", rate: 214.6 }),
      await createItem({ code: "Q7.97", description: "RUNSECRET landscaping turf seeding", quantity: 417.5, unit: "m2", rate: 9.1 }),
    ];

    const documentId = crypto.randomUUID();
    await prisma.projectDocument.create({
      data: {
        id: documentId, orgId: live.org.id, projectId: project.id, documentType: "specification", title: "LiveTest specification",
        originalName: "spec.txt", fileName: "spec.txt", mimeType: "text/plain", sizeBytes: SPEC_TEXT.length,
        sha256: crypto.createHash("sha256").update(SPEC_TEXT).digest("hex"), storageProvider: "local",
        objectKey: `live-test/${documentId}.txt`, storageKey: `live-test/${documentId}.txt`,
      },
    });
    await prisma.documentText.create({ data: { orgId: live.org.id, projectId: project.id, documentId, status: "ready", extractor: "text", text: SPEC_TEXT, wordCount: SPEC_TEXT.split(/\s+/).length } });
    const indexed = await api.post(at("/specifications/index"), { documentIds: [documentId] }, auth());
    expect([indexed.status, indexed.body?.error]).toEqual([200, undefined]);

    // The member's run as the code before 6468eb0 stored it: the uncovered
    // rows and the counts in the prompt and the answer, and a BOQ row among
    // the sources. Written the way storeRun wrote it, with no marker.
    const conversation = await prisma.assistantConversation.create({
      data: { orgId: live.org.id, projectId: project.id, userId: noBoq.id, kind: "scope_gap", recordType: "project", recordId: project.id, title: "Scope coverage review", lastMessageAt: new Date() },
    });
    const digest = { summary: { sections: 2, withGaps: 2, noBoq: 1, boqItems: 2, uncoveredBoq: 1 }, uncoveredBoq: [`Q7.97 ${rows[1].description}`] };
    await prisma.assistantMessage.create({ data: { orgId: live.org.id, conversationId: conversation.id, role: "user", content: JSON.stringify(digest) } });
    const answer = await prisma.assistantMessage.create({
      data: {
        orgId: live.org.id, conversationId: conversation.id, role: "assistant",
        content: `1 of 2 BOQ items match no specification section: Q7.97 ${rows[1].description} (417.5 m2). [1]`,
        citationsJson: [{ n: 1, id: rows[1].id, type: "boq_item", title: rows[1].description, ref: "Q7.97" }],
        sourcesJson: [{ n: 1, id: rows[1].id, type: "boq_item", title: rows[1].description, ref: "Q7.97", projectId: project.id, url: null }],
        provider: "openai", model: "legacy",
      },
    });
    legacy = { conversationId: conversation.id, answerId: answer.id };
  }, 120_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["specSection", "documentText", "projectDocument", "assistantMessage", "assistantConversation", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  const secretsOf = () => [...rows.map((row) => row.id), "Q7.41", "Q7.97", "RUNSECRET", "5123.25", "417.5", "\"uncoveredBoq\"", "\"boqItems\"", "\"noBoq\"", "boq_item"];
  const leaks = (text) => secretsOf().filter((secret) => text.includes(secret));
  const storedOf = (conversationId) => prisma.assistantMessage.findMany({ where: { orgId: live.org.id, conversationId }, orderBy: { createdAt: "asc" } });
  const runOf = async (userId) => {
    const row = await prisma.assistantConversation.findFirst({ where: { orgId: live.org.id, kind: "scope_gap", userId }, orderBy: { createdAt: "desc" } });
    return row.id;
  };
  const readPaths = async (member, conversationId, answerId) => ({
    org: await api.get(`/api/v1/assistant/conversations/${conversationId}`, as(member)),
    project: await api.get(at(`/assistant/conversations/${conversationId}`), as(member)),
    feedback: await api.post(`/api/v1/assistant/messages/${answerId}/feedback`, { rating: "up" }, as(member)),
    followUp: await api.post("/api/v1/assistant/ask", { question: "What did you find last time?", conversationId }, as(member)),
  });
  const expectWithheld = (label, paths) => {
    for (const [name, answer] of Object.entries(paths)) {
      expect([label, name, answer.status]).toEqual([label, name, 200]);
      expect([label, name, leaks(answer.text)]).toEqual([label, name, []]);
    }
    for (const name of ["org", "project"]) {
      const data = paths[name].body.data;
      expect([label, name, data.contentWithheld, data.kind, data.title]).toEqual([label, name, WITHHELD, "scope_gap", "Scope coverage review"]);
      expect(data.messages.map((message) => [message.role, message.contentWithheld, "content" in message, "sources" in message])).toEqual([
        ["user", WITHHELD, false, false],
        ["assistant", WITHHELD, false, false],
      ]);
    }
    expect([label, paths.feedback.body.data.contentWithheld, paths.feedback.body.data.feedback]).toEqual([label, WITHHELD, "up"]);
  };

  it("the member's own legacy run is served without its BOQ content on every read path, and nothing stored changes", async () => {
    expect((await api.get(at("/boq"), as(noBoq))).status).toBe(403);
    const before = await storedOf(legacy.conversationId);
    expect(before.map((message) => leaks(message.content).length > 0)).toEqual([true, true]);

    expectWithheld("legacy", await readPaths(noBoq, legacy.conversationId, legacy.answerId));

    // The follow-up question and its answer are added; the run itself is as it was.
    const after = (await storedOf(legacy.conversationId)).filter((message) => before.some((row) => row.id === message.id));
    const keep = (list) => list.map(({ feedback, updatedAt, ...row }) => row);
    expect(keep(after)).toEqual(keep(before));
    expect(after.find((message) => message.id === legacy.answerId).feedback).toBe("up");
  });

  it("the BOQ reader's run is served byte for byte as the service builds it, with the rows", async () => {
    const explained = await api.post(at("/specifications/scope-gaps/explain"), {}, auth());
    expect([explained.status, explained.body?.data?.degraded]).toEqual([200, false]);
    const conversationId = await runOf(live.user.id);
    const stored = await storedOf(conversationId);
    expect(stored[0].usageJson).toBeNull();

    for (const route of [`/api/v1/assistant/conversations/${conversationId}`, at(`/assistant/conversations/${conversationId}`)]) {
      const read = await api.get(route, auth());
      const built = await assistantService.getConversation({ orgId: live.org.id, user: live.user, conversationId, readsBoq: async () => true });
      expect(read.text).toBe(JSON.stringify({ success: true, data: normalizeMoneyTree(built) }));
      expect(read.body.data).not.toHaveProperty("contentWithheld");
      expect(read.body.data.messages[0].content).toContain("Q7.97 RUNSECRET landscaping turf seeding");
    }
    const rated = await api.post(`/api/v1/assistant/messages/${stored[1].id}/feedback`, { rating: "down" }, auth());
    expect(rated.text).toBe(JSON.stringify({ success: true, data: normalizeMoneyTree(assistantService.serializeMessage(await prisma.assistantMessage.findUnique({ where: { id: stored[1].id } }))) }));
    const followUp = await api.post("/api/v1/assistant/ask", { question: "What did you find last time?", conversationId }, auth());
    expect(followUp.body.data.message.content).toContain("RUNSECRET");
  });

  it("a PM who made a run while reading the BOQ and has lost boq:read is served it withheld", async () => {
    const explained = await api.post(at("/specifications/scope-gaps/explain"), {}, as(lapsed));
    expect([explained.status, explained.body?.data?.degraded]).toEqual([200, false]);
    const conversationId = await runOf(lapsed.id);
    const stored = await storedOf(conversationId);
    const visible = await api.get(`/api/v1/assistant/conversations/${conversationId}`, as(lapsed));
    expect(visible.body.data.messages[0].content).toContain("Q7.97 RUNSECRET");

    await withoutBoq(lapsed);
    expect((await api.get(at("/boq"), as(lapsed))).status).toBe(403);
    expectWithheld("lapsed", await readPaths(lapsed, conversationId, stored[1].id));
  });

  it("a member's new run, built without the bill and marked so, is served to them as it is", async () => {
    const explained = await api.post(at("/specifications/scope-gaps/explain"), {}, as(noBoq));
    expect([explained.status, explained.body?.data?.degraded]).toEqual([200, false]);
    const conversationId = await runOf(noBoq.id);
    expect(conversationId).not.toBe(legacy.conversationId);
    const stored = await storedOf(conversationId);
    expect(stored[0].usageJson).toEqual({ builtWithoutBoq: true });
    const read = await api.get(at(`/assistant/conversations/${conversationId}`), as(noBoq));
    expect(read.status).toBe(200);
    expect(read.body.data).not.toHaveProperty("contentWithheld");
    expect(read.body.data.messages.map((message) => [message.role, message.usage])).toEqual([["user", null], ["assistant", expect.anything()]]);
    expect(read.body.data.messages[0].content).toContain("sectionsWithGaps");
    expect(leaks(read.text)).toEqual([]);
  });
});
