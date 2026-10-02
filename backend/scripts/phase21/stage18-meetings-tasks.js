/**
 * Phase 21C · stage 18 — a progress meeting and the actions that come out of it.
 *
 *   MTG-01  weekly progress meeting, chaired by the PM, minuted by the planner:
 *           attendees, an agenda, a decision (lower the founding level per
 *           RFI-001), two action items — one owned by the site engineer,
 *           one by the QS — finalised and distributed.
 *   TSK     the site engineer's action as a task on the project, assigned,
 *           commented on by the assignee, closed by the assignee; a storeman
 *           may not close it.
 *
 * Idempotent: the meeting is found by title; the task by title.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PUT, PATCH, probe, check, note, section, summary } = require("./harness");

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, planner, qs, site, warehouse } = ctx.people;
const save = () => fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
const rows = (x) => x?.rows || x?.items || x?.records || x?.meetings || x?.tasks || (Array.isArray(x) ? x : []);

const MEETING_TITLE = `${ctx.tag} MTG-01 Weekly progress meeting, week 5`;
const TASK_TITLE = `${ctx.tag} TSK-01 Re-brief lifting plan and tag lines to the steelfixing crew`;
const ACTION_QS = `${ctx.tag} ACT-02 Price the RFI-001 variation against the client rates`;

async function main() {
  section("PHASE 21C · STAGE 18 — meeting, actions and a task");

  // ── 18.1 the meeting ─────────────────────────────────────────────────────
  section("18.1  MTG-01 — minuted by the planner, chaired by the PM");

  check("a storeman cannot create a meeting", 403, (await probe(warehouse, "POST", `/projects/${P}/meetings`, { title: "x" })).status);

  let mtg = rows(await GET(planner, `/projects/${P}/meetings?limit=100`)).find((m) => m.title === MEETING_TITLE) ?? null;
  if (!mtg) {
    mtg = await POST(planner, `/projects/${P}/meetings`, {
      title: MEETING_TITLE,
      meetingType: "progress",
      status: "draft",
      chairId: ctx.userIds.pm,
      activityId: ctx.activities.A130,
      scheduledAt: "2027-02-03T08:00:00.000Z",
      location: "Site office, meeting room 1",
      objective: "Week 5 progress, foundation works and the RFI-001 instruction",
      attendees: [
        { userId: ctx.userIds.pm, role: "Chair", attendanceStatus: "attended" },
        { userId: ctx.userIds.planner, role: "Minutes", attendanceStatus: "attended" },
        { userId: ctx.userIds.site, role: "Site", attendanceStatus: "attended" },
        { userId: ctx.userIds.qs, role: "Commercial", attendanceStatus: "attended" },
        { name: "Client's representative", companyName: ctx.companies.client.name, role: "Client", attendanceStatus: "apology" },
      ],
      agendaItems: [
        { title: "Progress against the week-5 lookahead", sortOrder: 1, status: "covered", activityId: ctx.activities.A130, notes: "Pads A-D reinforced; pour 1 postponed 2 h by rain on 1 Feb." },
        { title: "RFI-001 founding level at grid A-D", sortOrder: 2, status: "covered", notes: `Instructed as ${ctx.rfiRef || "RFI-001"}; variation raised.` },
        { title: "Near miss SAF-01", sortOrder: 3, status: "covered" },
      ],
      decisions: [
        { title: "Lower founding level at grid A-D by 150 mm", decision: "Per the RFI-001 response; instructed as a variation.", impact: "3 days on A130; 4,500.00", activityId: ctx.activities.A130, decidedById: ctx.userIds.pm, decidedAt: "2027-02-03T09:00:00.000Z" },
      ],
      actionItems: [
        { itemNumber: "1", title: TASK_TITLE, ownerId: ctx.userIds.site, dueDate: "2027-02-05", priority: "high", activityId: ctx.activities.A130 },
        { itemNumber: "2", title: ACTION_QS, ownerId: ctx.userIds.qs, dueDate: "2027-02-10", priority: "medium" },
      ],
    });
    note("MTG-01 created", `${mtg.ref ?? mtg.id} status=${mtg.status}`);
  } else {
    note("MTG-01 exists, reusing", `${mtg.ref ?? mtg.id} status=${mtg.status}`);
  }
  ctx.meetingId = mtg.id;
  save();
  let m = await GET(planner, `/projects/${P}/meetings/${mtg.id}`);
  check("five attendees are recorded", 5, (m.attendees || []).length);
  check("three agenda items", 3, (m.agendaItems || []).length);
  check("one decision, on the foundation activity", true, (m.decisions || []).length === 1 && (m.decisions[0].activityId === ctx.activities.A130));
  check("two action items, owned by the site engineer and the QS", "qs,site", (m.actionItems || []).map((a) => a.ownerId === ctx.userIds.site ? "site" : a.ownerId === ctx.userIds.qs ? "qs" : "?").sort().join(","));

  // Minutes: finalise, then distribute (the planner may; a storeman may not).
  if (m.status === "draft") {
    m = await PATCH(planner, `/projects/${P}/meetings/${mtg.id}`, { status: "finalized", minutesText: "Minutes agreed. Actions as listed.", endedAt: "2027-02-03T09:10:00.000Z" });
  }
  check("the minutes are finalised", true, ["finalized", "distributed"].includes(m.status));
  if (m.status === "finalized") {
    check("a storeman cannot distribute minutes", 403, (await probe(warehouse, "POST", `/projects/${P}/meetings/${mtg.id}/distribute`, { includeAttendees: true })).status);
    const d = await probe(planner, "POST", `/projects/${P}/meetings/${mtg.id}/distribute`, { includeAttendees: true, message: "Week 5 minutes attached." });
    note("  distribute", `${d.status} ${d.code ?? "ok"}`);
    if (!d.ok && d.status !== 409) throw new Error(`distribute: ${d.status} ${d.code} ${d.message}`);
    m = await GET(planner, `/projects/${P}/meetings/${mtg.id}`);
  }
  check("the minutes are distributed", "distributed", m.status);
  check("distribution is stamped with who and when", true, Boolean(m.distributedAt) && Boolean(m.distributedById || m.distributedBy));
  ctx.meetingRef = m.ref ?? null;

  // The site engineer, an attendee, can read the minutes; another tenant cannot.
  check("an attendee can read the minutes", 200, (await probe(site, "GET", `/projects/${P}/meetings/${mtg.id}`)).status);
  check("another tenant cannot", true, [403, 404].includes((await probe(ctx.outsider, "GET", `/projects/${P}/meetings/${mtg.id}`)).status));

  // ── 18.2 the action as a task ────────────────────────────────────────────
  section("18.2  TSK-01 — the site engineer's action, tracked to done");

  let task = rows(await GET(pm, `/tasks?projectId=${P}&limit=100`)).find((t) => t.title === TASK_TITLE) ?? null;
  if (!task) {
    // The meeting's action item may already have become a task.
    const fromMeeting = (m.actionItems || []).find((a) => a.title === TASK_TITLE && a.taskId);
    if (fromMeeting) task = await GET(pm, `/tasks/${fromMeeting.taskId}`);
  }
  if (!task) {
    check("a storeman cannot assign a task", 403, (await probe(warehouse, "POST", `/tasks`, { title: "x", projectId: P })).status);
    task = await POST(planner, `/tasks`, {
      title: TASK_TITLE,
      description: "From MTG-01 action 1. Tag lines on every cage lift; exclusion zone 3 m.",
      label: "safety",
      priority: "high",
      status: "todo",
      dueDate: "2027-02-05",
      projectId: P,
      activityId: ctx.activities.A130,
      assigneeId: ctx.userIds.site,
    });
    note("TSK-01 created", `${task.ref ?? task.id} status=${task.status}`);
  } else {
    note("TSK-01 exists, reusing", `${task.ref ?? task.id} status=${task.status}`);
  }
  ctx.taskId = task.id;
  save();
  check("the task is on the project and the foundation activity", `${P}/${ctx.activities.A130}`, `${task.projectId}/${task.activityId}`);
  check("the task is assigned to the site engineer", ctx.userIds.site, task.assigneeId ?? task.assignee?.id);

  // Link it back to the meeting's action item if the product did not do so itself.
  const action1 = (m.actionItems || []).find((a) => a.title === TASK_TITLE);
  if (action1 && !action1.taskId) {
    const linked = await probe(planner, "PATCH", `/projects/${P}/meetings/${mtg.id}`, { actionItems: (m.actionItems || []).map((a) => ({ ...a, taskId: a.id === action1.id ? task.id : a.taskId })) });
    note("  link action → task", `${linked.status} ${linked.code ?? "ok"}`);
    m = await GET(planner, `/projects/${P}/meetings/${mtg.id}`);
  }
  check("the meeting's action item points at the task", task.id, (m.actionItems || []).find((a) => a.title === TASK_TITLE)?.taskId);

  // The assignee works it: a comment, then done. A storeman may not close it.
  if (task.status !== "done") {
    const c = await probe(site, "POST", `/tasks/${task.id}/comments`, { body: "Re-briefed 07:15 on 4 Feb; tag lines issued to both crews.", text: "Re-briefed 07:15 on 4 Feb; tag lines issued to both crews." });
    note("  comment (assignee)", `${c.status} ${c.code ?? "ok"}`);
    check("a storeman cannot close the task", 403, (await probe(warehouse, "POST", `/tasks/${task.id}/close`, {})).status);
    const done = await probe(site, "POST", `/tasks/${task.id}/close`, { comment: "Done" });
    note("  close (assignee)", `${done.status} ${done.code ?? "ok"}`);
    if (!done.ok && done.status !== 409) throw new Error(`close: ${done.status} ${done.code} ${done.message}`);
    task = await GET(site, `/tasks/${task.id}`);
  }
  check("the task is done", "done", task.status);

  // My tasks: the site engineer sees it under "assigned to me".
  const mine = rows(await GET(site, `/tasks?assignee=me&limit=100`));
  check("it appears in the site engineer's own task list", true, mine.some((t) => t.id === task.id));

  ctx.deepLinks = Object.assign(ctx.deepLinks || {}, {
    meeting: { recordType: "meeting", recordId: mtg.id, ref: m.ref ?? MEETING_TITLE },
    task: { recordType: "task", recordId: task.id, ref: task.ref ?? TASK_TITLE },
  });
  save();
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 18 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
