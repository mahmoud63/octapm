'use strict';

/**
 * Site progress: what the site writes down each day, and what the project
 * team makes official from it.
 *
 *   - daily logs on several past days, every section (manpower, equipment,
 *     deliveries, visitors, delays, notes, quantities), left open, submitted
 *     and approved; one copied from the day before, one reopened, one
 *     distributed, a delay put on the weather register;
 *   - the BOQ allocations of the activities used here, submitted and approved
 *     (a quantity is recorded against an approved allocation only);
 *   - a progress method per activity: quantity, weighted milestone, percent
 *     (one that demands evidence), inspection, manual, and some left on the
 *     default;
 *   - quantity progress entries: draft, submitted, bundled, approved, rejected,
 *     and the ones a submitted daily log mints;
 *   - progress claims by the site engineer, approved, rejected or left waiting
 *     by the PM, the planner and the QS — percentages, milestone states,
 *     quantity bundles, a typed quantity, a bulk claim;
 *   - labour: workers (company-wide), a crew, timesheets on activities and
 *     cost codes — draft, submitted, returned, approved (which posts labour
 *     actual cost) and reopened (which reverses it);
 *   - weekly reports, and the older daily reports and site diaries that are
 *     still mounted.
 *
 * At the end the earned-value report is read back and its EV and AC noted.
 *
 * Re-runnable: a run takes days no log or timesheet stands on yet, finds its
 * workers and crew by number and name, and keeps the activity each method was
 * given in `ctx.refs.progress` (a method is locked once progress is approved
 * under it).
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
const unitOf = (allocation) => allocation.unitCode || allocation.boqItem?.unitCode || allocation.boqItem?.unit || null;

/**
 * A person's session that asks once more when the API answers 5xx. Under a
 * loaded database a transaction can run out of time (500 P2028) and is rolled
 * back; the second ask then succeeds. Every 5xx is still written to the notes
 * ("5xx, asked again"), because a 5xx is a finding whether or not the retry
 * got through.
 */
