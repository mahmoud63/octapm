/**
 * PC-1 — project-controls structure, proven against a real API process and
 * the real local Postgres.
 *
 *   units: the seed script writes the default list once and is idempotent;
 *     "M3" normalises to m3 and the unit as typed is never rewritten
 *   schedule import → activation creates the WBS tree (one node per summary
 *     task, never one per work task), links each activity to its summary's
 *     node, and leaves wbsCode and the dependencies exactly as imported
 *   a second activation keeps the planner's rename (upsert, not rebuild)
 *   a generated revision's id-less { code, level, name } nodes activate into
 *     a tree, with a missing ancestor materialised
 *   a colliding P6 wbs_id is not reused unless the code or name agrees, and
 *     an activity's wbsCode is looked up as a code before an external id
 *   moving a node rewrites its descendants' path and depth; a cycle is refused
 *   a package flag must name a party and a commitment of this project
 *   Postgres refuses a node filed under another organisation's project
 *
 * Everything lives in throwaway "LiveTest <uuid>" organisations that are
 * dropped afterwards. The API is started on a free port with the job worker
 * off, so nothing calls a model.
 *
 *   npm run test:live -- src/services/__live__/pc-1-structure.live.test.js
 */
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");
const { prisma } = require("../../config/db");
const { BACKEND_ROOT, createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { parseResult } = require("../../../scripts/enterprise/lib");
const { startApi } = require("./auth-live-kit");
const wbsService = require("../wbs.service");

const SEED_SCRIPT = path.join(BACKEND_ROOT, "scripts", "enterprise", "seed-units.js");

// The programme the schedule tests import: four summary rows with names, and
// five work tasks under them with logic between them. As MS Project writes
// it, every task carries its own outline number: a work task's is one level
// below its summary's, and no two tasks share one.
const SUMMARIES = [
  { uid: 101, wbs: "1", name: "Substructure" },
  { uid: 102, wbs: "1.1", name: "Site setup" },
  { uid: 103, wbs: "1.2", name: "Earthworks" },
  { uid: 104, wbs: "1.3", name: "Foundations" },
];
const PROGRAMME = [
  { code: "A100", name: "Mobilise", wbs: "1.1.1", start: "2026-01-05", finish: "2026-01-09", days: 5, preds: "", pct: 0 },
  { code: "A110", name: "Excavate", wbs: "1.2.1", start: "2026-01-12", finish: "2026-01-23", days: 10, preds: "A100", pct: 0 },
  { code: "A120", name: "Blinding", wbs: "1.2.2", start: "2026-01-27", finish: "2026-01-28", days: 2, preds: "A110FS+1", pct: 0 },
  { code: "A130", name: "Rebar", wbs: "1.3.1", start: "2026-01-29", finish: "2026-02-05", days: 6, preds: "A120, A110 SS -1", pct: 0 },
  { code: "A140", name: "Pour", wbs: "1.3.2", start: "2026-02-09", finish: "2026-02-12", days: 4, preds: "A130FF+2", pct: 0 },
];
const summaryOf = (outline) => outline.split(".").slice(0, -1).join(".");

// What the AI schedule generator stages: nodes as `{ code, level, name }`
// with no ids, and activities carrying the node's code as `wbs`. "2.1" is
// listed without a "2" above it, as a model sometimes does.
const GENERATED = {
  wbs: [
    { code: "1", level: 1, name: "Substructure", budget: 0 },
    { code: "1.1", level: 2, name: "Earthworks", budget: 0 },
    { code: "1.2", level: 2, name: "Foundations", budget: 0 },
    { code: "2.1", level: 2, name: "Frame", budget: 0 },
  ],
  activities: [
    { id: "G1", wbs: "1.1", name: "Excavate", phase: "Substructure", duration: 5, earlyStart: 0, earlyFinish: 5, predecessors: "" },
    { id: "G2", wbs: "1.2", name: "Pour footings", phase: "Substructure", duration: 4, earlyStart: 5, earlyFinish: 9, predecessors: "G1" },
    { id: "G3", wbs: "2.1", name: "Columns", phase: "Frame", duration: 6, earlyStart: 9, earlyFinish: 15, predecessors: "G2" },
  ],
};

// MSPDI: summary tasks carry the outline names; work tasks carry the logic
// (Type 1=FS 3=SS 0=FF, LinkLag in tenths of a minute, 4800 per day).
const programmeMspdi = (summaries = SUMMARIES, programme = PROGRAMME) => {
  const uidOf = new Map(programme.map((a, index) => [a.code, index + 1]));
  const type = { FS: 1, SS: 3, FF: 0, SF: 2 };
  const links = (preds) =>
    preds
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const match = token.match(/^(\S+?)\s*(FS|SS|FF|SF)?\s*([+-]\d+)?$/);
        const lagDays = match[3] ? Number(match[3]) : 0;
        return `<PredecessorLink><PredecessorUID>${uidOf.get(match[1])}</PredecessorUID><Type>${type[match[2] || "FS"]}</Type><LinkLag>${lagDays * 4800}</LinkLag></PredecessorLink>`;
      })
      .join("");
  const summaryRows = summaries.map(
    (s) => `<Task><UID>${s.uid}</UID><ID>${s.uid}</ID><Name>${s.name}</Name><WBS>${s.wbs}</WBS><OutlineLevel>${s.wbs.split(".").length}</OutlineLevel><Summary>1</Summary><Milestone>0</Milestone></Task>`,
  ).join("");
  const taskRows = programme.map(
    (a, index) =>
      `<Task><UID>${index + 1}</UID><ID>${index + 1}</ID><Name>${a.name}</Name><WBS>${a.wbs}</WBS><OutlineLevel>${a.wbs.split(".").length}</OutlineLevel><Summary>0</Summary><Milestone>0</Milestone><Duration>PT${a.days * 8}H0M0S</Duration><Start>${a.start}T08:00:00</Start><Finish>${a.finish}T17:00:00</Finish><PercentComplete>${a.pct}</PercentComplete>${links(a.preds)}</Task>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Name>Programme</Name><Tasks>${summaryRows}${taskRows}</Tasks></Project>`;
};

