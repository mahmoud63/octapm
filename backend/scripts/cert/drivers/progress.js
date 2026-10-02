'use strict';

/**
 * Site progress: what the site writes down each day, and what the project
 * team makes official from it.
 *
 *   - daily logs on several past days, every section (manpower, equipment,
 *     deliveries, visitors, delays, notes, quantities), left open, submitted
 *     and approved; one copied from the day before, one reopened, one
 *     distributed (a stored PDF, an in-app notice, no outside address), a
 *     delay put on the weather register (a 0.5-day contractual delay);
 *   - the BOQ allocations of the activities used here (the foundation
 *     driver's drafts, same project) submitted and approved: a quantity is
 *     recorded against an approved allocation only;
 *   - a progress method per activity: quantity, weighted milestone, percent
 *     (one that demands evidence), inspection, manual, and some left on the
 *     default. `inspectionRequired` is stored and shown but the product does
 *     not enforce it: what holds an approval is an open ITP hold point
 *     (progress.service openHoldPoints), which the quality driver leaves on
 *     the project's last activity — so that activity is given no role here
 *     when the project has six activities or more;
 *   - quantity progress entries: draft, submitted, bundled, approved, rejected,
 *     and the ones a submitted daily log mints;
 *   - progress claims by the site engineer, approved, rejected or left waiting
 *     by the PM, the planner and the QS — percentages, milestone states,
 *     quantity bundles, a typed quantity, a bulk claim. Claimed figures only
 *     rise: each activity's next claim is above its official figure (read
 *     from the activity list and kept in `ctx.refs.progress.pct`), so a
 *     --redo never makes official progress go backwards. One claim carries an
 *     actualCost: that is an estimate stored on the submission and the
 *     official row only — official actual cost is the cost ledger, and
 *     nothing is posted for it;
 *   - every official progress row (ActivityProgress) an approval writes —
 *     the approval answers its id for quantity claims only, so the rows are
 *     read back from each activity's detail and recorded there;
 *   - labour: workers (company-wide), a crew, timesheets on activities and
 *     cost codes — draft, submitted, returned, approved (which posts labour
 *     actual cost through the ledger) and reopened (which reverses it);
 *   - weekly reports, and the older daily reports and site diaries that are
 *     still mounted; approving a daily report also writes an official
 *     progress row and an equipment usage row (recorded, cost 0 here).
 *
 * At the end the earned-value report is read at today's cutoff and noted
 * (an observation, not an expected value: nothing is kept in refs).
 *
 * Failures: every record this area is about is created for real or the run
 * fails. A 5xx is always written to the notes as a FINDING; one the product
 * rolled back (P2028, P2034) is asked again, any other fails the run. The
 * only refusals accepted are named ones a company or a state legitimately
 * gives: no earlier day to copy from, a typed quantity on an activity that
 * already has entries (every --redo), and an approval held by an open ITP
 * hold point.
 *
 * Re-runnable: a run takes days no log or timesheet stands on yet, finds its
 * workers by number and its crew by the id kept in refs, keeps the activity
 * each method was given in `ctx.refs.progress`, and records an id once. Each
 * run takes 3–6 more log days from a 108-day window (roughly 18–36 runs
 * before it runs out), adds another 0.5-day contractual weather delay, more
 * labour cost and four more weekly reports; canaries carry the run number
 * from the second run on.
 */

const { ApiError } = require('../lib/api');

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const TRADES = ['Carpenter', 'Steelfixer', 'Mason', 'General labourer', 'Electrician', 'Plumber', 'Scaffolder'];
const PLANT = ['Excavator 20t', 'Mobile crane 50t', 'Concrete pump', 'Dumper 6t', 'Telehandler', 'Vibrating roller'];
const DELIVERIES = [['Ready-mix concrete C35', 'm3'], ['Reinforcement bars 16mm', 'ton'], ['Concrete blocks 200mm', 'nr'], ['Plywood formwork sheets', 'nr']];
const DELAY_TYPES = ['weather', 'access', 'design', 'material', 'labour', 'equipment', 'inspection', 'utility', 'other'];
const NOTE_KINDS = ['general', 'safety', 'instruction', 'inspection', 'issue'];
const WEATHER = ['clear', 'cloudy', 'rain', 'windy'];
const SECTION_TYPES = {
  manpower: 'daily_log_manpower',
  equipment: 'daily_log_equipment',
  deliveries: 'daily_log_delivery',
  visitors: 'daily_log_visitor',
  delays: 'daily_log_delay',
  notes: 'daily_log_note',
  quantities: 'daily_log_quantity',
};
const CLAIM_OUTCOMES = ['approved', 'submitted', 'rejected', 'approved', 'draft', 'approved', 'submitted', 'rejected', 'approved'];
const SHEET_OUTCOMES = ['approved', 'submitted', 'rejected', 'draft', 'approved', 'reopened', 'approved'];
const WEEK_OUTCOMES = ['approved', 'submitted', 'draft', 'approved'];
const REPORT_OUTCOMES = ['approved', 'submitted', 'rejected', 'draft'];
/** The highest percentage a claim proposes: an activity is never claimed complete by a percentage here. */
const PCT_CAP = 95;

const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const dayOf = (value) => String(value || '').slice(0, 10);
const shiftDay = (day, days) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (day) => {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return shiftDay(day, weekday === 0 ? -6 : 1 - weekday);
};
/** A quantity at the product's scale (three places), never zero. */
const qty = (value) => Math.max(0.001, Math.round(value * 1000) / 1000);
const round1 = (value) => Math.round(Number(value) * 10) / 10;
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const unitOf = (allocation) => allocation.unitCode || allocation.boqItem?.unitCode || allocation.boqItem?.unit || null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A person's session under the 5xx rule. Every 5xx is a product finding and
 * goes to the notes with how long the call took. Two are asked again because
 * the product rolled the whole request back — P2028 (an interactive
 * transaction outlived Prisma's limit) and P2034 (a write conflict) — so a
 * second ask cannot duplicate anything. Any other 5xx fails the run: it may
 * have been raised after a commit, and asking again could make an unrecorded
 * second copy.
 */
const ROLLED_BACK = new Set(['P2028', 'P2034']);
const steady = (ctx, session) => {
  const retry = (method, call) => async (route, ...rest) => {
    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      try {
        return await call(route, ...rest);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status < 500) throw error;
        const where = String(route).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');
        ctx.note(`FINDING 5xx: ${method} ${where} -> ${error.status} ${error.code} after ${Date.now() - started} ms (attempt ${attempt}): ${String(error.serverMessage).replace(/\s+/g, ' ').slice(0, 220)}`);
        if (!ROLLED_BACK.has(error.code) || attempt >= 3) throw error;
        await wait(1500 * attempt);
      }
    }
  };
  return {
    ...session,
    GET: retry('GET', session.GET),
    POST: retry('POST', session.POST),
    PATCH: retry('PATCH', session.PATCH),
    PUT: retry('PUT', session.PUT),
    DELETE: retry('DELETE', session.DELETE),
    upload: (method, route, file) => retry(method, (r) => session.upload(method, r, file))(route),
    download: retry('GET', session.download),
  };
};

