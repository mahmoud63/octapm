'use strict';

/**
 * Project structure and contract set-up: what a contractor fills in after the
 * programme and the bill exist and before work is recorded.
 *
 *   units of measure      two company units (once per company)                 qs
 *   project parties       client, consultant (then updated), contractor (a     pm
 *                         new directory company), subcontractor, and a
 *                         supplier that is taken off again (inactive)
 *   party members         staff beyond the personas as active members; one     pm
 *                         persona added and removed again (inactive member),
 *                         one on the supplier party when it is removed
 *   WBS                   the four branches the programme uses, children,      planner
 *                         work packages owned by the subcontractor party,
 *                         one node renamed, one archived, one archived and
 *                         restored
 *   locations             site > building > level > zone > room, an external   site, planner
 *                         area, reordered buildings, one archived, one
 *                         archived, restored and edited
 *   contract profile      form of contract, notice periods, clauses            qs, pm confirms
 *   prime contract        client company, retention, advance, tax, terms       qs
 *   project terms         delay damages per day, weather allowance             pm
 *   reporting periods     the last months of the job (and the next one)        cost
 *   cost loading          planned-value rows: draft, submitted, approved,      cost, finance, pm
 *                         rejected, and rejected-then-corrected (which stays
 *                         rejected: the product refuses to resubmit a
 *                         rejected row, a finding of its own)
 *   period lock           the oldest past period this driver made, with its    pm
 *                         EV and budget snapshots
 *   Gantt layouts         two private layouts and one shared with the project  planner, pm
 *   schedule revisions    staged P6 imports that are never activated:          planner, pm
 *                         rejected, then under review, or superseded + draft
 *
 * Every create is checked against what is already there (by code, name,
 * company or the ids kept in ctx.refs.structure), and every follow-up step
 * (an archive, a removal, a review) is decided from the record's current
 * state and a done-flag kept in ctx.refs.structure, so a run that stopped
 * half way is finished by the next one and a second complete run adds
 * nothing. Nothing here is allowed to fail quietly: a refusal of any step is
 * a failure of the run.
 *
 * Left for later drivers in ctx.refs: wbs {code: id}, locations {code: id}
 * (active ones only; the archived ones are in wbsArchived / locationsArchived),
 * parties {client, consultant, contractor, subcontractor, supplier: id},
 * reportingPeriods {code: id}, lockedPeriods [code], primeContract (id),
 * contractProfile {projectId, form, confirmed}, scheduleRevisions {id: status}.
 *
 * What the lock does to the rest of the project (by design): every budget
 * line's Original Budget becomes read-only, the EV and budget snapshots are
 * frozen with the figures of the moment (before progress and cost exist, so
 * EV and AC are zero), and cost-loading rows in that period can no longer be
 * edited, submitted or approved.
 *
 * Two things the API does not offer and so are not here: a calendar or
 * working-day record (the project carries only `projectCalendar`), and a
 * schedule revision made without a file or AI. The revisions below come from
 * a small P6 XER file built in memory; they stay staged, so the project's
 * activities are never touched. Set CERT_STRUCTURE_REVISIONS=off to leave
 * them out. The contract profile has no id of its own in the API (one per
 * project, read and written at P/contract), so it is not in the records: it
 * is ctx.refs.contractProfile, and the isolation index finds the row by its
 * project.
 */

const { buildPopulation } = require('../lib/spec');

// The same four branches foundation.js files its activities under.
const WBS_ROOTS = ['1 Substructure', '2 Superstructure', '3 Architectural & MEP', '4 External works'];
const WBS_CHILDREN = [
  ['Earthworks', 'Foundations', 'Below-ground drainage'],
  ['Frame', 'Floor slabs', 'Core walls'],
  ['Internal finishes', 'MEP services', 'Joinery and fittings'],
  ['Roads and paving', 'Soft landscaping', 'External services'],
];
const CONTRACT_FORMS = ['fidic_1999', 'fidic_2017', 'nec4', 'jct_2016', 'aia_a201', 'custom'];
const CLAUSES = [
  ['notice', 'Notice of claim', 28, 'The Contractor shall give notice of a claim within the stated period of becoming aware of the event.'],
  ['eot', 'Extension of time', 42, 'The Engineer shall respond to a fully detailed claim for an extension of time within the stated period.'],
  ['variation', 'Variation procedure', 14, 'A variation shall be instructed in writing and valued within the stated period.'],
  ['payment', 'Interim payment', 56, 'The Employer shall pay the certified amount within the stated period of the statement.'],
  ['ld', 'Delay damages', null, 'Delay damages accrue per day of delay, capped at a share of the contract price.'],
  ['retention', 'Retention money', null, 'Retention is deducted from each certificate up to the stated limit; half is released at taking over.'],
  ['defects', 'Defects notification period', 365, 'The Contractor shall remedy defects notified within the defects notification period.'],
  ['dispute', 'Dispute adjudication', 84, 'A dispute shall be referred to the adjudication board, which decides within the stated period.'],
];
// Project contract types that the prime contract has its own word for.
const PRIME_TYPE = { lump_sum: 'lump_sum', unit_rate: 'remeasured', remeasurement: 'remeasured', cost_plus: 'cost_plus' };
// Who may be added to a party as a member and taken off again: a persona who is
// on the project team and administers nothing (an administrator with no team
// assignment would become an external party on the project while a member).
const MEMBER_PERSONAS = ['site', 'quality', 'warehouse', 'procurement', 'cost', 'qs', 'planner', 'finance'];
// A staged import supersedes every revision in one of these states that is not active.
const OPEN_REVISION = ['draft', 'under_review', 'approved'];
// The state each planned-value row is taken to, in turn; 'corrected' is a
// rejected row whose amount was put right afterwards (it stays rejected).
const LOADING_STATES = ['approved', 'submitted', 'draft', 'rejected', 'corrected'];