// A programme with no summary tasks at all: two work tasks at the top of the
// outline. It has activities with WBS strings and no WBS.
const FLAT_PROGRAMME = [
  { code: "F100", name: "Set up", wbs: "1", start: "2026-01-05", finish: "2026-01-09", days: 5, preds: "", pct: 0 },
  { code: "F110", name: "Build", wbs: "2", start: "2026-01-12", finish: "2026-01-23", days: 10, preds: "F100", pct: 0 },
];

liveDescribe("PC-1: WBS nodes, units of measure and structure keys", () => {
  let live;
  let otherOrg;
  let api;
  let project;
  let boqProject;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const post = (route, body) => api.post(route, body, auth());
  const get = (route) => api.get(route, auth());
  const patch = (route, body) => api.request("PATCH", route, { body, headers: auth() });

  const uploadMspdi = async (projectId, xml = programmeMspdi()) => {
    const form = new FormData();
    form.append("file", new Blob([xml], { type: "application/xml" }), "programme.xml");
    const response = await fetch(`${api.base}/api/v1/projects/${projectId}/import/msp`, { method: "POST", headers: auth(), body: form });
    return { status: response.status, body: await response.json() };
  };

  /**
   * Draft → under review → approved → active, through the API. The readiness
   * gate on approval is the product's own; this programme has logic, dates
   * and a critical path, so it passes on its merits.
   */
  const activate = async (projectId, revisionId, mappings = [], unmappedRemovals = []) => {
    const submitted = await post(`/api/v1/projects/${projectId}/schedule/revisions/${revisionId}/submit-review`, {});
    expect([submitted.status, submitted.body?.error]).toEqual([200, undefined]);
    const approved = await post(`/api/v1/projects/${projectId}/schedule/revisions/${revisionId}/approve`, {});
    expect([approved.status, approved.body?.error?.code, approved.body?.error?.details?.checks?.filter((c) => !c.passed)]).toEqual([200, undefined, undefined]);
    const activated = await post(`/api/v1/projects/${projectId}/schedule/revisions/${revisionId}/activate`, { mappings, unmappedRemovals });
    expect([activated.status, activated.body?.error]).toEqual([200, undefined]);
    return activated.body.data;
  };

  const runSeed = (args) => {
    const result = spawnSync(process.execPath, [SEED_SCRIPT, ...args], { cwd: BACKEND_ROOT, env: process.env, encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}`, result: parseResult(result.stdout) };
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    otherOrg = await createLiveOrg(prisma);
    project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-1 structure" } });
    // The bill lives on a project of its own: an unallocated bill is a
    // readiness blocker for schedule approval, and that gate is the product's.
    boqProject = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-1 units" } });
    api = await startApi({ RATE_LIMIT_AI_MAX: "1000", RATE_LIMIT_UPLOAD_MAX: "1000" });
  });

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, otherOrg]) {
      if (!org) continue;
      for (const model of ["backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  describe("units of measure", () => {
    it("answers from the default list before the organisation is seeded", async () => {
      const units = await get(`/api/v1/projects/${project.id}/structure/units`);
      expect(units.status).toBe(200);
      expect(units.body.data.seeded).toBe(false);
      expect(units.body.data.items).toEqual([]);
      expect(units.body.data.defaults.map((u) => u.code)).toEqual(["m", "m2", "m3", "nr", "kg", "t", "hr", "day", "ls", "sum", "item", "l", "bag", "sheet", "roll", "load", "pcs"]);

      const m3 = await get(`/api/v1/projects/${project.id}/structure/units/normalise?unit=M3`);
      expect(m3.body.data).toEqual({ unit: "M3", unitCode: "m3", warning: null });
    });

    it("seeds the default list once: the script reports, writes with --apply, and a second --apply finds nothing to do", async () => {
      const dry = runSeed(["--org", live.org.id]);
      expect([dry.status, dry.result?.apply, dry.result?.unitsCreated]).toEqual([0, false, 0]);
      expect(dry.result.unitsPlanned).toBe(17);
      expect(await prisma.unitOfMeasure.count({ where: { orgId: live.org.id } })).toBe(0);

      const first = runSeed(["--apply", "--org", live.org.id]);
      expect([first.status, first.result?.unitsCreated]).toEqual([0, 17]);
      expect(first.result.after).toMatchObject({ organisations: 1, units: 17, organisationsComplete: 1 });

      const second = runSeed(["--apply", "--org", live.org.id]);
      expect([second.status, second.result?.unitsCreated, second.result?.unitsPlanned]).toEqual([0, 0, 0]);
      expect(await prisma.unitOfMeasure.count({ where: { orgId: live.org.id } })).toBe(17);
      // The other organisation was not touched by an --org run.
      expect(await prisma.unitOfMeasure.count({ where: { orgId: otherOrg.org.id } })).toBe(0);

      const units = await get(`/api/v1/projects/${project.id}/structure/units`);
      expect(units.body.data.seeded).toBe(true);
      expect(units.body.data.items).toHaveLength(17);
      expect(units.body.data.items.find((u) => u.code === "m3")).toMatchObject({ name: "Cubic metre", dimension: "volume", isSystem: true });
      expect(units.body.data.items.find((u) => u.code === "m3").aliases).toEqual(expect.arrayContaining(["cum", "cu.m"]));
    });

    it("normalises the unit on a BOQ row as a code beside it and never rewrites what was typed", async () => {
      const created = await post(`/api/v1/projects/${boqProject.id}/boq/items`, { code: "1.1", description: "Concrete in foundations", quantity: 120, unit: "M3", rate: 150 });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      expect(created.body.data.item).toMatchObject({ unit: "M3", unitCode: "m3", mappingRule: "required", wbsNodeId: null, locationId: null, costCodeId: null });
      expect(created.body.data.unitWarning).toBeNull();
      const row = await prisma.boqItem.findUnique({ where: { id: created.body.data.item.id } });
      expect([row.unit, row.unitCode]).toEqual(["M3", "m3"]);

      // A spelling nobody knows: the row is accepted, the unit kept, the code
      // empty, and the answer says so.
      const odd = await post(`/api/v1/projects/${boqProject.id}/boq/items`, { code: "1.2", description: "Hedging", quantity: 3, unit: "furlong", rate: 10 });
      expect(odd.status).toBe(201);
      expect(odd.body.data.item).toMatchObject({ unit: "furlong", unitCode: null });
      expect(odd.body.data.unitWarning).toMatchObject({ code: "UNIT_UNRECOGNISED", unit: "furlong" });

      // An edit re-normalises: an alias resolves, and the typed text stays.
      const edited = await patch(`/api/v1/projects/${boqProject.id}/boq/items/${odd.body.data.item.id}`, { unit: "Cu. M" });
      expect([edited.status, edited.body?.error]).toEqual([200, undefined]);
      expect(edited.body.data.item).toMatchObject({ unit: "Cu. M", unitCode: "m3" });
      expect(edited.body.data.unitWarning).toBeNull();
      const after = await prisma.boqItem.findUnique({ where: { id: odd.body.data.item.id } });
      expect([after.unit, after.unitCode]).toEqual(["Cu. M", "m3"]);
    });

    it("adds an organisation unit and refuses a duplicate code", async () => {
      const created = await post(`/api/v1/projects/${project.id}/structure/units`, { code: "Pallet", name: "Pallet", dimension: "count", aliases: ["plt", "pallets"] });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      expect(created.body.data).toMatchObject({ code: "pallet", isSystem: false, aliases: ["plt", "pallets"] });
      const duplicate = await post(`/api/v1/projects/${project.id}/structure/units`, { code: "PALLET" });
      expect([duplicate.status, duplicate.body.error.code]).toEqual([409, "UNIT_DUPLICATE_CODE"]);
      const resolved = await get(`/api/v1/projects/${project.id}/structure/units/normalise?unit=PLT`);
      expect(resolved.body.data.unitCode).toBe("pallet");
    });
  });

  describe("WBS from a schedule import", () => {
    let firstRevisionId;
    const activityRows = () => prisma.activity.findMany({ where: { projectId: project.id, isActive: true }, orderBy: { sortOrder: "asc" } });

    it("activation creates the tree, links every activity to its node and leaves wbsCode and the logic untouched", async () => {
      expect(await prisma.wbsNode.count({ where: { projectId: project.id } })).toBe(0);
      const imported = await uploadMspdi(project.id);
      expect([imported.status, imported.body?.error]).toEqual([201, undefined]);
      firstRevisionId = imported.body.data.revisionId;
      // The MSPDI import now carries the outline as nodes in its snapshot.
      const revision = await prisma.scheduleRevision.findUnique({ where: { id: firstRevisionId } });
      expect(revision.snapshotJson.wbs.map((n) => [n.code, n.name, n.parentWbsId])).toEqual([
        ["1", "Substructure", null],
        ["1.1", "Site setup", "1"],
        ["1.2", "Earthworks", "1"],
        ["1.3", "Foundations", "1"],
      ]);
      // Nothing is written before activation.
      expect(await prisma.wbsNode.count({ where: { projectId: project.id } })).toBe(0);

      // One node per summary task — a work task is an activity, not a node
      // of its own, however unique its outline number.
      const activated = await activate(project.id, firstRevisionId);
      expect(activated.activation).toMatchObject({ wbsNodesCreated: SUMMARIES.length, wbsNodesExisting: 0, wbsActivitiesLinked: 5, wbsActivitiesUnmatched: 0, dependencyCount: 5 });

      const nodes = await prisma.wbsNode.findMany({ where: { projectId: project.id }, orderBy: [{ depth: "asc" }, { sortOrder: "asc" }] });
      const byCode = new Map(nodes.map((n) => [n.code, n]));
      expect(nodes.map((n) => [n.code, n.name, n.depth, n.source, n.externalId, n.orgId === live.org.id])).toEqual([
        ["1", "Substructure", 0, "import", "1", true],
        ["1.1", "Site setup", 1, "import", "1.1", true],
        ["1.2", "Earthworks", 1, "import", "1.2", true],
        ["1.3", "Foundations", 1, "import", "1.3", true],
      ]);
      for (const code of ["1.1", "1.2", "1.3"]) {
        expect(byCode.get(code).parentId).toBe(byCode.get("1").id);
        expect(byCode.get(code).path).toBe(`${byCode.get("1").id}/${byCode.get(code).id}`);
      }
      expect(byCode.get("1").path).toBe(byCode.get("1").id);

      // An MSPDI import keys activities by task UID; the WBS string is the
      // task's own outline number as imported, and the link is the node of
      // the summary above it.
      const activities = await activityRows();
      expect(activities.map((a) => [a.p6ActivityId, a.name, a.wbsCode, byCode.get(summaryOf(a.wbsCode))?.id === a.wbsNodeId])).toEqual(
        PROGRAMME.map((a, index) => [String(index + 1), a.name, a.wbs, true]),
      );
      expect(await prisma.activityDependency.count({ where: { projectId: project.id } })).toBe(5);

      const listed = await get(`/api/v1/projects/${project.id}/structure/wbs`);
      expect(listed.status).toBe(200);
      expect(listed.body.data.summary).toMatchObject({ total: 4, roots: 1, maxDepth: 2, linkedActivities: 5 });
      expect(listed.body.data.tree[0]).toMatchObject({ code: "1", childCount: 3, activityCount: 0 });
      expect(listed.body.data.tree[0].children.map((c) => [c.code, c.activityCount])).toEqual([["1.1", 1], ["1.2", 2], ["1.3", 2]]);
    });

    it("a second activation keeps the planner's rename and adds nothing twice", async () => {
      const before = await prisma.wbsNode.findFirst({ where: { projectId: project.id, code: "1.2" } });
      const renamed = await patch(`/api/v1/projects/${project.id}/structure/wbs/${before.id}`, { name: "Bulk earthworks" });
      expect([renamed.status, renamed.body?.error]).toEqual([200, undefined]);
      expect(renamed.body.data.name).toBe("Bulk earthworks");

      const again = await uploadMspdi(project.id);
      expect(again.status).toBe(201);
      const mapping = await get(`/api/v1/projects/${project.id}/schedule/revisions/${again.body.data.revisionId}/mapping`);
      expect(mapping.status).toBe(200);
      const mappings = mapping.body.data.suggestedMappings.map((m) => ({ oldActivityId: m.oldActivityId, newActivityKey: m.newActivityKey }));
      expect(mappings).toHaveLength(5);
      const wbsCodesBefore = (await activityRows()).map((a) => [a.id, a.wbsCode]);

      const activated = await activate(project.id, again.body.data.revisionId, mappings);
      expect(activated.activation).toMatchObject({ wbsNodesCreated: 0, wbsNodesExisting: 4, wbsActivitiesLinked: 5 });
      expect(await prisma.wbsNode.count({ where: { projectId: project.id } })).toBe(4);
      const kept = await prisma.wbsNode.findUnique({ where: { id: before.id } });
      expect(kept.name).toBe("Bulk earthworks");
      // The same five activities, same wbsCode strings, still linked.
      expect((await activityRows()).map((a) => [a.id, a.wbsCode])).toEqual(wbsCodesBefore);
      expect((await activityRows()).every((a) => a.wbsNodeId)).toBe(true);
      expect(await prisma.activityDependency.count({ where: { projectId: project.id } })).toBe(5);
    });
  });

  describe("WBS from a flat programme", () => {
    it("a file with no summary tasks makes no nodes — never one per work task", async () => {
      const flatProject = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-1 flat" } });
      const imported = await uploadMspdi(flatProject.id, programmeMspdi([], FLAT_PROGRAMME));
      expect([imported.status, imported.body?.error]).toEqual([201, undefined]);
      const revision = await prisma.scheduleRevision.findUnique({ where: { id: imported.body.data.revisionId } });
      expect(revision.snapshotJson.wbs).toEqual([]);

      const activated = await activate(flatProject.id, imported.body.data.revisionId);
      expect(activated.activation).toMatchObject({ wbsNodesCreated: 0, wbsNodesExisting: 0, wbsActivitiesLinked: 0, wbsActivitiesUnmatched: 2 });
      expect(await prisma.wbsNode.count({ where: { projectId: flatProject.id } })).toBe(0);
      const activities = await prisma.activity.findMany({ where: { projectId: flatProject.id, isActive: true }, orderBy: { sortOrder: "asc" } });
      expect(activities.map((a) => [a.name, a.wbsCode, a.wbsNodeId])).toEqual(FLAT_PROGRAMME.map((a) => [a.name, a.wbs, null]));
    });
  });

  describe("WBS from a generated schedule", () => {
    it("activation builds the tree from { code, level, name } nodes without ids, and links each activity", async () => {
      const aiProject = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-1 generated" } });
      // The row the generator writes (schedule.service createScheduleRevision
      // with source "ai"), already approved: the readiness gate is the
      // product's own and is not what this test is about.
      const revision = await prisma.scheduleRevision.create({
        data: {
          projectId: aiProject.id,
          label: "AI Generated",
          source: "ai",
          status: "approved",
          activityCount: GENERATED.activities.length,
          snapshotJson: { ...GENERATED, source: "ai", stagedAt: new Date().toISOString(), boqRows: [] },
        },
      });
      const activated = await post(`/api/v1/projects/${aiProject.id}/schedule/revisions/${revision.id}/activate`, { mappings: [], unmappedRemovals: [] });
      expect([activated.status, activated.body?.error]).toEqual([200, undefined]);
      // Four listed nodes plus the "2" the list left out above "2.1".
      expect(activated.body.data.activation).toMatchObject({ wbsNodesCreated: 5, wbsActivitiesLinked: 3, wbsActivitiesUnmatched: 0 });

      const nodes = await prisma.wbsNode.findMany({ where: { projectId: aiProject.id }, orderBy: [{ depth: "asc" }, { code: "asc" }] });
      const byCode = new Map(nodes.map((n) => [n.code, n]));
      expect(nodes.map((n) => [n.code, n.name, n.depth, n.source, byCode.get(summaryOf(n.code))?.id ?? null])).toEqual([
        ["1", "Substructure", 0, "ai", null],
        ["2", "2", 0, "ai", null],
        ["1.1", "Earthworks", 1, "ai", byCode.get("1").id],
        ["1.2", "Foundations", 1, "ai", byCode.get("1").id],
        ["2.1", "Frame", 1, "ai", byCode.get("2").id],
      ]);
      expect(nodes.map((n) => [n.parentId, n.path])).toEqual(
        nodes.map((n) => {
          const parent = byCode.get(summaryOf(n.code)) || null;
          return [parent ? parent.id : null, parent ? `${parent.id}/${n.id}` : n.id];
        }),
      );
      const activities = await prisma.activity.findMany({ where: { projectId: aiProject.id, isActive: true }, orderBy: { sortOrder: "asc" } });
      expect(activities.map((a) => [a.name, a.wbsCode, byCode.get(a.wbsCode)?.id === a.wbsNodeId])).toEqual(
        GENERATED.activities.map((a) => [a.name, a.wbs, true]),
      );
    });
  });

  describe("matching nodes on a re-import", () => {
    const upsert = (projectId, nodes) =>
      prisma.$transaction((tx) => wbsService.upsertNodesFromSnapshot({ tx, orgId: live.org.id, projectId, nodes, source: "import" }));

    it("a wbs_id from another P6 database is not the same node unless the code or name agrees", async () => {
      const p6Project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-1 re-import" } });
      const first = await upsert(p6Project.id, [{ wbsId: "5", parentWbsId: null, code: "STR", name: "Structure", seqNum: 1 }]);
      expect([first.created, first.existing]).toEqual([1, 0]);

      // Another database's export happens to number an unrelated node 5.
      const collision = await upsert(p6Project.id, [{ wbsId: "5", parentWbsId: null, code: "CIV", name: "Civil works", seqNum: 1 }]);
      expect([collision.created, collision.existing]).toEqual([1, 0]);
      expect((await prisma.wbsNode.findMany({ where: { projectId: p6Project.id }, orderBy: { code: "asc" } })).map((n) => [n.code, n.name, n.externalId])).toEqual([
        ["CIV", "Civil works", "5"],
        ["STR", "Structure", "5"],
      ]);

      // The same database renamed the short name: the name still agrees, so
      // the node is kept, not duplicated.
      const renamed = await upsert(p6Project.id, [{ wbsId: "5", parentWbsId: null, code: "STRUCT", name: "Structure", seqNum: 1 }]);
      expect([renamed.created, renamed.existing]).toEqual([0, 1]);
      expect(await prisma.wbsNode.count({ where: { projectId: p6Project.id } })).toBe(2);
    });

    it("an activity's wbsCode is a code before it is an external id", async () => {
      const xerProject = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-1 precedence" } });
      // XER: node 7 has the numeric short name "9"; node 9 is the roof.
      const lookups = await upsert(xerProject.id, [
        { wbsId: "7", parentWbsId: null, code: "9", name: "Nine", seqNum: 1 },
        { wbsId: "9", parentWbsId: null, code: "ROOF", name: "Roof", seqNum: 2 },
      ]);
      expect(wbsService.resolveNodeForCode(lookups, "9").code).toBe("9");
      expect(wbsService.resolveNodeForCode(lookups, "ROOF").code).toBe("ROOF");
      // An MS Project work task's outline number walks up to its summary.
      expect(wbsService.resolveNodeForCode(lookups, "9.4.2").code).toBe("9");
      expect(wbsService.resolveNodeForCode(lookups, "8.1")).toBeNull();

      const activity = await prisma.activity.create({ data: { projectId: xerProject.id, name: "Cast slab", wbsCode: "9" } });
      const links = await prisma.$transaction((tx) => wbsService.linkActivitiesToNodes({ tx, lookups, activities: [{ id: activity.id, wbsCode: "9" }, { id: activity.id, wbsCode: "8.1" }] }));
      expect(links).toEqual({ linked: 1, unmatched: 1 });
      const linked = await prisma.activity.findUnique({ where: { id: activity.id } });
      expect(linked.wbsNodeId).toBe(lookups.byCode.get("9").id);
      expect(linked.wbsCode).toBe("9");
    });
  });

  describe("editing the tree", () => {
    const ids = {};

    it("creates nodes under parents with a materialised path", async () => {
      const a = await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "A", name: "Block A" });
      expect([a.status, a.body?.error]).toEqual([201, undefined]);
      ids.a = a.body.data.id;
      const a1 = await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "A.1", name: "Level 1", parentId: ids.a });
      ids.a1 = a1.body.data.id;
      const a11 = await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "A.1.1", name: "Zone 1", parentId: ids.a1 });
      ids.a11 = a11.body.data.id;
      const b = await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "B", name: "Block B" });
      ids.b = b.body.data.id;
      expect(a11.body.data).toMatchObject({ depth: 2, path: `${ids.a}/${ids.a1}/${ids.a11}`, source: "manual" });

      const duplicate = await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "A", name: "Again" });
      expect([duplicate.status, duplicate.body.error.code]).toEqual([409, "WBS_NODE_DUPLICATE_CODE"]);
    });

    it("moving a node rewrites its descendants' path and depth, and a cycle is refused", async () => {
      const moved = await patch(`/api/v1/projects/${project.id}/structure/wbs/${ids.a1}`, { parentId: ids.b });
      expect([moved.status, moved.body?.error]).toEqual([200, undefined]);
      expect(moved.body.data).toMatchObject({ parentId: ids.b, depth: 1, path: `${ids.b}/${ids.a1}` });

      const child = await prisma.wbsNode.findUnique({ where: { id: ids.a11 } });
      expect([child.parentId, child.depth, child.path]).toEqual([ids.a1, 2, `${ids.b}/${ids.a1}/${ids.a11}`]);

      const cycle = await patch(`/api/v1/projects/${project.id}/structure/wbs/${ids.b}`, { parentId: ids.a11 });
      expect([cycle.status, cycle.body.error.code]).toEqual([400, "WBS_NODE_INVALID_PARENT"]);
      const self = await patch(`/api/v1/projects/${project.id}/structure/wbs/${ids.b}`, { parentId: ids.b });
      expect([self.status, self.body.error.code]).toEqual([400, "WBS_NODE_INVALID_PARENT"]);
    });

    it("a package must name a party and a commitment of this project", async () => {
      const badParty = await patch(`/api/v1/projects/${project.id}/structure/wbs/${ids.a}`, { isPackage: true, ownerPartyId: crypto.randomUUID() });
      expect([badParty.status, badParty.body.error.code]).toEqual([400, "WBS_PACKAGE_OWNER_INVALID"]);
      const badCommitment = await patch(`/api/v1/projects/${project.id}/structure/wbs/${ids.a}`, { isPackage: true, commitmentId: crypto.randomUUID() });
      expect([badCommitment.status, badCommitment.body.error.code]).toEqual([400, "WBS_PACKAGE_COMMITMENT_INVALID"]);
      const flagged = await patch(`/api/v1/projects/${project.id}/structure/wbs/${ids.a}`, { isPackage: true });
      expect(flagged.body.data).toMatchObject({ isPackage: true, ownerPartyId: null, commitmentId: null });
      const listed = await get(`/api/v1/projects/${project.id}/structure/wbs`);
      expect(listed.body.data.summary.packages).toBe(1);
    });

    it("archives a subtree without touching the links, and restores it", async () => {
      const archived = await post(`/api/v1/projects/${project.id}/structure/wbs/${ids.b}/archive`, { reason: "Descoped" });
      expect([archived.status, archived.body?.error]).toEqual([200, undefined]);
      expect(archived.body.data.affectedIds.sort()).toEqual([ids.a1, ids.a11, ids.b].sort());
      const listed = await get(`/api/v1/projects/${project.id}/structure/wbs`);
      expect(listed.body.data.items.map((n) => n.code)).toEqual(["1", "1.1", "1.2", "1.3", "A"]);
      const restored = await post(`/api/v1/projects/${project.id}/structure/wbs/${ids.a1}/restore`, {});
      expect([restored.status, restored.body.error.code]).toEqual([409, "WBS_NODE_PARENT_ARCHIVED"]);
      const root = await post(`/api/v1/projects/${project.id}/structure/wbs/${ids.b}/restore`, {});
      expect(root.status).toBe(200);
      expect(await prisma.wbsNode.count({ where: { projectId: project.id, status: "archived" } })).toBe(0);
    });
  });

  describe("tenancy", () => {
    it("Postgres refuses a WBS node filed under another organisation's project", async () => {
      const insert = (orgId) =>
        prisma.$executeRaw`
          INSERT INTO "WbsNode" ("id", "projectId", "orgId", "code", "name", "path", "updatedAt")
          VALUES (${crypto.randomUUID()}, ${project.id}, ${orgId}, ${`T-${orgId.slice(0, 8)}`}, 'Tenancy probe', 'probe', now())`;
      await expect(insert(otherOrg.org.id)).rejects.toThrow(/WbsNode_projectId_orgId_fkey/);
      expect(await prisma.wbsNode.count({ where: { projectId: project.id, name: "Tenancy probe" } })).toBe(0);
      // Positive control: the same row under the project's own organisation goes in.
      await insert(live.org.id);
      expect(await prisma.wbsNode.count({ where: { projectId: project.id, name: "Tenancy probe" } })).toBe(1);
    });
  });
});
