/**
 * R5-1 — the regression case for the certified project's 45-day forecast
 * (docs/project-controls/OCTAPM_FORECAST_CHANGE_IMPACTS_CENSUS.md §5).
 *
 * Rebuilds the geometry of project 0ce999f2 in a throwaway "LiveTest <uuid>"
 * organisation, through the product's own paths, against a real API process
 * and the real local Postgres. Six-day calendar, project start 2027-01-04,
 * one zero-float chain laid out by the CPM engine:
 *
 *   F  Foundation concrete   30 wd  2027-01-04 → 2027-02-08
 *   G  Frame                 29 wd  2027-02-08 → 2027-03-13
 *   X  Blockwork walls        9 wd  2027-03-13 → 2027-03-24
 *   P  Finishes              13 wd  2027-03-24 → 2027-04-08
 *   M  Practical completion   0 wd  2027-04-08  (the project's planned finish)
 *
 * X finishes 15 calendar days (13 working days) before the project does.
 *   - six approved orders give X 10 days each, with one identical
 *     description, as the Phase-21 harness wrote VO-10…VO-20;
 *   - RFI-1 records 3 days on F and becomes an order through the RFI's own
 *     "convert to change" (Rfi.changeOrderId), approved with 3 days on F — it
 *     replaces the RFI's link, as VO-22 replaced RFI-001's;
 *   - one order on X is only submitted (10 days, 10 typed as "approved");
 *   - one order on X was approved with 7 days and then archived. The product
 *     refuses to archive an approved order, so the archive is written
 *     directly on this LiveTest row: it stands for legacy data, and the
 *     forecast's `archivedAt: null` filter must hold for it.
 * As on the certified project, the project has a prime contract (value from
 * the project, completion date 2027-12-17), a bill row, a payment certificate
 * in draft and a cost record with an entered forecast — so that "the forecast
 * writes nothing" is checked on rows that exist.
 *
 * The expected figures pin the engine's CURRENT conventions. Each is a
 * documented limitation (census §5.6), asserted so that any change to it is
 * deliberate:
 *   LIMITATION 1 — additive: every approved order on an activity counts, even
 *     six recordings of one instruction (6 × 10 = 60);
 *   LIMITATION 2 — calendar days: an impact is added as 24-hour days, whatever
 *     the activity's calendar (X: 2027-03-24 + 60 d = 2027-05-23);
 *   LIMITATION 3 — no successor propagation: P and M keep their planned
 *     finish; the project slip is X's projected finish minus the project's
 *     planned finish, 60 − 15 = 45.
 *
 * And what R5-1 requires, whatever the conventions: nothing is written by the
 * forecast (activity, baseline and contract dates, orders, amounts), and it is
 * called a projection, never an extension of time.
 *
 * THE INSTANT. A forecast is read as of an instant, and GET /forecast always
 * reads it as of now. The fixture's dates are fixed in 2027, so every figure
 * below is taken from forecast.service.buildForecast at AS_OF — before any
 * activity's planned start, as the certified project's Blockwork was when its
 * 45 days were read (census §5.2) — and does not depend on the day the suite
 * runs. Read later, the same records give other figures (the late-start and
 * overdue rules move activities that have not started); such readings are
 * asserted so the dependence is on the record. The HTTP route is kept for
 * what no instant changes: the shape, the recorded impact days, the planned
 * dates, the wording, and that nothing is written.
 *
 *   npm run test:live -- src/services/__live__/r5-1-forecast-change-impacts.live.test.js
 */
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { buildForecast, deterministicNarrative, forecastBlock } = require("../forecast.service");
const { resolveRequestPrincipal } = require("../membership.service");
const { requestForProject } = require("../../middleware/project-access");
const { boqFigureAccess, exceptionAccess } = require("../../utils/boq-figures");