const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.periods || data?.activities || []);
const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (date) => date.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthIndex = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const round2 = (n) => Math.round(n * 100) / 100;

/** The population's own date (spec.js asOf). Periods hang on it, not on the wall clock, so a run next month plans the same months. */
let populationDay = null;
const asOfDay = () => {
  populationDay = populationDay || buildPopulation().asOf.slice(0, 10);
  return populationDay;
};

/** The reporting period that closes in month `index` (a count of months): the calendar month, or cutoff-day to cutoff-day. */
const periodOf = (index, cutoffDay) => {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const code = `RP-${y}-${pad2(m)}`;
  if (!cutoffDay) return { code, periodStart: isoDay(utc(y, m, 1)), periodEnd: isoDay(utc(y, m, lastDay(y, m))) };
  const py = Math.floor((index - 1) / 12);
  const pm = ((index - 1) % 12) + 1;
  const end = utc(y, m, Math.min(cutoffDay, lastDay(y, m)));
  const start = new Date(utc(py, pm, Math.min(cutoffDay, lastDay(py, pm))).getTime() + 86_400_000);
  return { code, periodStart: isoDay(start), periodEnd: isoDay(end) };
};

/** A small P6 XER file: the project's own activity codes in a chain, so the staged revision maps onto the live programme. */
const buildXer = ({ canary, activities, startDate }) => {
  const stamp = (date, time) => `${isoDay(date)} ${time}`;
  const base = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const lines = [
    'ERMHDR\t19.12',
    '%T\tPROJWBS',
    '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num',
    `%R\tW1\t\tREV\tRevised programme ${canary}\t1`,
    `%R\tW2\tW1\tREV.1\tRevised sequence ${canary}\t2`,
    '%T\tTASK',
    '%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct',
  ];
  activities.forEach((activity, i) => {
    const start = new Date(base + i * 7 * 86_400_000);
    const end = new Date(start.getTime() + 4 * 86_400_000);
    const from = stamp(start, '08:00');
    const to = stamp(end, '17:00');
    lines.push(`%R\tT${i + 1}\t${activity.code}\t${activity.name} ${canary}\t${i % 2 ? 'W2' : 'W1'}\t40\t40\t${from}\t${to}\t${from}\t${to}\t0\t0`);
  });
  lines.push('%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt');
  for (let i = 1; i < activities.length; i += 1) lines.push(`%R\tP${i}\tT${i + 1}\tT${i}\tPR_FS\t0`);
  lines.push('%E', '');
  return lines.join('\n');
};

/**
 * What this driver keeps about its own work in ctx.refs.structure: the ids it
 * created (parties, nodes, places, periods, planned-value rows by plan index,
 * revisions in order, layouts by label, members) and the follow-up steps it
 * has finished.
 *
 * A project where an earlier version of this driver ran (it kept no such
 * record) is taken over: that version created its parties, periods and
 * revisions and did each follow-up right after the create, and its run was
 * marked ok, so those follow-ups and its planned-value set count as done.
 * What it never made (party members, where the company has no staff) is
 * made now.
 */
const takeOver = (ctx, earlier) => {
  const own = { v: 2, legacy: earlier, parties: [], wbs: [], locations: [], periods: [], loading: {}, revisions: [], layouts: {}, members: {}, done: {} };
  if (!earlier) return own;
  own.parties = Object.values(ctx.refs.parties || {}).filter(Boolean);
  own.periods = Object.values(ctx.refs.reportingPeriods || {}).filter(Boolean);
  own.revisions = Object.keys(ctx.refs.scheduleRevisions || {});
  for (const key of ['consultant.updated', 'wbs.renamed', 'wbs.provisional', 'wbs.temporary', 'locations.reordered', 'location.laydown', 'location.gate', 'contract.confirmed', 'loading', 'lock', 'lock.snapshots']) {
    own.done[key] = true;
  }
  return own;
};

