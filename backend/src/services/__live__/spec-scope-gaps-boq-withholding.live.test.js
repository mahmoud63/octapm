/**
 * The specification check carries no BOQ row, count or gap to a member who
 * may not read the BOQ — in its answer, in a section's related records, or
 * through the model's prompt — proven against a real API process and the
 * real local Postgres (owner check, 2026-09-29).
 *
 * GET /specifications/scope-gaps, GET /specifications/:sectionId (and POST
 * /:sectionId/conflicts) are admitted on document_control:read, POST
 * /scope-gaps/explain on assistant:read as well. They used to read the
 * bill's rows and hand every specification reader summary.boqItems (the row
 * count), uncoveredBoq[] (id, code, description, unit, quantity of every row
 * no section covers) and its count, the "no_boq" gaps, noBoq and each
 * section's BOQ count, and related.boqItems; /explain put the uncovered rows
 * in the model's prompt. That is the BOQ's, not the specification's.
 *
 * The spawned API's model is the echo fixture (fixtures/echo-model.js): it
 * answers every prompt with the prompt itself as the narrative, so what the
 * prompt carried is in the answer — the worst a real model could do.
 *
 * Three members whose templates set the BOQ tool to none, and who keep
 * document_control and assistant (refused GET /boq, admitted to the check),
 * receive no BoqItem id, code, description or quantity, no BOQ count and no
 * "no_boq" gap anywhere — and `boqWithheld` / `boqItemsWithheld` with the
 * reason. The BOQ reader receives the service's answer, byte for byte, with
 * the rows.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/spec-scope-gaps-boq-withholding.live.test.js
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
const specificationService = require("../specification.service");
const { startApi } = require("./auth-live-kit");

const WITHHELD = { reason: "BOQ coverage is worked from the BOQ's rows, available only to members who may read the BOQ" };
// Forward slashes: NODE_OPTIONS reads a backslash as an escape.
const ECHO_MODEL = path.join(__dirname, "fixtures", "echo-model.js").split(path.sep).join("/");

const SPEC_TEXT = [
  "SECTION 03 30 00",
  "CAST-IN-PLACE CONCRETE",
  "PART 1 - GENERAL",
  "A. This section covers cast-in-place concrete for foundations, slabs on grade and suspended slabs including formwork, reinforcement and curing.",
  "END OF SECTION",
  "",
  "SECTION 09 91 00 – PAINTING",
  "PART 1 - GENERAL",
  "A. This section covers surface preparation and field painting of exposed interior and exterior surfaces, two finish coats over primer.",
  "END OF SECTION",
  "",
  "SECTION 26 05 19",
  "LOW-VOLTAGE ELECTRICAL POWER CONDUCTORS AND CABLES",
  "PART 1 - GENERAL",
  "A. This section covers building wires and cables rated 600 V and less, connectors, splices and terminations.",
  "END OF SECTION",
].join("\n");

liveDescribe("The specification check carries no BOQ row, count or gap to a member who may not read the BOQ", () => {
  let live;
  let api;
  let project;
  let rows;
  let sections;
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    // No real provider: the chat endpoint is the echo fixture.
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
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest spec scope gaps", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    // Specification readers — each role keeps document_control and the
    // assistant; the template takes the BOQ tool away.
    for (const role of ["site_engineer", "planning_engineer", "pm"]) {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${role}`,
        email: `live-spec-${role.replace(/_/g, "")}-${tag}@octapm-live.test`,
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

    // Two rows with text nothing else in these answers could produce: one
    // the concrete section covers, one no section covers.
    const createItem = async (payload) => {
      const created = await api.post(at("/boq/items"), payload, auth());
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data.item;
    };
    rows = [
      await createItem({ code: "Z8.31", description: "SPECSECRET concrete to suspended slabs incl. formwork", quantity: 4271.5, unit: "m3", rate: 212.4 }),
      await createItem({ code: "Z8.99", description: "SPECSECRET landscaping turf seeding", quantity: 318.75, unit: "m2", rate: 9.6 }),
    ];

    // One activity the concrete section relates to, so the other two have
    // an activity gap that is not the BOQ's.
    const activity = await api.post(at("/activities"), {
      engineerIds: [live.user.id],
      name: "Pour concrete to suspended slabs",
      activityCode: "A310",
      duration: 5,
      startDate: "2026-02-02",
      endDate: "2026-02-06",
    }, auth());
    expect([activity.status, activity.body?.error]).toEqual([201, undefined]);

    // A specification document with extracted text, indexed through the API.
    const documentId = crypto.randomUUID();
    await prisma.projectDocument.create({
      data: {
        id: documentId,
        orgId: live.org.id,
        projectId: project.id,
        documentType: "specification",
        title: "LiveTest specification",
        originalName: "spec.txt",
        fileName: "spec.txt",
        mimeType: "text/plain",
        sizeBytes: SPEC_TEXT.length,
        sha256: crypto.createHash("sha256").update(SPEC_TEXT).digest("hex"),
        storageProvider: "local",
        objectKey: `live-test/${documentId}.txt`,
        storageKey: `live-test/${documentId}.txt`,
      },
    });
    await prisma.documentText.create({
      data: { orgId: live.org.id, projectId: project.id, documentId, status: "ready", extractor: "text", text: SPEC_TEXT, wordCount: SPEC_TEXT.split(/\s+/).length },
    });
    const indexed = await api.post(at("/specifications/index"), { documentIds: [documentId] }, auth());
    expect([indexed.status, indexed.body?.error]).toEqual([200, undefined]);
    sections = await prisma.specSection.findMany({ where: { orgId: live.org.id, projectId: project.id }, orderBy: { codeKey: "asc" } });
    expect(sections.map((section) => section.code)).toEqual(["03 30 00", "09 91 00", "26 05 19"]);
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

  // What must not reach a member who may not read the BOQ, wherever it would sit.
  const secretsOf = () => [
    ...rows.map((row) => row.id),
    "Z8.31",
    "Z8.99",
    "SPECSECRET",
    "4271.5",
    "318.75",
    "no_boq",
    "no BOQ items",
    "\"noBoq\"",
    "\"boqItems\"",
    "\"uncoveredBoq\"",
    "\"boq\":",
    "BOQ items match no specification section",
  ];
  const leaks = (text) => secretsOf().filter((secret) => text.includes(secret));

  it("the BOQ reader receives the service's check byte for byte, with the BOQ rows — and the model is sent them", async () => {
    const answer = await api.get(at("/specifications/scope-gaps"), auth());
    expect([answer.status, answer.body?.error]).toEqual([200, undefined]);
    const built = await specificationService.scopeGaps({ orgId: live.org.id, projectId: project.id });
    built.computedAt = answer.body.data.computedAt;
    expect(answer.text).toBe(JSON.stringify({ success: true, data: normalizeMoneyTree(built) }));
    expect(answer.body.data.summary).toMatchObject({ sections: 3, noBoq: 2, boqItems: 2, uncoveredBoq: 1 });
    expect(answer.body.data.uncoveredBoq).toEqual([{ id: rows[1].id, code: "Z8.99", description: "SPECSECRET landscaping turf seeding", unit: "m2", qty: 318.75 }]);
    expect(answer.body.data).not.toHaveProperty("boqWithheld");

    const explained = await api.post(at("/specifications/scope-gaps/explain"), {}, auth());
    expect([explained.status, explained.body?.error, explained.body?.data?.degraded]).toEqual([200, undefined, false]);
    expect(explained.body.data.review.narrative).toContain("Z8.99 SPECSECRET landscaping turf seeding");

    const concrete = sections.find((section) => section.code === "03 30 00");
    const section = await api.get(at(`/specifications/${concrete.id}`), auth());
    expect(section.body.data.related.boqItems.map((item) => [item.id, item.code, item.qty])).toEqual([[rows[0].id, "Z8.31", 4271.5]]);
  });

  it("members without BOQ read get the check without the bill, and the model is never sent a row", async () => {
    const reader = (await api.get(at("/specifications/scope-gaps"), auth())).body.data;
    const concrete = sections.find((section) => section.code === "03 30 00");

    for (const [role, member] of Object.entries(members)) {
      const memberAuth = as(member);
      // The BOQ tool is refused them; the specification check is not.
      const boq = await api.get(at("/boq"), memberAuth);
      expect([role, boq.status]).toEqual([role, 403]);

      const gaps = await api.get(at("/specifications/scope-gaps"), memberAuth);
      expect([role, gaps.status]).toEqual([role, 200]);
      const data = gaps.body.data;
      expect([role, data.boqWithheld]).toEqual([role, WITHHELD]);
      expect([role, "uncoveredBoq" in data]).toEqual([role, false]);
      expect([role, data.summary]).toEqual([role, { sections: 3, withGaps: 2, noDrawings: 0, noActivities: 2, sheets: 0, activities: 1 }]);
      // The specification's own stays as the reader has it, less the BOQ.
      expect([role, data.sections.map((section) => [section.id, section.code, section.gaps, section.counts])]).toEqual([
        role,
        reader.sections.map((section) => {
          const { boq, ...counts } = section.counts;
          return [section.id, section.code, section.gaps.filter((gap) => gap !== "no_boq"), counts];
        }),
      ]);
      expect([role, data.notes]).toEqual([role, reader.notes]);

      const explained = await api.post(at("/specifications/scope-gaps/explain"), {}, memberAuth);
      expect([role, explained.status, explained.body?.data?.degraded]).toEqual([role, 200, false]);
      // The echo model's narrative is the prompt it was sent.
      expect([role, explained.body.data.review.headline]).toEqual([role, "Echo of the prompt"]);
      expect([role, explained.body.data.review.narrative]).toEqual([role, expect.stringContaining("\"sectionsWithGaps\"")]);

      const section = await api.get(at(`/specifications/${concrete.id}`), memberAuth);
      expect([role, section.status, section.body.data.related.boqItemsWithheld]).toEqual([role, 200, WITHHELD]);
      const conflicts = await api.post(at(`/specifications/${concrete.id}/conflicts`), {}, memberAuth);
      expect([role, conflicts.status, conflicts.body.data.related.boqItemsWithheld]).toEqual([role, 200, WITHHELD]);

      for (const [name, answer] of Object.entries({ gaps, explained, section, conflicts })) {
        expect([role, name, leaks(answer.text)]).toEqual([role, name, []]);
      }
    }

    // Nor in what their explain runs stored as the prompt and the answer.
    const conversations = await prisma.assistantConversation.findMany({
      where: { orgId: live.org.id, kind: "scope_gap", userId: { in: Object.values(members).map((member) => member.id) } },
      select: { id: true },
    });
    expect(conversations).toHaveLength(Object.keys(members).length);
    const stored = await prisma.assistantMessage.findMany({ where: { orgId: live.org.id, conversationId: { in: conversations.map((row) => row.id) } } });
    expect(stored).toHaveLength(conversations.length * 2);
    expect(stored.filter((message) => message.role === "user").every((message) => message.content.includes("sectionsWithGaps"))).toBe(true);
    for (const message of stored) expect([message.role, leaks(message.content)]).toEqual([message.role, []]);
  });
});