// The instant every figure is read at: before the fixture's first planned
// start (2027-01-04), so no pace, late-start or overdue rule applies.
const AS_OF = new Date("2026-09-30T12:00:00.000Z");
// Later readings of the same records — what GET /forecast will answer then.
const LATE_START = new Date("2027-01-06T12:00:00.000Z"); // F two and a half days past its start
const MID_MARCH = new Date("2027-03-20T12:00:00.000Z"); // F overdue, X past its start
const AFTER_THE_PLAN = new Date("2027-08-01T12:00:00.000Z"); // every activity overdue

// ─── Every row of the organisation ────────────────────────────────────────
// "Writes nothing" is checked on every table of the schema that holds rows of
// an organisation or a project (the LiveTest organisation has this one
// project), not on a list of tables someone thought of: a table added later is
// covered the day it is added. Activity progress, assignments and equipment
// have neither column and are reached through their activity. The few models
// left (children keyed only by their parent's id, such as an RFI's assignees,
// and operational tables such as rate-limit buckets) are not compared.
const scalarField = (model, name) => model.fields.some((field) => field.name === name && field.kind === "scalar");
const THROUGH_ACTIVITY = new Set(["ActivityProgress", "ActivityAssignment", "ActivityEquipment"]);
const scopeOf = (model) => {
  if (model.name === "Organisation") return ({ orgId }) => ({ id: orgId });
  if (scalarField(model, "orgId")) return ({ orgId }) => ({ orgId });
  if (scalarField(model, "projectId")) return ({ projectId }) => ({ projectId });
  if (THROUGH_ACTIVITY.has(model.name)) return ({ projectId }) => ({ activity: { projectId } });
  return null;
};
const TABLES = Prisma.dmmf.datamodel.models.map((model) => ({
  name: model.name,
  delegate: model.name[0].toLowerCase() + model.name.slice(1),
  key: model.primaryKey?.fields?.length ? model.primaryKey.fields : model.fields.filter((field) => field.isId).map((field) => field.name),
  where: scopeOf(model),
}));
const SCOPED = TABLES.filter((table) => table.where);
const stable = (value) => JSON.stringify(value, (key, inner) => (typeof inner === "bigint" ? `${inner}n` : inner));

/** name → (row key → the row's fields, each as text) for every scoped table. */
const everyRow = async (scope) => {
  const snapshot = new Map();
  for (let index = 0; index < SCOPED.length; index += 3) {
    await Promise.all(SCOPED.slice(index, index + 3).map(async (table) => {
      const found = await prisma[table.delegate].findMany({ where: table.where(scope) });
      snapshot.set(table.name, new Map(found.map((row) => [table.key.map((field) => stable(row[field])).join("|"), Object.fromEntries(Object.entries(row).map(([field, value]) => [field, stable(value)]))])));
    }));
  }
  return snapshot;
};

/** What differs between two snapshots, one line per row: "Table key: added | removed | changed a, b". */
const changesBetween = (before, after) => {
  const changes = [];
  for (const [name, rowsAfter] of after) {
    const rowsBefore = before.get(name) || new Map();
    for (const [key, row] of rowsAfter) {
      const was = rowsBefore.get(key);
      if (!was) changes.push(`${name} ${key}: added`);
      else {
        const fields = Object.keys({ ...was, ...row }).filter((field) => was[field] !== row[field]);
        if (fields.length) changes.push(`${name} ${key}: changed ${fields.map((field) => `${field} ${was[field]} → ${row[field]}`).join(", ")}`);
      }
    }
    for (const key of rowsBefore.keys()) if (!rowsAfter.has(key)) changes.push(`${name} ${key}: removed`);
  }
  return changes;
};

const PROOF = { fileName: "LiveTest proof.pdf", fileUrl: "https://example.test/proof.pdf" };
const DUPLICATE = "LiveTest Client instruction: upgrade blockwork to fair-faced, grid A-F";
// Words that belong to a granted extension of time, never to a forecast.
const NOT_A_FORECAST = /extension of time|\beot\b|approved delay|granted/i;

