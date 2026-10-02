'use strict';

/**
 * Project structure and contract set-up: what a contractor fills in after the
 * programme and the bill exist and before work is recorded.
 *
 *   units of measure      two company units (once per company)                 qs
 *   project parties       client, consultant, contractor, subcontractor(s);    pm
 *                         one removed (inactive); party members where the
 *                         company has staff beyond the personas
 *   WBS                   the four branches the programme uses, children,      planner
 *                         work packages owned by the subcontractor party,
 *                         one node archived, one archived and restored
 *   locations             site > building > level > zone > room, an external   site, planner
 *                         area, one archived, one archived and restored
 *   contract profile      form of contract, notice periods, clauses            qs, pm confirms
 *   prime contract        client company, retention, advance, tax, terms       qs
 *   reporting periods     the last months of the job (and the next one)        cost
 *   cost loading          planned-value rows: draft, submitted, approved,      cost, finance, pm
 *                         rejected, rejected-then-corrected-and-approved
 *   period lock           the oldest past period, with its EV and budget       pm
 *                         snapshots
 *   Gantt layouts         a private and a shared layout                        planner, pm
 *   schedule revisions    staged P6 imports that are never activated:          planner, pm
 *                         rejected, superseded, under review / draft
 *
 * Every step looks for what is already there first (by code, name or
 * company), so the driver can be run again on the same project.
 *
 * Left for later drivers in ctx.refs: wbs {code: id}, locations {code: id}
 * (active ones only; the archived ones are in wbsArchived / locationsArchived),
 * parties {client, consultant, contractor, subcontractor, supplier: id},
 * reportingPeriods {code: id}, lockedPeriods [code], primeContract (id),
 * scheduleRevisions {id: status}.
 *
 * Two things the API does not offer and so are not here: a calendar or
 * working-day record (the project carries only `projectCalendar`, set when
 * the project was created), and a schedule revision made without a file or
 * AI (a hand-built programme has none). The revisions below come from a small
 * P6 XER file built in memory; they stay staged, so the project's activities
 * are never touched. Set CERT_STRUCTURE_REVISIONS=off to leave them out.
 */

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

const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.periods || data?.activities || []);
const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (date) => date.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthIndex = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const round2 = (n) => Math.round(n * 100) / 100;

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