const steady = (ctx, session) => {
  const again = (method) => async (...args) => {
    try {
      return await session[method](...args);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status < 500) throw error;
      ctx.note(`5xx, asked again: ${error.message}`.slice(0, 320));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return session[method](...args);
    }
  };
  return { ...session, GET: again('GET'), POST: again('POST'), PATCH: again('PATCH'), PUT: again('PUT'), DELETE: again('DELETE'), upload: again('upload'), download: again('download') };
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
  state.runs = (state.runs || 0) + 1;
  state.methods = state.methods || {};
  const runNo = state.runs;

  const activities = ctx.refs.activities || {};
  const codes = Object.keys(activities).sort();
  if (codes.length < 2) throw new Error('progress: the project has fewer than two activities to record progress on');
  const codeOf = Object.fromEntries(Object.entries(activities).map(([code, id]) => [id, code]));
  const anyActivity = () => activities[rng.pick(codes)];
  const costCodes = ctx.companyRefs.costCodes || {};
  const labourCode = costCodes['01-100'] || Object.values(costCodes)[0] || null;
  const prelimCode = costCodes['09-100'] || labourCode;
  const subcontractor = ctx.companyRefs.directory?.subcontractor || null;
  const tally = {};
  const count = (key) => {
    tally[key] = (tally[key] || 0) + 1;
  };

  // ── 1. which activity is measured how (decided once, kept) ───────────────
  const readAllocations = async () =>
    listOf(await planner.GET(`${P}/activity-boq-allocations`), 'allocations').filter((row) => row.isActive !== false && codeOf[row.activityId]);
  let allocations = await readAllocations();
  const allocationsOf = (code, { approved = false } = {}) =>
    allocations.filter((row) => codeOf[row.activityId] === code && (approved ? row.status === 'approved' : row.status !== 'rejected'));

  if (!state.roles) {
    const mapped = codes.filter((code) => allocationsOf(code).length);
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
    roles.milestone = take(mapped) || take(codes);
    roles.logQuantity = take(mapped);
    roles.typedQuantity = codes.length >= 7 ? take(mapped, oneItem) : null;
    // Mapped activities first: approved progress on them is what earns value.
    const rest = [...mapped, ...codes].filter((code, index, all) => all.indexOf(code) === index);
    roles.percent = [take(rest), take(rest)].filter(Boolean);
    roles.inspection = codes.length >= 8 ? take(rest) : null;
    roles.manual = codes.length >= 10 ? take(rest) : null;
    const wanted = ctx.count(2, 6);
    while (roles.percent.length < wanted) {
      const code = take(rest);
      if (!code) break;
      roles.percent.push(code);
    }
    if (roles.quantity) {
      const biggest = [...allocationsOf(roles.quantity)].sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
      roles.quantityItem = biggest.boqItemId;
    }
    state.roles = roles;
  }
  const roles = state.roles;
  if (!roles.percent.length) throw new Error('progress: no activity is left to claim a percentage on');

  // ── 2. approve the allocations these activities are measured against ─────
  const used = new Set([roles.quantity, roles.milestone, roles.logQuantity, roles.typedQuantity, roles.inspection, roles.manual, ...roles.percent].filter(Boolean));
  for (const row of allocations) {
    if (!used.has(codeOf[row.activityId]) || !['draft', 'submitted'].includes(row.status)) continue;
    if (row.status === 'draft') {
      const submitted = await ctx.attempt(`allocation ${row.id} submit`, () => planner.POST(`${P}/activity-boq-allocations/${row.id}/submit`));
      if (!submitted) continue;
    }
    if (await ctx.attempt(`allocation ${row.id} approve`, () => qs.POST(`${P}/activity-boq-allocations/${row.id}/approve`))) count('allocations approved');
  }
  allocations = await readAllocations();

  // ── 3. the progress methods ──────────────────────────────────────────────
  const setMethod = async (code, body) => {
    const row = await ctx.attempt(`progress method ${code}`, () => planner.PUT(`${P}/activities/${activities[code]}/progress-method`, body));
    if (row?.id && !state.methods[code]) {
      state.methods[code] = row.id;
      ctx.record('activity_progress_method', row.id);
    }
    return row;
  };

  // The quantity activity: one BOQ item, in that item's unit. When its
  // approved allocations are in more than one unit the planned quantity is
  // typed on the method (nothing is summed across units).
  let quantity = null;
  if (roles.quantity) {
    const approved = allocationsOf(roles.quantity, { approved: true });
    const allocation = approved.find((row) => row.boqItemId === roles.quantityItem) || null;
    if (!allocation) {
      ctx.note(`quantity progress skipped: ${roles.quantity} has no approved allocation of its BOQ item`);
    } else {
      const unit = unitOf(allocation);
      const mixed = new Set(approved.map(unitOf)).size > 1;
      const method = await setMethod(roles.quantity, {
        method: 'quantity',
        quantityUnit: unit,
        ...(mixed ? { plannedQuantity: Number(allocation.quantity) } : {}),
        notes: `${ctx.canary('progress_method')} measured by installed quantity`,
      });
      if (method) quantity = { code: roles.quantity, activityId: activities[roles.quantity], boqItemId: allocation.boqItemId, allocationId: allocation.id, unit, step: qty(Number(allocation.quantity) * 0.01) };
    }
  }
  const milestones = [
    { id: 'm1', name: `${ctx.canary('progress_milestone')} set out and prepared`, weight: 20 },
    { id: 'm2', name: `${ctx.canary('progress_milestone')} main works done`, weight: 50 },
    { id: 'm3', name: `${ctx.canary('progress_milestone')} inspected and handed over`, weight: 30 },
  ];
  const milestoneMethod = await setMethod(roles.milestone, { method: 'weighted_milestone', milestoneWeights: milestones, notes: `${ctx.canary('progress_method')} three weighted milestones` });
  await setMethod(roles.percent[0], { method: 'percent', notes: `${ctx.canary('progress_method')} physical percent complete` });
  const evidenceCode = roles.percent.length > 1 ? roles.percent[1] : null;
  const evidenceMethod = evidenceCode ? await setMethod(evidenceCode, { method: 'percent', evidenceRequired: true, notes: `${ctx.canary('progress_method')} percent, evidence required` }) : null;
  const inspectionMethod = roles.inspection ? await setMethod(roles.inspection, { method: 'inspection', inspectionRequired: true, notes: `${ctx.canary('progress_method')} released by inspection` }) : null;
  const manualMethod = roles.manual ? await setMethod(roles.manual, { method: 'manual', notes: `${ctx.canary('progress_method')} manual assessment` }) : null;

  // ── 4. a site photo, the evidence of a claim ─────────────────────────────
  const photoName = `${ctx.canary('progress_photo')}.png`;
  const uploaded = await ctx.attempt('site photo upload', () => site.upload('POST', `${P}/site-reporting/uploads`, { field: 'files', filename: photoName, contentType: 'image/png', body: PNG_1X1 }));
  const photo = listOf(uploaded, 'files')[0] || null;
  if (photo?.documentId) ctx.record('project_document', photo.documentId);
  const evidence = () => ({
    notes: `${ctx.canary('progress_evidence')} photographed on site`,
    photos: photo ? [{ key: photo.key, url: photo.url, name: photo.filename || photoName, type: 'photo' }] : [],
  });

  // ── 5. daily logs ────────────────────────────────────────────────────────
  const seen = new Set();
  const absorb = (log) => {
    if (!log?.id) return log;
    if (!seen.has(log.id)) {
      seen.add(log.id);
      ctx.record('daily_log', log.id);
    }
    for (const [section, type] of Object.entries(SECTION_TYPES)) {
      for (const row of log.sections?.[section] || []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        ctx.record(type, row.id);
      }
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
      notes: `${ctx.canary('daily_log_quantity')} ${label}`,
    });
    return log.entryId;
  };
  // The second quantities target: an activity that stays on a percentage, so
  // what its rows mint is never bundled and stays pending.
  let pendingTarget = null;
  if (roles.logQuantity) {
    const allocation = allocationsOf(roles.logQuantity, { approved: true })[0];
    if (allocation) pendingTarget = { code: roles.logQuantity, activityId: activities[roles.logQuantity], boqItemId: allocation.boqItemId, allocationId: allocation.id, step: qty(Number(allocation.quantity) * 0.01) };
  }

  const logs = [];
  for (const [index, day] of logDays.entries()) {
    const last = index === logDays.length - 1; // the newest day stays open
    const outcome = last ? 'open' : index === logDays.length - 2 ? 'submitted' : 'approved';
    const made = { day, outcome };

    // Manpower and equipment: typed, or (second day) copied from the day before.
    const copied = index === 1 ? await ctx.attempt(`daily log ${day} copy previous`, () => site.POST(`${P}/daily-logs/${day}/copy-previous`, { sections: ['manpower', 'equipment'] })) : null;
    if (copied) {
      absorb(copied);
      count('daily logs copied from the day before');
    } else {
      for (let i = ctx.count(1, 3); i > 0; i -= 1) {
        await entry(day, 'manpower', {
          trade: rng.pick(TRADES),
          workers: rng.int(2, 24),
          hours: rng.pick([8, 8, 9, 10]),
          ...(subcontractor && i % 2 ? { companyId: subcontractor } : { companyName: `${ctx.canary('daily_log_company')} own labour` }),
          activityId: anyActivity(),
          notes: `${ctx.canary('daily_log_manpower')} gang on site`,
        });
      }
      for (let i = ctx.count(1, 2); i > 0; i -= 1) {
        await entry(day, 'equipment', {
          name: `${rng.pick(PLANT)} ${ctx.canary('daily_log_equipment')}`,
          count: rng.int(1, 3),
          hoursOperated: rng.int(2, 9),
          hoursIdle: rng.int(0, 3),
          activityId: anyActivity(),
          notes: `${ctx.canary('daily_log_equipment')} plant return`,
        });
      }
    }
    for (let i = ctx.count(1, 2); i > 0; i -= 1) {
      const [material, unit] = rng.pick(DELIVERIES);
      await entry(day, 'deliveries', {
        description: `${material} — ${ctx.canary('daily_log_delivery')}`,
        supplierName: `${ctx.canary('daily_log_supplier')} Supply Co`,
        quantity: rng.int(4, 120),
        unit,
        poRef: `PO-${ctx.project.key}-${rng.int(100, 999)}`,
        receivedBy: ctx.person('site').name,
        deliveredAt: rng.pick(['07:30', '09:15', '11:40', '14:05']),
        activityId: anyActivity(),
        notes: `${ctx.canary('daily_log_delivery')} checked against the delivery note`,
      });
    }
    for (let i = index === 0 ? 1 : ctx.count(0, 2); i > 0; i -= 1) {
      await entry(day, 'visitors', {
        name: `${ctx.canary('daily_log_visitor')} visitor`,
        company: `${ctx.canary('daily_log_visitor')} Consulting`,
        purpose: `${ctx.canary('daily_log_visitor')} site walk and inspection`,
        arrivedAt: '10:00',
        leftAt: '11:30',
        notes: `${ctx.canary('daily_log_visitor')} inducted, PPE issued`,
      });
    }
    for (let i = index === 0 ? 1 : ctx.count(0, 1); i > 0; i -= 1) {
      const log = await entry(day, 'delays', {
        type: index === 0 ? 'weather' : rng.pick(DELAY_TYPES),
        description: `${ctx.canary('daily_log_delay')} work stopped`,
        hoursLost: rng.pick([1, 2, 4]),
        activityId: anyActivity(),
        notes: `${ctx.canary('daily_log_delay')} crew stood down`,
      });
      if (index === 0) made.delayId = log.entryId;
    }
    for (let i = ctx.count(1, 2); i > 0; i -= 1) {
      await entry(day, 'notes', { kind: rng.pick(NOTE_KINDS), text: `${ctx.canary('daily_log_note')} site note for the day`, activityId: anyActivity() });
    }
    // The quality engineer writes in the same log.
    await entry(day, 'notes', { kind: 'inspection', text: `${ctx.canary('daily_log_note')} inspection walk, no defects raised` }, quality);
    if (quantity) made.quantityRow = await quantityRow(day, quantity, 1 + (index % 3), 'installed today');
    if (pendingTarget && index <= 1) made.pendingRow = await quantityRow(day, pendingTarget, 1, index === 1 ? 'to be returned by the site team' : 'installed today');

    if (index === 0) {
      // An entry edited, an entry removed, a delay put on the weather register.
      const draft = await entry(day, 'notes', { kind: 'general', text: `${ctx.canary('daily_log_note')} first wording` });
      absorb(await site.PATCH(`${P}/daily-logs/${day}/entries/notes/${draft.entryId}`, { text: `${ctx.canary('daily_log_note')} corrected wording`, kind: 'instruction' }));
      const extra = await site.POST(`${P}/daily-logs/${day}/entries/visitors`, { name: `${ctx.canary('daily_log_visitor')} entered by mistake` });
      seen.add(extra.entryId);
      await site.DELETE(`${P}/daily-logs/${day}/entries/visitors/${extra.entryId}`);
      if (made.delayId) {
        const registered = await ctx.attempt(`daily log ${day} weather delay`, () =>
          site.POST(`${P}/daily-logs/${day}/entries/delays/${made.delayId}/weather-delay`, { delayDays: 0.5, contractual: true, description: `${ctx.canary('weather_delay')} rain stopped the pour` })
        );
        if (registered?.weatherDelay?.id) ctx.record('weather_delay', registered.weatherDelay.id);
      }
    }
    if (last) {
      // On the open day: a note still in draft and a delay the site team rejected.
      await entry(day, 'notes', { kind: 'issue', text: `${ctx.canary('daily_log_note')} draft, not yet confirmed`, status: 'draft' });
      const disputed = await entry(day, 'delays', { type: 'access', description: `${ctx.canary('daily_log_delay')} gate blocked`, hoursLost: 1 });
      absorb(
        await pm.POST(`${P}/daily-logs/${day}/entries/delays/${disputed.entryId}/review`, { decision: 'reject', reason: `${ctx.canary('daily_log_review')} not a delay to the works` })
      );
    }
    absorb(
      await site.PATCH(`${P}/daily-logs/${day}`, {
        summary: `${ctx.canary('daily_log')} summary of the day (${outcome})`,
        weather: { condition: rng.pick(WEATHER), tempMinC: rng.int(8, 22), tempMaxC: rng.int(23, 41), precipitationMm: rng.int(0, 12), windMaxKph: rng.int(5, 45), notes: `${ctx.canary('daily_log_weather')} read at 07:00` },
      })
    );

    if (outcome !== 'open') {
      absorb(await site.POST(`${P}/daily-logs/${day}/submit`));
      if (made.pendingRow && index === 1) {
        // Returned on a submitted day: the pending entry it minted goes with it.
        await ctx.attempt(`daily log ${day} quantity row rejected`, () =>
          pm.POST(`${P}/daily-logs/${day}/entries/quantities/${made.pendingRow}/review`, { decision: 'reject', reason: `${ctx.canary('daily_log_review')} measured twice` })
        );
      }
    }
    if (outcome === 'approved') {
      absorb(await pm.POST(`${P}/daily-logs/${day}/approve`));
      if (index === 0) {
        // Reopened, corrected and closed again.
        const reopened = await ctx.attempt(`daily log ${day} reopen`, () => pm.POST(`${P}/daily-logs/${day}/reopen`, { reason: `${ctx.canary('daily_log_reopen')} a delivery was missed` }));
        if (reopened) {
          await entry(day, 'deliveries', { description: `Sand, late delivery — ${ctx.canary('daily_log_delivery')}`, quantity: 12, unit: 'm3', deliveredAt: '16:20', activityId: anyActivity() });
          await site.POST(`${P}/daily-logs/${day}/submit`);
          await pm.POST(`${P}/daily-logs/${day}/approve`);
          count('daily logs reopened and closed again');
        }
      }
    }
    count(`daily logs ${outcome}`);
    logs.push(made);
  }

  // One approved day sent out (a stored PDF and a notice to the PM — no outside address), and read back as a PDF.
  const approvedDay = logs.find((log) => log.outcome === 'approved')?.day;
  if (approvedDay) {
    const sent = await ctx.attempt(`daily log ${approvedDay} distribute`, () =>
      site.POST(`${P}/daily-logs/${approvedDay}/distribute`, { roles: ['pm'], userIds: [], emails: [], note: `${ctx.canary('daily_log_distribution')} for the record` })
    );
    if (sent?.document?.id) ctx.record('project_document', sent.document.id);
    const pdf = await ctx.attempt(`daily log ${approvedDay} pdf`, () => planner.download(`${P}/daily-logs/${approvedDay}/export.pdf`));
    if (pdf && pdf.subarray(0, 4).toString() !== '%PDF') ctx.note(`daily log ${approvedDay}: export.pdf did not answer a PDF`);
    await ctx.attempt('manpower report', () => planner.GET(`${P}/daily-logs/manpower-report?from=${logDays[0]}&to=${logDays[logDays.length - 1]}&groupBy=trade`));
  }

  // What the submitted days minted: one pending quantity entry per row that counts.
  const minted = listOf(await site.GET(`${P}/quantity-progress?source=daily_log`), 'entries');
  for (const row of minted) {
    if (!seen.has(row.dailyLogId) || seen.has(row.id)) continue;
    seen.add(row.id);
    ctx.record('quantity_progress_entry', row.id);
    count('quantity entries minted by daily logs');
  }

  // ── 6. progress claims ───────────────────────────────────────────────────
  const claim = async (code, body, who = site) => {
    const answer = await who.POST(`${P}/activities/${activities[code]}/progress`, body);
    ctx.record('progress_submission', answer.submission.id);
    return answer.submission;
  };
  const settle = async (code, submission, outcome, who = pm) => {
    const base = `${P}/activities/${activities[code]}/progress-submissions/${submission.id}`;
    if (outcome === 'approved') {
      const done = await ctx.attempt(`progress ${code} approve`, () => who.POST(`${base}/approve`));
      if (done?.approvedProgressId) ctx.record('activity_progress', done.approvedProgressId);
      count(done ? 'claims approved' : 'claims waiting');
      return done;
    }
    if (outcome === 'rejected') {
      const done = await ctx.attempt(`progress ${code} reject`, () => who.POST(`${base}/reject`, { reason: `${ctx.canary('progress_rejection')} not as measured on site` }));
      count(done ? 'claims rejected' : 'claims waiting');
      return done;
    }
    count(outcome === 'draft' ? 'claims in draft' : 'claims waiting');
    return submission;
  };
  const approvers = [pm, planner, qs];

  // Percentages: several claims over the percent activities, each ending differently.
  const claims = ctx.count(5, 9);
  for (let k = 0; k < claims; k += 1) {
    const code = roles.percent[k % roles.percent.length];
    const outcome = CLAIM_OUTCOMES[k % CLAIM_OUTCOMES.length];
    const needsEvidence = code === evidenceCode && Boolean(evidenceMethod);
    const submission = await claim(code, {
      pctComplete: Math.min(95, 10 + 8 * k + 3 * (runNo - 1)),
      progressMethod: 'percent',
      status: outcome === 'draft' ? 'draft' : 'submitted',
      source: k % 4 === 3 ? 'mobile' : 'manual',
      actualStart: `${ctx.daysAgo(30 + k)}T00:00:00.000Z`,
      // One claim carries a cost figure of its own; it sits on the activity it is made on.
      ...(k === 0 ? { actualCost: 1500 + 250 * runNo } : {}),
      ...(needsEvidence || k % 3 === 0 ? { evidence: evidence() } : {}),
      notes: `${ctx.canary('progress_submission')} percent claim`,
    });
    await settle(code, submission, outcome, approvers[k % approvers.length]);
  }

  // Milestones: the first complete and approved, then the second half done and left waiting.
  if (milestoneMethod) {
    const first = await claim(roles.milestone, { milestones: [{ id: 'm1', complete: true }], notes: `${ctx.canary('progress_submission')} first milestone reached` });
    await settle(roles.milestone, first, 'approved');
    const second = await claim(roles.milestone, { milestones: [{ id: 'm1', complete: true }, { id: 'm2', pctComplete: 50 }], notes: `${ctx.canary('progress_submission')} main works half done` });
    await settle(roles.milestone, second, 'submitted');
  }
  if (inspectionMethod) {
    const passed = await claim(roles.inspection, { inspectionStatus: 'passed', pctComplete: 40, evidence: evidence(), notes: `${ctx.canary('progress_submission')} inspection passed` });
    await settle(roles.inspection, passed, 'approved', planner);
    const failed = await claim(roles.inspection, { inspectionStatus: 'failed', pctComplete: 60, notes: `${ctx.canary('progress_submission')} inspection failed` });
    await settle(roles.inspection, failed, 'rejected', qs);
  }
  if (manualMethod) {
    const assessed = await claim(roles.manual, { pctComplete: Math.min(90, 15 + 5 * runNo), notes: `${ctx.canary('progress_submission')} manual assessment` });
    await settle(roles.manual, assessed, 'submitted');
  }

  // A bulk claim (all or nothing), left waiting.
  const bulkCodes = [...new Set([roles.percent[0], roles.percent[roles.percent.length - 1]])];
  const bulk = await ctx.attempt('bulk progress', () =>
    site.POST(`${P}/activities/bulk-progress`, {
      updates: bulkCodes.map((code, i) => ({
        activityId: activities[code],
        pctComplete: Math.min(96, 30 + 6 * i + 2 * runNo),
        progressMethod: 'percent',
        status: 'submitted',
        evidence: evidence(),
        notes: `${ctx.canary('progress_submission')} weekly bulk update`,
      })),
    })
  );
  for (const submission of bulk?.submissions || []) {
    ctx.record('progress_submission', submission.id);
    count('claims waiting');
  }

  // ── 7. quantity entries and the bundles that make them official ──────────
  if (quantity) {
    const recordEntry = (row) => {
      if (seen.has(row.id)) return row;
      seen.add(row.id);
      ctx.record('quantity_progress_entry', row.id);
      return row;
    };
    const base = { activityId: quantity.activityId, boqItemId: quantity.boqItemId };
    const earlier = logDays[0];
    const draft = recordEntry(
      (await site.POST(`${P}/quantity-progress`, { ...base, allocationId: quantity.allocationId, quantity: quantity.step, date: ctx.today, status: 'draft', note: `${ctx.canary('quantity_progress_entry')} draft, not yet submitted` })).entry
    );
    count('quantity entries draft');
    const batch = await site.POST(`${P}/quantity-progress`, {
      status: 'submitted',
      entries: [
        { ...base, quantity: qty(quantity.step * 2), date: shiftDay(earlier, -3), note: `${ctx.canary('quantity_progress_entry')} to be approved` },
        { ...base, quantity: qty(quantity.step * 3), date: shiftDay(earlier, -2), unitCode: quantity.unit, note: `${ctx.canary('quantity_progress_entry')} to be rejected` },
        { ...base, quantity: quantity.step, date: ctx.today, note: `${ctx.canary('quantity_progress_entry')} submitted, in no bundle` },
      ],
    });
    const [toApprove, toReject] = batch.entries.map(recordEntry);
    count('quantity entries submitted');
    // Recorded as a draft, submitted on its own, then corrected.
    const late = recordEntry((await site.POST(`${P}/quantity-progress`, { ...base, quantity: quantity.step, date: ctx.today, note: `${ctx.canary('quantity_progress_entry')} first figure` })).entry);
    await site.POST(`${P}/quantity-progress/${late.id}/submit`);
    await site.PATCH(`${P}/quantity-progress/${late.id}`, { quantity: qty(quantity.step * 1.5), note: `${ctx.canary('quantity_progress_entry')} corrected figure` });
    // Recorded by mistake and removed.
    const mistake = (await site.POST(`${P}/quantity-progress`, { ...base, quantity: quantity.step, date: ctx.today, note: `${ctx.canary('quantity_progress_entry')} recorded by mistake` })).entry;
    await site.DELETE(`${P}/quantity-progress/${mistake.id}`);

    const approvedBundle = await claim(quantity.code, { entryIds: [toApprove.id], notes: `${ctx.canary('progress_submission')} quantity bundle` });
    await settle(quantity.code, approvedBundle, 'approved');
    const rejectedBundle = await claim(quantity.code, { entryIds: [toReject.id], notes: `${ctx.canary('progress_submission')} quantity bundle, disputed` });
    await settle(quantity.code, rejectedBundle, 'rejected');
    // Everything the submitted daily logs minted on this activity, made official in one bundle.
    const through = logs.filter((log) => log.outcome !== 'open').map((log) => log.day).sort().pop();
    const fromLogs = through ? await ctx.attempt('quantity bundle from the daily logs', () => claim(quantity.code, { bundleSubmittedThrough: through, source: 'manual', notes: `${ctx.canary('progress_submission')} quantities from the daily logs` })) : null;
    if (fromLogs) await settle(quantity.code, fromLogs, 'approved', qs);
    const waitingBundle = await claim(quantity.code, { entryIds: [late.id], notes: `${ctx.canary('progress_submission')} quantity bundle, waiting` });
    await settle(quantity.code, waitingBundle, 'submitted');
    state.quantityDraftEntry = draft.id;
  }

  // The older shape: a typed quantity on an activity with no entries yet. Its
  // approval mints one entry; after that the product wants entries, so a
  // second run is refused here and says so.
  if (roles.typedQuantity) {
    const allocation = allocationsOf(roles.typedQuantity, { approved: true })[0];
    const method = allocation ? await setMethod(roles.typedQuantity, { method: 'quantity', quantityUnit: unitOf(allocation), notes: `${ctx.canary('progress_method')} typed quantity` }) : null;
    const typed = method
      ? await ctx.attempt(`typed quantity ${roles.typedQuantity}`, () =>
          claim(roles.typedQuantity, { quantityComplete: qty(Number(allocation.quantity) * 0.1), quantityUnit: unitOf(allocation), notes: `${ctx.canary('progress_submission')} typed quantity` })
        )
      : null;
    if (typed) {
      const done = await settle(roles.typedQuantity, typed, 'approved');
      const mintedId = done?.quantity?.mintedEntry?.id;
      if (mintedId) ctx.record('quantity_progress_entry', mintedId);
    }
  }

  // ── 8. labour: workers, a crew, timesheets ───────────────────────────────
  const roster = listOf(await site.GET(`${P}/timesheets/workers?q=${encodeURIComponent(`${ctx.project.key}-W`)}`));
  const workers = [];
  const wantedWorkers = ctx.count(2, 5);
  for (let i = 0; i < wantedWorkers; i += 1) {
    const employeeNumber = `${ctx.project.key}-W${i + 1}`;
    let worker = roster.find((row) => row.employeeNumber === employeeNumber);
    const name = `${ctx.canary('worker')} ${rng.pick(TRADES)}`;
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
        notes: `${ctx.canary('worker')} engaged for ${ctx.project.key}`,
      });
      ctx.record('worker', worker.id, { scope: 'company' });
      count('workers');
    }
    workers.push(worker);
  }
  // One who has left: on the roster, inactive, on no timesheet.
  const leaverNumber = `${ctx.project.key}-W0`;
  if (!roster.some((row) => row.employeeNumber === leaverNumber)) {
    const leaver = await ctx.attempt('inactive worker', () =>
      site.POST(`${P}/timesheets/workers`, { name: `${ctx.canary('worker')} left the site`, employeeNumber: leaverNumber, trade: 'General labourer', hourlyRate: 20, status: 'inactive', notes: `${ctx.canary('worker')} demobilised` })
    );
    if (leaver?.id) ctx.record('worker', leaver.id, { scope: 'company' });
  }
  await ctx.attempt('worker rate change', () => cost.PATCH(`${P}/timesheets/workers/${workers[0].id}`, { hourlyRate: Number(workers[0].hourlyRate || 30) + 1, notes: `${ctx.canary('worker')} rate reviewed` }));

  const crewName = `${ctx.canary('crew')} gang`;
  let crew = listOf(await site.GET(`${P}/timesheets/crews`)).find((row) => row.name === crewName);
  if (!crew) {
    crew = await site.POST(`${P}/timesheets/crews`, {
      name: crewName,
      workerIds: workers.map((worker) => worker.id),
      defaultActivityId: activities[roles.percent[0]],
      ...(labourCode ? { defaultCostCodeId: labourCode } : {}),
      foremanUserId: ctx.userId('site'),
      status: 'active',
    });
    ctx.record('crew', crew.id);
    count('crews');
  }

  const sheetsBefore = listOf(await site.GET(`${P}/timesheets`));
  const takenSheetDays = new Set(sheetsBefore.map((row) => dayOf(row.date)));
  const sheetDays = [];
  const wantedSheets = ctx.count(4, 7);
  for (let back = 1; back <= 300 && sheetDays.length < wantedSheets; back += 1) {
    const day = ctx.daysAgo(back);
    if (!takenSheetDays.has(day)) sheetDays.push(day);
  }
  const sheetEntries = (hours = 8) =>
    workers.slice(0, Math.max(1, Math.min(workers.length, 3))).flatMap((worker, i) => [
      { workerId: worker.id, activityId: activities[roles.percent[i % roles.percent.length]], costCodeId: i % 2 ? prelimCode : labourCode, timeType: 'regular', hours, startTime: '07:00', endTime: '15:00', notes: `${ctx.canary('time_entry')} day work` },
      ...(i === 0 ? [{ workerId: worker.id, activityId: activities[roles.milestone], costCodeId: labourCode, timeType: 'overtime', hours: 2, startTime: '15:00', endTime: '17:00', notes: `${ctx.canary('time_entry')} overtime to finish the pour` }] : []),
      ...(i === 1 ? [{ workerId: worker.id, activityId: activities[roles.milestone], costCodeId: labourCode, timeType: 'double', hours: 1, notes: `${ctx.canary('time_entry')} rest-day hour` }] : []),
    ]);
  let labourPosted = 0;
  for (const [index, day] of sheetDays.entries()) {
    const outcome = SHEET_OUTCOMES[index % SHEET_OUTCOMES.length];
    const base = `${P}/timesheets`;
    // The first sheet is the crew's: no entries sent, the members are filled in on the crew's defaults.
    let sheet = await site.POST(base, {
      date: day,
      notes: `${ctx.canary('timesheet')} ${index === 0 ? 'crew day' : 'labour return'} (${outcome})`,
      ...(index === 0 ? { crewId: crew.id, defaultHours: 8 } : { entries: sheetEntries(index % 2 ? 9 : 8) }),
    });
    ctx.record('timesheet', sheet.id);
    if (outcome === 'draft') {
      // Edited while still a draft: the entries are replaced.
      sheet = await site.PATCH(`${base}/${sheet.id}`, { notes: `${ctx.canary('timesheet')} draft, hours to be confirmed`, entries: sheetEntries(6) });
    } else {
      await site.POST(`${base}/${sheet.id}/submit`);
      if (outcome === 'rejected') await cost.POST(`${base}/${sheet.id}/reject`, { reason: `${ctx.canary('timesheet_rejection')} hours do not match the gate log` });
      if (outcome === 'approved' || outcome === 'reopened') {
        const approved = await cost.POST(`${base}/${sheet.id}/approve`);
        if (outcome === 'approved') labourPosted += Number(approved.totalCost || 0);
      }
      if (outcome === 'reopened') await ctx.attempt(`timesheet ${day} reopen`, () => pm.POST(`${base}/${sheet.id}/reopen`, { reason: `${ctx.canary('timesheet_reopen')} wrong activity` }));
      sheet = await site.GET(`${base}/${sheet.id}`);
    }
    for (const row of sheet.entries || []) ctx.record('time_entry', row.id);
    count(`timesheets ${sheet.status}${outcome === 'reopened' ? ' (reopened)' : ''}`);
  }
  if (sheetDays.length) await ctx.attempt('timesheet week view', () => cost.GET(`${P}/timesheets/week?weekStart=${mondayOf(sheetDays[0])}`));

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
      weatherCondition: `${rng.pick(WEATHER)} — ${ctx.canary('weekly_report')}`,
      weatherDelayDays: rng.int(0, 2),
      plannedProgress: rng.int(5, 40),
      actualProgress: rng.int(3, 38),
      manpowerCount: rng.int(12, 140),
      activitiesCompleted: completed,
      activitiesInProgress: inProgress,
      issuesSummary: `${ctx.canary('weekly_report')} issues of the week`,
      nextWeekPlan: `${ctx.canary('weekly_report')} plan for next week`,
      remarks: `${ctx.canary('weekly_report')} remarks`,
      status: outcome === 'draft' ? 'draft' : 'submitted',
    });
    ctx.record('weekly_report', report.id);
    if (outcome === 'approved') await pm.PATCH(`${P}/weekly-reports/${report.id}`, { status: 'approved', remarks: `${ctx.canary('weekly_report')} accepted by the PM` });
    count(`weekly reports ${outcome}`);
  }
  // This week's report is made by reading it.
  const current = await ctx.attempt('weekly report of this week', () => site.GET(`${P}/weekly-reports/current`));
  if (current?.id && state.currentWeekly !== current.id) {
    state.currentWeekly = current.id;
    ctx.record('weekly_report', current.id);
  }

  // ── 10. the older site records, still mounted ────────────────────────────
  const legacyDays = sheetDays.length ? sheetDays : logDays;
  const reports = ctx.count(3, 4);
  for (let i = 0; i < reports; i += 1) {
    const outcome = REPORT_OUTCOMES[i % REPORT_OUTCOMES.length];
    const code = roles.percent[i % roles.percent.length];
    const report = await ctx.attempt('daily report', () =>
      site.POST(`${P}/daily-reports`, {
        activityId: activities[code],
        date: legacyDays[i % legacyDays.length],
        shift: i % 2 ? 'night' : 'day',
        weather: { summary: `${ctx.canary('daily_report')} fair`, condition: rng.pick(WEATHER), temperatureC: rng.int(15, 38), rainfallMm: 0, delayImpact: false },
        manpower: [{ trade: rng.pick(TRADES), workers: rng.int(3, 15), hours: 8 }],
        materials: [{ name: `${ctx.canary('daily_report')} cement`, qty: rng.int(5, 50), unit: 'bag' }],
        equipment: [{ name: `${ctx.canary('daily_report')} ${rng.pick(PLANT)}`, hours: rng.int(2, 8) }],
        issues: [{ title: `${ctx.canary('daily_report')} issue`, description: `${ctx.canary('daily_report')} access to the work face`, severity: 'low', status: 'open' }],
        ...(photo ? { photos: [{ key: photo.key, filename: photo.filename, caption: `${ctx.canary('daily_report')} progress photo` }] } : {}),
        notes: `${ctx.canary('daily_report')} activity report (${outcome})`,
        status: outcome === 'draft' ? 'draft' : 'submitted',
        // The first report carries a progress claim; approving the report approves it.
        ...(i === 0 ? { progress: { method: 'percent', pctComplete: Math.min(97, 20 + 4 * runNo), evidence: evidence(), notes: `${ctx.canary('progress_submission')} claimed in the daily report` } } : {}),
      })
    );
    if (!report?.id) break;
    ctx.record('daily_report', report.id);
    for (const submission of report.progressSubmissions || []) if (submission?.id) ctx.record('progress_submission', submission.id);
    if (outcome === 'approved') await ctx.attempt('daily report approve', () => pm.POST(`${P}/daily-reports/${report.id}/approve`));
    if (outcome === 'rejected') await ctx.attempt('daily report reject', () => pm.POST(`${P}/daily-reports/${report.id}/reject`, { reason: `${ctx.canary('daily_report')} manpower not as counted` }));
    count(`daily reports ${outcome}`);
  }
  const diaries = ctx.count(3, 4);
  for (let i = 0; i < diaries; i += 1) {
    const outcome = REPORT_OUTCOMES[i % REPORT_OUTCOMES.length];
    const diary = await ctx.attempt('site diary', () =>
      site.POST(`${P}/site-diaries`, {
        date: legacyDays[i % legacyDays.length],
        shift: 'day',
        weather: `${rng.pick(WEATHER)} — ${ctx.canary('site_diary')}`,
        weatherDetails: { summary: `${ctx.canary('site_diary')} dry`, temperatureC: rng.int(15, 38), delayImpact: false },
        workers: rng.int(10, 120),
        visitors: `${ctx.canary('site_diary')} client representative`,
        workDone: `${ctx.canary('site_diary')} work done today`,
        issues: `${ctx.canary('site_diary')} no stoppage`,
        instructions: `${ctx.canary('site_diary')} instruction received on site`,
        manpower: [{ trade: rng.pick(TRADES), workers: rng.int(3, 15), hours: 8 }],
        notes: `${ctx.canary('site_diary')} diary (${outcome})`,
        status: outcome === 'draft' ? 'draft' : 'submitted',
      })
    );
    if (!diary?.id) break;
    ctx.record('site_diary', diary.id);
    if (outcome === 'approved') await ctx.attempt('site diary approve', () => pm.POST(`${P}/site-diaries/${diary.id}/approve`));
    if (outcome === 'rejected') await ctx.attempt('site diary reject', () => pm.POST(`${P}/site-diaries/${diary.id}/reject`, { reason: `${ctx.canary('site_diary')} incomplete` }));
    count(`site diaries ${outcome}`);
  }

  // ── 11. what it all adds up to ───────────────────────────────────────────
  const ev = await ctx.attempt('earned value report', () => cost.GET(`${P}/reports/ev`));
  if (ev) {
    state.ev = { ev: ev.ev, ac: ev.ac, pv: ev.pv, spi: ev.spi, cpi: ev.cpi, cutoff: ev.reporting?.cutoffLocalDate || null, labourPosted: Math.round(labourPosted * 100) / 100 };
    ctx.note(`earned value after run ${runNo}: EV ${ev.ev}, AC ${ev.ac}, PV ${ev.pv}, SPI ${ev.spi}, CPI ${ev.cpi} (cutoff ${state.ev.cutoff}); labour posted by this run's approved timesheets ${state.ev.labourPosted}`);
  }
  ctx.note(`progress run ${runNo}: ${Object.entries(tally).map(([key, n]) => `${key} ${n}`).join('; ')}`);
  if (!tally['claims approved']) throw new Error('progress: no progress claim could be approved (see the notes)');
};

module.exports = { name: 'progress', needs: ['foundation'], depths: ['standard'], run };