/**
 * A step some companies or states legitimately refuse: only the refusal
 * codes named here become a note (and null); any other refusal, and every
 * 5xx, fails the run.
 */
const tolerate = async (ctx, label, fn, codes) => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status < 500 && codes.includes(error.code)) {
      ctx.note(`${label}: refused as expected here, ${error.status} ${error.code}: ${error.serverMessage}`.slice(0, 300));
      return null;
    }
    throw error;
  }
};

const run = async (ctx) => {
  const { P, rng } = ctx;
  const pm = steady(ctx, ctx.who('pm'));
  const planner = steady(ctx, ctx.who('planner'));
  const qs = steady(ctx, ctx.who('qs'));
  const cost = steady(ctx, ctx.who('cost'));
  const site = steady(ctx, ctx.who('site'));
  const quality = steady(ctx, ctx.who('quality'));

  const state = (ctx.refs.progress = ctx.refs.progress || {});
  // Earlier versions kept the EV figures here, where a later script could take them for expected values.
  delete state.ev;
  state.runs = (state.runs || 0) + 1;
  state.methods = state.methods || {};
  state.pct = state.pct || {};
  const runNo = state.runs;
  /** The canary of a record; from the second run on it carries the run, so no two records share one. */
  const canary = (type) => ctx.canary(runNo > 1 ? `${type}_r${runNo}` : type);

  /** Records an id once, across runs (the inventory keeps every run's ids). */
  const known = new Map();
  const recordOnce = (type, id, options = {}) => {
    if (!id) throw new Error(`progress: a ${type} came back without an id`);
    let ids = known.get(type);
    if (!ids) {
      ids = new Set(options.scope === 'company' ? [] : ctx.records[type] || []);
      known.set(type, ids);
    }
    if (ids.has(id)) return false;
    ids.add(id);
    ctx.record(type, id, options);
    return true;
  };

  const activities = ctx.refs.activities || {};
  const codes = Object.keys(activities).sort();
  if (codes.length < 4) throw new Error(`progress: the project has ${codes.length} activities; four are needed (quantity, milestone and two percent activities)`);
  const codeOf = Object.fromEntries(Object.entries(activities).map(([code, id]) => [id, code]));
  const anyActivity = () => activities[rng.pick(codes)];
  const costCodes = ctx.companyRefs.costCodes || {};
  const labourCode = costCodes['01-100'] || Object.values(costCodes)[0] || null;
  const prelimCode = costCodes['09-100'] || labourCode;
  const subcontractor = ctx.companyRefs.directory?.subcontractor || null;
  const tally = {};
  const count = (key, n = 1) => {
    tally[key] = (tally[key] || 0) + n;
  };

  // ── 1. which activity is measured how (decided once, kept) ───────────────
  const readAllocations = async () =>
    listOf(await planner.GET(`${P}/activity-boq-allocations`), 'allocations').filter((row) => row.isActive !== false && codeOf[row.activityId]);
  let allocations = await readAllocations();
  const allocationsOf = (code, { approved = false } = {}) =>
    allocations.filter((row) => codeOf[row.activityId] === code && (approved ? row.status === 'approved' : row.status !== 'rejected'));

  if (!state.roles) {
    // The quality driver leaves open ITP hold points on the project's last
    // activity (and names them in its refs); an open hold point holds every
    // approval there, so those activities are not measured here when the
    // project has room without them.
    const held = new Set([...(ctx.refs.qualityField?.holdPointActivities || []), codes[codes.length - 1]]);
    let pool = codes.length >= 6 ? codes.filter((code) => !held.has(code)) : codes;
    if (!pool.some((code) => allocationsOf(code).length)) pool = codes;
    const mapped = pool.filter((code) => allocationsOf(code).length);
    if (!mapped.length) throw new Error('progress: no activity of this project has a BOQ allocation, so no quantity progress can be recorded (the foundation driver allocates the bill)');
    const oneUnit = (code) => new Set(allocationsOf(code).map(unitOf)).size === 1;
    const oneItem = (code) => new Set(allocationsOf(code).map((row) => row.boqItemId)).size === 1;
    const taken = new Set();
    const take = (list, test = () => true) => {
      const code = list.find((candidate) => !taken.has(candidate) && test(candidate)) || null;
      if (code) taken.add(code);
      return code;
    };
    const roles = {};
    roles.quantity = take(mapped, oneUnit) || take(mapped);
    roles.milestone = take(mapped) || take(pool);
    roles.logQuantity = take(mapped);
    roles.typedQuantity = codes.length >= 7 ? take(mapped, oneItem) : null;
    // Mapped activities first: approved progress on them is what earns value.
    const rest = [...mapped, ...pool].filter((code, index, all) => all.indexOf(code) === index);
    roles.percent = [take(rest), take(rest)].filter(Boolean);
    roles.inspection = codes.length >= 8 ? take(rest) : null;
    roles.manual = codes.length >= 10 ? take(rest) : null;
    const wanted = ctx.count(2, 6);
    while (roles.percent.length < wanted) {
      const code = take(rest);
      if (!code) break;
      roles.percent.push(code);
    }
    // On a small schedule the second daily-log quantity activity gives way to a percentage.
    if (roles.percent.length < 2 && roles.logQuantity) {
      roles.percent.push(roles.logQuantity);
      roles.logQuantity = null;
    }
    const biggest = [...allocationsOf(roles.quantity)].sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
    roles.quantityItem = biggest.boqItemId;
    // Checked before it is kept: a project that cannot be served must not be remembered as served.
    if (roles.percent.length < 2) throw new Error('progress: fewer than two activities are left to claim a percentage on');
    state.roles = roles;
  }
  const roles = state.roles;
  if (!roles.logQuantity) ctx.note('progress: no second activity with a BOQ allocation is free, so no daily-log quantity is left pending on one');
  if (!roles.typedQuantity) ctx.note('progress: fewer than seven activities (or no single-item one left), so no typed quantity is claimed');
  if (!roles.inspection) ctx.note('progress: fewer than eight activities, so no activity is measured by inspection');
  if (!roles.manual) ctx.note('progress: fewer than ten activities, so no activity is measured by manual assessment');

  // ── 2. approve the allocations these activities are measured against ─────
  const used = new Set([roles.quantity, roles.milestone, roles.logQuantity, roles.typedQuantity, roles.inspection, roles.manual, ...roles.percent].filter(Boolean));
  for (const row of allocations) {
    if (!used.has(codeOf[row.activityId]) || !['draft', 'submitted'].includes(row.status)) continue;
    if (row.status === 'draft') await planner.POST(`${P}/activity-boq-allocations/${row.id}/submit`);
    await qs.POST(`${P}/activity-boq-allocations/${row.id}/approve`);
    count('allocations approved');
  }
  allocations = await readAllocations();

  // The official figure of each activity now (latest approved progress), so every claim proposes more.
  const official = {};
  for (const row of listOf(await planner.GET(`${P}/activities`), 'activities')) {
    if (codeOf[row.id]) official[codeOf[row.id]] = Number(row.pctComplete || 0);
  }
  const floorOf = (code) => Math.max(official[code] || 0, state.pct[code] || 0);
  /** A claim's figure: above the official one, capped; never below it (at or past the cap it repeats the official figure). */
  const propose = (code, step) => Math.max(floorOf(code), Math.min(PCT_CAP, round1(floorOf(code) + step)));
  const madeOfficial = (code, pct) => {
    state.pct[code] = Math.max(floorOf(code), Number(pct || 0));
  };

  // ── 3. the progress methods ──────────────────────────────────────────────
  const setMethod = async (code, body) => {
    const row = await planner.PUT(`${P}/activities/${activities[code]}/progress-method`, body);
    if (!row?.id) throw new Error(`progress: the progress method of ${code} came back without an id`);
    state.methods[code] = row.id;
    recordOnce('activity_progress_method', row.id);
    return row;
  };

  // The quantity activity: one BOQ item, in that item's unit. When its
  // approved allocations are in more than one unit the planned quantity is
  // typed on the method (nothing is summed across units).
  const quantityApproved = allocationsOf(roles.quantity, { approved: true });
  const quantityAllocation = quantityApproved.find((row) => row.boqItemId === roles.quantityItem);
  if (!quantityAllocation) throw new Error(`progress: ${roles.quantity} has no approved allocation of its BOQ item ${roles.quantityItem} after the approvals`);
  const quantityUnit = unitOf(quantityAllocation);
  await setMethod(roles.quantity, {
    method: 'quantity',
    quantityUnit,
    ...(new Set(quantityApproved.map(unitOf)).size > 1 ? { plannedQuantity: Number(quantityAllocation.quantity) } : {}),
    notes: `${canary('progress_method')} measured by installed quantity`,
  });
  const quantity = {
    code: roles.quantity,
    activityId: activities[roles.quantity],
    boqItemId: quantityAllocation.boqItemId,
    allocationId: quantityAllocation.id,
    unit: quantityUnit,
    step: qty(Number(quantityAllocation.quantity) * 0.01),
  };
  const milestones = [
    { id: 'm1', name: `${canary('progress_milestone')} set out and prepared`, weight: 20 },
    { id: 'm2', name: `${canary('progress_milestone')} main works done`, weight: 50 },
    { id: 'm3', name: `${canary('progress_milestone')} inspected and handed over`, weight: 30 },
  ];
  await setMethod(roles.milestone, { method: 'weighted_milestone', milestoneWeights: milestones, notes: `${canary('progress_method')} three weighted milestones` });
  await setMethod(roles.percent[0], { method: 'percent', notes: `${canary('progress_method')} physical percent complete` });
  const evidenceCode = roles.percent[1];
  await setMethod(evidenceCode, { method: 'percent', evidenceRequired: true, notes: `${canary('progress_method')} percent, evidence required` });
  if (roles.inspection) {
    await setMethod(roles.inspection, { method: 'inspection', inspectionRequired: true, notes: `${canary('progress_method')} inspection flag set (stored, not enforced by the product)` });
  }
  if (roles.manual) await setMethod(roles.manual, { method: 'manual', notes: `${canary('progress_method')} manual assessment` });

  // ── 4. a site photo, the evidence of a claim ─────────────────────────────
  const photoName = `${canary('progress_photo')}.png`;
  const uploaded = await site.upload('POST', `${P}/site-reporting/uploads`, { field: 'files', filename: photoName, contentType: 'image/png', body: PNG_1X1 });
  const photo = listOf(uploaded, 'files')[0] || null;
  if (!photo?.documentId || !photo.key) throw new Error(`progress: the site photo upload answered no stored document: ${JSON.stringify(uploaded).slice(0, 200)}`);
  recordOnce('project_document', photo.documentId);
  const evidence = () => ({
    notes: `${canary('progress_evidence')} photographed on site`,
    photos: [{ key: photo.key, url: photo.url, name: photo.filename || photoName, type: 'photo' }],
  });

  // ── 5. daily logs ────────────────────────────────────────────────────────
  const myLogs = new Set();
  const skip = new Set();
  const absorb = (log) => {
    if (!log?.id) throw new Error('progress: a daily log answer carried no log id');
    myLogs.add(log.id);
    recordOnce('daily_log', log.id);
    for (const [section, type] of Object.entries(SECTION_TYPES)) {
      for (const row of log.sections?.[section] || []) if (!skip.has(row.id)) recordOnce(type, row.id);
    }
    return log;
  };
  const existingLogs = listOf(await site.GET(`${P}/daily-logs?from=${ctx.daysAgo(110)}&to=${ctx.today}`), 'items');
  const takenDays = new Set(existingLogs.map((row) => dayOf(row.date)));
  const logDays = [];
  const wantedLogs = ctx.count(3, 6);
  for (let back = 1; back <= 108 && logDays.length < wantedLogs; back += 1) {
    const day = ctx.daysAgo(back);
    if (!takenDays.has(day)) logDays.push(day);
  }
  if (logDays.length < 3) throw new Error('progress: fewer than three free days in the last 108 for daily logs');
  logDays.reverse(); // oldest first, so a day can be copied from the one before

  const entry = async (day, section, body, who = site) => absorb(await who.POST(`${P}/daily-logs/${day}/entries/${section}`, body));
  const quantityRow = async (day, target, factor, label) => {
    const log = await entry(day, 'quantities', {
      activityId: target.activityId,
      boqItemId: target.boqItemId,
      allocationId: target.allocationId,
      quantity: qty(target.step * factor),
      notes: `${canary('daily_log_quantity')} ${label}`,
    });
    return log.entryId;
  };
  // The second quantities target: an activity that stays on a percentage, so
  // what its rows mint is never bundled and stays pending.
  let pendingTarget = null;
  if (roles.logQuantity) {
    const allocation = allocationsOf(roles.logQuantity, { approved: true })[0];
    if (!allocation) throw new Error(`progress: ${roles.logQuantity} has no approved allocation after the approvals`);
    pendingTarget = { code: roles.logQuantity, activityId: activities[roles.logQuantity], boqItemId: allocation.boqItemId, allocationId: allocation.id, step: qty(Number(allocation.quantity) * 0.01) };
  }

  const logs = [];
  for (const [index, day] of logDays.entries()) {
    const last = index === logDays.length - 1; // the newest day stays open
    const outcome = last ? 'open' : index === logDays.length - 2 ? 'submitted' : 'approved';
    const made = { day, outcome };

    // Manpower and equipment: typed, or (second day) copied from the day before.
    const copied =
      index === 1
        ? await tolerate(ctx, `daily log ${day} copy previous`, () => site.POST(`${P}/daily-logs/${day}/copy-previous`, { sections: ['manpower', 'equipment'] }), ['DAILY_LOG_NOTHING_TO_COPY'])
        : null;
    if (copied) {
      absorb(copied);
      count('daily logs copied from the day before');
    } else {
      for (let i = ctx.count(1, 3); i > 0; i -= 1) {
        await entry(day, 'manpower', {
          trade: rng.pick(TRADES),
          workers: rng.int(2, 24),
          hours: rng.pick([8, 8, 9, 10]),
          ...(subcontractor && i % 2 ? { companyId: subcontractor } : { companyName: `${canary('daily_log_company')} own labour` }),
          activityId: anyActivity(),
          notes: `${canary('daily_log_manpower')} gang on site`,
        });
      }
      for (let i = ctx.count(1, 2); i > 0; i -= 1) {
        await entry(day, 'equipment', {
          name: `${rng.pick(PLANT)} ${canary('daily_log_equipment')}`,
          count: rng.int(1, 3),
          hoursOperated: rng.int(2, 9),
          hoursIdle: rng.int(0, 3),
          activityId: anyActivity(),
          notes: `${canary('daily_log_equipment')} plant return`,
        });
      }
    }
    for (let i = ctx.count(1, 2); i > 0; i -= 1) {
      const [material, unit] = rng.pick(DELIVERIES);
      await entry(day, 'deliveries', {
        description: `${material} — ${canary('daily_log_delivery')}`,
        supplierName: `${canary('daily_log_supplier')} Supply Co`,
        quantity: rng.int(4, 120),
        unit,
        poRef: `PO-${canary('daily_log_po')}`,
        receivedBy: ctx.person('site').name,
        deliveredAt: rng.pick(['07:30', '09:15', '11:40', '14:05']),
        activityId: anyActivity(),
        notes: `${canary('daily_log_delivery')} checked against the delivery note`,
      });
    }
    for (let i = index === 0 ? 1 : ctx.count(0, 2); i > 0; i -= 1) {
      await entry(day, 'visitors', {
        name: `${canary('daily_log_visitor')} visitor`,
        company: `${canary('daily_log_visitor')} Consulting`,
        purpose: `${canary('daily_log_visitor')} site walk and inspection`,
        arrivedAt: '10:00',
        leftAt: '11:30',
        notes: `${canary('daily_log_visitor')} inducted, PPE issued`,
      });
    }
    for (let i = index === 0 ? 1 : ctx.count(0, 1); i > 0; i -= 1) {
      const log = await entry(day, 'delays', {
        type: index === 0 ? 'weather' : rng.pick(DELAY_TYPES),
        description: `${canary('daily_log_delay')} work stopped`,
        hoursLost: rng.pick([1, 2, 4]),
        activityId: anyActivity(),
        notes: `${canary('daily_log_delay')} crew stood down`,
      });
      if (index === 0) made.delayId = log.entryId;
    }
    for (let i = ctx.count(1, 2); i > 0; i -= 1) {
      await entry(day, 'notes', { kind: rng.pick(NOTE_KINDS), text: `${canary('daily_log_note')} site note for the day`, activityId: anyActivity() });
    }
    // The quality engineer writes in the same log.
    await entry(day, 'notes', { kind: 'inspection', text: `${canary('daily_log_note')} inspection walk, no defects raised` }, quality);
    made.quantityRow = await quantityRow(day, quantity, 1 + (index % 3), 'installed today');
    if (pendingTarget && index <= 1) made.pendingRow = await quantityRow(day, pendingTarget, 1, index === 1 ? 'to be returned by the site team' : 'installed today');

    if (index === 0) {
      // An entry edited, an entry removed, a delay put on the weather register.
      const draft = await entry(day, 'notes', { kind: 'general', text: `${canary('daily_log_note')} first wording` });
      absorb(await site.PATCH(`${P}/daily-logs/${day}/entries/notes/${draft.entryId}`, { text: `${canary('daily_log_note')} corrected wording`, kind: 'instruction' }));
      const extra = await site.POST(`${P}/daily-logs/${day}/entries/visitors`, { name: `${canary('daily_log_visitor')} entered by mistake` });
      skip.add(extra.entryId);
      await site.DELETE(`${P}/daily-logs/${day}/entries/visitors/${extra.entryId}`);
      const registered = await site.POST(`${P}/daily-logs/${day}/entries/delays/${made.delayId}/weather-delay`, {
        delayDays: 0.5,
        contractual: true,
        description: `${canary('weather_delay')} rain stopped the pour`,
      });
      if (!registered?.weatherDelay?.id) throw new Error(`progress: the weather delay of ${day} came back without an id`);
      recordOnce('weather_delay', registered.weatherDelay.id);
    }
    if (last) {
      // On the open day: a note still in draft and a delay the site team rejected.
      await entry(day, 'notes', { kind: 'issue', text: `${canary('daily_log_note')} draft, not yet confirmed`, status: 'draft' });
      const disputed = await entry(day, 'delays', { type: 'access', description: `${canary('daily_log_delay')} gate blocked`, hoursLost: 1 });
      absorb(await pm.POST(`${P}/daily-logs/${day}/entries/delays/${disputed.entryId}/review`, { decision: 'reject', reason: `${canary('daily_log_review')} not a delay to the works` }));
    }
    absorb(
      await site.PATCH(`${P}/daily-logs/${day}`, {
        summary: `${canary('daily_log')} summary of the day (${outcome})`,
        weather: { condition: rng.pick(WEATHER), tempMinC: rng.int(8, 22), tempMaxC: rng.int(23, 41), precipitationMm: rng.int(0, 12), windMaxKph: rng.int(5, 45), notes: `${canary('daily_log_weather')} read at 07:00` },
      })
    );

    if (outcome !== 'open') {
      absorb(await site.POST(`${P}/daily-logs/${day}/submit`));
      if (made.pendingRow && index === 1) {
        // Returned on a submitted day: the pending entry it minted goes with it.
        absorb(await pm.POST(`${P}/daily-logs/${day}/entries/quantities/${made.pendingRow}/review`, { decision: 'reject', reason: `${canary('daily_log_review')} measured twice` }));
        count('daily log quantity rows returned');
      }
    }
    if (outcome === 'approved') {
      absorb(await pm.POST(`${P}/daily-logs/${day}/approve`));
      if (index === 0) {
        // Reopened, corrected and closed again.
        absorb(await pm.POST(`${P}/daily-logs/${day}/reopen`, { reason: `${canary('daily_log_reopen')} a delivery was missed` }));
        await entry(day, 'deliveries', { description: `Sand, late delivery — ${canary('daily_log_delivery')}`, quantity: 12, unit: 'm3', deliveredAt: '16:20', activityId: anyActivity() });
        absorb(await site.POST(`${P}/daily-logs/${day}/submit`));
        absorb(await pm.POST(`${P}/daily-logs/${day}/approve`));
        count('daily logs reopened and closed again');
      }
    }
    count(`daily logs ${outcome}`);
    logs.push(made);
  }

  // One approved day sent out (a stored PDF and a notice to the PM — no outside address), and read back as a PDF.
  const approvedDay = logs.find((log) => log.outcome === 'approved')?.day;
  if (approvedDay) {
    const sent = await site.POST(`${P}/daily-logs/${approvedDay}/distribute`, { roles: ['pm'], userIds: [], emails: [], note: `${canary('daily_log_distribution')} for the record` });
    if (!sent?.document?.id) throw new Error(`progress: the distribution of ${approvedDay} stored no document`);
    recordOnce('project_document', sent.document.id);
    const pdf = await planner.download(`${P}/daily-logs/${approvedDay}/export.pdf`);
    if (pdf.subarray(0, 4).toString() !== '%PDF') ctx.note(`FINDING: GET daily-logs/${approvedDay}/export.pdf answered 200 but not a PDF (starts ${JSON.stringify(pdf.subarray(0, 8).toString())})`);
    await planner.GET(`${P}/daily-logs/manpower-report?from=${logDays[0]}&to=${logDays[logDays.length - 1]}&groupBy=trade`);
  }

  // What the submitted days minted: one pending quantity entry per row that counts.
  const minted = listOf(await site.GET(`${P}/quantity-progress?source=daily_log`), 'entries');
  for (const row of minted) {
    if (!myLogs.has(row.dailyLogId)) continue;
    if (recordOnce('quantity_progress_entry', row.id)) count('quantity entries minted by daily logs');
  }

  // ── 6. progress claims ───────────────────────────────────────────────────
  const claim = async (code, body, who = site) => {
    const answer = await who.POST(`${P}/activities/${activities[code]}/progress`, body);
    if (!answer?.submission?.id) throw new Error(`progress: the claim on ${code} came back without a submission id`);
    recordOnce('progress_submission', answer.submission.id);
    return answer.submission;
  };
  const settle = async (code, submission, outcome, who = pm) => {
    const base = `${P}/activities/${activities[code]}/progress-submissions/${submission.id}`;
    if (outcome === 'approved') {
      // An open ITP hold point on the activity (the quality driver's) holds an approval; nothing else may.
      const done = await tolerate(ctx, `progress ${code} approve`, () => who.POST(`${base}/approve`), ['ITP_HOLD_POINT_OPEN']);
      if (!done) {
        count('claim approvals held by an ITP hold point');
        return null;
      }
      if (done.approvedProgressId) recordOnce('activity_progress', done.approvedProgressId);
      madeOfficial(code, done.pctComplete);
      count('claims approved');
      return done;
    }
    if (outcome === 'rejected') {
      const done = await who.POST(`${base}/reject`, { reason: `${canary('progress_rejection')} not as measured on site` });
      count('claims rejected');
      return done;
    }
    count(outcome === 'draft' ? 'claims in draft' : 'claims waiting');
    return submission;
  };
  const approvers = [pm, planner, qs];

  // Percentages: several claims over the percent activities, each ending
  // differently, each proposing more than the activity's official figure.
  const claims = ctx.count(5, 9);
  for (let k = 0; k < claims; k += 1) {
    const code = roles.percent[k % roles.percent.length];
    const outcome = CLAIM_OUTCOMES[k % CLAIM_OUTCOMES.length];
    const submission = await claim(code, {
      pctComplete: propose(code, rng.int(4, 9)),
      progressMethod: 'percent',
      status: outcome === 'draft' ? 'draft' : 'submitted',
      source: k % 4 === 3 ? 'mobile' : 'manual',
      actualStart: `${ctx.daysAgo(30 + k)}T00:00:00.000Z`,
      // An estimate stored on the submission (and the official row when approved); it is not actual cost and posts nothing.
      ...(k === 0 ? { actualCost: 1500 + 250 * runNo } : {}),
      ...(code === evidenceCode || k % 3 === 0 ? { evidence: evidence() } : {}),
      notes: `${canary('progress_submission')} percent claim`,
    });
    await settle(code, submission, outcome, approvers[k % approvers.length]);
  }

  // Milestones: each run reaches one milestone further (m1, then m2, then m3),
  // approved; the next one half done is left waiting.
  const stage = Math.min(runNo, milestones.length);
  const reached = milestones.slice(0, stage).map((row) => ({ id: row.id, complete: true }));
  const first = await claim(roles.milestone, { milestones: reached, notes: `${canary('progress_submission')} milestone ${stage} reached` });
  await settle(roles.milestone, first, 'approved');
  if (stage < milestones.length) {
    const second = await claim(roles.milestone, {
      milestones: [...reached, { id: milestones[stage].id, pctComplete: 50 }],
      notes: `${canary('progress_submission')} milestone ${stage + 1} half done`,
    });
    await settle(roles.milestone, second, 'submitted');
  }
  if (roles.inspection) {
    const passed = await claim(roles.inspection, { inspectionStatus: 'passed', pctComplete: propose(roles.inspection, 20), evidence: evidence(), notes: `${canary('progress_submission')} inspection passed` });
    await settle(roles.inspection, passed, 'approved', planner);
    const failed = await claim(roles.inspection, { inspectionStatus: 'failed', pctComplete: propose(roles.inspection, 20), notes: `${canary('progress_submission')} inspection failed` });
    await settle(roles.inspection, failed, 'rejected', qs);
  }
  if (roles.manual) {
    const assessed = await claim(roles.manual, { pctComplete: propose(roles.manual, 15), notes: `${canary('progress_submission')} manual assessment` });
    await settle(roles.manual, assessed, 'submitted');
  }

  // A bulk claim (all or nothing), left waiting.
  const bulkCodes = [...new Set([roles.percent[0], roles.percent[roles.percent.length - 1]])];
  const bulk = await site.POST(`${P}/activities/bulk-progress`, {
    updates: bulkCodes.map((code) => ({
      activityId: activities[code],
      pctComplete: propose(code, 6),
      progressMethod: 'percent',
      status: 'submitted',
      evidence: evidence(),
      notes: `${canary('progress_submission')} weekly bulk update`,
    })),
  });
  const bulkRows = bulk?.submissions || [];
  if (bulkRows.length !== bulkCodes.length) throw new Error(`progress: the bulk claim made ${bulkRows.length} submissions for ${bulkCodes.length} activities`);
  for (const submission of bulkRows) {
    recordOnce('progress_submission', submission.id);
    count('claims waiting');
  }

  // ── 7. quantity entries and the bundles that make them official ──────────
  let manualEntries = 0;
  const recordEntry = (row) => {
    if (!row?.id) throw new Error('progress: a quantity entry came back without an id');
    if (recordOnce('quantity_progress_entry', row.id)) manualEntries += 1;
    return row;
  };
  const base = { activityId: quantity.activityId, boqItemId: quantity.boqItemId };
  const earlier = logDays[0];
  recordEntry(
    (await site.POST(`${P}/quantity-progress`, { ...base, allocationId: quantity.allocationId, quantity: quantity.step, date: ctx.today, status: 'draft', note: `${canary('quantity_progress_entry')} draft, not yet submitted` })).entry
  );
  count('quantity entries draft');
  const batch = await site.POST(`${P}/quantity-progress`, {
    status: 'submitted',
    entries: [
      { ...base, quantity: qty(quantity.step * 2), date: shiftDay(earlier, -3), note: `${canary('quantity_progress_entry')} to be approved` },
      { ...base, quantity: qty(quantity.step * 3), date: shiftDay(earlier, -2), unitCode: quantity.unit, note: `${canary('quantity_progress_entry')} to be rejected` },
      { ...base, quantity: quantity.step, date: ctx.today, note: `${canary('quantity_progress_entry')} submitted, in no bundle` },
    ],
  });
  if ((batch?.entries || []).length !== 3) throw new Error(`progress: the batch of three quantity entries made ${(batch?.entries || []).length}`);
  const [toApprove, toReject] = batch.entries.map(recordEntry);
  count('quantity entries submitted', 3);
  // Recorded as a draft, submitted on its own, then corrected.
  const late = recordEntry((await site.POST(`${P}/quantity-progress`, { ...base, quantity: quantity.step, date: ctx.today, note: `${canary('quantity_progress_entry')} first figure` })).entry);
  await site.POST(`${P}/quantity-progress/${late.id}/submit`);
  await site.PATCH(`${P}/quantity-progress/${late.id}`, { quantity: qty(quantity.step * 1.5), note: `${canary('quantity_progress_entry')} corrected figure` });
  // Recorded by mistake and removed.
  const mistake = (await site.POST(`${P}/quantity-progress`, { ...base, quantity: quantity.step, date: ctx.today, note: `${canary('quantity_progress_entry')} recorded by mistake` })).entry;
  await site.DELETE(`${P}/quantity-progress/${mistake.id}`);

  const approvedBundle = await claim(quantity.code, { entryIds: [toApprove.id], notes: `${canary('progress_submission')} quantity bundle` });
  await settle(quantity.code, approvedBundle, 'approved');
  const rejectedBundle = await claim(quantity.code, { entryIds: [toReject.id], notes: `${canary('progress_submission')} quantity bundle, disputed` });
  await settle(quantity.code, rejectedBundle, 'rejected');
  // Everything the submitted daily logs minted on this activity, made official in one bundle.
  const through = logs.filter((log) => log.outcome !== 'open').map((log) => log.day).sort().pop();
  const fromLogs = await claim(quantity.code, { bundleSubmittedThrough: through, source: 'manual', notes: `${canary('progress_submission')} quantities from the daily logs` });
  await settle(quantity.code, fromLogs, 'approved', qs);
  const waitingBundle = await claim(quantity.code, { entryIds: [late.id], notes: `${canary('progress_submission')} quantity bundle, waiting` });
  await settle(quantity.code, waitingBundle, 'submitted');

  // The older shape: a typed quantity on an activity with no entries yet. Its
  // approval mints one entry; after that the product wants entries, so every
  // later run is refused here (409 QUANTITY_ENTRIES_REQUIRED) and says so.
  if (roles.typedQuantity) {
    const allocation = allocationsOf(roles.typedQuantity, { approved: true })[0];
    if (!allocation) throw new Error(`progress: ${roles.typedQuantity} has no approved allocation after the approvals`);
    await setMethod(roles.typedQuantity, { method: 'quantity', quantityUnit: unitOf(allocation), notes: `${canary('progress_method')} typed quantity` });
    const typed = await tolerate(
      ctx,
      `typed quantity ${roles.typedQuantity}`,
      () => claim(roles.typedQuantity, { quantityComplete: qty(Number(allocation.quantity) * 0.1), quantityUnit: unitOf(allocation), notes: `${canary('progress_submission')} typed quantity` }),
      ['QUANTITY_ENTRIES_REQUIRED']
    );
    if (typed) {
      const done = await settle(roles.typedQuantity, typed, 'approved');
      const mintedId = done?.quantity?.mintedEntry?.id;
      if (mintedId) recordOnce('quantity_progress_entry', mintedId);
      else if (done) ctx.note(`typed quantity ${roles.typedQuantity}: approved, no entry minted (${JSON.stringify(done?.quantity?.mintSkipped || null).slice(0, 160)})`);
    }
  }

  // ── 8. labour: workers, a crew, timesheets ───────────────────────────────
  const roster = listOf(await site.GET(`${P}/timesheets/workers?q=${encodeURIComponent(`${ctx.project.key}-W`)}`));
  const workers = [];
  const wantedWorkers = ctx.count(2, 5);
  for (let i = 0; i < wantedWorkers; i += 1) {
    const employeeNumber = `${ctx.project.key}-W${i + 1}`;
    let worker = roster.find((row) => row.employeeNumber === employeeNumber);
    const name = `${canary('worker')} ${rng.pick(TRADES)}`;
    const rate = rng.int(18, 60);
    if (!worker) {
      worker = await site.POST(`${P}/timesheets/workers`, {
        name,
        employeeNumber,
        trade: rng.pick(TRADES),
        classification: i % 2 ? 'skilled' : 'semi-skilled',
        hourlyRate: rate,
        overtimeMultiplier: 1.5,
        ...(subcontractor && i % 3 === 2 ? { companyId: subcontractor } : {}),
        status: 'active',
        notes: `${canary('worker')} engaged for ${ctx.project.key}`,
      });
      recordOnce('worker', worker.id, { scope: 'company' });
      count('workers');
    }
    workers.push(worker);
  }
  // One who has left: on the roster, inactive, on no timesheet.
  const leaverNumber = `${ctx.project.key}-W0`;
  if (!roster.some((row) => row.employeeNumber === leaverNumber)) {
    const leaver = await site.POST(`${P}/timesheets/workers`, { name: `${canary('worker')} left the site`, employeeNumber: leaverNumber, trade: 'General labourer', hourlyRate: 20, status: 'inactive', notes: `${canary('worker')} demobilised` });
    recordOnce('worker', leaver.id, { scope: 'company' });
    count('workers');
  }
  // The cost controller reviews one rate, once (not again on every run).
  if (!state.rateReviewed) {
    await cost.PATCH(`${P}/timesheets/workers/${workers[0].id}`, { hourlyRate: Number(workers[0].hourlyRate || 30) + 1, notes: `${canary('worker')} rate reviewed` });
    state.rateReviewed = true;
  }

  const crews = listOf(await site.GET(`${P}/timesheets/crews`));
  let crew = crews.find((row) => row.id === state.crewId) || crews.find((row) => state.crewName && row.name === state.crewName) || null;
  if (!crew) {
    const crewName = `${canary('crew')} gang`;
    crew = await site.POST(`${P}/timesheets/crews`, {
      name: crewName,
      workerIds: workers.map((worker) => worker.id),
      defaultActivityId: activities[roles.percent[0]],
      ...(labourCode ? { defaultCostCodeId: labourCode } : {}),
      foremanUserId: ctx.userId('site'),
      status: 'active',
    });
    recordOnce('crew', crew.id);
    count('crews');
  }
  state.crewId = crew.id;
  state.crewName = crew.name;

  const sheetsBefore = listOf(await site.GET(`${P}/timesheets`));
  const takenSheetDays = new Set(sheetsBefore.map((row) => dayOf(row.date)));
  const sheetDays = [];
  const wantedSheets = ctx.count(4, 7);
  for (let back = 1; back <= 300 && sheetDays.length < wantedSheets; back += 1) {
    const day = ctx.daysAgo(back);
    if (!takenSheetDays.has(day)) sheetDays.push(day);
  }
  if (sheetDays.length < 4) throw new Error('progress: fewer than four free days in the last 300 for timesheets');
  const sheetEntries = (hours = 8) =>
    workers.slice(0, Math.max(1, Math.min(workers.length, 3))).flatMap((worker, i) => [
      { workerId: worker.id, activityId: activities[roles.percent[i % roles.percent.length]], costCodeId: i % 2 ? prelimCode : labourCode, timeType: 'regular', hours, startTime: '07:00', endTime: '15:00', notes: `${canary('time_entry')} day work` },
      ...(i === 0 ? [{ workerId: worker.id, activityId: activities[roles.milestone], costCodeId: labourCode, timeType: 'overtime', hours: 2, startTime: '15:00', endTime: '17:00', notes: `${canary('time_entry')} overtime to finish the pour` }] : []),
      ...(i === 1 ? [{ workerId: worker.id, activityId: activities[roles.milestone], costCodeId: labourCode, timeType: 'double', hours: 1, notes: `${canary('time_entry')} rest-day hour` }] : []),
    ]);
  // Labour this run leaves posted: every approval's cost, less what a reopen reversed.
  let labourPosted = 0;
  for (const [index, day] of sheetDays.entries()) {
    const outcome = SHEET_OUTCOMES[index % SHEET_OUTCOMES.length];
    const sheetBase = `${P}/timesheets`;
    // The first sheet is the crew's: no entries sent, the members are filled in
    // on the crew's defaults (the product writes those entries; they carry no text).
    let sheet = await site.POST(sheetBase, {
      date: day,
      notes: `${canary('timesheet')} ${index === 0 ? 'crew day' : 'labour return'} (${outcome})`,
      ...(index === 0 ? { crewId: crew.id, defaultHours: 8 } : { entries: sheetEntries(index % 2 ? 9 : 8) }),
    });
    recordOnce('timesheet', sheet.id);
    if (outcome === 'draft') {
      // Edited while still a draft: the entries are replaced.
      sheet = await site.PATCH(`${sheetBase}/${sheet.id}`, { notes: `${canary('timesheet')} draft, hours to be confirmed`, entries: sheetEntries(6) });
    } else {
      await site.POST(`${sheetBase}/${sheet.id}/submit`);
      if (outcome === 'rejected') await cost.POST(`${sheetBase}/${sheet.id}/reject`, { reason: `${canary('timesheet_rejection')} hours do not match the gate log` });
      if (outcome === 'approved' || outcome === 'reopened') {
        const approved = await cost.POST(`${sheetBase}/${sheet.id}/approve`);
        labourPosted += Number(approved.totalCost || 0);
        if (outcome === 'reopened') {
          await pm.POST(`${sheetBase}/${sheet.id}/reopen`, { reason: `${canary('timesheet_reopen')} wrong activity` });
          labourPosted -= Number(approved.totalCost || 0);
        }
      }
      sheet = await site.GET(`${sheetBase}/${sheet.id}`);
    }
    for (const row of sheet.entries || []) recordOnce('time_entry', row.id);
    count(`timesheets ${sheet.status}${outcome === 'reopened' ? ' (reopened)' : ''}`);
  }
  await cost.GET(`${P}/timesheets/week?weekStart=${mondayOf(sheetDays[0])}`);

  // ── 9. weekly reports ────────────────────────────────────────────────────
  const thisWeek = mondayOf(ctx.today);
  const completed = roles.percent.slice(0, 1).map((code) => activities[code]);
  const inProgress = [roles.milestone, roles.quantity, ...roles.percent.slice(1)].filter(Boolean).map((code) => activities[code]);
  const weeks = ctx.count(3, 4);
  for (let i = 0; i < weeks; i += 1) {
    const start = shiftDay(thisWeek, -7 * (i + 1 + (runNo - 1) * 4));
    const outcome = WEEK_OUTCOMES[i % WEEK_OUTCOMES.length];
    const report = await site.POST(`${P}/weekly-reports`, {
      weekStartDate: start,
      weekEndDate: shiftDay(start, 6),
      preparedBy: ctx.person('site').name,
      weatherCondition: `${rng.pick(WEATHER)} — ${canary('weekly_report')}`,
      weatherDelayDays: rng.int(0, 2),
      plannedProgress: rng.int(5, 40),
      actualProgress: rng.int(3, 38),
      manpowerCount: rng.int(12, 140),
      activitiesCompleted: completed,
      activitiesInProgress: inProgress,
      issuesSummary: `${canary('weekly_report')} issues of the week`,
      nextWeekPlan: `${canary('weekly_report')} plan for next week`,
      remarks: `${canary('weekly_report')} remarks`,
      status: outcome === 'draft' ? 'draft' : 'submitted',
    });
    recordOnce('weekly_report', report.id);
    if (outcome === 'approved') await pm.PATCH(`${P}/weekly-reports/${report.id}`, { status: 'approved', remarks: `${canary('weekly_report')} accepted by the PM` });
    count(`weekly reports ${outcome}`);
  }
  // This week's report is made by reading it; the site engineer then writes in it.
  const current = await site.GET(`${P}/weekly-reports/current`);
  if (!current?.id) throw new Error('progress: the weekly report of this week came back without an id');
  if (recordOnce('weekly_report', current.id)) {
    await site.PATCH(`${P}/weekly-reports/${current.id}`, { remarks: `${canary('weekly_report')} this week, in progress`, issuesSummary: `${canary('weekly_report')} nothing to report yet` });
    count('weekly reports of this week');
  }
  state.currentWeekly = current.id;

  // ── 10. the older site records, still mounted ────────────────────────────
  const legacyDays = sheetDays;
  const myReports = new Set();
  const reports = ctx.count(3, 4);
  for (let i = 0; i < reports; i += 1) {
    const outcome = REPORT_OUTCOMES[i % REPORT_OUTCOMES.length];
    const code = roles.percent[i % roles.percent.length];
    // The first report carries a progress claim; approving the report approves it.
    const reportPct = i === 0 ? propose(code, 5) : null;
    const report = await site.POST(`${P}/daily-reports`, {
      activityId: activities[code],
      date: legacyDays[i % legacyDays.length],
      shift: i % 2 ? 'night' : 'day',
      weather: { summary: `${canary('daily_report')} fair`, condition: rng.pick(WEATHER), temperatureC: rng.int(15, 38), rainfallMm: 0, delayImpact: false },
      manpower: [{ trade: rng.pick(TRADES), workers: rng.int(3, 15), hours: 8 }],
      materials: [{ name: `${canary('daily_report')} cement`, qty: rng.int(5, 50), unit: 'bag' }],
      equipment: [{ name: `${canary('daily_report')} ${rng.pick(PLANT)}`, hours: rng.int(2, 8) }],
      issues: [{ title: `${canary('daily_report')} issue`, description: `${canary('daily_report')} access to the work face`, severity: 'low', status: 'open' }],
      photos: [{ key: photo.key, filename: photo.filename, caption: `${canary('daily_report')} progress photo` }],
      notes: `${canary('daily_report')} activity report (${outcome})`,
      status: outcome === 'draft' ? 'draft' : 'submitted',
      ...(i === 0 ? { progress: { method: 'percent', pctComplete: reportPct, evidence: evidence(), notes: `${canary('progress_submission')} claimed in the daily report` } } : {}),
    });
    if (!report?.id) throw new Error('progress: a daily report came back without an id');
    recordOnce('daily_report', report.id);
    myReports.add(report.id);
    for (const submission of report.progressSubmissions || []) if (submission?.id) recordOnce('progress_submission', submission.id);
    if (outcome === 'approved') {
      // Approving the report approves its claim, so an open ITP hold point holds it too.
      const done = await tolerate(ctx, `daily report ${report.id} approve`, () => pm.POST(`${P}/daily-reports/${report.id}/approve`), ['ITP_HOLD_POINT_OPEN']);
      if (!done) {
        count('daily report approvals held by an ITP hold point');
        continue;
      }
      if (reportPct !== null) madeOfficial(code, reportPct);
    }
    if (outcome === 'rejected') await pm.POST(`${P}/daily-reports/${report.id}/reject`, { reason: `${canary('daily_report')} manpower not as counted` });
    count(`daily reports ${outcome}`);
  }
  const diaries = ctx.count(3, 4);
  for (let i = 0; i < diaries; i += 1) {
    const outcome = REPORT_OUTCOMES[i % REPORT_OUTCOMES.length];
    const diary = await site.POST(`${P}/site-diaries`, {
      date: legacyDays[i % legacyDays.length],
      shift: 'day',
      weather: `${rng.pick(WEATHER)} — ${canary('site_diary')}`,
      weatherDetails: { summary: `${canary('site_diary')} dry`, temperatureC: rng.int(15, 38), delayImpact: false },
      workers: rng.int(10, 120),
      visitors: `${canary('site_diary')} client representative`,
      workDone: `${canary('site_diary')} work done today`,
      issues: `${canary('site_diary')} no stoppage`,
      instructions: `${canary('site_diary')} instruction received on site`,
      manpower: [{ trade: rng.pick(TRADES), workers: rng.int(3, 15), hours: 8 }],
      notes: `${canary('site_diary')} diary (${outcome})`,
      status: outcome === 'draft' ? 'draft' : 'submitted',
    });
    if (!diary?.id) throw new Error('progress: a site diary came back without an id');
    recordOnce('site_diary', diary.id);
    if (outcome === 'approved') await pm.POST(`${P}/site-diaries/${diary.id}/approve`);
    if (outcome === 'rejected') await pm.POST(`${P}/site-diaries/${diary.id}/reject`, { reason: `${canary('site_diary')} incomplete` });
    count(`site diaries ${outcome}`);
  }

  // ── 11. what the approvals wrote, read back ──────────────────────────────
  // Every official progress row of the activities used here that one of this
  // driver's submissions produced (a percent, milestone, inspection or manual
  // approval answers no row id; a daily report's approval writes one too).
  const mySubmissions = new Set(ctx.records.progress_submission || []);
  for (const code of used) {
    const detail = await pm.GET(`${P}/activities/${activities[code]}/detail`);
    const history = detail?.sections?.progress?.approvedHistory;
    if (!history) throw new Error(`progress: the detail of ${code} carried no approved progress history`);
    for (const row of history.items || []) {
      if (mySubmissions.has(row.submissionId) && recordOnce('activity_progress', row.id)) count('official progress rows recorded');
    }
    if (Number(history.total || 0) > (history.items || []).length) ctx.note(`activity ${code}: ${history.total} official progress rows, the detail lists ${(history.items || []).length}; the rest are not recorded`);
  }
  // The equipment usage a daily report's approval posts (no rate here, so cost 0).
  const usage = await cost.GET(`${P}/equipment/usage?from=${[...legacyDays].sort()[0]}&to=${[...legacyDays].sort().pop()}`);
  for (const row of usage?.recentUsage || []) {
    if (myReports.has(row.dailyReportId) && recordOnce('activity_equipment_usage', row.id)) count('equipment usage rows recorded');
  }

  // ── 12. what it all adds up to (an observation, at today's cutoff) ───────
  const ev = await cost.GET(`${P}/reports/ev?cutoffDate=${ctx.today}`);
  ctx.note(
    `EV report at cutoff ${ev?.reporting?.cutoffLocalDate || ctx.today} after run ${runNo}: EV ${ev?.ev}, AC ${ev?.ac}, PV ${ev?.pv}, SPI ${ev?.spi}, CPI ${ev?.cpi}; labour this run left posted (approved less reopened) ${round2(labourPosted)}`
  );
  ctx.note(`progress run ${runNo}: ${Object.entries(tally).map(([key, n]) => `${key} ${n}`).join('; ')}`);
  if (!tally['claims approved']) throw new Error('progress: no progress claim could be approved (see the notes)');
  if (!manualEntries) throw new Error('progress: no quantity progress entry was recorded on the quantity activity');
  if (!tally['quantity entries minted by daily logs']) throw new Error('progress: the submitted daily logs minted no quantity entry');
};

module.exports = { name: 'progress', needs: ['foundation'], depths: ['standard'], run };
