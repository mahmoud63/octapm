/**
 * PC-2 — BOQ revisions and imports, proven against a real API process and the
 * real local Postgres.
 *
 *   upload the fixture twice → one revision each, with a comparison
 *   submit → approve → lock: the explicit lock is written, and it locks
 *   a third upload becomes comparison_only; there is no unlock; rows refuse edits
 *   a dry run answers the comparison and writes nothing
 *   a schedule workbook dry-runs, then stages the same revision an MSPDI file would
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards. The API is started on a free port with the job worker
 * off, so the AI job an upload queues stays queued and nothing calls a model.
 *
 *   npm run test:live -- src/services/__live__/pc-2-boq-revisions.live.test.js
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("@e965/xlsx");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const DOCS = path.resolve(__dirname, "..", "..", "..", "..", "docs");
const CONSTRUCTION_BOQ = path.join(DOCS, "Construction_BOQ.xlsx");
const BILL_OF_QUANTITIES = path.join(DOCS, "bill_of_quantities.xlsx");
const BOQ_FAIL = path.join(DOCS, "boq-fail.xls");

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The programme the schedule import tests use, once as a workbook and once
// as the MSPDI file Microsoft Project would write for it.
const PROGRAMME = [
  { code: "A100", name: "Mobilise", wbs: "1.1", start: "2026-01-05", finish: "2026-01-09", days: 5, preds: "", pct: 100 },
  { code: "A110", name: "Excavate", wbs: "1.2", start: "2026-01-12", finish: "2026-01-23", days: 10, preds: "A100", pct: 50 },
  { code: "A120", name: "Blinding", wbs: "1.2", start: "2026-01-27", finish: "2026-01-28", days: 2, preds: "A110FS+1", pct: 0 },
  { code: "A130", name: "Rebar", wbs: "1.3", start: "2026-01-29", finish: "2026-02-05", days: 6, preds: "A120, A110 SS -1", pct: 0 },
  { code: "A140", name: "Pour", wbs: "1.3", start: "2026-02-09", finish: "2026-02-12", days: 4, preds: "A130FF+2", pct: 0 },
];

const programmeWorkbook = () => {
  const rows = [
    ["activity_code", "name", "wbs_code", "start", "finish", "duration_days", "predecessors", "percent_complete"],
    ...PROGRAMME.map((a) => [a.code, a.name, a.wbs, a.start, a.finish, a.days, a.preds, a.pct]),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Programme");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
};

// MSPDI: one Task per activity (UID = position), PredecessorLink with Type
// 1=FS 3=SS 0=FF and LinkLag in tenths of a minute (4800 per day).
const programmeMspdi = () => {
  const uidOf = new Map(PROGRAMME.map((a, index) => [a.code, index + 1]));
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
  const tasks = PROGRAMME.map(
    (a, index) =>
      `<Task><UID>${index + 1}</UID><ID>${index + 1}</ID><Name>${a.name}</Name><WBS>${a.wbs}</WBS><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Milestone>0</Milestone><Duration>PT${a.days * 8}H0M0S</Duration><Start>${a.start}T08:00:00</Start><Finish>${a.finish}T17:00:00</Finish><PercentComplete>${a.pct}</PercentComplete>${links(a.preds)}</Task>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Name>Programme</Name><Tasks>${tasks}</Tasks></Project>`;
};

liveDescribe("PC-2: BOQ revisions, upload dry-run and xlsx schedule import", () => {
  let live;
  let api;
  let project;
  let secondProject;
  const auth = () => ({ authorization: `Bearer ${live.token}` });

  /** A multipart upload as the browser sends one. */
  const uploadFile = async (route, { name, mime, content, fields = {} }) => {
    const form = new FormData();
    form.append("file", new Blob([content], { type: mime }), name);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const response = await fetch(`${api.base}${route}`, { method: "POST", headers: auth(), body: form });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  };
  const uploadBoq = (projectId, file, { label, dryRun = false } = {}) =>
    uploadFile(`/api/v1/projects/${projectId}/boq/upload${dryRun ? "?dryRun=true" : ""}`, {
      name: path.basename(file),
      mime: file.endsWith(".xls") ? "application/vnd.ms-excel" : XLSX_MIME,
      content: fs.readFileSync(file),
      fields: label ? { label } : {},
    });
  const post = (route, body) => api.post(route, body, auth());
  const get = (route) => api.get(route, auth());
  const boq = (projectId) => get(`/api/v1/projects/${projectId}/boq`).then((r) => r.body.data);
  const activeRows = (projectId) => prisma.boqItem.count({ where: { projectId, isActive: true } });
  const revisionRows = (projectId) => prisma.boqRevision.count({ where: { projectId } });
  const footprint = async (projectId) => ({
    revisions: await revisionRows(projectId),
    items: await prisma.boqItem.count({ where: { projectId } }),
    documents: await prisma.projectDocument.count({ where: { projectId } }),
    jobs: await prisma.backgroundJob.count({ where: { projectId } }),
    scheduleRevisions: await prisma.scheduleRevision.count({ where: { projectId } }),
  });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-2 revisions" } });
    secondProject = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-2 dry run" } });
    api = await startApi({ RATE_LIMIT_AI_MAX: "1000", RATE_LIMIT_UPLOAD_MAX: "1000" });
  });

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      // Rows that only carry orgId (no FK) would otherwise outlive the organisation.
      for (const model of ["backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  describe("revision approval and explicit baseline lock", () => {
    let firstRevisionId;
    let secondRevisionId;
    let thirdRevisionId;

    it("uploads the fixture twice: one revision each, with a comparison", async () => {
      const first = await uploadBoq(project.id, CONSTRUCTION_BOQ, { label: "Tender bill" });
      expect(first.status).toBe(200);
      expect(first.body.data.mode).toBe("imported");
      expect(first.body.data.baselineLocked).toBe(false);
      expect(first.body.data.comparison).toEqual({ added: 10, updated: 0, unchanged: 0, removed: 0, blocked: 0 });
      firstRevisionId = first.body.data.revisionId;
      expect(await activeRows(project.id)).toBe(10);

      const second = await uploadBoq(project.id, BILL_OF_QUANTITIES, { label: "Re-measured bill" });
      expect(second.status).toBe(200);
      expect(second.body.data.mode).toBe("imported");
      secondRevisionId = second.body.data.revisionId;
      const summary = second.body.data.comparison;
      // The second workbook has seven priced rows; every one is either new,
      // changed or unchanged against the ten already there, and the rows it
      // omits are reported removed but kept on the bill.
      expect(summary.added + summary.updated + summary.unchanged).toBe(7);
      expect(summary.removed).toBe(10 - summary.updated - summary.unchanged);
      expect(await activeRows(project.id)).toBe(10 + summary.added);

      const state = await boq(project.id);
      expect(state.revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);
      expect(state.revisions.map((r) => r.status)).toEqual(["imported", "imported"]);
      expect(state.currentRevision.id).toBe(secondRevisionId);
      expect(state.baseline.locked).toBe(false);

      const detail = await get(`/api/v1/projects/${project.id}/boq/revisions/${secondRevisionId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.comparison.summary).toEqual(summary);
      expect(detail.body.data.workflowEvents.map((e) => e.toStatus)).toEqual(["imported"]);
    });

    it("submits and approves the revision, recording each step", async () => {
      const locked = await post(`/api/v1/projects/${project.id}/boq/revisions/${secondRevisionId}/lock`, {});
      expect(locked.status).toBe(409);
      expect(locked.body.error.code).toBe("BOQ_REVISION_NOT_APPROVED");

      const approvedEarly = await post(`/api/v1/projects/${project.id}/boq/revisions/${secondRevisionId}/approve`, {});
      expect(approvedEarly.status).toBe(409);
      expect(approvedEarly.body.error.code).toBe("APPROVAL_WORKFLOW_INVALID_TRANSITION");

      const submitted = await post(`/api/v1/projects/${project.id}/boq/revisions/${secondRevisionId}/submit`, { comment: "Please review" });
      expect(submitted.status).toBe(200);
      expect(submitted.body.data.status).toBe("under_review");

      const approved = await post(`/api/v1/projects/${project.id}/boq/revisions/${secondRevisionId}/approve`, {});
      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe("approved");
      expect(approved.body.data.baselineLocked).toBe(false);

      const events = await prisma.approvalWorkflowEvent.findMany({
        where: { recordType: "boq_revision", recordId: secondRevisionId },
        orderBy: { createdAt: "asc" },
      });
      expect(events.map((e) => [e.fromStatus, e.toStatus, e.actorId])).toEqual([
        [null, "imported", live.user.id],
        ["imported", "under_review", live.user.id],
        ["under_review", "approved", live.user.id],
      ]);
      const audit = await prisma.auditEvent.findMany({
        where: { entityType: "boq_revision", entityId: secondRevisionId },
        orderBy: { createdAt: "asc" },
      });
      expect(audit.map((e) => e.action)).toEqual(["imported", "status_changed", "approved"]);
    });

    it("locks the baseline explicitly and the lock is what locks the BOQ", async () => {
      const before = await boq(project.id);
      expect(before.baseline.locked).toBe(false);

      const locked = await post(`/api/v1/projects/${project.id}/boq/revisions/${secondRevisionId}/lock`, { comment: "Contract bill" });
      expect(locked.status).toBe(200);
      expect(locked.body.data.revision).toMatchObject({
        status: "baselined",
        baselineLocked: true,
        lockedBy: live.user.id,
      });
      expect(locked.body.data.revision.lockedAt).toBeTruthy();
      expect(locked.body.data.lockedRows).toBe(await activeRows(project.id));

      const row = await prisma.boqRevision.findUnique({ where: { id: secondRevisionId } });
      expect(row.status).toBe("baselined");
      expect(row.baselineLocked).toBe(true);
      expect(row.lockedBy).toBe(live.user.id);
      expect(row.lockedAt).toBeInstanceOf(Date);
      expect(await prisma.scheduleRevision.count({ where: { projectId: project.id, status: "baselined" } })).toBe(0);

      const after = await boq(project.id);
      expect(after.baseline).toMatchObject({ locked: true, source: "boq_revision", boqRevisionId: secondRevisionId, revisionNumber: 2 });
      expect(after.currentRevision.id).toBe(secondRevisionId);
      expect(after.items.every((item) => item.baselineLocked)).toBe(true);

      const audit = await prisma.auditEvent.findFirst({ where: { entityType: "boq_revision", entityId: secondRevisionId, action: "baseline_locked" } });
      expect(audit).not.toBeNull();
      expect(audit.actorId).toBe(live.user.id);
    });

    it("saves a third upload as comparison_only without touching the rows", async () => {
      const rowsBefore = await activeRows(project.id);
      const third = await uploadBoq(project.id, CONSTRUCTION_BOQ, { label: "Late re-issue" });
      expect(third.status).toBe(200);
      expect(third.body.data.mode).toBe("comparison_only");
      expect(third.body.data.baselineLocked).toBe(true);
      thirdRevisionId = third.body.data.revisionId;

      const revision = await prisma.boqRevision.findUnique({ where: { id: thirdRevisionId } });
      expect(revision.status).toBe("comparison_only");
      expect(revision.baselineLocked).toBe(false);
      expect(await activeRows(project.id)).toBe(rowsBefore);
      const state = await boq(project.id);
      expect(state.latestRevision.id).toBe(thirdRevisionId);
      expect(state.currentRevision.id).toBe(secondRevisionId);
    });

    it("refuses to unlock, re-lock or review around the lock", async () => {
      const unlock = await post(`/api/v1/projects/${project.id}/boq/revisions/${secondRevisionId}/unlock`, { reason: "please" });
      expect(unlock.status).toBe(404);

      const again = await post(`/api/v1/projects/${project.id}/boq/revisions/${secondRevisionId}/lock`, {});
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("BOQ_BASELINE_LOCKED");

      const submitComparison = await post(`/api/v1/projects/${project.id}/boq/revisions/${thirdRevisionId}/submit`, {});
      expect(submitComparison.status).toBe(409);
      expect(submitComparison.body.error.code).toBe("BOQ_REVISION_COMPARISON_ONLY");

      const lockFirst = await post(`/api/v1/projects/${project.id}/boq/revisions/${firstRevisionId}/lock`, {});
      expect(lockFirst.status).toBe(409);
      expect(lockFirst.body.error.code).toBe("BOQ_BASELINE_LOCKED");

      const row = await prisma.boqRevision.findUnique({ where: { id: secondRevisionId } });
      expect(row).toMatchObject({ status: "baselined", baselineLocked: true });
    });

    it("refuses row edits while locked", async () => {
      const state = await boq(project.id);
      const item = state.items[0];
      const patched = await api.request("PATCH", `/api/v1/projects/${project.id}/boq/items/${item.id}`, { body: { quantity: item.quantity + 1 }, headers: auth() });
      expect(patched.status).toBe(409);
      expect(patched.body.error.code).toBe("BOQ_BASELINE_LOCKED");

      const created = await post(`/api/v1/projects/${project.id}/boq/items`, { code: "Z-1", description: "Extra", quantity: 1, unit: "no", rate: 10 });
      expect(created.status).toBe(409);
      expect(created.body.error.code).toBe("BOQ_BASELINE_LOCKED");

      const deleted = await api.request("DELETE", `/api/v1/projects/${project.id}/boq/items/${item.id}`, { headers: auth() });
      expect(deleted.status).toBe(409);

      const row = await prisma.boqItem.findUnique({ where: { id: item.id } });
      expect(row.qty).toBe(item.quantity);
    });
  });

  describe("upload dry-run", () => {
    it("answers the comparison and writes nothing", async () => {
      const before = await footprint(secondProject.id);
      expect(before).toMatchObject({ revisions: 0, items: 0, documents: 0, jobs: 0 });

      const preview = await uploadBoq(secondProject.id, CONSTRUCTION_BOQ, { dryRun: true, label: "Preview" });
      expect(preview.status).toBe(200);
      expect(preview.body.data).toMatchObject({
        dryRun: true,
        mode: "imported",
        baselineLocked: false,
        rowCount: 10,
        label: "Preview",
      });
      expect(preview.body.data.comparison.summary).toEqual({ added: 10, updated: 0, unchanged: 0, removed: 0, blocked: 0 });
      expect(preview.body.data.comparison.added).toHaveLength(10);
      expect(preview.body.data.comparison.added[0]).toMatchObject({ code: "1", quantity: 500, rate: 2.5, amount: 1250 });
      expect(preview.body.data.revisionId).toBeUndefined();
      expect(preview.body.data.jobId).toBeUndefined();

      expect(await footprint(secondProject.id)).toEqual(before);
    });

    it("previews against a locked bill as comparison_only, still writing nothing", async () => {
      const before = await footprint(project.id);
      const preview = await uploadBoq(project.id, BILL_OF_QUANTITIES, { dryRun: true });
      expect(preview.status).toBe(200);
      expect(preview.body.data.mode).toBe("comparison_only");
      expect(preview.body.data.baselineLocked).toBe(true);
      expect(preview.body.data.comparison.summary.unchanged + preview.body.data.comparison.summary.updated + preview.body.data.comparison.summary.added).toBe(7);
      expect(await footprint(project.id)).toEqual(before);
    });

    it("fails the tender workbook cleanly with a structured, capped error", async () => {
      const before = await footprint(secondProject.id);
      const failed = await uploadBoq(secondProject.id, BOQ_FAIL, { dryRun: true });
      expect(failed.status).toBe(400);
      expect(failed.body.success).toBe(false);
      expect(failed.body.error.code).toBe("BOQ_VALIDATION_FAILED");
      const details = failed.body.error.details;
      expect(Array.isArray(details.errors)).toBe(true);
      expect(details.errors.length).toBe(200);
      expect(details.errorCount).toBeGreaterThan(200);
      expect(details.truncated).toBe(true);
      expect(details.errors[0]).toMatchObject({ row: expect.any(Number), field: expect.any(String), message: expect.any(String) });
      expect(await footprint(secondProject.id)).toEqual(before);
    });
  });

  describe("xlsx schedule import", () => {
    const strip = (activity) => ({
      name: activity.name,
      wbsCode: activity.wbsCode,
      duration: activity.duration,
      physComplete: activity.physComplete,
      start: activity.startDate ? activity.startDate.slice(0, 10) : null,
      end: activity.endDate ? activity.endDate.slice(0, 10) : null,
    });
    const stripDependencies = (snapshot) => {
      const nameOf = new Map(snapshot.activities.map((a) => [a.draftKey, a.name]));
      return snapshot.dependencies
        .map((d) => [nameOf.get(d.predecessorRef), nameOf.get(d.successorRef), d.relationshipType, d.lagDays])
        .sort((a, b) => a.join().localeCompare(b.join()));
    };

    it("dry-runs the workbook: a report, no revision", async () => {
      const before = await footprint(secondProject.id);
      const report = await uploadFile(`/api/v1/projects/${secondProject.id}/import/xlsx?dryRun=true`, {
        name: "programme.xlsx",
        mime: XLSX_MIME,
        content: programmeWorkbook(),
      });
      expect(report.status).toBe(200);
      expect(report.body.data).toMatchObject({
        dryRun: true,
        staged: false,
        source: "xlsx",
        activityCount: 5,
        dependencyCount: 5,
        wbsNodeCount: 4,
        issueCount: 0,
      });
      expect(report.body.data.activities.map((a) => a.p6ActivityId)).toEqual(PROGRAMME.map((a) => a.code));
      expect(report.body.data.revisionId).toBeUndefined();
      expect(await footprint(secondProject.id)).toEqual(before);
    });

    it("stages the workbook as the same revision the MSPDI file stages", async () => {
      const before = await footprint(secondProject.id);
      const imported = await uploadFile(`/api/v1/projects/${secondProject.id}/import/xlsx`, {
        name: "programme.xlsx",
        mime: XLSX_MIME,
        content: programmeWorkbook(),
      });
      expect(imported.status).toBe(201);
      expect(imported.body.data).toMatchObject({ staged: true, imported: 5, dependencyCount: 5, wbsNodes: 4 });
      expect(imported.body.data.document.documentId).toBeTruthy();
      const after = await footprint(secondProject.id);
      expect(after.scheduleRevisions).toBe(before.scheduleRevisions + 1);
      expect(after.documents).toBe(before.documents + 1);

      const viaMsp = await uploadFile(`/api/v1/projects/${secondProject.id}/import/msp`, {
        name: "programme.xml",
        mime: "application/xml",
        content: programmeMspdi(),
      });
      expect(viaMsp.status).toBe(201);
      expect(viaMsp.body.data).toMatchObject({ staged: true, imported: 5, dependencyCount: 5 });

      const [xlsxRevision, mspRevision] = await Promise.all([
        prisma.scheduleRevision.findUnique({ where: { id: imported.body.data.revisionId } }),
        prisma.scheduleRevision.findUnique({ where: { id: viaMsp.body.data.revisionId } }),
      ]);
      expect(xlsxRevision).toMatchObject({ source: "xlsx", status: "superseded", isActive: false, activityCount: 5 });
      expect(mspRevision).toMatchObject({ source: "msp", status: "draft", isActive: false, activityCount: 5 });

      const xlsxSnapshot = xlsxRevision.snapshotJson;
      const mspSnapshot = mspRevision.snapshotJson;
      expect(xlsxSnapshot.activities.map(strip)).toEqual(mspSnapshot.activities.map(strip));
      expect(stripDependencies(xlsxSnapshot)).toEqual(stripDependencies(mspSnapshot));
      expect(stripDependencies(xlsxSnapshot)).toEqual([
        ["Blinding", "Rebar", "FS", 0],
        ["Excavate", "Blinding", "FS", 1],
        ["Excavate", "Rebar", "SS", -1],
        ["Mobilise", "Excavate", "FS", 0],
        ["Rebar", "Pour", "FF", 2],
      ]);
      expect(xlsxSnapshot.wbs.map((n) => n.code)).toEqual(["1", "1.1", "1.2", "1.3"]);
      expect(xlsxSnapshot.activities.map((a) => a.p6ActivityId)).toEqual(PROGRAMME.map((a) => a.code));
    });

    it("refuses a workbook without the required columns", async () => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Task", "Days"], ["Dig", 3]]), "Sheet1");
      const rejected = await uploadFile(`/api/v1/projects/${secondProject.id}/import/xlsx?dryRun=true`, {
        name: "bad.xlsx",
        mime: XLSX_MIME,
        content: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe("SCHEDULE_VALIDATION_FAILED");
    });
  });
});