const run = async (ctx) => {
  const pm = ctx.who('pm');
  const planner = ctx.who('planner');
  const qs = ctx.who('qs');
  const cost = ctx.who('cost');
  const site = ctx.who('site');
  const finance = ctx.who('finance');
  const { P, rng, company, project } = ctx;
  const directory = ctx.companyRefs.directory || {};
  const domain = `parties.c${company.code}.octapm-cert.test`;
  const mine = (ctx.companyRefs.structure = ctx.companyRefs.structure || {});

  // A canary names one record. ctx.canary counts from 1 on every run, so a
  // later run marks whatever it still has to make with its run number.
  const runNo = (ctx.refs.structureRuns = (ctx.refs.structureRuns ?? (ctx.refs.wbs ? 1 : 0)) + 1);
  const mark = (type) => ctx.canary(runNo > 1 ? `${type}-r${runNo}` : type);

  // Every size and choice is drawn here, in one fixed order, before anything
  // is asked of the API: a second run then draws the same plan whatever it
  // finds already made, and adds nothing.
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

  // ── once per company: two units of measure of its own ─────────────────────
  mine.units = mine.units || {};
  await ctx.attempt('units of measure', async () => {
    const wanted = [['pallet', 'Pallet', 'count'], ['drum', 'Drum (200 l)', 'volume']];
    if (wanted.every(([code]) => mine.units[code])) return;
    const existing = new Map(listOf(await qs.GET(`${P}/structure/units?includeArchived=true`)).map((u) => [u.code, u]));
    for (const [code, name, dimension] of wanted) {
      if (mine.units[code]) continue;
      let unit = existing.get(code);
      if (!unit) {
        unit = await qs.POST(`${P}/structure/units`, { code, name: `${name} ${mark('unit_of_measure')}`, dimension, aliases: [`${code}s`] });
        ctx.record('unit_of_measure', unit.id, { scope: 'company' });
      }
      mine.units[code] = unit.id;
    }
  });

  // ── project parties ───────────────────────────────────────────────────────
  // POST P/parties is find-or-create on (company, role), so a party that is
  // already there is left as it is and only a new one is recorded.
  ctx.refs.parties = ctx.refs.parties || {};
  // Both lists are read: `status=all` is accepted but answers with the active parties only.
  const partyRows = [...listOf(await pm.GET(`${P}/parties`)), ...listOf(await pm.GET(`${P}/parties?status=inactive`))];
  const ensureParty = async (key, body) => {
    const known = partyRows.find((row) => row.id === ctx.refs.parties[key]) || partyRows.find((row) => body.companyId && row.companyId === body.companyId && row.role === body.role);
    if (known) {
      ctx.refs.parties[key] = known.id;
      return { ...known, created: false };
    }
    const canary = mark('project_party');
    const party = await pm.POST(`${P}/parties`, {
      contactName: `${key} contact ${canary}`,
      contactEmail: `${key}.contact@${domain}`,
      contactPhone: '+1 555 0142',
      ...body,
    });
    ctx.refs.parties[key] = party.id;
    ctx.record('project_party', party.id);
    return { ...party, created: true };
  };
  if (directory.client) await ensureParty('client', { role: 'owner', companyId: directory.client, accessLevel: 'read_only' });
  let consultant = null;
  if (directory.consultant) consultant = await ensureParty('consultant', { role: 'consultant', companyId: directory.consultant, accessLevel: 'collaborator' });
  let subcontractor = null;
  if (directory.subcontractor) subcontractor = await ensureParty('subcontractor', { role: 'subcontractor', companyId: directory.subcontractor, accessLevel: 'collaborator' });
  // The contractor is named, not picked: the first use adds the company to the directory.
  if (!ctx.refs.parties.contractor) {
    const name = `${company.canary} Joint Venture Partner`;
    const already = partyRows.find((row) => row.role === 'contractor' && row.company?.name === name);
    if (already) {
      ctx.refs.parties.contractor = already.id;
    } else {
      const canary = mark('project_party');
      const party = await pm.POST(`${P}/parties`, {
        role: 'contractor',
        companyName: name,
        email: `jv@${domain}`,
        address: '7 Harbour Road',
        contactName: `contractor contact ${canary}`,
        contactEmail: `contractor.contact@${domain}`,
        accessLevel: 'admin',
      });
      ctx.refs.parties.contractor = party.id;
      ctx.record('project_party', party.id);
      if (!mine.contractorCompany && party.companyId) {
        mine.contractorCompany = party.companyId;
        ctx.record('company', party.companyId, { scope: 'company' });
      }
    }
  }
  // The supplier joins as a second subcontractor party and is then taken off the project (status inactive).
  if (directory.supplier) {
    const supplier = await ensureParty('supplier', { role: 'subcontractor', companyId: directory.supplier, accessLevel: 'read_only' });
    if (supplier.created) await pm.DELETE(`${P}/parties/${supplier.id}`);
  }
  // The consultant's access is raised after the fact: an update of its own.
  if (consultant?.created) {
    await pm.PATCH(`${P}/parties/${consultant.id}`, { accessLevel: 'reviewer', contactPhone: '+1 555 0177', contactName: `Resident engineer ${mark('project_party')}` });
  }
  // Party members: people of the company beyond the personas (none in a small company).
  if (subcontractor?.created) {
    const { staff } = plan;
    for (const [i, person] of staff.entries()) {
      const member = await ctx.attempt(`party member ${person.email}`, () => pm.POST(`${P}/parties/${subcontractor.id}/members`, { userId: person.id, role: i === 0 ? 'member' : 'coordinator' }));
      if (!member?.id) continue;
      ctx.record('project_party_member', member.id);
      // The second one is removed again (an inactive member).
      if (i === 1) await ctx.attempt('party member removal', () => pm.DELETE(`${P}/parties/${subcontractor.id}/members/${person.id}`));
    }
    if (!staff.length) ctx.note('party members: the company has no staff beyond the personas');
  }

  // ── WBS ───────────────────────────────────────────────────────────────────
  const wbs = new Map(listOf(await planner.GET(`${P}/structure/wbs?includeArchived=true`)).map((node) => [node.code, node]));
  const createdWbs = new Set();
  const ensureWbs = async (code, name, parent, extra = {}) => {
    if (wbs.has(code)) return { ...wbs.get(code), created: false };
    const canary = mark('wbs_node');
    const node = await planner.POST(`${P}/structure/wbs`, { code, name: `${name} — ${canary}`, parentId: parent?.id || null, externalId: canary, ...extra });
    ctx.record('wbs_node', node.id);
    createdWbs.add(code);
    wbs.set(code, node);
    return { ...node, created: true };
  };
  for (const [branch, label] of WBS_ROOTS.entries()) {
    const root = await ensureWbs(label, label.replace(/^\d+\s+/, ''), null, { sortOrder: branch });
    for (let i = 0; i < plan.wbsChildren[branch]; i += 1) {
      const code = `${branch + 1}.${i + 1}`;
      // The second child of the structure and fit-out branches is a work package the subcontractor delivers.
      const isPackage = i === 1 && branch >= 1 && branch <= 2;
      const child = await ensureWbs(code, WBS_CHILDREN[branch][i], root, isPackage ? { isPackage: true, ownerPartyId: subcontractor?.id || null } : {});
      if (i === 0 && branch === 0) await ensureWbs(`${code}.1`, 'Bulk excavation and disposal', child);
    }
  }
  const renamed = wbs.get('1.1');
  if (renamed && createdWbs.has('1.1')) await planner.PATCH(`${P}/structure/wbs/${renamed.id}`, { name: `Earthworks and dewatering — ${mark('wbs_node')}`, sortOrder: 0 });
  const provisional = await ensureWbs('9 Provisional', 'Provisional sums', null, { sortOrder: 9 });
  if (provisional.created) await planner.POST(`${P}/structure/wbs/${provisional.id}/archive`, { reason: `Not used on this contract ${mark('wbs_node')}` });
  const temporary = await ensureWbs('8 Temporary', 'Temporary works', null, { sortOrder: 8 });
  if (temporary.created) {
    await planner.POST(`${P}/structure/wbs/${temporary.id}/archive`, { reason: `Filed by mistake ${mark('wbs_node')}` });
    await planner.POST(`${P}/structure/wbs/${temporary.id}/restore`, { reason: `Needed after all ${mark('wbs_node')}` });
  }
  const wbsNow = listOf(await planner.GET(`${P}/structure/wbs?includeArchived=true`));
  ctx.refs.wbs = Object.fromEntries(wbsNow.filter((n) => n.status === 'active').map((n) => [n.code, n.id]));
  ctx.refs.wbsArchived = Object.fromEntries(wbsNow.filter((n) => n.status !== 'active').map((n) => [n.code, n.id]));

  // ── locations: site > building > level > zone > room ─────────────────────
  const locations = new Map(listOf(await site.GET(`${P}/locations?includeArchived=true`)).filter((l) => l.code).map((l) => [l.code, l]));
  const ensureLocation = async (code, name, kind, parent) => {
    if (locations.has(code)) return { ...locations.get(code), created: false };
    const canary = mark('location');
    const row = await site.POST(`${P}/locations`, { code, name: `${name} — ${canary}`, kind, parentId: parent?.id || null, description: `${kind} of ${project.name} ${canary}` });
    ctx.record('location', row.id);
    locations.set(code, row);
    return { ...row, created: true };
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
  if (buildings.length > 1 && buildings.some((b) => b.created)) {
    await planner.POST(`${P}/locations/reorder`, { parentId: siteNode.id, orderedIds: buildings.map((b) => b.id).reverse() });
  }
  const laydown = await ensureLocation('LAY', 'Temporary laydown area', 'area', siteNode);
  if (laydown.created) await planner.POST(`${P}/locations/${laydown.id}/archive`, { reason: `Handed back to the client ${mark('location')}` });
  const gate = await ensureLocation('GATE2', 'Second site entrance', 'area', siteNode);
  if (gate.created) {
    await planner.POST(`${P}/locations/${gate.id}/archive`, { reason: `Closed during piling ${mark('location')}` });
    await planner.POST(`${P}/locations/${gate.id}/restore`, { reason: `Reopened ${mark('location')}` });
    await site.PATCH(`${P}/locations/${gate.id}`, { description: `Deliveries only, 07:00-15:00 ${mark('location')}` });
  }
  const locationsNow = listOf(await site.GET(`${P}/locations?includeArchived=true`)).filter((l) => l.code);
  ctx.refs.locations = Object.fromEntries(locationsNow.filter((l) => l.status === 'active').map((l) => [l.code, l.id]));
  ctx.refs.locationsArchived = Object.fromEntries(locationsNow.filter((l) => l.status !== 'active').map((l) => [l.code, l.id]));

  // ── contract profile: the form of contract, its periods and clauses ──────
  // The profile has no id of its own in the API (one per project, read and
  // written at P/contract), so it is recorded under the project's id.
  const profile = await qs.GET(`${P}/contract`);
  if (!profile.exists) {
    const { form } = plan;
    const clauses = plan.clauses.map(([category, title, days, text], i) => {
      const canary = mark('contract_profile');
      return {
        category,
        reference: `Sub-Clause ${8 + i}.${1 + (i % 4)}`,
        title: `${title} ${canary}`,
        summary: `${text} ${canary}`,
        excerpt: `${text} (${canary})`,
        days,
        status: i === 1 ? 'rejected' : i === 2 ? 'confirmed' : 'draft',
        source: 'manual',
      };
    });
    await qs.PUT(`${P}/contract`, {
      form,
      paymentDays: plan.paymentDays,
      defectsLiabilityDays: plan.defectsLiabilityDays,
      ldCapPct: plan.ldCapPct,
      ...(form === 'custom' ? { delayNoticeDays: 21, claimParticularsDays: 35, variationNoticeDays: 14, responseDays: 28 } : {}),
      clauses,
    });
    // Half the projects have a profile the PM has confirmed (its draft clauses become confirmed).
    if (plan.confirmProfile) await pm.PUT(`${P}/contract`, { confirm: true });
    ctx.record('contract_profile', project.id);
  }

  // ── prime contract: the terms the client is billed under ─────────────────
  const prime = await qs.GET(`${P}/prime-contract`);
  if (!ctx.refs.primeContract) {
    const canary = mark('prime_contract');
    const { advanceRate } = plan;
    await qs.PATCH(`${P}/prime-contract`, {
      title: `${project.name} — main contract ${canary}`.slice(0, 200),
      ...(directory.client ? { clientCompanyId: directory.client } : {}),
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
    ctx.refs.primeContract = prime.id;
    ctx.record('prime_contract', prime.id);
  }

  // ── the project's own contract fields ─────────────────────────────────────
  // Delay damages per day and the weather allowance. The working calendar is
  // a field of the project too (there is no calendar record): it is sent back
  // as it was set when the project was created.
  if (!ctx.refs.projectTerms) {
    const saved = await ctx.attempt('project contract fields', () =>
      pm.PATCH(`/projects/${project.id}`, {
        ldRatePerDay: Math.round(project.contractValue * plan.ldShare),
        weatherAllowanceDays: plan.weatherDays,
        projectCalendar: project.projectCalendar,
      })
    );
    if (saved) ctx.refs.projectTerms = { ldRatePerDay: saved.ldRatePerDay, weatherAllowanceDays: saved.weatherAllowanceDays, projectCalendar: saved.projectCalendar };
  }

  // ── reporting periods: the last months of the job, and the next one ──────
  const periodRows = listOf(await cost.GET(`${P}/reports/periods`));
  const periods = new Map(periodRows.map((row) => [row.code, row]));
  // The job's last reporting month is this month, or the month it ended in.
  const anchor = Math.min(monthIndex(ctx.today), monthIndex(project.endDate));
  const sinceStart = Math.max(0, anchor - monthIndex(project.startDate));
  const months = Math.max(1, Math.min(plan.months, sinceStart + 1));
  const withNext = anchor === monthIndex(ctx.today) && plan.nextMonth;
  const wantedPeriods = [];
  for (let i = months - 1; i >= (withNext ? -1 : 0); i -= 1) wantedPeriods.push(periodOf(anchor - i, project.reportingCutoffDay));
  for (const wanted of wantedPeriods) {
    if (periods.has(wanted.code)) continue;
    const created = await cost.POST(`${P}/reports/periods`, { ...wanted, label: `${wanted.code} ${mark('reporting_period')}` });
    periods.set(created.code, created);
    ctx.record('reporting_period', created.id);
  }
  const myPeriods = wantedPeriods.map((wanted) => periods.get(wanted.code)).filter(Boolean);
  ctx.refs.reportingPeriods = { ...(ctx.refs.reportingPeriods || {}), ...Object.fromEntries(myPeriods.map((row) => [row.code, row.id])) };
  const openPeriods = myPeriods.filter((row) => row.status !== 'locked');

  // ── cost loading: planned value by activity and month ────────────────────
  // Each row names an activity. The amount is the activity's share of the
  // bill (foundation's allocations), spread over the month it is planned in.
  const loadingMark = `${project.canary}-ACTIVITY_COST_LOADING-`;
  const loaded = listOf(await cost.GET(`${P}/reports/cost-loading`)).some((row) => String(row.notes || '').includes(loadingMark));
  if (!loaded && openPeriods.length) {
    const activityRows = listOf(await planner.GET(`${P}/activities`));
    const byCode = new Map(activityRows.map((a) => [a.activityCode, a]));
    const billValue = {};
    for (const [boqCode, parts] of Object.entries(ctx.refs.allocations || {})) {
      for (const part of parts) billValue[part.activityCode] = (billValue[part.activityCode] || 0) + part.quantity * (ctx.refs.boqRows?.[boqCode]?.rate || 0);
    }
    const codes = Object.keys(ctx.refs.activities || {});
    for (let i = 0; i < plan.loadingRows; i += 1) {
      const code = codes[i % codes.length];
      const period = openPeriods[i % openPeriods.length];
      const canary = mark('activity_cost_loading');
      const total = billValue[code] || rng.int(20, 400) * 1000;
      const plannedDate = isoDay(new Date(new Date(period.periodStart).getTime() + rng.int(3, 20) * 86_400_000));
      const state = ['approved', 'submitted', 'draft', 'rejected', 'corrected'][i % 5];
      const body = {
        activityId: ctx.refs.activities[code],
        reportingPeriodId: period.id,
        plannedDate,
        plannedValue: round2(total * rng.pick([0.2, 0.25, 0.4, 0.5])),
        source: 'manual',
        baselineVersion: 'BL0',
        notes: `Planned value for ${byCode.get(code)?.name || code} ${canary}`,
      };
      // Some are sent for approval in the same step, the rest are saved first.
      const row = await cost.POST(`${P}/reports/cost-loading`, state === 'submitted' ? { ...body, status: 'submitted' } : body);
      ctx.record('activity_cost_loading', row.id);
      if (state === 'draft' || state === 'submitted') continue;
      await cost.POST(`${P}/reports/cost-loading/${row.id}/submit`);
      if (state === 'approved') {
        await finance.POST(`${P}/reports/cost-loading/${row.id}/approve`);
        continue;
      }
      await pm.POST(`${P}/reports/cost-loading/${row.id}/reject`, { reason: `The amount does not match the priced bill ${mark('activity_cost_loading')}` });
      if (state === 'rejected') continue;
      // Corrected and sent again. The service allows a rejected row to be
      // submitted, the approval workflow's transition table does not (409
      // APPROVAL_WORKFLOW_INVALID_TRANSITION): where that refusal stands the
      // row stays rejected with its corrected amount.
      await cost.PATCH(`${P}/reports/cost-loading/${row.id}`, { plannedValue: round2(total * 0.3), notes: `Corrected after rejection ${canary}` });
      await ctx.attempt('cost loading resubmitted after rejection', async () => {
        await cost.POST(`${P}/reports/cost-loading/${row.id}/submit`);
        await finance.POST(`${P}/reports/cost-loading/${row.id}/approve`);
      });
    }
  }

  // ── lock the oldest past period (EV and budget snapshots are taken) ──────
  // A hand-built programme has no baseline, so the readiness gate is not met
  // and only the PM may lock, giving a reason.
  ctx.refs.lockedPeriods = ctx.refs.lockedPeriods || [];
  const oldest = myPeriods[0];
  if (oldest && myPeriods.length > 1 && oldest.status !== 'locked' && oldest.periodEnd.slice(0, 10) < ctx.today) {
    const locked = await ctx.attempt(`lock ${oldest.code}`, () =>
      pm.POST(`${P}/reports/periods/${oldest.id}/lock`, { overrideReason: `Month closed before the baseline was agreed ${mark('reporting_period')}` })
    );
    if (locked) {
      ctx.refs.lockedPeriods.push(oldest.code);
      const after = listOf(await cost.GET(`${P}/reports/periods`)).find((row) => row.id === oldest.id);
      if (after?.snapshot?.id) ctx.record('ev_period_snapshot', after.snapshot.id);
      const budgetSnapshot = listOf(await cost.GET(`${P}/budget/snapshots`)).find((row) => row.reportingPeriodId === oldest.id || row.reportingPeriod?.id === oldest.id);
      if (budgetSnapshot?.id) ctx.record('budget_snapshot', budgetSnapshot.id);
    }
  }

  // ── Gantt layouts: one the planner keeps, one shared with the project ────
  const layoutNames = new Set(listOf(await planner.GET(`${P}/schedule/layouts`)).map((l) => l.name));
  const saveLayout = async (who, label, visibility, layout) => {
    const canary = mark('gantt_layout');
    const name = `${label} ${canary}`.slice(0, 60);
    if ([...layoutNames].some((existing) => existing.startsWith(label))) return;
    const saved = await who.POST(`${P}/schedule/layouts`, { name, visibility, layout: { ...layout, collapsed: [canary] } });
    layoutNames.add(saved.name);
    ctx.record('gantt_layout', saved.id);
  };
  await saveLayout(planner, 'Lookahead', 'private', { timeScale: 'day', pxPerDay: 18, showBaseline: false, showHistogram: true, histogramGroup: 'resource' });
  await saveLayout(planner, 'Summary', 'project', { timeScale: 'month', pxPerDay: 3, showBaseline: true, showHistogram: false });
  // The PM's private layout is only visible to the PM: look for it as the PM.
  const pmLayouts = listOf(await pm.GET(`${P}/schedule/layouts`));
  if (!pmLayouts.some((l) => l.name.startsWith('Critical'))) {
    const canary = mark('gantt_layout');
    const saved = await pm.POST(`${P}/schedule/layouts`, { name: `Critical ${canary}`.slice(0, 60), visibility: 'private', layout: { timeScale: 'week', pxPerDay: 8, showBaseline: true, collapsed: [canary] } });
    ctx.record('gantt_layout', saved.id);
  }

  // ── staged schedule revisions (never activated) ──────────────────────────
  // rejected; then, where there are more, under review or superseded + draft.
  ctx.refs.scheduleRevisions = ctx.refs.scheduleRevisions || {};
  if (process.env.CERT_STRUCTURE_REVISIONS !== 'off') {
    await ctx.attempt('staged schedule revisions', async () => {
      if (listOf(await planner.GET(`${P}/schedule/revisions`)).length) return;
      const activityRows = listOf(await planner.GET(`${P}/activities`)).slice(0, 12).map((a) => ({ code: a.activityCode, name: a.name }));
      const stage = async () => {
        const canary = mark('schedule_revision');
        const result = await planner.upload('POST', `${P}/import/xer`, {
          filename: `${canary}.xer`,
          contentType: 'application/octet-stream',
          body: buildXer({ canary, activities: activityRows, startDate: project.startDate }),
        });
        ctx.record('schedule_revision', result.revisionId);
        if (result.document?.documentId) ctx.record('project_document', result.document.documentId);
        return result.revisionId;
      };
      const review = (id) => planner.POST(`${P}/schedule/revisions/${id}/submit-review`, { comment: `Revised sequence for review ${mark('schedule_revision')}` });
      const count = plan.revisions;
      const first = await stage();
      await review(first);
      await pm.POST(`${P}/schedule/revisions/${first}/reject`, { reason: `Logic between the frame and the fit-out is missing ${mark('schedule_revision')}` });
      ctx.refs.scheduleRevisions[first] = 'rejected';
      if (count < 2) return;
      const second = await stage();
      await review(second);
      ctx.refs.scheduleRevisions[second] = 'under_review';
      if (count < 3) return;
      // A newer import supersedes the one still under review and stays a draft.
      const third = await stage();
      ctx.refs.scheduleRevisions[second] = 'superseded';
      ctx.refs.scheduleRevisions[third] = 'draft';
    });
  }
};

module.exports = { name: 'structure', needs: ['foundation'], depths: ['standard'], run };