liveDescribe("R5-1: the certified project's 45-day forecast, pinned on its own geometry", () => {
  let live;
  let api;
  const built = { activities: {}, orders: {} };

  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${built.project.id}${route}`;
  const send = async (route, body, expected = 201) => {
    const response = await api.post(route, body, auth());
    expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
    return response.body.data;
  };
  const patch = async (route, body) => {
    const response = await api.request("PATCH", route, { body, headers: auth() });
    expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
    return response.body.data;
  };
  const approve = async (orderId) => {
    await send(at(`/change-orders/${orderId}/submit`), {}, 200);
    await send(at(`/change-orders/${orderId}/approve`), { comment: "LiveTest" }, 200);
  };
  const order = async (description, activityId, days, extra = {}) =>
    send(at("/change-orders"), { description, category: "variation", value: 500, scheduleImpactSummary: `${days} working days on the activity`, costImpactSummary: "priced", activityLinks: [{ activityId, relationType: "impacted", scheduleImpactDays: days, ...extra }], attachmentRefs: [PROOF] });
  // GET /forecast: the forecast as of NOW. Only what no instant changes is
  // asserted on it.
  const forecast = async () => {
    const response = await api.get(at("/forecast"), auth());
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data;
  };
  // The same forecast, built in this process at a fixed instant — for the
  // same reader: GET /forecast passes the caller's access (PC-7b integration
  // D: boqFigureAccess + exceptionAccess, routes/forecast.js), which decides
  // the data-quality notes and their dataQualityWithheld marker; no figure
  // depends on it.
  const forecastAt = async (asOf = AS_OF) => {
    const view = await requestForProject({ user: await resolveRequestPrincipal({ userId: live.user.id, orgId: live.org.id }) }, built.project.id);
    return buildForecast({ orgId: live.org.id, projectId: built.project.id, asOf, access: { ...boqFigureAccess(view), ...exceptionAccess(view) } });
  };
  const keysOf = (value) => Object.keys(value || {}).sort();

  // Every row of this organisation, once nothing is still being written: two
  // snapshots a moment apart must agree (a request answered before its
  // publish-after-commit work lands is given the time to finish).
  const settledRows = async () => {
    const scope = { orgId: live.org.id, projectId: built.project.id };
    let previous = await everyRow(scope);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const next = await everyRow(scope);
      if (!changesBetween(previous, next).length) return next;
      previous = next;
    }
    throw new Error("the organisation's rows never settled");
  };
  const ok = async (response, expected = 200) => {
    expect([response.status, response.body?.error]).toEqual([expected, undefined]);
    return response.body.data;
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    // No model provider: /forecast/explain answers with the forecast's own
    // deterministic narrative, and no request leaves the machine.
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", AI_PROVIDER: "" });
    built.project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest R5-1 forecast trace", startDate: new Date("2027-01-04"), endDate: new Date("2027-12-17"), completionDate: new Date("2027-12-17"), contractValue: 250000, projectCalendar: "six_day" },
    });
    // The chain, laid out by the CPM engine from the project start on the
    // six-day calendar (each create recalculates the project).
    let previous = null;
    for (const [key, name, duration] of [["F", "Foundation concrete", 30], ["G", "Frame", 29], ["X", "Blockwork walls", 9], ["P", "Finishes", 13], ["M", "Practical completion", 0]]) {
      const activity = await send(at("/activities"), {
        name,
        activityCode: `R5${key}`,
        duration,
        isMilestone: duration === 0,
        engineerIds: [live.user.id],
        ...(previous ? { dependencies: [{ predecessorId: previous, relationshipType: "FS", lagDays: 0 }] } : {}),
      });
      built.activities[key] = activity.id;
      previous = activity.id;
    }
    const { F, G, X } = built.activities;

    // The contract and the money, as the certified project has them, written
    // before the orders so their approval meets a contract that exists: the
    // prime contract (its completion date taken from the project, 2027-12-17),
    // one bill row left unallocated (no activity budget, no earned value), a
    // payment certificate drafted for it, and a cost record on G with an
    // entered forecast.
    built.contract = await ok(await api.get(at("/prime-contract"), auth()));
    await send(at("/boq/items"), { code: "R5.1", description: "LiveTest bill row", quantity: 10, unit: "m3", rate: 100 });
    built.ipc = await send(at("/ipc"), { period: "P01" });
    built.costRecord = await send(at(`/cost/activity/${G}`), { budget: 1000, forecast: 1200 });

    // Six approved orders on X, one instruction recorded six times.
    built.orders.duplicates = [];
    for (let run = 0; run < 6; run += 1) {
      const created = await order(DUPLICATE, X, 10);
      await approve(created.id);
      built.orders.duplicates.push(created.id);
    }
    // RFI-1: 3 days on F, converted into an order through the RFI itself.
    const rfi = await send(at("/rfi"), { subject: "LiveTest RFI-1 founding level", status: "open", activityId: F, activityLinks: [{ activityId: F, relationType: "schedule_impact", scheduleImpactDays: 3 }] });
    built.rfiId = rfi.id;
    const converted = await send(at(`/rfi/${rfi.id}/convert-to-change`), { value: 450 });
    built.orders.fromRfi = converted.changeOrder.id;
    await patch(at(`/change-orders/${built.orders.fromRfi}`), { scheduleImpactSummary: "3 working days on F", costImpactSummary: "priced", activityLinks: [{ activityId: F, relationType: "impacted", scheduleImpactDays: 3 }], attachmentRefs: [PROOF] });
    await approve(built.orders.fromRfi);
    // Submitted, never approved: its typed "approved" 10 days are not source.
    const pending = await order("LiveTest pending order on X", X, 10, { approvedScheduleImpactDays: 10 });
    await send(at(`/change-orders/${pending.id}/submit`), {}, 200);
    built.orders.pending = pending.id;
    // Approved, then archived (legacy state, written directly — see above).
    const archived = await order("LiveTest archived order on X", X, 7);
    await approve(archived.id);
    await prisma.changeOrder.update({ where: { id: archived.id }, data: { archivedAt: new Date("2026-09-01T00:00:00Z") } });
    built.orders.archived = archived.id;

    // Every row of the organisation BEFORE any forecast is built: what the
    // last test compares with, so a write made by the first forecast of this
    // file — even one that stores the same value every time — is seen.
    built.before = await settledRows();
  }, 600_000);

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

  it("the stored facts are the certified project's geometry (the product paths wrote them)", async () => {
    const activities = await prisma.activity.findMany({ where: { projectId: built.project.id }, select: { id: true, startDate: true, endDate: true, totalFloat: true, isCritical: true, calendarId: true } });
    const byId = Object.fromEntries(activities.map((row) => [row.id, row]));
    const plan = (key) => {
      const row = byId[built.activities[key]];
      return [key, row.startDate.toISOString().slice(0, 10), row.endDate.toISOString().slice(0, 10), row.totalFloat, row.isCritical, row.calendarId];
    };
    expect(["F", "G", "X", "P", "M"].map(plan)).toEqual([
      ["F", "2027-01-04", "2027-02-08", 0, true, "six_day"],
      ["G", "2027-02-08", "2027-03-13", 0, true, "six_day"],
      ["X", "2027-03-13", "2027-03-24", 0, true, "six_day"],
      ["P", "2027-03-24", "2027-04-08", 0, true, "six_day"],
      ["M", "2027-04-08", "2027-04-08", 0, true, "six_day"],
    ]);

    const orders = await prisma.changeOrder.findMany({ where: { projectId: built.project.id }, select: { id: true, status: true, archivedAt: true, description: true } });
    const status = Object.fromEntries(orders.map((row) => [row.id, [row.status, Boolean(row.archivedAt)]]));
    expect(built.orders.duplicates.map((id) => status[id])).toEqual(Array(6).fill(["approved", false]));
    expect(orders.filter((row) => row.description === DUPLICATE)).toHaveLength(6);
    expect([status[built.orders.fromRfi], status[built.orders.pending], status[built.orders.archived]]).toEqual([["approved", false], ["pending", false], ["approved", true]]);

    const links = await prisma.changeOrderActivityLink.findMany({ where: { projectId: built.project.id, scheduleImpactDays: { gt: 0 } }, select: { changeOrderId: true, activityId: true, approvedScheduleImpactDays: true } });
    const approvedDays = (id) => links.filter((row) => row.changeOrderId === id).map((row) => [row.activityId, row.approvedScheduleImpactDays]);
    for (const id of built.orders.duplicates) expect(approvedDays(id)).toEqual([[built.activities.X, 10]]);
    expect(approvedDays(built.orders.fromRfi)).toEqual([[built.activities.F, 3]]);
    expect(approvedDays(built.orders.pending)).toEqual([[built.activities.X, 10]]);
    expect(approvedDays(built.orders.archived)).toEqual([[built.activities.X, 7]]);

    const rfi = await prisma.rfi.findUnique({ where: { id: built.rfiId }, select: { changeOrderId: true } });
    expect(rfi.changeOrderId).toBe(built.orders.fromRfi);
    const rfiLinks = await prisma.workflowActivityLink.findMany({ where: { projectId: built.project.id, recordType: "rfi", recordId: built.rfiId }, select: { activityId: true, scheduleImpactDays: true } });
    expect(rfiLinks).toEqual([{ activityId: built.activities.F, scheduleImpactDays: 3 }]);
  });

  it("gives Blockwork 60 impact days and the project 45 days of projected slip, on the engine's documented conventions", async () => {
    const data = await forecastAt(AS_OF);
    expect([data.available, data.asOf]).toEqual([true, "2026-09-30T12:00:00.000Z"]);
    const row = (key) => data.activities.find((activity) => activity.id === built.activities[key]);

    // LIMITATION 1 — additive: six approved orders of 10 days on X count 60.
    // The pending order (10) and the archived one (7) are not counted.
    expect(row("X")).toMatchObject({ plannedFinish: "2027-03-24", projectedFinish: "2027-03-24", basis: "planned", slipDays: 0, impactDays: 60, float: 0, floatBreached: true, isCritical: true });
    expect(row("X").reasons).toContain("60 days of recorded impact from change order");
    // RFI-1's 3 days on F are replaced by the approved order's 3: 3, not 6.
    expect(row("F")).toMatchObject({ plannedFinish: "2027-02-08", projectedFinish: "2027-02-08", slipDays: 0, impactDays: 3 });
    expect(row("F").reasons).toContain("3 days of recorded impact from change order");
    expect(row("F").reasons.join(" ")).not.toMatch(/from RFI/);
    // LIMITATION 3 — no successor propagation: P and M keep their planned finish.
    expect(["G", "P", "M"].map((key) => [key, row(key).projectedFinish, row(key).impactDays, row(key).slipDays])).toEqual([
      ["G", "2027-03-13", 0, 0],
      ["P", "2027-04-08", 0, 0],
      ["M", "2027-04-08", 0, 0],
    ]);

    // LIMITATION 2 — calendar days: 2027-03-24 + 60 × 24 h = 2027-05-23, and
    // (LIMITATION 3) the slip is measured from X's own finish: 60 − 15 = 45.
    expect(data.schedule).toMatchObject({
      plannedFinish: "2027-04-08",
      projectedFinish: "2027-05-23",
      activityBasedFinish: "2027-05-23",
      evBasedFinish: null,
      slipDays: 45,
      basis: "activities",
      criticalDriver: { id: built.activities.X, name: "Blockwork walls", slipDays: 60 },
    });
    expect(data.summary.scheduleLevel).toBe("high");
  });

  it("is read as of an instant: the route answers the same forecast as of now, and a later reading moves activities that have not started", async () => {
    const pinned = await forecastAt(AS_OF);
    const now = await forecast();
    const ids = ["F", "G", "X", "P", "M"].map((key) => built.activities[key]);
    const facts = (data) => ids.map((id) => data.activities.find((activity) => activity.id === id)).map((activity) => [activity.name, activity.plannedFinish, activity.impactDays, activity.float, activity.isCritical]);

    // The route's answer has the pinned forecast's shape, and the figures no
    // instant changes: the planned dates and the recorded impact days.
    expect(now.available).toBe(true);
    expect(keysOf(now)).toEqual(keysOf(pinned));
    expect(keysOf(now.schedule)).toEqual(keysOf(pinned.schedule));
    expect(keysOf(now.activities[0])).toEqual(keysOf(pinned.activities[0]));
    expect(now.activities.map((activity) => activity.id).sort()).toEqual([...ids].sort());
    expect(now.schedule.plannedFinish).toBe("2027-04-08");
    expect(facts(now)).toEqual(facts(pinned));
    expect(facts(pinned)).toEqual([
      ["Foundation concrete", "2027-02-08", 3, 0, true],
      ["Frame", "2027-03-13", 0, 0, true],
      ["Blockwork walls", "2027-03-24", 60, 0, true],
      ["Finishes", "2027-04-08", 0, 0, true],
      ["Practical completion", "2027-04-08", 0, 0, true],
    ]);

    // Two and a half days after F's planned start with nothing recorded, the
    // late-start rule moves F by the time lost; X still drives the 45 days.
    const lateStart = await forecastAt(LATE_START);
    const f = lateStart.activities.find((activity) => activity.id === built.activities.F);
    expect([f.basis, f.plannedFinish, f.projectedFinish, f.impactDays]).toEqual(["late_start", "2027-02-08", "2027-02-10", 3]);
    expect([lateStart.schedule.projectedFinish, lateStart.schedule.slipDays, lateStart.schedule.criticalDriver.name]).toEqual(["2027-05-23", 45, "Blockwork walls"]);
    // By mid-March F is overdue and X itself is late: the slip is no longer
    // 45 and the driver is no longer Blockwork. The 45 days are a reading at
    // an instant, not a property of the records.
    const midMarch = await forecastAt(MID_MARCH);
    expect(midMarch.schedule.slipDays).toBeGreaterThan(45);
    expect(midMarch.schedule.criticalDriver.name).toBe("Foundation concrete");
  });

  it("calls it a projection, never an extension of time", async () => {
    // The wording holds at every reading: the route's (as of now), the
    // pinned one, and the later ones where other rules and reasons apply.
    const pinned = await forecastAt(AS_OF);
    const readings = [["now", await forecast()], ["pinned", pinned]];
    for (const asOf of [LATE_START, MID_MARCH, AFTER_THE_PLAN]) readings.push([asOf.toISOString(), await forecastAt(asOf)]);
    const bases = new Set();
    for (const [label, data] of readings) {
      const keys = [];
      const strings = [];
      const walk = (value) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") {
          for (const [key, inner] of Object.entries(value)) {
            keys.push(key);
            walk(inner);
          }
        } else if (typeof value === "string") strings.push(value);
      };
      walk(data);
      walk({ block: forecastBlock(data, "LiveTest R5-1 forecast trace"), narrative: deterministicNarrative(data) });
      expect([label, keys.filter((key) => /eot|extension|granted/i.test(key))]).toEqual([label, []]);
      expect([label, strings.filter((text) => NOT_A_FORECAST.test(text))]).toEqual([label, []]);
      expect(Object.keys(data.schedule)).toEqual(expect.arrayContaining(["projectedFinish", "activityBasedFinish", "plannedFinish", "slipDays"]));
      for (const activity of data.activities) bases.add(activity.basis);
    }
    // The later readings did exercise the other projection rules.
    expect([...bases].sort()).toEqual(expect.arrayContaining(["late_start", "overdue", "planned"]));

    // The text the model is given and the narrative the reader gets, at the
    // pinned instant.
    const block = forecastBlock(pinned, "LiveTest R5-1 forecast trace");
    expect(block).toContain("As of: 2026-09-30");
    expect(block).toContain("Schedule: planned finish 2027-04-08, projected 2027-05-23 (45 days late, basis activities)");
    expect(block).toContain("Main driver: Blockwork walls (60 days).");
    expect(deterministicNarrative(pinned).headline).toMatch(/^The project is projected to finish 45 days late/);
    // The route's narrative, as of now: X's recorded impact keeps the project
    // late on any day, by a number of days that depends on the day — so the
    // number is not asserted here.
    const explained = await api.post(at("/forecast/explain"), {}, auth());
    expect(explained.status).toBe(200);
    const { narrative, degraded } = explained.body.data;
    expect(degraded).toBe(true);
    expect(narrative.headline).toMatch(/^The project is projected to finish \d+ days late/);
    expect(JSON.stringify(narrative)).not.toMatch(NOT_A_FORECAST);
  });

  it("writes nothing: not one row of the organisation changes — no activity, baseline or contract date, order, link, amount, certificate or cost record", async () => {
    // Every forecast the tests above built is behind us; build them once more.
    const { before } = built;
    await forecast();
    const explained = await api.post(at("/forecast/explain"), {}, auth());
    expect([explained.status, explained.body?.error]).toEqual([200, undefined]);
    await forecast();
    // The same service in this process, at every instant this file reads.
    for (const asOf of [AS_OF, LATE_START, MID_MARCH, AFTER_THE_PLAN]) await forecastAt(asOf);
    const after = await settledRows();
    expect(changesBetween(before, after)).toEqual([]);

    // The comparison is over rows that exist, in every table R5-1 names.
    // No schedule revision and no extension-of-time claim exists, before or
    // after: a forecast is neither.
    expect(SCOPED.length).toBeGreaterThan(200);
    const counted = ["Project", "PrimeContract", "Activity", "ActivityDependency", "ActivityProgress", "ScheduleRevision", "ChangeOrder", "ChangeOrderActivityLink", "WorkflowActivityLink", "Rfi", "EotClaim", "BudgetLine", "BudgetLineChange", "BudgetRevision", "CostRecord", "BoqItem", "IpcCertificate"];
    expect(Object.fromEntries(counted.map((name) => [name, after.get(name).size]))).toEqual({
      Project: 1,
      PrimeContract: 1,
      Activity: 5,
      ActivityDependency: 4,
      ActivityProgress: 0,
      ScheduleRevision: 0,
      ChangeOrder: 9,
      ChangeOrderActivityLink: 9,
      WorkflowActivityLink: 1,
      Rfi: 1,
      EotClaim: 0,
      BudgetLine: 1,
      BudgetLineChange: 8,
      BudgetRevision: 8,
      CostRecord: 1,
      BoqItem: 1,
      IpcCertificate: 1,
    });

    // And, by name, what the forecast must never move (R5-1).
    const projectId = built.project.id;
    const day = (value) => (value ? value.toISOString().slice(0, 10) : null);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect([day(project.endDate), day(project.completionDate), day(project.revisedCompletionDate)]).toEqual(["2027-12-17", "2027-12-17", null]);
    const contract = await prisma.primeContract.findUnique({ where: { projectId } });
    expect([day(contract.completionDate), String(contract.originalValue), contract.originalValueSource]).toEqual(["2027-12-17", "250000", "project_value"]);
    const cost = await prisma.costRecord.findFirst({ where: { projectId } });
    expect([cost.activityId, String(cost.budget), String(cost.forecast)]).toEqual([built.activities.G, "1000", "1200"]);
    const baselines = await prisma.activity.findMany({ where: { projectId }, select: { baselineStart: true, baselineFinish: true } });
    expect(baselines).toEqual(Array(5).fill({ baselineStart: null, baselineFinish: null }));
  });
});