const run = async (ctx) => {
  const pm = ctx.who('pm');
  const planner = ctx.who('planner');
  const qs = ctx.who('qs');
  const cost = ctx.who('cost');
  const site = ctx.who('site');
  const finance = ctx.who('finance');
  const { P, rng, company, project } = ctx;
  const fail = (message) => {
    throw new Error(`structure: ${message}`);
  };
  const AS_OF = asOfDay();
  const directory = ctx.companyRefs.directory || {};
  for (const kind of ['client', 'consultant', 'subcontractor', 'supplier']) {
    if (!directory[kind]) fail(`the company directory has no ${kind} (foundation makes it)`);
  }
  if (!Object.keys(ctx.refs.activities || {}).length) fail('the project has no activities (foundation makes them)');
  const domain = `parties.c${company.code}.octapm-cert.test`;
  const mine = (ctx.companyRefs.structure = ctx.companyRefs.structure || {});

  const earlier = Boolean(ctx.refs.structureRuns || ctx.refs.wbs);
  const own = (ctx.refs.structure = ctx.refs.structure || takeOver(ctx, earlier));
  const done = (key) => Boolean(own.done[key]);
  const finish = (key) => {
    own.done[key] = true;
  };
  const owns = (list, id) => Boolean(id) && own[list].includes(id);

  // A canary names one record, and says which driver made it (other drivers
  // count their own LOCATION-n and ACTIVITY_COST_LOADING-n from 1 as well).
  // ctx.canary counts from 1 on every run, so a later run marks whatever it
  // still has to make with its run number.
  const runNo = (ctx.refs.structureRuns = (ctx.refs.structureRuns ?? (ctx.refs.wbs ? 1 : 0)) + 1);
  const mark = (type) => ctx.canary(runNo > 1 ? `st-${type}-r${runNo}` : `st-${type}`);

  // Every size and choice is drawn here, in one fixed order, before anything
  // is asked of the API: a second run draws the same plan whatever it finds
  // already made. (New draws go at the end, so the plan of a project an
  // earlier version ran on stays what it was.)
  const plan = {
    staff: rng.shuffle(company.people.filter((p) => !p.persona && !p.isOwner)).slice(0, ctx.count(1, 2)),
    wbsChildren: WBS_ROOTS.map(() => ctx.count(1, 3)),
    buildings: ctx.count(1, 3),
    levels: [0, 1, 2].map(() => ctx.count(1, 4)),
    zones: [0, 1, 2].map(() => ctx.count(1, 3)),
    form: rng.pick(CONTRACT_FORMS),
    clauses: rng.shuffle(CLAUSES).slice(0, ctx.count(2, 6)),
    paymentDays: rng.pick([28, 30, 45, 56]),
    defectsLiabilityDays: rng.pick([365, 400, 730]),
    ldCapPct: rng.pick([5, 10, 10, 15]),
    confirmProfile: rng.chance(0.5),
    advanceRate: rng.pick([0, 10, 10, 15]),
    advanceRecoveryRate: rng.pick([10, 20, 25]),
    retentionCapRate: rng.pick([null, 5, 10]),
    materialsOnSiteRate: rng.pick([100, 80, 70]),
    taxRate: rng.pick([0, 0, 5, 15]),
    paymentTermsDays: rng.pick([30, 45, 60]),
    months: ctx.count(2, 6),
    nextMonth: rng.chance(0.5),
    loadingRows: ctx.count(5, 12),
    revisions: ctx.count(1, 3),
    weatherDays: rng.pick([10, 15, 20, 30]),
    ldShare: rng.pick([0.0002, 0.0005, 0.001]),
  };
  plan.loading = Array.from({ length: plan.loadingRows }, () => ({
    fallback: rng.int(20, 400) * 1000,
    day: rng.int(3, 20),
    share: rng.pick([0.2, 0.25, 0.4, 0.5]),
  }));

  // ── once per company: two units of measure of its own ─────────────────────
  mine.units = mine.units || {};
  const wantedUnits = [['pallet', 'Pallet', 'count'], ['drum', 'Drum (200 l)', 'volume']];
  if (!wantedUnits.every(([code]) => mine.units[code])) {
    const existing = new Map(listOf(await qs.GET(`${P}/structure/units?includeArchived=true`)).map((u) => [u.code, u]));
    for (const [code, name, dimension] of wantedUnits) {
      if (mine.units[code]) continue;
      let unit = existing.get(code);
      if (!unit) {
        unit = await qs.POST(`${P}/structure/units`, { code, name: `${name} ${mark('unit_of_measure')}`, dimension, aliases: [`${code}s`] });
        if (!unit?.id) fail(`unit ${code} was created without an id`);
        ctx.record('unit_of_measure', unit.id, { scope: 'company' });
      }
      mine.units[code] = unit.id;
    }
  }

  // ── project parties ───────────────────────────────────────────────────────
  // POST P/parties is NOT a find-or-create: for a (company, role) already on
  // the project it UPDATES that party — contact fields replaced (null when not
  // sent), access level reset, status forced back to active, which would bring
  // the removed supplier back. So both lists are read first (`status=all` is
  // accepted but answers with the active parties only) and a party is posted
  // only when none matches. Every party call also rewrites the project's
  // clientName, consultantName and contractorName from the active parties
  // (company-party.service updateLegacyPartyNames): those fields stop matching
  // the spec, by the product's design.
  ctx.refs.parties = ctx.refs.parties || {};
  const partyRows = [...listOf(await pm.GET(`${P}/parties`)), ...listOf(await pm.GET(`${P}/parties?status=inactive`))];
  const ensureParty = async (key, body) => {
    const known = partyRows.find((row) => row.id === ctx.refs.parties[key]) || partyRows.find((row) => row.companyId === body.companyId && row.role === body.role);
    if (known) {
      ctx.refs.parties[key] = known.id;
      return known;
    }
    const canary = mark('project_party');
    const party = await pm.POST(`${P}/parties`, {
      contactName: `${key} contact ${canary}`,
      contactEmail: `${key}.contact@${domain}`,
      contactPhone: '+1 555 0142',
      ...body,
    });
    if (!party?.id) fail(`the ${key} party was created without an id`);
    ctx.refs.parties[key] = party.id;
    own.parties.push(party.id);
    ctx.record('project_party', party.id);
    partyRows.push(party);
    return party;
  };
  await ensureParty('client', { role: 'owner', companyId: directory.client, accessLevel: 'read_only' });
  const consultant = await ensureParty('consultant', { role: 'consultant', companyId: directory.consultant, accessLevel: 'collaborator' });
  const subcontractor = await ensureParty('subcontractor', { role: 'subcontractor', companyId: directory.subcontractor, accessLevel: 'collaborator' });
  // The contractor is named, not picked: the first use adds the company to the directory.
  const contractorName = `${company.canary} Joint Venture Partner`;
  let contractor = partyRows.find((row) => row.id === ctx.refs.parties.contractor) || partyRows.find((row) => row.role === 'contractor' && row.company?.name === contractorName);
  if (!contractor) {
    const canary = mark('project_party');
    contractor = await pm.POST(`${P}/parties`, {
      role: 'contractor',
      companyName: contractorName,
      email: `jv@${domain}`,
      address: `7 Harbour Road ${canary}`,
      contactName: `contractor contact ${canary}`,
      contactEmail: `contractor.contact@${domain}`,
      accessLevel: 'admin',
    });
    if (!contractor?.id) fail('the contractor party was created without an id');
    own.parties.push(contractor.id);
    ctx.record('project_party', contractor.id);
    if (!mine.contractorCompany && contractor.companyId) {
      mine.contractorCompany = contractor.companyId;
      ctx.record('company', contractor.companyId, { scope: 'company' });
    }
  }
  ctx.refs.parties.contractor = contractor.id;
  // The supplier joins as a second subcontractor party and is taken off the project below.
  const supplier = await ensureParty('supplier', { role: 'subcontractor', companyId: directory.supplier, accessLevel: 'read_only' });

  // The consultant's access is raised after the fact: an update of its own.
  if (owns('parties', consultant.id) && !done('consultant.updated')) {
    await pm.PATCH(`${P}/parties/${consultant.id}`, { accessLevel: 'reviewer', contactPhone: '+1 555 0177', contactName: `Resident engineer ${mark('project_party')}` });
    finish('consultant.updated');
  }

  // ── party members ─────────────────────────────────────────────────────────
  // Staff beyond the personas join the subcontractor party and stay. One
  // persona is added and taken off again (an inactive member), and the same
  // persona is on the supplier party when that party is removed (its members
  // go inactive with it). An inactive member grants nothing
  // (project-authorization projectPartyAccessSelect reads active members of
  // active parties only); the persona keeps the company membership the
  // product adds (CompanyMembership, read by nothing that grants access).
  const guest = MEMBER_PERSONAS.filter((key) => ctx.hasPersona(key))
    .map((key) => ctx.person(key))
    .find((person) => person.persona !== 'pm' && !person.isAdmin && !person.isOwner);
  if (owns('parties', subcontractor.id) && subcontractor.status === 'active') {
    for (const [i, person] of plan.staff.entries()) {
      const key = `staff:${person.id}`;
      if (own.members[key]) continue;
      const member = await pm.POST(`${P}/parties/${subcontractor.id}/members`, { userId: person.id, role: i === 0 ? 'member' : 'coordinator' });
      if (!member?.id) fail(`party member ${person.email} was added without an id`);
      own.members[key] = ctx.record('project_party_member', member.id);
    }
    if (!plan.staff.length && !done('note.staff')) {
      ctx.note('party members: the company has no staff beyond the personas, so no member stays active');
      finish('note.staff');
    }
    if (guest && !own.members.removed) {
      const member = await pm.POST(`${P}/parties/${subcontractor.id}/members`, { userId: guest.id, role: 'coordinator' });
      if (!member?.id) fail(`party member ${guest.email} was added without an id`);
      own.members.removed = ctx.record('project_party_member', member.id);
    }
    if (guest && !done('member.removed')) {
      await pm.DELETE(`${P}/parties/${subcontractor.id}/members/${guest.id}`);
      finish('member.removed');
    }
  } else if (!done('note.subcontractor')) {
    ctx.note(`party members: the subcontractor party ${subcontractor.id} is ${owns('parties', subcontractor.id) ? subcontractor.status : 'not one this driver made'}; no members added`);
    finish('note.subcontractor');
  }
  if (supplier.status === 'active' && owns('parties', supplier.id)) {
    if (guest && !own.members.supplier) {
      const member = await pm.POST(`${P}/parties/${supplier.id}/members`, { userId: guest.id, role: 'member' });
      if (!member?.id) fail(`supplier party member ${guest.email} was added without an id`);
      own.members.supplier = ctx.record('project_party_member', member.id);
    }
    await pm.DELETE(`${P}/parties/${supplier.id}`);
  } else if (supplier.status === 'active') {
    if (!done('note.supplier')) ctx.note(`project parties: the supplier party ${supplier.id} was not made by this driver, so it is left active`);
    finish('note.supplier');
  } else if (guest && !own.members.supplier && !done('note.supplier')) {
    ctx.note('party members: the supplier party was taken off by an earlier run, so it has no member of its own');
    finish('note.supplier');
  }
  if (!guest && !done('note.guest')) {
    ctx.note('party members: no persona outside administration to add and remove');
    finish('note.guest');
  }

  // ── WBS ───────────────────────────────────────────────────────────────────
  const wbs = new Map(listOf(await planner.GET(`${P}/structure/wbs?includeArchived=true`)).map((node) => [node.code, node]));
  const ensureWbs = async (code, name, parent, extra = {}) => {
    if (wbs.has(code)) return wbs.get(code);
    const canary = mark('wbs_node');
    const node = await planner.POST(`${P}/structure/wbs`, { code, name: `${name} — ${canary}`, parentId: parent?.id || null, externalId: canary, ...extra });
    if (!node?.id) fail(`WBS ${code} was created without an id`);
    ctx.record('wbs_node', node.id);
    own.wbs.push(node.id);
    wbs.set(code, node);
    return node;
  };
  for (const [branch, label] of WBS_ROOTS.entries()) {
    const root = await ensureWbs(label, label.replace(/^\d+\s+/, ''), null, { sortOrder: branch });
    for (let i = 0; i < plan.wbsChildren[branch]; i += 1) {
      const code = `${branch + 1}.${i + 1}`;
      // The second child of the structure and fit-out branches is a work package the subcontractor delivers.
      const isPackage = i === 1 && branch >= 1 && branch <= 2;
      const child = await ensureWbs(code, WBS_CHILDREN[branch][i], root, isPackage ? { isPackage: true, ownerPartyId: subcontractor.id } : {});
      if (i === 0 && branch === 0) await ensureWbs(`${code}.1`, 'Bulk excavation and disposal', child);
    }
  }
  const earthworks = wbs.get('1.1');
  if (owns('wbs', earthworks?.id) && !done('wbs.renamed')) {
    await planner.PATCH(`${P}/structure/wbs/${earthworks.id}`, { name: `Earthworks and dewatering — ${mark('wbs_node')}`, sortOrder: 0 });
    finish('wbs.renamed');
  }
  const provisional = await ensureWbs('9 Provisional', 'Provisional sums', null, { sortOrder: 9 });
  if (owns('wbs', provisional.id) && !done('wbs.provisional')) {
    if (provisional.status !== 'archived') await planner.POST(`${P}/structure/wbs/${provisional.id}/archive`, { reason: `Not used on this contract ${mark('wbs_node')}` });
    finish('wbs.provisional');
  }
  const temporary = await ensureWbs('8 Temporary', 'Temporary works', null, { sortOrder: 8 });
  if (owns('wbs', temporary.id) && !done('wbs.temporary')) {
    if (temporary.status !== 'archived') await planner.POST(`${P}/structure/wbs/${temporary.id}/archive`, { reason: `Filed by mistake ${mark('wbs_node')}` });
    await planner.POST(`${P}/structure/wbs/${temporary.id}/restore`, { reason: `Needed after all ${mark('wbs_node')}` });
    finish('wbs.temporary');
  }
  const wbsNow = listOf(await planner.GET(`${P}/structure/wbs?includeArchived=true`));
  ctx.refs.wbs = Object.fromEntries(wbsNow.filter((n) => n.status === 'active').map((n) => [n.code, n.id]));
  ctx.refs.wbsArchived = Object.fromEntries(wbsNow.filter((n) => n.status !== 'active').map((n) => [n.code, n.id]));
  if (owns('wbs', provisional.id) && ctx.refs.wbs['9 Provisional']) fail('WBS 9 Provisional is still active after its archive');
  if (owns('wbs', temporary.id) && !ctx.refs.wbs['8 Temporary']) fail('WBS 8 Temporary is not active after its restore');

  // ── locations: site > building > level > zone > room ─────────────────────
  const locations = new Map(listOf(await site.GET(`${P}/locations?includeArchived=true`)).filter((l) => l.code).map((l) => [l.code, l]));
  const ensureLocation = async (code, name, kind, parent) => {
    if (locations.has(code)) return locations.get(code);
    const canary = mark('location');
    const row = await site.POST(`${P}/locations`, { code, name: `${name} — ${canary}`, kind, parentId: parent?.id || null, description: `${kind} of ${project.name} ${canary}` });
    if (!row?.id) fail(`location ${code} was created without an id`);
    ctx.record('location', row.id);
    own.locations.push(row.id);
    locations.set(code, row);
    return row;
  };
  const siteNode = await ensureLocation('SITE', 'Main site', 'site', null);
  const buildings = [];
  for (let b = 1; b <= plan.buildings; b += 1) {
    const building = await ensureLocation(`B${b}`, `Building ${b}`, 'building', siteNode);
    buildings.push(building);
    for (let l = 0; l < plan.levels[b - 1]; l += 1) {
      const level = await ensureLocation(`B${b}-L${pad2(l)}`, l === 0 ? 'Ground floor' : `Level ${l}`, 'level', building);
      if (l > 0) continue;
      for (let z = 0; z < plan.zones[b - 1]; z += 1) {
        const zone = await ensureLocation(`B${b}-L00-Z${'ABC'[z]}`, `Zone ${'ABC'[z]}`, 'zone', level);
        if (b === 1 && z === 0) await ensureLocation('B1-L00-ZA-R01', 'Plant room', 'room', zone);
      }
    }
  }
  await ensureLocation('EXT', 'External works area', 'external', siteNode);
  // The buildings in reverse order: only sortOrder changes, and only on the buildings this driver made.
  if (buildings.length > 1 && buildings.every((b) => owns('locations', b.id)) && !done('locations.reordered')) {
    await planner.POST(`${P}/locations/reorder`, { parentId: siteNode.id, orderedIds: buildings.map((b) => b.id).reverse() });
    finish('locations.reordered');
  }
  const laydown = await ensureLocation('LAY', 'Temporary laydown area', 'area', siteNode);
  if (owns('locations', laydown.id) && !done('location.laydown')) {
    if (laydown.status !== 'archived') await planner.POST(`${P}/locations/${laydown.id}/archive`, { reason: `Handed back to the client ${mark('location')}` });
    finish('location.laydown');
  }
  const gate = await ensureLocation('GATE2', 'Second site entrance', 'area', siteNode);
  if (owns('locations', gate.id) && !done('location.gate')) {
    if (gate.status !== 'archived') await planner.POST(`${P}/locations/${gate.id}/archive`, { reason: `Closed during piling ${mark('location')}` });
    await planner.POST(`${P}/locations/${gate.id}/restore`, { reason: `Reopened ${mark('location')}` });
    await site.PATCH(`${P}/locations/${gate.id}`, { description: `Deliveries only, 07:00-15:00 ${mark('location')}` });
    finish('location.gate');
  }
  const locationsNow = listOf(await site.GET(`${P}/locations?includeArchived=true`)).filter((l) => l.code);
  ctx.refs.locations = Object.fromEntries(locationsNow.filter((l) => l.status === 'active').map((l) => [l.code, l.id]));
  ctx.refs.locationsArchived = Object.fromEntries(locationsNow.filter((l) => l.status !== 'active').map((l) => [l.code, l.id]));
  if (owns('locations', laydown.id) && ctx.refs.locations.LAY) fail('location LAY is still active after its archive');
  if (owns('locations', gate.id) && !ctx.refs.locations.GATE2) fail('location GATE2 is not active after its restore');

  // ── contract profile: the form of contract, its periods and clauses ──────
  // An earlier version recorded the project's id under contract_profile; the
  // profile's own id is never given by the API, so that entry goes.
  if (Array.isArray(ctx.records.contract_profile)) {
    ctx.records.contract_profile = ctx.records.contract_profile.filter((id) => id !== project.id);
    if (!ctx.records.contract_profile.length) delete ctx.records.contract_profile;
  }
  let profile = await qs.GET(`${P}/contract`);
  if (!profile.exists) {
    const { form } = plan;
    const clauses = plan.clauses.map(([category, title, days, text], i) => {
      const canary = mark('contract_profile');
      return {
        category,
        reference: `Sub-Clause ${8 + i}.${1 + (i % 4)} ${canary}`,
        title: `${title} ${canary}`,
        summary: `${text} ${canary}`,
        excerpt: `${text} (${canary})`,
        days,
        status: i === 1 ? 'rejected' : i === 2 ? 'confirmed' : 'draft',
        source: 'manual',
      };
    });
    profile = await qs.PUT(`${P}/contract`, {
      form,
      paymentDays: plan.paymentDays,
      defectsLiabilityDays: plan.defectsLiabilityDays,
      ldCapPct: plan.ldCapPct,
      ...(form === 'custom' ? { delayNoticeDays: 21, claimParticularsDays: 35, variationNoticeDays: 14, responseDays: 28 } : {}),
      clauses,
    });
    if (!profile?.exists) fail('the contract profile was saved but reads as not existing');
    finish('contract.made');
  }
  // Half the projects have a profile the PM has confirmed (its draft clauses become confirmed).
  if (plan.confirmProfile && done('contract.made') && !profile.confirmedAt && !done('contract.confirmed')) {
    profile = await pm.PUT(`${P}/contract`, { confirm: true });
    if (!profile?.confirmedAt) fail('the contract profile was confirmed but carries no confirmation');
    finish('contract.confirmed');
  }
  ctx.refs.contractProfile = { projectId: project.id, form: profile.form, confirmed: Boolean(profile.confirmedAt) };

  // ── prime contract: the terms the client is billed under ─────────────────
  // The first read or write of P/prime-contract creates the row (the project's
  // value, its default retention), so it is touched only while there is no
  // ref. client-billing.js later sets terms of its own over these.
  if (!ctx.refs.primeContract) {
    const canary = mark('prime_contract');
    const { advanceRate } = plan;
    const saved = await qs.PATCH(`${P}/prime-contract`, {
      title: `${project.name} — main contract ${canary}`.slice(0, 200),
      clientCompanyId: directory.client,
      ...(PRIME_TYPE[project.contractType] ? { contractType: PRIME_TYPE[project.contractType] } : {}),
      status: 'active',
      retentionRate: project.defaultRetentionRate ?? 5,
      retentionCapRate: plan.retentionCapRate,
      advanceRate,
      advanceRecoveryRate: advanceRate ? plan.advanceRecoveryRate : 0,
      materialsOnSiteRate: plan.materialsOnSiteRate,
      taxRate: plan.taxRate,
      paymentTermsDays: plan.paymentTermsDays,
      startDate: project.startDate,
      completionDate: project.endDate,
      notes: `Terms entered from the signed agreement ${canary}`,
    });
    if (!saved?.id) fail('the prime contract answered without an id');
    ctx.refs.primeContract = saved.id;
    ctx.record('prime_contract', saved.id);
  }

  // ── the project's own contract fields ─────────────────────────────────────
  // Delay damages per day and the weather allowance. The working calendar is
  // a field of the project too (there is no calendar record): it is sent back
  // as it was set when the project was created.
  if (!ctx.refs.projectTerms) {
    const saved = await pm.PATCH(`/projects/${project.id}`, {
      ldRatePerDay: Math.round(project.contractValue * plan.ldShare),
      weatherAllowanceDays: plan.weatherDays,
      projectCalendar: project.projectCalendar,
    });
    if (Number(saved?.weatherAllowanceDays) !== plan.weatherDays) fail(`the project's weather allowance reads ${saved?.weatherAllowanceDays} after it was set to ${plan.weatherDays}`);
    ctx.refs.projectTerms = { ldRatePerDay: saved.ldRatePerDay, weatherAllowanceDays: saved.weatherAllowanceDays, projectCalendar: saved.projectCalendar };
  }

  // ── reporting periods: the last months of the job, and the next one ──────
  const periodRows = listOf(await cost.GET(`${P}/reports/periods`));
  const periods = new Map(periodRows.map((row) => [row.code, row]));
  // The job's last reporting month is the population's month, or the month it ended in.
  const anchor = Math.min(monthIndex(AS_OF), monthIndex(project.endDate));
  const sinceStart = Math.max(0, anchor - monthIndex(project.startDate));
  const months = Math.max(1, Math.min(plan.months, sinceStart + 1));
  const withNext = anchor === monthIndex(AS_OF) && plan.nextMonth;
  const wantedPeriods = [];
  for (let i = months - 1; i >= (withNext ? -1 : 0); i -= 1) wantedPeriods.push(periodOf(anchor - i, project.reportingCutoffDay));
  for (const wanted of wantedPeriods) {
    if (periods.has(wanted.code)) continue;
    const created = await cost.POST(`${P}/reports/periods`, { ...wanted, label: `${wanted.code} ${mark('reporting_period')}` });
    if (!created?.id || created.code !== wanted.code) fail(`reporting period ${wanted.code} answered ${created?.code} / ${created?.id}`);
    periods.set(created.code, created);
    own.periods.push(created.id);
    ctx.record('reporting_period', created.id);
  }
  const myPeriods = wantedPeriods.map((wanted) => periods.get(wanted.code));
  ctx.refs.reportingPeriods = { ...(ctx.refs.reportingPeriods || {}), ...Object.fromEntries(myPeriods.map((row) => [row.code, row.id])) };

  // ── cost loading: planned value by activity and month ────────────────────
  // Each row names an activity. The amount is a share of the activity's
  // bill (foundation's allocations) or of a drawn sum where it has none; the
  // shares this driver puts on one activity never pass the whole of it. The
  // rows are this driver's by plan index (ctx.refs.structure.loading), and a
  // row the refs lost (a run that was killed) is found again by its tag.
  if (!done('loading')) {
    const openPeriods = myPeriods.filter((row) => row.status !== 'locked');
    if (!openPeriods.length) {
      ctx.note('cost loading: every reporting period of this driver is locked, so no planned value was loaded');
    } else {
      const codes = Object.keys(ctx.refs.activities);
      const activityRows = listOf(await planner.GET(`${P}/activities`));
      const nameOf = new Map(activityRows.map((a) => [a.activityCode, a.name]));
      const billValue = {};
      for (const [boqCode, parts] of Object.entries(ctx.refs.allocations || {})) {
        for (const part of parts) billValue[part.activityCode] = (billValue[part.activityCode] || 0) + part.quantity * (ctx.refs.boqRows?.[boqCode]?.rate || 0);
      }
      // Which activity each row loads, and what share of it: a fixed function of the plan.
      const used = {};
      const assignment = plan.loading.map((draw, i) => {
        const start = (i + Math.floor(i / codes.length)) % codes.length;
        let code = null;
        for (let k = 0; k < codes.length && !code; k += 1) {
          const candidate = codes[(start + k) % codes.length];
          if ((used[candidate] || 0) + draw.share <= 1 + 1e-9) code = candidate;
        }
        let { share } = draw;
        if (!code) {
          code = [...codes].sort((a, b) => (used[a] || 0) - (used[b] || 0))[0];
          share = Math.max(0.05, round2(1 - (used[code] || 0)));
        }
        used[code] = (used[code] || 0) + share;
        return { code, share };
      });
      const rowTag = (i) => `(planned value row ${i + 1})`;
      const stMark = `${project.canary}-ST-ACTIVITY_COST_LOADING`;
      const server = new Map(listOf(await cost.GET(`${P}/reports/cost-loading`)).map((row) => [row.id, row]));
      const findTagged = (i) => [...server.values()].find((row) => String(row.notes || '').includes(stMark) && String(row.notes || '').includes(rowTag(i)));
      for (let i = 0; i < plan.loadingRows; i += 1) {
        const want = LOADING_STATES[i % LOADING_STATES.length];
        const { code, share } = assignment[i];
        const total = billValue[code] || plan.loading[i].fallback;
        let row = server.get(own.loading[i]) || findTagged(i);
        // A row found by its tag after the refs were lost is recorded if the inventory lost it too.
        if (row && !(ctx.records.activity_cost_loading || []).includes(row.id)) ctx.record('activity_cost_loading', row.id);
        if (!row) {
          const period = openPeriods[i % openPeriods.length];
          const body = {
            activityId: ctx.refs.activities[code],
            reportingPeriodId: period.id,
            plannedDate: isoDay(new Date(new Date(period.periodStart).getTime() + plan.loading[i].day * 86_400_000)),
            plannedValue: round2(total * share),
            source: 'manual',
            baselineVersion: 'BL0',
            notes: `Planned value for ${nameOf.get(code) || code} ${rowTag(i)} ${mark('activity_cost_loading')}`,
          };
          // A submitted row is sent for approval in the same step; the rest are saved first.
          row = await cost.POST(`${P}/reports/cost-loading`, want === 'submitted' ? { ...body, status: 'submitted' } : body);
          if (!row?.id) fail(`planned-value row ${i + 1} was created without an id`);
          ctx.record('activity_cost_loading', row.id);
        }
        own.loading[i] = row.id;
        if (row.status === 'draft' && want !== 'draft') row = await cost.POST(`${P}/reports/cost-loading/${row.id}/submit`);
        if (row.status === 'submitted' && want === 'approved') row = await finance.POST(`${P}/reports/cost-loading/${row.id}/approve`);
        if (row.status === 'submitted' && (want === 'rejected' || want === 'corrected')) {
          row = await pm.POST(`${P}/reports/cost-loading/${row.id}/reject`, { reason: `The amount does not match the priced bill ${mark('activity_cost_loading')}` });
        }
        // Corrected after the rejection. It stays rejected: the service would
        // take a rejected row back to submitted, the approval workflow's
        // transition table refuses it (409 APPROVAL_WORKFLOW_INVALID_TRANSITION),
        // a product finding, so the driver does not try.
        if (want === 'corrected' && row.status === 'rejected' && !String(row.notes || '').startsWith('Corrected after rejection')) {
          row = await cost.PATCH(`${P}/reports/cost-loading/${row.id}`, {
            plannedValue: round2(total * Math.min(0.3, share)),
            notes: `Corrected after rejection ${rowTag(i)} ${mark('activity_cost_loading')}`,
          });
        }
        const expected = want === 'corrected' ? 'rejected' : want;
        if (row.status !== expected) fail(`planned-value row ${i + 1} (${row.id}) is ${row.status}, expected ${expected}`);
      }
      finish('loading');
    }
  }

  // ── lock the oldest past period (EV and budget snapshots are taken) ──────
  // A hand-built programme has no baseline, so the readiness gate is not met
  // and only the PM may lock, giving a reason. Irreversible, so: at most one
  // lock per project, and only of a period this driver made.
  ctx.refs.lockedPeriods = ctx.refs.lockedPeriods || [];
  if (!done('lock')) {
    const oldest = myPeriods[0];
    const why =
      myPeriods.length < 2 ? 'the project has only one reporting period of this driver'
        : ctx.refs.lockedPeriods.length ? `${ctx.refs.lockedPeriods.join(', ')} is locked already`
          : !owns('periods', oldest.id) ? `the oldest period ${oldest.code} was not made by this driver`
            : oldest.status === 'locked' ? `${oldest.code} was locked by somebody else`
              : String(oldest.periodEnd).slice(0, 10) >= AS_OF ? `${oldest.code} has not ended by ${AS_OF}`
                : null;
    if (why) {
      ctx.note(`period lock: none made — ${why}`);
    } else {
      await pm.POST(`${P}/reports/periods/${oldest.id}/lock`, { overrideReason: `Month closed before the baseline was agreed ${mark('reporting_period')}` });
      ctx.refs.lockedPeriods.push(oldest.code);
      own.lockedPeriod = oldest.id;
    }
    finish('lock');
  }
  if (own.lockedPeriod && !done('lock.snapshots')) {
    const after = listOf(await cost.GET(`${P}/reports/periods`)).find((row) => row.id === own.lockedPeriod);
    if (after?.status !== 'locked' || !after?.snapshot?.id) fail(`period ${after?.code} reads ${after?.status} with ${after?.snapshot?.id ? 'a' : 'no'} EV snapshot after its lock`);
    ctx.record('ev_period_snapshot', after.snapshot.id);
    const budgetSnapshot = listOf(await cost.GET(`${P}/budget/snapshots`)).find((row) => row.reportingPeriodId === own.lockedPeriod || row.reportingPeriod?.id === own.lockedPeriod);
    if (!budgetSnapshot?.id) fail(`no budget snapshot for the locked period ${after.code}`);
    ctx.record('budget_snapshot', budgetSnapshot.id);
    finish('lock.snapshots');
  }

  // ── Gantt layouts: two the planner keeps, one the PM keeps ───────────────
  // One name per author per project; saving under a name again updates it.
  const layoutLists = { planner: listOf(await planner.GET(`${P}/schedule/layouts`)), pm: listOf(await pm.GET(`${P}/schedule/layouts`)) };
  const ensureLayout = async (author, who, label, visibility, layout) => {
    const known = layoutLists[author].find((l) => l.id === own.layouts[label]) || layoutLists[author].find((l) => l.name.startsWith(`${label} `) && l.name.includes(project.canary));
    if (known) {
      own.layouts[label] = known.id;
      return;
    }
    const canary = mark('gantt_layout');
    const name = `${label} ${canary}`;
    if (name.length > 60) fail(`layout name ${name} is longer than 60 characters`);
    const saved = await who.POST(`${P}/schedule/layouts`, { name, visibility, layout: { ...layout, collapsed: [canary] } });
    if (!saved?.id) fail(`layout ${label} was saved without an id`);
    own.layouts[label] = ctx.record('gantt_layout', saved.id);
  };
  await ensureLayout('planner', planner, 'Lookahead', 'private', { timeScale: 'day', pxPerDay: 18, showBaseline: false, showHistogram: true, histogramGroup: 'resource' });
  await ensureLayout('planner', planner, 'Summary', 'project', { timeScale: 'month', pxPerDay: 3, showBaseline: true, showHistogram: false });
  // The PM's private layout is only visible to the PM: it is looked for as the PM.
  await ensureLayout('pm', pm, 'Critical', 'private', { timeScale: 'week', pxPerDay: 8, showBaseline: true });

  // ── staged schedule revisions (never activated) ──────────────────────────
  // The first is rejected; with two the second is under review; with three the
  // third import supersedes the second and stays a draft. Each step is taken
  // from the revision's state as the server has it, so a stopped run resumes.
  ctx.refs.scheduleRevisions = ctx.refs.scheduleRevisions || {};
  if (process.env.CERT_STRUCTURE_REVISIONS === 'off') {
    if (!done('note.revisions')) ctx.note('schedule revisions: left out (CERT_STRUCTURE_REVISIONS=off)');
    finish('note.revisions');
  } else {
    const readRevisions = async () => new Map(listOf(await planner.GET(`${P}/schedule/revisions`)).map((r) => [r.id, r]));
    let server = await readRevisions();
    const statusOf = (id) => server.get(id)?.status;
    // An import supersedes every open revision that is not active: one this driver did not make is never put at risk.
    const foreign = [...server.values()].filter((r) => !own.revisions.includes(r.id) && !r.isActive && OPEN_REVISION.includes(r.status));
    const activityRows = listOf(await planner.GET(`${P}/activities`)).slice(0, 12).map((a) => ({ code: a.activityCode, name: a.name }));
    const staged = async (k) => {
      if (own.revisions[k]) return own.revisions[k];
      if (foreign.length) {
        ctx.note(`schedule revisions: not staged — ${foreign.length} open revision(s) this driver did not make would be superseded`);
        return null;
      }
      const canary = mark('schedule_revision');
      const result = await planner.upload('POST', `${P}/import/xer`, {
        filename: `${canary}.xer`,
        contentType: 'application/octet-stream',
        body: buildXer({ canary, activities: activityRows, startDate: project.startDate }),
      });
      if (!result?.revisionId) fail('the XER import answered without a revision id');
      own.revisions.push(result.revisionId);
      ctx.record('schedule_revision', result.revisionId);
      if (result.document?.documentId) ctx.record('project_document', result.document.documentId);
      server = await readRevisions();
      return result.revisionId;
    };
    const review = async (id) => {
      await planner.POST(`${P}/schedule/revisions/${id}/submit-review`, { comment: `Revised sequence for review ${mark('schedule_revision')}` });
      server = await readRevisions();
    };
    const expect = (id, status) => {
      if (statusOf(id) !== status) fail(`schedule revision ${id} is ${statusOf(id)}, expected ${status}`);
    };
    const first = await staged(0);
    if (first) {
      if (statusOf(first) === 'draft') await review(first);
      if (statusOf(first) === 'under_review') {
        await pm.POST(`${P}/schedule/revisions/${first}/reject`, { reason: `Logic between the frame and the fit-out is missing ${mark('schedule_revision')}` });
        server = await readRevisions();
      }
      expect(first, 'rejected');
      const second = plan.revisions >= 2 ? await staged(1) : null;
      if (second) {
        if (statusOf(second) === 'draft' && !own.revisions[2]) await review(second);
        const third = plan.revisions >= 3 ? await staged(2) : null;
        if (third) {
          expect(second, 'superseded');
          expect(third, 'draft');
        } else if (plan.revisions < 3) {
          expect(second, 'under_review');
        }
      }
    }
    for (const id of own.revisions) ctx.refs.scheduleRevisions[id] = statusOf(id) || ctx.refs.scheduleRevisions[id];
  }
};

module.exports = { name: 'structure', needs: ['foundation'], depths: ['standard'], run };
