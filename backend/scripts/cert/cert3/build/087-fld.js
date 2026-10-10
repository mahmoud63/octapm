'use strict';

/**
 * CERT-3 deep population, 087-FLD "CERT3 Field & quality" (plan §3.2, D1
 * company 087). Serves WP-7 (weather) and WP-8 (field, quality, documents),
 * and the WP-2 hold-point probes that need separate activities.
 *
 * Every date is relative to the run date (plan §3.2 "Relative to the run
 * date"): the dates are chosen once (step `calendar`) and kept in the state
 * file, so a resumed run on a later day builds on the same days. Every
 * transaction is dated on or before the run date; plan dates (due dates,
 * activity finishes, required-on-site) may lie after it.
 *
 * What it holds (plan §3.2, the 087-FLD row) and the answer-book keys each
 * part sets up (answers/field-controls.js WP8.*, answers/commercial.js
 * WP7.weather["087-FLD.*"]):
 *   activities   A100..A180 (9): A100 plain; A110 pending hold; A120 failed
 *                hold; A140 voided hold; A150 retroactive hold; A170 a passed
 *                (complete) instance; A130 labour (timesheet week summary and
 *                manpower report, WP8.dailyLog.weekSummaryA130 /
 *                manpowerReportA130); A160 quantity rows and the party's
 *                carpenters; A180 documents
 *   locations    three top-level places
 *   project      weatherAllowanceDays 20, set explicitly (WP8.weather.allowance)
 *   parties      a subcontractor directory company, its project party, and a
 *                party user brought in by invitation and acceptance (D-ID-1);
 *                a supplier directory company (deliveries)
 *   labour       crews of 3+ workers with different rates and overtime
 *                multipliers; timesheets: mixed day 650.00, reopened and
 *                re-approved 2,000.00, rejected-edited-approved 1,750.00, a
 *                crew-prefilled submitted sheet (3 x 8 h), a draft. The plan's
 *                0.5 crew member is served by the contract refusal (builders'
 *                adjudication 087-FLD item 1, adjudication F1): the create is
 *                refused 400 VALIDATION_ERROR naming the field in
 *                error.details, the import answers 200 with the row in
 *                errors[] and nothing made (WP8.timesheet.multiplierHalfCreate
 *                / multiplierHalfImport); the step is DONE, no 0.5 worker exists
 *   daily logs   7 days covering the six sections (manpower, equipment,
 *                deliveries, visitors, delays, notes) plus quantity rows,
 *                internal and party entries, one day approved straight from
 *                open; manpower rows on ONE day only, so the manpower report
 *                reads Steelfixer 40, Carpenter 30, Labourer absent, 70 man-
 *                hours, 8 workers over any range (WP8.dailyLog.manpower*)
 *   weather      delays of 2 h, 6 h, 10 h promoted by the planner, who holds
 *                eot:create (0.5 / 1.0 / 1.5 days, contractual by default,
 *                adjudication C4; builders' adjudication R2-16: the site
 *                engineer's promotion is a WP-7 HR-F4 probe), manual
 *                contractual 2.5 + 7.5 (13.0), then 1.0 (14.0), then a
 *                non-contractual 10 (WP7.weather["087-FLD.composition"]).
 *                GET /weather-delays is read from the product at 13 (before the
 *                1.0-day delay exists) and again at 14 (builders' adjudication
 *                087-FLD item 2); each reading is compared with the answer book
 *                in a step of its own and, while the half-days are stored
 *                truncated (Int column), is BLOCKED HR-C11 with the product's
 *                answer. The reading after the non-contractual 10 is judged the
 *                same way against WP8.weather.nonContractualAddsNothing (value
 *                14, today 12: HR-C11's known answer; round 2, R2-B5)
 *   daily report with equipment on the pending-hold activity (A110)
 *   form ITP     2 hold points + a required inspector signature; instances
 *                scheduled, in progress (A110), complete-fail (A120), void
 *                (A140), closed (A150), complete-pass (A170); then a template
 *                edit adds a hold item, which reaches the closed instance
 *                (HR-Q2 probe). The hold points before the edit are read in a
 *                step of their own (itp.holds.before-edit), so a run cut off
 *                after the edit took effect resumes past that reading (R2-C)
 *   legacy ITPs  failed, waived, passed (WP8.quality.inputs087FLD)
 *   NCRs         major open, major closed, minor open, minor submitted,
 *                minor closed (score 21, WP8.quality.dashboard087FLD); and a
 *                6-major variant on a project of its own (WP8.quality.sixMajor)
 *   punch        draft 2, open 2, ready 1, dispute 1, closed 1, void 1, all
 *                with a final approver (WP8.punch.mix / openDefects 6)
 *   observations one per type: safety open, environmental draft, the other
 *                three closed or void (WP8.punch.openObservations 2)
 *   safety       open near miss, closed LTI with lost days, archived near miss
 *                (WP8.safety.inputs)
 *   RFIs         open overdue only by responseRequiredBy, answered after its
 *                dueDate, closed with a 3-day schedule impact, archived; a
 *                draft is refused at HEAD (RFI-DRAFT, BLOCKED)
 *   submittals   one direct, one on a 2-step template (QS 3 d, Planner 4 d)
 *                (WP8.submittal.submitByDirect / submitByTemplated)
 *   drawing S-1  revisions A-F (A superseded, B approved and current, C-F not
 *                approved) and the current-only fixture X1 filed approved and
 *                not latest (WP8.drawing.currentOnlyFixture)
 *   transmittal  citing S-1 rev B and an activity (WP8.transmittal.activityAndRevision);
 *                the revision is filed through document control (builders'
 *                adjudication 087-FLD item 5), persisted as finding WP8-TRN-1
 *   notice       a contractual notice letter linked to a weather delay
 *                (WP8.transmittal.noticeLetterReadBack)
 *   meeting      action items with createTask, a change event raised from an
 *                action item (WP8.transmittal.meetingChangeEventReadBack)
 *
 * Resumable (adjudication G4, R2-11): every create has a find that reads the
 * live record (its clientRequestId, its b.name text, its revision code and
 * file name, or its id on the record that lists it). The workflow evidence
 * uploads have none: the product lists an upload only once a record cites
 * it, so an interrupted one stops the build for a check by hand (fail
 * closed). Every step whose records have no read-back route re-reads them
 * live in its verify. Records are picked by identity, never by position (G6).
 *
 * Run (debug, through the proof lock, from backend/ with DATABASE_URL unset):
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-fld.js
 */

const zlib = require('zlib');
const lib = require('./lib');

const { is, dates } = lib;
const FC = lib.answers.fieldControls;
const CM = lib.answers.commercial;
const WP8 = FC.WP8;
const COMPOSITION = CM.WP7.weather['087-FLD.composition'];

// ── small real files ─────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
/** A valid 1x1 PNG whose text chunk carries `text`. */
const png = (text) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  const seed = crc32(Buffer.from(text, 'latin1'));
  const pixel = Buffer.from([0, seed & 0xff, (seed >>> 8) & 0xff, (seed >>> 16) & 0xff]);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')),
    pngChunk('IDAT', zlib.deflateSync(pixel)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
/** A minimal one-page PDF with `text` on the page. */
const pdf = (text) => {
  const stream = `BT /F1 11 Tf 40 780 Td (${String(text).replace(/[()\\]/g, ' ')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

// ── reading answers ──────────────────────────────────────────────────────────
const LIST_KEYS = ['rows', 'items', 'records', 'drawings', 'incidents', 'transmittals', 'correspondence', 'templates', 'data'];
const rowsOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of LIST_KEYS) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const num = (value) => (value === null || value === undefined || value === '' ? null : Number(value));
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── the plan's fixed inputs ──────────────────────────────────────────────────
const ACTIVITIES = [
  // code, title, role in the build
  ['A100', 'Site clearance and set-out', 'plain'],
  ['A110', 'Pile caps', 'pending hold'],
  ['A120', 'Ground beams', 'failed hold'],
  ['A130', 'Foundation steelfixing', 'labour'],
  ['A140', 'Column kickers', 'voided hold'],
  ['A150', 'Slab on grade', 'retroactive hold'],
  ['A160', 'Blockwork level 1', 'quantity'],
  ['A170', 'Roof waterproofing', 'passed instance'],
  ['A180', 'MEP first fix', 'documents'],
];

// Timesheet rates (WP8.timesheet: 50.00/h; the mixed crew differs in rate and multiplier).
const RATE = 50;
const WORKERS = [
  // key, trade, rate, overtime multiplier
  ['W1', 'Steelfixer', 50, 1.5],
  ['W2', 'Steelfixer', 50, 1.5],
  ['W3', 'Steelfixer', 50, 1.5],
  ['W4', 'Steelfixer', 50, 1.5],
  ['W5', 'Steelfixer', 50, 1.5],
  ['W6', 'Mason', 40, 1.25],
  ['W7', 'Mason', 60, 2],
  ['W8', 'Labourer', 45, 1],
];

// The answer book's figures this build sets up, checked once against its own rules.
const PROMOTED_HOURS = [2, 6, 10];
const PROMOTED_DAYS = COMPOSITION.value.promoted; // [0.5, 1.0, 1.5]
const MANUAL_13 = COMPOSITION.value.at13Manual; // [2.5, 7.5]
const MANUAL_14 = COMPOSITION.value.at14Add; // [1.0]
const NON_CONTRACTUAL = COMPOSITION.value.nonContractual; // [10]

/** The build, exported so a scratch copy under another code can prove a from-scratch run (see the foot). */
const build = async (b) => {
  // The answer book agrees with itself before anything is built on it.
  b.assert(sameList(PROMOTED_HOURS.map(FC.rules.promoteDays), PROMOTED_DAYS), `promotion rule gives ${PROMOTED_DAYS} for ${PROMOTED_HOURS} h`);
  b.assert(sameList(PROMOTED_DAYS, [WP8.dailyLog.promote2h.value, WP8.dailyLog.promote6h.value, WP8.dailyLog.promote10h.value]), 'the two books agree on the promoted days');
  b.assert(WP8.weather.allowance.value === 20, 'allowance 20 (WP8.weather.allowance)');
  b.assert(WP8.timesheet.mixedDay.value === 65000 && WP8.timesheet.reopenTwoThousand.value === 200000 && WP8.timesheet.rejectEditApprove.value === 175000, 'timesheet figures 650.00 / 2,000.00 / 1,750.00');
  // HR-C11's known answer is carried by both books (commercial composition.today, field-controls todayBelow / todayAt).
  b.assert(COMPOSITION.today.at13Pct === WP8.weather.todayBelow.value && COMPOSITION.today.at14Pct === WP8.weather.todayAt.value, 'the two books agree on HR-C11\'s known answer at 13 and 14');
  b.assert(sameList(PROMOTED_DAYS, CM.WP7.weather['087-FLD.promoted.days'].value) && CM.WP7.weather['087-FLD.promoted.contractual'].value === true, 'the promoted delays are 0.5 / 1.0 / 1.5, contractual (WP7.weather["087-FLD.promoted.*"])');
  // R2-B5: the non-contractual invariance is judged against WP8.weather.nonContractualAddsNothing, whose value is
  // the book's figure at 14 and whose `today` is HR-C11's known answer at 14 (the composition's at14Used).
  const NON_CONTRACTUAL_LEAF = WP8.weather.nonContractualAddsNothing;
  b.assert(NON_CONTRACTUAL_LEAF.value === WP8.weather.atContractualUsed.value && NON_CONTRACTUAL_LEAF.today === COMPOSITION.today.at14Used, `WP8.weather.nonContractualAddsNothing (value ${NON_CONTRACTUAL_LEAF.value}, today ${NON_CONTRACTUAL_LEAF.today}) agrees with WP8.weather.atContractualUsed (${WP8.weather.atContractualUsed.value}) and HR-C11's known answer at 14 (${COMPOSITION.today.at14Used})`);
  // R2-F: the meeting change event's ROM and schedule impact are compared as the book's numbers, a value required.
  const CE_BOOK = WP8.transmittal.meetingChangeEventReadBack.value;
  b.assert(Number.isFinite(CE_BOOK.romAmount) && Number.isFinite(CE_BOOK.scheduleImpactDays), 'WP8.transmittal.meetingChangeEventReadBack carries romAmount and scheduleImpactDays as numbers', CE_BOOK);

  /** G6: the one record a predicate names, or null; two that match is an ambiguity, never a pick. */
  const one = (rows, predicate, what) => {
    const hits = (rows || []).filter(predicate);
    b.assert(hits.length <= 1, `${what}: at most one record matches, found ${hits.length}`, hits.map((row) => row.id));
    return hits.length === 1 ? hits[0] : null;
  };
  /** A money field against an answer-book key held in cents. */
  const cents = (key, label) => (v) => lib.toCents(v) === key.value || `${label} ${key.value} cents`;

  // ── calendar: the days, chosen once from the run date ───────────────────────
  const cal = await b.step('calendar', async () => {
    const day = (n) => b.date(n);
    return {
      runDate: b.today,
      projectStart: day(-56),
      projectEnd: dates.addDays(b.today, 240),
      // D1..D7, oldest first: the seven daily logs
      logDays: [-7, -6, -5, -4, -3, -2, -1].map(day),
      reportDay: day(-2),
      issueDay: day(-20),
    };
  });
  const D = cal.logDays; // D[0] = D1 ... D[6] = D7
  const later = (n) => dates.addDays(cal.runDate, n); // a plan date (due, finish), never a transaction
  const before = (n) => dates.addDays(cal.runDate, -n); // a transaction date
  for (const d of [...D, cal.reportDay, cal.issueDay, cal.projectStart]) b.past(d);

  // ── the project ─────────────────────────────────────────────────────────────
  await b.project({
    title: 'Field & quality',
    payload: {
      startDate: cal.projectStart,
      endDate: cal.projectEnd,
      projectCalendar: 'five_day',
      currency: 'EGP',
      type: 'building',
      contractType: 'unit_rate',
      weatherAllowanceDays: WP8.weather.allowance.value, // WP8.weather.allowance / WP7.weather["087-FLD.allowance"]: set explicitly
    },
    fields: { projectCalendar: 'five_day', currency: 'EGP', weatherAllowanceDays: WP8.weather.allowance.value, startDate: is.day(cal.projectStart) },
  });
  const P = b.P;

  await b.team({ planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', site: 'site_engineer', quality: null, warehouse: 'warehouse' });
  const user = {};
  for (const key of ['pm', 'planner', 'qs', 'cost', 'site', 'quality', 'warehouse']) user[key] = await b.userId(key);

  // ── activities ──────────────────────────────────────────────────────────────
  const acts = await b.step('activities', async (s) => {
    const out = {};
    const listed = rowsOf(await s.get('planner', `${P}/activities`));
    for (const [index, [code, title, role]] of ACTIVITIES.entries()) {
      const start = dates.addDays(cal.projectStart, 7 + index * 3);
      const name = b.name(`${code} ${title}`);
      const data = await s.create(`activity.${code}`, 'planner', `${P}/activities`, {
        name,
        activityCode: code,
        wbsCode: `FLD.${index + 1}`,
        category: 'structural',
        startDate: start,
        endDate: dates.addDays(start, 40),
        duration: 28,
        engineerIds: [user.site],
      }, {
        fields: { name, activityCode: code },
        find: async () => one(listed, (row) => row.activityCode === code && row.name === name, `activity ${code}`),
      });
      out[code] = { id: data.id, role };
    }
    return out;
  });
  const A = Object.fromEntries(Object.entries(acts).map(([code, row]) => [code, row.id]));

  // ── locations ───────────────────────────────────────────────────────────────
  const locations = await b.step('locations', async (s) => {
    const out = {};
    for (const [key, code, kind, title] of [['zoneA', 'FLD-ZONE-A', 'zone', 'Foundation zone grid A-C'], ['zoneB', 'FLD-ZONE-B', 'zone', 'Superstructure zone grid C-F'], ['yard', 'FLD-YARD', 'area', 'Laydown yard']]) {
      const name = b.name(title);
      const data = await s.create(`location.${key}`, 'planner', `${P}/locations`, { name, code, kind, description: b.name(`${title}, where field records are pinned`) }, {
        fields: { name, code, kind },
        get: `${P}/locations`,
        find: async (s2) => one(rowsOf(await s2.get('planner', `${P}/locations`)), (row) => row.code === code, `location ${code}`),
      });
      out[key] = data.id;
    }
    return out;
  });

  // ── the subcontractor, its party and the party user; the supplier ───────────
  const companies = await b.step('companies', async (s) => {
    const out = {};
    for (const [key, title, type] of [['subcontractor', 'Delta Formwork Subcontractors', 'subcontractor'], ['supplier', 'Nile Cement Supply', 'supplier']]) {
      const name = b.name(title);
      const search = `/companies?limit=100&search=${encodeURIComponent(name)}`;
      const data = await s.create(`company.${key}`, 'pm', '/companies', { name, type, status: 'active' }, {
        fields: { name, type, status: 'active' },
        get: search,
        adopt: true,
        find: async (s2) => one(rowsOf(await s2.get('pm', search)), (row) => row.name === name, `company ${name}`),
      });
      out[key] = data.id;
    }
    return out;
  });

  const party = await b.step('party', async (s) => {
    const data = await s.create('party.subcontractor', 'pm', `${P}/parties`, {
      role: 'subcontractor',
      companyId: companies.subcontractor,
      accessLevel: 'collaborator',
      contactName: b.name('Delta site foreman'),
    }, {
      fields: { role: 'subcontractor', companyId: companies.subcontractor, status: 'active' },
      get: `${P}/parties`,
      find: async (s2) => one(rowsOf(await s2.get('pm', `${P}/parties`)), (row) => row.companyId === companies.subcontractor && row.role === 'subcontractor', 'the subcontractor party'),
    });
    return { partyId: data.id };
  }, { needs: ['companies'] });

  // The party user: a person NOT in the population, by invitation and acceptance (plan §3.3, D-ID-1).
  await b.invite('party', {
    inviter: 'pm',
    email: `cert3.${b.code.toLowerCase()}.party@${b.company.domain}`,
    role: 'site_engineer',
    name: b.name('Delta foreman'),
    projectId: b.projectId,
    projectPartyId: party.partyId,
  });
  const partyUserId = await b.userId('party');

  await b.step('party.member', async (s) => {
    const parties = rowsOf(await s.get('pm', `${P}/parties`));
    const row = one(parties, (p) => p.id === party.partyId, `party ${party.partyId}`);
    s.assert(Boolean(row), `the subcontractor party ${party.partyId} is listed`);
    const members = row.members || [];
    s.note(`party members: ${JSON.stringify(members.map((m) => ({ userId: m.userId, status: m.status }))).slice(0, 300)}`);
    s.assert(members.some((m) => m.userId === partyUserId && (m.status || 'active') === 'active'), `the invited party user ${partyUserId} is an active member of the subcontractor party`, members);
    const team = rowsOf(await s.get('pm', `${P}/team`));
    const assignments = team.filter((t) => t.userId === partyUserId && t.assignmentRole);
    s.assert(assignments.length === 0, 'the party user holds no project assignment (party-scoped access)', assignments);
    return { partyUserId };
  }, { needs: ['party', 'invite.party'] });

  // ── equipment and the BOQ row the quantity rows name ────────────────────────
  const equipment = await b.step('equipment', async (s) => {
    const name = b.name('Excavator 20 t');
    const data = await s.create('equipment.excavator', 'planner', `${P}/equipment`, { name, rateType: 'hourly', rate: 250 }, {
      fields: { name, rateType: 'hourly' },
      get: `${P}/equipment`,
      find: async (s2) => one(rowsOf(await s2.get('planner', `${P}/equipment`)), (row) => row.name === name, `equipment ${name}`),
    });
    return { equipmentId: data.id };
  });

  const boq = await b.step('boq', async (s) => {
    const code = b.ref('B01');
    const description = b.name('Blockwork walls 200 mm');
    // The create answers { item, financial }; the bill lists the row itself: either shape is read.
    const itemField = (key, value) => (v, d) => (d?.item ? d.item[key] : d?.[key]) === value || `${key} ${value}`;
    await s.create('boq.B01', 'qs', `${P}/boq/items`, { code, description, quantity: 500, unit: 'm2', rate: 45 }, {
      fields: { code: itemField('code', code), description: itemField('description', description), unit: itemField('unit', 'm2') },
      get: `${P}/boq`,
      find: async (s2) => one(rowsOf(await s2.get('qs', `${P}/boq`)), (row) => row.code === code, `BOQ item ${code}`),
    });
    const item = { id: s.id('boq.B01') };
    const allocation = await s.create('allocation.B01.A160', 'planner', `${P}/activity-boq-allocations`, {
      boqItemId: item.id,
      activityId: A.A160,
      quantity: 500,
      amount: 22500,
      source: 'manual',
      notes: b.name('Blockwork level 1 measured by installed quantity'),
    }, {
      fields: { boqItemId: item.id, activityId: A.A160, status: 'draft' },
      get: `${P}/activity-boq-allocations`,
      find: async (s2) => one(rowsOf(await s2.get('planner', `${P}/activity-boq-allocations?activityId=${A.A160}`)), (row) => row.boqItemId === item.id, `allocation of ${code} to A160`),
    });
    const statusOf = async (s2) => one(rowsOf(await s2.get('planner', `${P}/activity-boq-allocations?activityId=${A.A160}`)), (row) => row.id === allocation.id, `allocation ${allocation.id}`)?.status;
    await s.act('allocation.B01.A160.submit', 'planner', 'POST', `${P}/activity-boq-allocations/${allocation.id}/submit`, {}, {
      fields: { status: 'submitted' },
      verify: async (s2) => ['submitted', 'approved'].includes(await statusOf(s2)),
    });
    await s.act('allocation.B01.A160.approve', 'qs', 'POST', `${P}/activity-boq-allocations/${allocation.id}/approve`, {}, {
      fields: { status: 'approved' },
      verify: async (s2) => (await statusOf(s2)) === 'approved',
    });
    return { boqItemId: item.id, allocationId: allocation.id, unit: 'm2' };
  }, { needs: ['activities'] });

  // ── labour: workers, crews, timesheets (WP8.timesheet.*) ────────────────────
  const workers = await b.step('workers', async (s) => {
    const out = {};
    const roster = rowsOf(await s.get('site', `${P}/timesheets/workers?q=${encodeURIComponent(b.ref('W'))}`));
    for (const [key, trade, rate, multiplier] of WORKERS) {
      const employeeNumber = b.ref(key);
      const name = b.name(`${trade} ${key}`);
      const data = await s.create(`worker.${key}`, 'site', `${P}/timesheets/workers`, {
        name,
        employeeNumber,
        trade,
        classification: 'skilled',
        hourlyRate: rate,
        overtimeMultiplier: multiplier,
        status: 'active',
        notes: b.name('Engaged for the field and quality works'),
      }, {
        fields: { name, employeeNumber, hourlyRate: is.number(rate), overtimeMultiplier: is.number(multiplier), status: 'active' },
        get: `${P}/timesheets/workers?q=${encodeURIComponent(employeeNumber)}`,
        adopt: true,
        find: async () => one(roster, (row) => row.employeeNumber === employeeNumber, `worker ${employeeNumber}`),
      });
      out[key] = data.id;
    }
    return out;
  });

  // Plan §3.2 "one of them 0.5", SERVED BY THE CONTRACT REFUSAL (builders' adjudication 087-FLD item 1,
  // adjudication F1): the create is refused with the field named in error.details
  // (WP8.timesheet.multiplierHalfCreate) and the import answers 200 with the row in errors[], making
  // nothing (WP8.timesheet.multiplierHalfImport). No 0.5 worker exists on 087-FLD, by contract; the
  // 100.00 figure (WP8.timesheet.multiplierHalf) is checked in process by the WP-8 proof.
  const HALF_CREATE = WP8.timesheet.multiplierHalfCreate;
  const HALF_IMPORT = WP8.timesheet.multiplierHalfImport.value;
  // the note reads "details.field=overtimeMultiplier. ...": a dotted path is kept, the sentence's full stop is not
  const HALF_FIELD = /details\.field=([A-Za-z0-9_[\]]+(?:\.[A-Za-z0-9_[\]]+)*)/.exec(HALF_CREATE.note || '')?.[1] || null;
  const halfWorker = { name: b.name('Labourer W0 at multiplier 0.5'), employeeNumber: b.ref('W0'), importName: b.name('Labourer W0 imported at multiplier 0.5') };
  /** The 0.5 workers this build tried, as the roster lists them: the refusals made none. */
  const halfWorkersListed = async (s) => {
    const byNumber = rowsOf(await s.get('site', `${P}/timesheets/workers?q=${encodeURIComponent(halfWorker.employeeNumber)}`)).filter((row) => row.employeeNumber === halfWorker.employeeNumber);
    const byName = rowsOf(await s.get('site', `${P}/timesheets/workers?q=${encodeURIComponent('multiplier 0.5')}`)).filter((row) => row.name === halfWorker.name || row.name === halfWorker.importName);
    return [...new Map([...byNumber, ...byName].map((row) => [row.id, row])).values()];
  };
  await b.step('worker.multiplier-half', async (s) => {
    s.assert(Boolean(HALF_FIELD), 'the answer book names the refused field (WP8.timesheet.multiplierHalfCreate note "details.field=...")', HALF_CREATE.note);
    const probe = (name) => s.refused(name, 'site', 'POST', `${P}/timesheets/workers`, {
      name: halfWorker.name,
      employeeNumber: halfWorker.employeeNumber,
      trade: 'Labourer',
      hourlyRate: RATE,
      overtimeMultiplier: 0.5,
      status: 'active',
    }, HALF_CREATE.value, {
      // whatever it would have made had it been wrongly accepted
      find: async (s2) => one((await halfWorkersListed(s2)).filter((row) => row.employeeNumber === halfWorker.employeeNumber), () => true, `worker ${halfWorker.employeeNumber}`),
    });
    let refused = await probe('worker.W0.half');
    // A refusal recorded by an interrupted attempt carries no body: the refusal (which makes nothing)
    // is asked again under this attempt's name, to read the field it names.
    if (!refused.res) refused = await probe(`worker.W0.half.recheck${b.state.steps[s.name].attempts}`);
    const details = refused.res?.body?.error?.details;
    s.assert(Array.isArray(details) && details.some((d) => d?.field === HALF_FIELD), `the refusal names ${HALF_FIELD} in error.details (WP8.timesheet.multiplierHalfCreate)`, details);
    const imported = await s.act('worker.W0.half.import', 'site', 'POST', `${P}/timesheets/workers/import`, {
      rows: [{ name: halfWorker.importName, hourlyRate: RATE, overtimeMultiplier: 0.5 }],
    }, {
      expect: HALF_IMPORT.status,
      named: true,
      fields: {
        created: HALF_IMPORT.created,
        updated: HALF_IMPORT.updated,
        skipped: HALF_IMPORT.skipped,
        errors: (v) => sameList(v, HALF_IMPORT.errors) || `errors ${JSON.stringify(HALF_IMPORT.errors)}`,
      },
      // An interrupted import either made nothing (asked again: the row is refused again and makes
      // nothing) or made a worker, and then the build stops for a check by hand.
      verify: async (s2) => {
        const made = (await halfWorkersListed(s2)).filter((row) => row.name === halfWorker.importName);
        s2.assert(made.length === 0, `the 0.5 import row made no worker; ${halfWorker.importName} exists, check it by hand`, made.map((row) => row.id));
        return false;
      },
    });
    const listed = await halfWorkersListed(s);
    s.assert(listed.length === 0, 'no worker at multiplier 0.5 exists: neither the create nor the import made one', listed.map((row) => ({ id: row.id, name: row.name, overtimeMultiplier: row.overtimeMultiplier })));
    return {
      create: { said: refused.said, field: HALF_FIELD },
      import: { created: imported?.created, updated: imported?.updated, skipped: imported?.skipped, errors: imported?.errors },
    };
  }, {
    verify: async (s) => {
      const listed = await halfWorkersListed(s);
      return listed.length === 0 || `a worker at multiplier 0.5 now exists: ${listed.map((row) => row.id).join(', ')}`;
    },
  });

  const crews = await b.step('crews', async (s) => {
    const listed = rowsOf(await s.get('site', `${P}/timesheets/crews`));
    const make = async (key, title, members, activityId) => {
      const name = b.name(title);
      const data = await s.create(`crew.${key}`, 'site', `${P}/timesheets/crews`, {
        name,
        workerIds: members.map((w) => workers[w]),
        defaultActivityId: activityId,
        foremanUserId: user.site,
        status: 'active',
      }, {
        fields: { name, memberCount: members.length, defaultActivityId: activityId },
        get: `${P}/timesheets/crews`,
        find: async () => one(listed, (row) => row.name === name, `crew ${name}`),
      });
      return data.id;
    };
    return {
      steelfixers: await make('steelfixers', 'Steelfixer crew', ['W1', 'W2', 'W3', 'W4', 'W5'], A.A130),
      mixed: await make('mixed', 'Mixed-rate crew', ['W6', 'W7', 'W8'], A.A160),
    };
  }, { needs: ['workers', 'activities'] });

  /** An interrupted timesheet create is found on its day by its notes (a b.name text, one sheet's own), never sent again. */
  const sheetFind = (date, notes) => async (s2) => one(rowsOf(await s2.get('site', `${P}/timesheets?from=${date}&to=${date}`)), (row) => row.notes === notes, `timesheet "${notes}"`);
  const sheetStatus = (id) => async (s) => (await s.get('site', `${P}/timesheets/${id}`))?.status;
  const sheetAct = (s, name, persona, id, action, payload, status, extraFields = {}) =>
    s.act(name, persona, 'POST', `${P}/timesheets/${id}/${action}`, payload, {
      fields: { status, ...extraFields },
      verify: async (s2) => (await sheetStatus(id)(s2)) === status,
    });
  const entriesOf = (list, { activityId, hours, timeType = 'regular' }) =>
    list.map((w) => ({ workerId: workers[w], activityId, timeType, hours, startTime: '07:00', endTime: timeType === 'regular' ? '15:00' : '17:00' }));

  // WP8.timesheet.reopenTwoThousand / reopenMirrorCount / reapprovedNet / reapprovedEntryCount and
  // WP8.dailyLog.weekSummaryA130: 5 workers x 8 h x 50.00 on A130, on the manpower day D4, the only
  // A130 labour of the build; approved, reopened (5 mirrors), resubmitted and approved again.
  // G1: the reopened sheet stands at 0.00 only between the reopen and the re-approval
  // (WP8.timesheet.reopenNet), so it is asserted at that moment, on the reopen's own answer.
  await b.step('timesheet.2000', async (s) => {
    const notes = b.name('Steelfixing crew day on the foundations');
    const sheet = await s.create('timesheet.2000', 'site', `${P}/timesheets`, {
      date: D[3],
      crewId: crews.steelfixers,
      clientRequestId: b.ref('TS-2000'),
      notes,
      entries: entriesOf(['W1', 'W2', 'W3', 'W4', 'W5'], { activityId: A.A130, hours: 8 }),
    }, {
      fields: { date: D[3], status: 'draft', regularHours: 40, entryCount: 5 },
      find: sheetFind(D[3], notes),
    });
    await sheetAct(s, 'timesheet.2000.submit1', 'site', sheet.id, 'submit', {}, 'submitted');
    await sheetAct(s, 'timesheet.2000.approve1', 'cost', sheet.id, 'approve', {}, 'approved', { totalCost: cents(WP8.timesheet.reopenTwoThousand, 'totalCost (WP8.timesheet.reopenTwoThousand)') });
    await sheetAct(s, 'timesheet.2000.reopen', 'pm', sheet.id, 'reopen', { reason: b.name('Wrong cost code on the first posting; reopened to re-post') }, 'draft', { totalCost: cents(WP8.timesheet.reopenNet, 'totalCost after the reopen (WP8.timesheet.reopenNet)') });
    await sheetAct(s, 'timesheet.2000.submit2', 'site', sheet.id, 'submit', {}, 'submitted');
    await sheetAct(s, 'timesheet.2000.approve2', 'cost', sheet.id, 'approve', {}, 'approved', { totalCost: cents(WP8.timesheet.reapprovedNet, 'totalCost (WP8.timesheet.reapprovedNet)') });
    const read = await s.get('cost', `${P}/timesheets/${sheet.id}`);
    s.expectFields(read, { status: 'approved', totalCost: cents(WP8.timesheet.reapprovedNet, 'totalCost (WP8.timesheet.reapprovedNet)'), regularHours: 40 });
    return { timesheetId: sheet.id, date: D[3], reopenNetCents: WP8.timesheet.reopenNet.value, reapprovedCents: lib.toCents(read.totalCost) };
  }, { needs: ['crews'] });

  // WP8.timesheet.mixedDay: 8 h regular + 2 h overtime (x1.5) + 1 h double (x2) at 50.00 = 650.00.
  await b.step('timesheet.mixed', async (s) => {
    const notes = b.name('Mixed day: regular, overtime and a double-time hour');
    const sheet = await s.create('timesheet.mixed', 'site', `${P}/timesheets`, {
      date: D[1],
      clientRequestId: b.ref('TS-MIX'),
      notes,
      entries: [
        ...entriesOf(['W1'], { activityId: A.A100, hours: 8 }),
        ...entriesOf(['W1'], { activityId: A.A100, hours: 2, timeType: 'overtime' }),
        ...entriesOf(['W1'], { activityId: A.A100, hours: 1, timeType: 'double' }),
      ],
    }, {
      fields: { date: D[1], status: 'draft', entryCount: 3 },
      find: sheetFind(D[1], notes),
    });
    await sheetAct(s, 'timesheet.mixed.submit', 'site', sheet.id, 'submit', {}, 'submitted');
    await sheetAct(s, 'timesheet.mixed.approve', 'cost', sheet.id, 'approve', {}, 'approved', { totalCost: (v) => lib.toCents(v) === WP8.timesheet.mixedDay.value || 'totalCost 650.00 (WP8.timesheet.mixedDay)' });
    return { timesheetId: sheet.id, date: D[1] };
  }, { needs: ['workers'] });

  // WP8.timesheet.rejectEditApprove: 5 x 8 h submitted, returned with a reason, edited to 5 x 7 h,
  // resubmitted and approved = 35 h x 50.00 = 1,750.00.
  await b.step('timesheet.rejected-edited', async (s) => {
    const notes = b.name('Clearance day, hours to be checked against the gate log');
    const sheet = await s.create('timesheet.rejected', 'site', `${P}/timesheets`, {
      date: D[2],
      clientRequestId: b.ref('TS-REJ'),
      notes,
      entries: entriesOf(['W1', 'W2', 'W3', 'W4', 'W5'], { activityId: A.A100, hours: 8 }),
    }, {
      fields: { date: D[2], status: 'draft', regularHours: 40 },
      find: sheetFind(D[2], notes),
    });
    await sheetAct(s, 'timesheet.rejected.submit1', 'site', sheet.id, 'submit', {}, 'submitted');
    await sheetAct(s, 'timesheet.rejected.reject', 'cost', sheet.id, 'reject', { reason: b.name('Hours do not match the gate log: seven each') }, 'rejected');
    await s.act('timesheet.rejected.edit', 'site', 'PATCH', `${P}/timesheets/${sheet.id}`, {
      notes: b.name('Clearance day, corrected to seven hours each'),
      entries: entriesOf(['W1', 'W2', 'W3', 'W4', 'W5'], { activityId: A.A100, hours: 7 }),
    }, {
      fields: { status: 'rejected', regularHours: 35 },
      verify: async (s2) => (await s2.get('site', `${P}/timesheets/${sheet.id}`))?.regularHours === 35,
    });
    await sheetAct(s, 'timesheet.rejected.submit2', 'site', sheet.id, 'submit', {}, 'submitted');
    await sheetAct(s, 'timesheet.rejected.approve', 'cost', sheet.id, 'approve', {}, 'approved', { totalCost: (v) => lib.toCents(v) === WP8.timesheet.rejectEditApprove.value || 'totalCost 1,750.00 (WP8.timesheet.rejectEditApprove)' });
    return { timesheetId: sheet.id, date: D[2] };
  }, { needs: ['workers'] });

  // WP8.timesheet.crewPrefillEntries / crewPrefillHours: the mixed crew's sheet with no entries is
  // pre-filled 3 x 8 h regular on the crew's default activity; left SUBMITTED (the rate-timing probe).
  await b.step('timesheet.crew-prefill', async (s) => {
    const notes = b.name('Mixed-rate crew day, pre-filled from the crew');
    const sheet = await s.create('timesheet.crew', 'site', `${P}/timesheets`, {
      date: D[4],
      crewId: crews.mixed,
      defaultHours: 8,
      clientRequestId: b.ref('TS-CREW'),
      notes,
    }, {
      fields: {
        date: D[4],
        status: 'draft',
        entryCount: WP8.timesheet.crewPrefillEntries.value,
        regularHours: WP8.timesheet.crewPrefillHours.value,
      },
      find: sheetFind(D[4], notes),
    });
    await sheetAct(s, 'timesheet.crew.submit', 'site', sheet.id, 'submit', {}, 'submitted');
    return { timesheetId: sheet.id, date: D[4] };
  }, { needs: ['crews'] });

  await b.step('timesheet.draft', async (s) => {
    const notes = b.name('Draft sheet, hours still to be confirmed');
    const sheet = await s.create('timesheet.draft', 'site', `${P}/timesheets`, {
      date: D[5],
      clientRequestId: b.ref('TS-DRAFT'),
      notes,
      entries: entriesOf(['W6'], { activityId: A.A100, hours: 6 }),
    }, {
      fields: { date: D[5], status: 'draft', regularHours: 6 },
      find: sheetFind(D[5], notes),
    });
    return { timesheetId: sheet.id, date: D[5] };
  }, { needs: ['workers'] });

  // ── daily logs: D1..D7 ──────────────────────────────────────────────────────
  const dayLog = (s, day, persona = 'pm') => s.get(persona, `${P}/daily-logs/${day}`);
  const entryIn = (log, section, id) => one(log?.sections?.[section] || [], (row) => row.id === id, `${section} entry ${id}`);
  /**
   * One entry of a day. It has no route of its own (get: null): the day's step re-reads it in its
   * verify (dayVerify). An interrupted add is found in the day by its clientRequestId, never sent again.
   */
  const entry = async (s, name, persona, day, section, payload) => {
    const clientRequestId = b.ref(name);
    await s.create(name, persona, `${P}/daily-logs/${day}/entries/${section}`, { ...payload, clientRequestId }, {
      get: null,
      idOf: (d) => d?.entryId ?? null,
      fields: { date: day, entryId: is.present },
      find: async (s2) => {
        const row = one((await dayLog(s2, day))?.sections?.[section] || [], (r) => r.clientRequestId === clientRequestId, `${section} entry ${clientRequestId}`);
        return row ? { date: day, entryId: row.id } : null;
      },
    });
    return { entryId: s.id(name) };
  };
  const weatherList = (s) => s.get('planner', `${P}/weather-delays`);
  const logAct = (s, name, persona, day, action, payload, status) =>
    s.act(name, persona, 'POST', `${P}/daily-logs/${day}/${action}`, payload, {
      fields: { status },
      verify: async (s2) => (await dayLog(s2, day))?.status === status,
    });
  const setSummary = (s, name, day, text, condition) =>
    s.act(name, 'site', 'PATCH', `${P}/daily-logs/${day}`, {
      summary: b.name(text),
      weather: { condition, tempMinC: 18, tempMaxC: 31, precipitationMm: condition === 'rain' ? 22 : 0, windMaxKph: 20, notes: b.name('Read at 07:00') },
    }, {
      fields: { summary: b.name(text) },
      verify: async (s2) => (await dayLog(s2, day))?.summary === b.name(text),
    });
  /**
   * Promotes a delay entry to the weather register (WP8.dailyLog.promote*; contractual by default,
   * C4), as the planner, who holds eot:create (builders' adjudication R2-16; the site engineer's
   * promotion is the WP-7 HR-F4 probe). G1: the promotion's own answer echoes the computed days
   * (daily-log.service.js:1216) only at that moment, so it is asserted here; the stored figure is read
   * in `weather.at13.read` (HR-C11: the Int column).
   */
  const PROMOTED_CONTRACTUAL = CM.WP7.weather['087-FLD.promoted.contractual'].value;
  const promote = async (s, name, day, entryId, expectedDays) => {
    const data = await s.create(name, 'planner', `${P}/daily-logs/${day}/entries/delays/${entryId}/weather-delay`, {
      description: b.name(`Weather delay promoted from the daily log of ${day}`),
    }, {
      expect: 200,
      get: null, // the register has no single-row route: the day's verify re-reads it (promotedVerify)
      idOf: (d) => d?.weatherDelay?.id ?? null,
      fields: { 'weatherDelay.id': is.present, 'weatherDelay.contractual': PROMOTED_CONTRACTUAL },
      // An interrupted promotion: the entry carries the register row's id; the row is read from the register.
      find: async (s2) => {
        const row = entryIn(await dayLog(s2, day), 'delays', entryId);
        if (!row?.weatherDelayId) return null;
        const delay = one(rowsOf(await weatherList(s2)), (r) => r.id === row.weatherDelayId, `weather delay ${row.weatherDelayId}`);
        s2.assert(Boolean(delay), `the promoted delay ${row.weatherDelayId} is on the weather register`);
        return { weatherDelay: { id: delay.id, contractual: delay.contractual, storedDelayDays: delay.delayDays }, adopted: true };
      },
    });
    const echoed = data?.weatherDelay?.delayDays;
    if (data?.adopted === true || (data?.truncated === true && echoed === undefined)) {
      // The promotion's answer was lost to an interruption (adopted, or kept truncated in the state)
      // and cannot be asked again (409 DAILY_LOG_WEATHER_DELAY_EXISTS): WP8.dailyLog.promote* then
      // needs fresh records (WP-8 proof).
      s.note(`${name}: the promotion's answer was not kept (interrupted run); its echoed days are not asserted on this build`);
      return { id: s.id(name), echoed: null };
    }
    s.assert(Number(echoed) === expectedDays, `the promotion answers ${expectedDays} days (WP8.dailyLog.promote*)`, data?.weatherDelay);
    return { id: s.id(name), echoed: Number(echoed) };
  };
  const dayVerify = (day, status) => async (s, out) => {
    const log = await dayLog(s, day);
    if (log?.status !== status) return `${day} is ${log?.status}, not ${status}`;
    const ids = new Set(Object.values(log.sections || {}).flat().map((row) => row.id));
    const missing = Object.values(out.entries || {}).filter((id) => !ids.has(id));
    return missing.length ? `${day} no longer holds entries ${missing.join(', ')}` : true;
  };
  /** A day with a promoted delay: the day as built, and the promoted row still on the register, contractual. */
  const promotedVerify = async (s, out) => {
    const day = await dayVerify(out.day, out.status)(s, out);
    if (day !== true) return day;
    const delay = one(rowsOf(await weatherList(s)), (r) => r.id === out.weatherDelayId, `weather delay ${out.weatherDelayId}`);
    if (!delay) return `the promoted delay ${out.weatherDelayId} is no longer on the weather register`;
    return delay.contractual === PROMOTED_CONTRACTUAL || `the promoted delay ${out.weatherDelayId} is not contractual`;
  };

  const qty = (n) => ({ activityId: A.A160, boqItemId: boq.boqItemId, allocationId: boq.allocationId, quantity: n, unitCode: boq.unit });

  // D1: every section but manpower; a 2 h weather delay promoted (0.5 day); approved straight from
  // open, without a submit (WP8.dailyLog.approveFromOpen, recorded; HR-F4).
  const d1 = await b.step('dailylog.D1', async (s) => {
    const day = D[0];
    const e = {};
    e.equipment = (await entry(s, 'dl.D1.equipment', 'site', day, 'equipment', { equipmentId: equipment.equipmentId, name: b.name('Excavator 20 t'), count: 1, hoursOperated: 6, hoursIdle: 1, activityId: A.A100, locationId: locations.yard, notes: b.name('Bulk dig at grid A') })).entryId;
    e.delivery = (await entry(s, 'dl.D1.delivery', 'site', day, 'deliveries', { companyId: companies.supplier, supplierName: b.name('Nile Cement Supply'), description: b.name('Cement OPC 42.5N bags'), quantity: 200, unit: 'bag', poRef: b.ref('PO-01'), receivedBy: 'Site storeman', deliveredAt: '09:15', activityId: A.A110, notes: b.name('Checked against the delivery note') })).entryId;
    e.visitor = (await entry(s, 'dl.D1.visitor', 'site', day, 'visitors', { name: b.name('Resident engineer'), company: b.name('Client consultant'), purpose: b.name('Site walk and set-out check'), arrivedAt: '10:00', leftAt: '11:30', notes: b.name('Inducted, PPE issued') })).entryId;
    e.delay = (await entry(s, 'dl.D1.delay', 'site', day, 'delays', { type: 'weather', description: b.name('Rain, works stopped two hours'), hoursLost: 2, activityId: A.A100, locationId: locations.zoneA, notes: b.name('Crew stood down') })).entryId;
    e.note = (await entry(s, 'dl.D1.note', 'site', day, 'notes', { kind: 'general', text: b.name('Set-out checked against the grid'), activityId: A.A100 })).entryId;
    e.qualityNote = (await entry(s, 'dl.D1.note.quality', 'quality', day, 'notes', { kind: 'inspection', text: b.name('Inspection walk, no defects raised') })).entryId;
    await setSummary(s, 'dl.D1.summary', day, 'Day 1: clearance and set-out, rain in the morning', 'rain');
    const promoted = await promote(s, 'weather.promote.2h', day, e.delay, PROMOTED_DAYS[0]);
    await logAct(s, 'dl.D1.approve', 'pm', day, 'approve', {}, 'approved'); // straight from open
    return { day, status: 'approved', entries: e, weatherDelayId: promoted.id, promotedEcho: promoted.echoed };
  }, { verify: promotedVerify });

  // D2: a 6 h weather delay promoted (1.0 day); a quantity row; submitted then approved.
  const d2 = await b.step('dailylog.D2', async (s) => {
    const day = D[1];
    const e = {};
    e.equipment = (await entry(s, 'dl.D2.equipment', 'site', day, 'equipment', { equipmentId: equipment.equipmentId, name: b.name('Excavator 20 t'), count: 1, hoursOperated: 2, hoursIdle: 5, activityId: A.A110, notes: b.name('Idle most of the day, rain') })).entryId;
    e.delivery = (await entry(s, 'dl.D2.delivery', 'site', day, 'deliveries', { companyId: companies.supplier, supplierName: b.name('Nile Cement Supply'), description: b.name('Concrete blocks 200 mm'), quantity: 1200, unit: 'nr', poRef: b.ref('PO-02'), deliveredAt: '11:40', activityId: A.A160 })).entryId;
    e.delay = (await entry(s, 'dl.D2.delay', 'site', day, 'delays', { type: 'weather', description: b.name('Heavy rain, works stopped six hours'), hoursLost: 6, activityId: A.A110, notes: b.name('Excavations pumped out') })).entryId;
    e.note = (await entry(s, 'dl.D2.note', 'site', day, 'notes', { kind: 'safety', text: b.name('Excavation edges re-barriered after the rain') })).entryId;
    e.quantity = (await entry(s, 'dl.D2.quantity', 'site', day, 'quantities', { ...qty(20), notes: b.name('Blockwork laid today') })).entryId;
    await setSummary(s, 'dl.D2.summary', day, 'Day 2: heavy rain, pumping', 'rain');
    const promoted = await promote(s, 'weather.promote.6h', day, e.delay, PROMOTED_DAYS[1]);
    await logAct(s, 'dl.D2.submit', 'site', day, 'submit', {}, 'submitted');
    await logAct(s, 'dl.D2.approve', 'pm', day, 'approve', {}, 'approved');
    return { day, status: 'approved', entries: e, weatherDelayId: promoted.id, promotedEcho: promoted.echoed };
  }, { needs: ['boq', 'equipment'], verify: promotedVerify });

  // D3: a 10 h weather delay promoted (1.5 days); visitors; submitted then approved.
  const d3 = await b.step('dailylog.D3', async (s) => {
    const day = D[2];
    const e = {};
    e.visitor = (await entry(s, 'dl.D3.visitor', 'site', day, 'visitors', { name: b.name('Client representative'), company: b.name('Client'), purpose: b.name('Progress meeting on site'), arrivedAt: '13:00', leftAt: '14:00' })).entryId;
    e.delay = (await entry(s, 'dl.D3.delay', 'site', day, 'delays', { type: 'weather', description: b.name('Storm, site closed ten hours'), hoursLost: 10, activityId: A.A120, notes: b.name('Site closed by order') })).entryId;
    e.note = (await entry(s, 'dl.D3.note', 'site', day, 'notes', { kind: 'issue', text: b.name('Storm damage to the hoarding on the north boundary') })).entryId;
    await setSummary(s, 'dl.D3.summary', day, 'Day 3: storm, site closed', 'storm');
    const promoted = await promote(s, 'weather.promote.10h', day, e.delay, PROMOTED_DAYS[2]);
    await logAct(s, 'dl.D3.submit', 'site', day, 'submit', {}, 'submitted');
    await logAct(s, 'dl.D3.approve', 'pm', day, 'approve', {}, 'approved');
    return { day, status: 'approved', entries: e, weatherDelayId: promoted.id, promotedEcho: promoted.echoed };
  }, { verify: promotedVerify });

  // D4, the manpower day (WP8.dailyLog.manpower*): internal Steelfixer 5 x 8 on A130 (approved as
  // written), the party's Carpenter 3 x 10 on A160 (submitted, and left submitted: the answer book
  // counts it as "status submitted, counted", which is what gives the manpower status-filter mutation
  // its teeth) and Labourer 2 x 8 on A160 (rejected with a reason). The only manpower rows of the
  // build. The day is submitted and NOT approved (approving it would approve the carpenter entry); the
  // approved days of WP8.dailyLog.approvedDay* are D1, D2, D3 and D6.
  await b.step('dailylog.D4', async (s) => {
    const day = D[3];
    const e = {};
    e.steelfixer = (await entry(s, 'dl.D4.manpower.steelfixer', 'site', day, 'manpower', { trade: 'Steelfixer', workers: 5, hours: 8, companyName: b.name('Own labour'), activityId: A.A130, locationId: locations.zoneA, notes: b.name('Foundation steelfixing crew') })).entryId;
    e.carpenter = (await entry(s, 'dl.D4.manpower.carpenter', 'party', day, 'manpower', { trade: 'Carpenter', workers: 3, hours: 10, activityId: A.A160, notes: b.name('Formwork carpenters of the subcontractor') })).entryId;
    e.labourer = (await entry(s, 'dl.D4.manpower.labourer', 'party', day, 'manpower', { trade: 'Labourer', workers: 2, hours: 8, activityId: A.A160, notes: b.name('Labourers of the subcontractor') })).entryId;
    e.partyDelivery = (await entry(s, 'dl.D4.delivery.party', 'party', day, 'deliveries', { description: b.name('Formwork plywood sheets'), quantity: 40, unit: 'sheet', deliveredAt: '08:30', activityId: A.A160 })).entryId;
    e.equipment = (await entry(s, 'dl.D4.equipment', 'site', day, 'equipment', { equipmentId: equipment.equipmentId, name: b.name('Excavator 20 t'), count: 1, hoursOperated: 4, activityId: A.A130 })).entryId;
    e.note = (await entry(s, 'dl.D4.note', 'site', day, 'notes', { kind: 'instruction', text: b.name('Steelfixing to continue at grid B'), activityId: A.A130 })).entryId;
    const fresh = await dayLog(s, day);
    s.expectFields(entryIn(fresh, 'manpower', e.carpenter), { status: 'submitted', partyId: party.partyId }, 'the party carpenter entry');
    s.expectFields(entryIn(fresh, 'manpower', e.steelfixer), { status: 'approved', partyId: is.absent }, 'the internal steelfixer entry');
    await s.act('dl.D4.manpower.labourer.reject', 'pm', 'POST', `${P}/daily-logs/${day}/entries/manpower/${e.labourer}/review`, {
      decision: 'reject',
      reason: b.name('Not on the gate log for this day'),
    }, {
      fields: { status: 'open' },
      verify: async (s2) => entryIn(await dayLog(s2, day), 'manpower', e.labourer)?.status === 'rejected',
    });
    await setSummary(s, 'dl.D4.summary', day, 'Day 4: foundation steelfixing, subcontractor carpenters on blockwork formwork', 'clear');
    await logAct(s, 'dl.D4.submit', 'site', day, 'submit', {}, 'submitted');
    const log = await dayLog(s, day);
    s.expectFields(entryIn(log, 'manpower', e.steelfixer), { trade: 'Steelfixer', workers: 5, hours: 8, status: 'approved', activityId: A.A130 }, 'steelfixer 5 x 8');
    s.expectFields(entryIn(log, 'manpower', e.carpenter), { trade: 'Carpenter', workers: 3, hours: 10, status: 'submitted', activityId: A.A160 }, 'carpenter 3 x 10');
    s.expectFields(entryIn(log, 'manpower', e.labourer), { trade: 'Labourer', workers: 2, hours: 8, status: 'rejected' }, 'labourer 2 x 8 rejected');
    s.assert(log.totals.manHours === WP8.dailyLog.manpowerTotal.value && log.totals.workers === WP8.dailyLog.manpowerWorkers.value, `the day counts ${WP8.dailyLog.manpowerTotal.value} man-hours and ${WP8.dailyLog.manpowerWorkers.value} workers`, log.totals);
    return { day, status: 'submitted', entries: e };
  }, { needs: ['party.member', 'equipment'], verify: async (s, out) => dayVerify(out.day, out.status)(s, out) });

  // D5: deliveries, visitors, notes and a quantity row; left SUBMITTED (the party-lock day,
  // WP8.dailyLog.partyLock: the party user writing to it gets 409 DAILY_LOG_SUBMITTED).
  await b.step('dailylog.D5', async (s) => {
    const day = D[4];
    const e = {};
    e.delivery = (await entry(s, 'dl.D5.delivery', 'site', day, 'deliveries', { companyId: companies.supplier, supplierName: b.name('Nile Cement Supply'), description: b.name('Mortar mix'), quantity: 60, unit: 'bag', deliveredAt: '07:30', activityId: A.A160 })).entryId;
    e.visitor = (await entry(s, 'dl.D5.visitor', 'site', day, 'visitors', { name: b.name('Safety auditor'), company: b.name('Client HSE'), purpose: b.name('Monthly safety audit'), arrivedAt: '09:00', leftAt: '12:00' })).entryId;
    e.partyNote = (await entry(s, 'dl.D5.note.party', 'party', day, 'notes', { kind: 'general', text: b.name('Subcontractor: blockwork to grid D complete') })).entryId;
    e.note = (await entry(s, 'dl.D5.note', 'site', day, 'notes', { kind: 'general', text: b.name('Blockwork progressing at level 1') })).entryId;
    e.quantity = (await entry(s, 'dl.D5.quantity', 'site', day, 'quantities', { ...qty(15), notes: b.name('Blockwork laid today') })).entryId;
    await setSummary(s, 'dl.D5.summary', day, 'Day 5: blockwork, safety audit', 'clear');
    await logAct(s, 'dl.D5.submit', 'site', day, 'submit', {}, 'submitted');
    return { day, status: 'submitted', entries: e };
  }, { needs: ['party.member', 'boq'], verify: async (s, out) => dayVerify(out.day, out.status)(s, out) });

  // D6: equipment, a non-weather delay (not promoted), a quantity row; submitted then approved.
  await b.step('dailylog.D6', async (s) => {
    const day = D[5];
    const e = {};
    e.equipment = (await entry(s, 'dl.D6.equipment', 'site', day, 'equipment', { equipmentId: equipment.equipmentId, name: b.name('Excavator 20 t'), count: 1, hoursOperated: 7, activityId: A.A120 })).entryId;
    e.delay = (await entry(s, 'dl.D6.delay', 'site', day, 'delays', { type: 'access', description: b.name('Gate blocked by a neighbour delivery'), hoursLost: 1, activityId: A.A120 })).entryId;
    e.note = (await entry(s, 'dl.D6.note', 'site', day, 'notes', { kind: 'general', text: b.name('Ground beams shuttering') })).entryId;
    e.quantity = (await entry(s, 'dl.D6.quantity', 'site', day, 'quantities', { ...qty(10), notes: b.name('Blockwork laid today') })).entryId;
    await setSummary(s, 'dl.D6.summary', day, 'Day 6: ground beams, short access delay', 'clear');
    await logAct(s, 'dl.D6.submit', 'site', day, 'submit', {}, 'submitted');
    await logAct(s, 'dl.D6.approve', 'pm', day, 'approve', {}, 'approved');
    return { day, status: 'approved', entries: e };
  }, { needs: ['boq', 'equipment'], verify: async (s, out) => dayVerify(out.day, out.status)(s, out) });

  // D7: the newest day stays OPEN, with a draft note and a party delivery awaiting review.
  await b.step('dailylog.D7', async (s) => {
    const day = D[6];
    const e = {};
    e.visitor = (await entry(s, 'dl.D7.visitor', 'site', day, 'visitors', { name: b.name('Utility inspector'), company: b.name('Water authority'), purpose: b.name('Connection survey'), arrivedAt: '10:30', leftAt: '11:00' })).entryId;
    e.draftNote = (await entry(s, 'dl.D7.note.draft', 'site', day, 'notes', { kind: 'issue', text: b.name('Draft: crane booking to be confirmed'), status: 'draft' })).entryId;
    e.partyDelivery = (await entry(s, 'dl.D7.delivery.party', 'party', day, 'deliveries', { description: b.name('Tie wire and spacers'), quantity: 25, unit: 'box', deliveredAt: '14:05', activityId: A.A160 })).entryId;
    await setSummary(s, 'dl.D7.summary', day, 'Day 7: open day', 'clear');
    return { day, status: 'open', entries: e };
  }, { needs: ['party.member'], verify: async (s, out) => dayVerify(out.day, out.status)(s, out) });

  // ── weather: the manual delays, read from the product at 13 and at 14 (WP7.weather["087-FLD.composition"]) ──
  // Builders' adjudication 087-FLD item 2: GET /weather-delays is read at 13 contractual days (before
  // the 1.0-day delay exists) and again at 14. Each reading is the product's answer, kept in its own
  // step's out, and compared with the answer book in a step of its own, so a resumed run compares the
  // answer of that moment, never a later register. HEAD writes every delay to the Int column
  // WeatherDelay.delayDays (schema.prisma:2958, weather.service.js:217): the half-days are stored
  // truncated, so today's answers are HR-C11's known ones (COMPOSITION.today) and both comparisons are
  // BLOCKED HR-C11 with what the product answered; any other answer fails the build.
  const manualDelay = async (s, name, days, contractual, day, activityId) => {
    const description = b.name(`${contractual ? 'Contractual' : 'Non-contractual'} weather delay of ${days} day(s) from ${day}`);
    await s.create(name, 'planner', `${P}/weather-delays`, {
      description,
      date: day,
      delayDays: days,
      contractual,
      affectedActivityIds: [activityId],
    }, {
      fields: { description, contractual },
      get: null, // the register has no single-row route: the step's verify re-reads it
      find: async (s2) => one(rowsOf(await weatherList(s2)), (row) => row.description === description, `weather delay "${description}"`),
    });
    return s.id(name);
  };
  /** A step's verify: the delays it made are still on the register, contractual or not as made. */
  const delaysListed = (ids, contractual) => async (s) => {
    const rows = rowsOf(await weatherList(s));
    const wrong = ids.filter((id) => one(rows, (row) => row.id === id, `weather delay ${id}`)?.contractual !== contractual);
    return wrong.length ? `weather delays ${wrong.join(', ')} are gone or no longer ${contractual ? 'contractual' : 'non-contractual'}` : true;
  };
  const promotedIds = () => [d1.weatherDelayId, d2.weatherDelayId, d3.weatherDelayId];
  /** The register as the product answers it now: its summary, its monthly split, and the stored days of the rows named. */
  const readRegister = async (s, groups) => {
    const list = await weatherList(s);
    const rows = rowsOf(list);
    const stored = {};
    for (const [key, ids] of Object.entries(groups)) {
      stored[key] = ids.map((id) => {
        const row = one(rows, (r) => r.id === id, `weather delay ${id}`);
        s.assert(Boolean(row), `weather delay ${id} is listed`);
        return num(row.delayDays);
      });
    }
    const summary = list?.summary || {};
    return {
      readAt: new Date().toISOString(),
      summary: { allowance: num(summary.allowance), contractualUsed: num(summary.contractualUsed), consumedPct: num(summary.consumedPct), warning: summary.warning, remaining: num(summary.remaining) },
      monthly: list?.monthly || [],
      stored,
      contractualIds: rows.filter((row) => row.contractual === true).map((row) => row.id).sort(),
    };
  };
  /** A reading against the answer book: DONE when it is the book's, BLOCKED HR-C11 when it is HR-C11's known answer, else failed. */
  const judge = (s, label, measured, expected, known) => {
    const matches = (want) => Object.keys(want).every((key) => sameList(measured[key], want[key]));
    if (matches(expected)) return { measured, expected };
    if (matches(known)) {
      s.blocked('HR-C11', {
        reading: label,
        measured,
        expected,
        known,
        note: 'the product\'s answer at that moment: half-days are stored truncated (Int column WeatherDelay.delayDays); the WP-7 weather boundaries and WP8.dailyLog.promoteResponseVsStored stay red until HR-C11 is decided',
      });
    }
    s.assert(false, `the weather register at ${label} answers neither the answer book nor HR-C11's known answer`, { expected, known, measured });
    return null;
  };

  // 13.0 = promoted 0.5 + 1.0 + 1.5 + manual 2.5 + 7.5.
  const manual13 = await b.step('weather.manual.13', async (s) => {
    const ids = [];
    for (const [i, days] of MANUAL_13.entries()) ids.push(await manualDelay(s, `weather.manual.13.${i + 1}`, days, true, before(10 + i), A.A110));
    return { ids };
  }, { verify: async (s, out) => delaysListed(out.ids, true)(s) });

  // The product's answer at 13, before the 1.0-day delay exists.
  const at13 = await b.step('weather.at13.read', async (s) => {
    const reading = await readRegister(s, { promoted: promotedIds(), manual13: manual13.ids });
    s.assert(sameList(reading.contractualIds, [...promotedIds(), ...manual13.ids].sort()), 'the contractual rows on the register are exactly the three promoted and the two manual delays of this build', reading.contractualIds);
    s.assert(reading.summary.allowance === WP8.weather.allowance.value, `the allowance is ${WP8.weather.allowance.value}, set explicitly (WP8.weather.allowance)`, reading.summary);
    return reading;
  }, { needs: ['dailylog.D1', 'dailylog.D2', 'dailylog.D3', 'weather.manual.13'], verify: async (s, out) => delaysListed(out.contractualIds, true)(s) });

  await b.step('weather.at13', async (s) => {
    const measured = {
      promotedStored: at13.stored.promoted,
      manualStored: at13.stored.manual13,
      contractualUsed: at13.summary.contractualUsed,
      consumedPct: round2(at13.summary.consumedPct), // compared at 2 dp (F2)
      warning: at13.summary.warning,
      remaining: at13.summary.remaining,
    };
    const expected = {
      promotedStored: PROMOTED_DAYS,
      manualStored: MANUAL_13,
      contractualUsed: WP8.weather.belowContractualUsed.value,
      consumedPct: WP8.weather.belowConsumedPct.value,
      warning: WP8.weather.belowWarning.value,
      remaining: WP8.weather.belowRemaining.value,
    };
    // HR-C11's known answer at 13 (COMPOSITION.today, WP8.weather.todayBelow): 55%, and no warning
    // either way (WP8.weather.belowWarning; todayBelow's derivation). The book carries no "today" for
    // the remaining days: that figure is in `measured`, not compared.
    const known = {
      promotedStored: COMPOSITION.today.promotedStored,
      manualStored: COMPOSITION.today.manualStored,
      contractualUsed: COMPOSITION.today.at13Used,
      consumedPct: WP8.weather.todayBelow.value,
      warning: WP8.weather.belowWarning.value,
    };
    return judge(s, '13 contractual days', measured, expected, known);
  }, { needs: ['weather.at13.read'] });

  // 14.0 = 13.0 + manual 1.0, made only once the reading at 13 is recorded.
  const manual14 = await b.step('weather.manual.14', async (s) => {
    const ids = [];
    for (const [i, days] of MANUAL_14.entries()) ids.push(await manualDelay(s, `weather.manual.14.${i + 1}`, days, true, before(9), A.A120));
    return { ids };
  }, { needs: ['weather.at13.read'], verify: async (s, out) => delaysListed(out.ids, true)(s) });

  // The product's answer at 14, before the non-contractual delay exists.
  const at14 = await b.step('weather.at14.read', async (s) => {
    const reading = await readRegister(s, { promoted: promotedIds(), manual13: manual13.ids, manual14: manual14.ids });
    s.assert(sameList(reading.contractualIds, [...promotedIds(), ...manual13.ids, ...manual14.ids].sort()), 'the contractual rows on the register are exactly the promoted and manual delays of this build', reading.contractualIds);
    s.assert(reading.summary.allowance === WP8.weather.allowance.value, `the allowance is ${WP8.weather.allowance.value}, set explicitly (WP8.weather.allowance)`, reading.summary);
    return reading;
  }, { needs: ['weather.manual.14'], verify: async (s, out) => delaysListed(out.contractualIds, true)(s) });

  await b.step('weather.at14', async (s) => {
    const measured = {
      promotedStored: at14.stored.promoted,
      manualStored: at14.stored.manual13,
      at14AddStored: at14.stored.manual14,
      contractualUsed: at14.summary.contractualUsed,
      consumedPct: round2(at14.summary.consumedPct), // compared at 2 dp (F2)
      warning: at14.summary.warning,
      remaining: at14.summary.remaining,
    };
    const expected = {
      promotedStored: PROMOTED_DAYS,
      manualStored: MANUAL_13,
      at14AddStored: MANUAL_14,
      contractualUsed: WP8.weather.atContractualUsed.value,
      consumedPct: WP8.weather.atConsumedPct.value,
      warning: WP8.weather.atWarning.value,
      remaining: WP8.weather.atRemaining.value,
    };
    // HR-C11's known answer at 14 (COMPOSITION.today, WP8.weather.todayAt): 60%, no warning. The book
    // carries no "today" for the 1.0-day row or the remaining days: those are in `measured`, not compared.
    const known = {
      promotedStored: COMPOSITION.today.promotedStored,
      manualStored: COMPOSITION.today.manualStored,
      contractualUsed: COMPOSITION.today.at14Used,
      consumedPct: WP8.weather.todayAt.value,
      warning: COMPOSITION.today.warningAt14,
    };
    return judge(s, '14 contractual days', measured, expected, known);
  }, { needs: ['weather.at14.read'] });

  // The non-contractual 10 days, after the reading at 14: made, then the register is read from the
  // product at that moment. It is booked under nonContractual in its month
  // (WP8.weather.monthlyNonContractual); what it does to contractualUsed is judged in the next step.
  const nonContractual = await b.step('weather.non-contractual', async (s) => {
    const day = before(8);
    const ids = [];
    for (const [i, days] of NON_CONTRACTUAL.entries()) ids.push(await manualDelay(s, `weather.non-contractual.${i + 1}`, days, false, day, A.A100));
    const reading = await readRegister(s, { nonContractual: ids });
    s.assert(sameList(reading.stored.nonContractual, NON_CONTRACTUAL), `the non-contractual delay is stored at ${NON_CONTRACTUAL.join(' + ')} days`, reading.stored);
    const monthKey = day.slice(0, 7);
    const month = one(reading.monthly, (m) => m.month === monthKey, `the register's month ${monthKey}`);
    s.assert(Boolean(month) && num(month.nonContractual) === WP8.weather.monthlyNonContractual.value, `the month ${monthKey} books ${WP8.weather.monthlyNonContractual.value} non-contractual days (WP8.weather.monthlyNonContractual)`, reading.monthly);
    return { ids, day, readAt: reading.readAt, summary: reading.summary, contractualUsedAt14: at14.summary.contractualUsed, contractualUsedAfter: reading.summary.contractualUsed, month };
  }, { needs: ['weather.at14.read'], verify: async (s, out) => delaysListed(out.ids, false)(s) });

  // The non-contractual delay adds nothing to contractualUsed, judged against the answer book
  // (round 2, R2-B5; WP8.weather.nonContractualAddsNothing): the book's value is 14 (still the 14.0 of
  // the reading at 14), its `today` HR-C11's 12 (the truncated rows; the same 12 at 14). DONE on the
  // book's value, BLOCKED HR-C11 on the known answer, otherwise failed. Both readings are the product's
  // (weather.at14.read and weather.non-contractual); nothing is computed here but their difference.
  await b.step('weather.non-contractual.adds-nothing', async (s) => {
    const measured = {
      contractualUsed: nonContractual.contractualUsedAfter,
      addedByNonContractual: nonContractual.contractualUsedAfter - nonContractual.contractualUsedAt14,
    };
    const expected = {
      contractualUsed: NON_CONTRACTUAL_LEAF.value,
      addedByNonContractual: NON_CONTRACTUAL_LEAF.value - WP8.weather.atContractualUsed.value,
    };
    const known = {
      contractualUsed: NON_CONTRACTUAL_LEAF.today,
      addedByNonContractual: NON_CONTRACTUAL_LEAF.today - COMPOSITION.today.at14Used,
    };
    return judge(s, 'the non-contractual delay (WP8.weather.nonContractualAddsNothing)', measured, expected, known);
  }, { needs: ['weather.non-contractual'] });

  // ── the form ITP: 2 hold points and a required inspector signature ──────────
  const SIGNER = b.name('Quality inspector');
  /** The instance's inspector signature (role inspector, not on an item, signed by SIGNER), or null. */
  const inspectorSignature = async (s2, instanceId) => one((await s2.get('quality', `${P}/forms/${instanceId}`))?.signatures || [], (sig) => sig.role === 'inspector' && !sig.itemId && sig.signerName === SIGNER, `inspector signature on form ${instanceId}`);
  const signature = (s, name, instanceId) =>
    s.create(name, 'quality', `${P}/forms/${instanceId}/signatures`, {
      role: 'inspector',
      image: `data:image/png;base64,${png(b.ref(name)).toString('base64')}`,
      signerName: SIGNER,
      signerCompany: b.name('Oakmont quality team'),
    }, {
      get: null, // no single-signature route: the instance lists it, re-read by the step's verify (signedVerify)
      idOf: (d) => d?.signature?.id ?? null,
      fields: { 'signature.role': 'inspector', 'signature.id': is.present },
      // R2-11: an interrupted signature is found on the instance, never sent again.
      find: async (s2) => {
        const sig = await inspectorSignature(s2, instanceId);
        return sig ? { signature: sig } : null;
      },
    });
  /** A step with a signed instance: the instance in its state, still carrying the signature recorded. */
  const signedVerify = (status) => async (s, out) => {
    const row = await s.get('quality', `${P}/forms/${out.instanceId}`);
    if (row?.status !== status) return `form ${out.instanceId} is ${row?.status}, not ${status}`;
    return (row.signatures || []).some((sig) => sig.id === out.signatureId) || `form ${out.instanceId} no longer carries signature ${out.signatureId}`;
  };
  const SECTION_TITLE = b.name('Before the pour');
  const itpTemplate = await b.step('itp.template', async (s) => {
    const name = b.name('Pile cap pour ITP');
    const data = await s.create('itp.template', 'quality', `${P}/forms/templates`, {
      name,
      description: b.name('Two hold points released by the quality engineer before the pour'),
      trade: 'Concrete',
      type: 'itp',
      status: 'active',
      settings: { requireSignatures: ['inspector'], instructions: b.name('No pour before both hold points are released') },
      sections: [{
        title: SECTION_TITLE,
        items: [
          { label: 'Hold 1: reinforcement fixed to drawing, cover and laps checked', responseType: 'pass_fail', isHoldPoint: true },
          { label: 'Hold 2: formwork line, level and tightness released for the pour', responseType: 'pass_fail', isHoldPoint: true },
          { label: 'Embedded items and sleeves in place', responseType: 'pass_fail' },
          { label: 'Consultant present for the pour', responseType: 'yes_no', inspectionPointType: 'witness' },
        ],
      }],
    }, {
      fields: { name, type: 'itp', status: 'active', holdPointCount: 2, version: 1, 'settings.requireSignatures': ['inspector'] },
      find: async (s2) => one(rowsOf(await s2.get('quality', `${P}/forms/templates?scope=project`)), (row) => row.name === name, `form template ${name}`),
    });
    const section = one(data.sections || [], (sec) => sec.title === SECTION_TITLE, `template section ${SECTION_TITLE}`);
    s.assert(Boolean(section) && (data.sections || []).length === 1, 'the template has its one section', data.sections);
    const items = section.items || [];
    const item = (prefix, hold) => {
      const row = one(items, (it) => it.label.startsWith(prefix) && Boolean(it.isHoldPoint) === hold, `template item "${prefix}"`);
      s.assert(Boolean(row), `the template carries "${prefix}"${hold ? ' as a hold point' : ''}`, items);
      return row.id;
    };
    s.assert(items.filter((it) => it.isHoldPoint).length === 2 && items.length === 4, 'the template holds 4 items, 2 of them hold points', items);
    return {
      templateId: data.id,
      sectionId: section.id,
      items: items.map((it) => ({ id: it.id, label: it.label, responseType: it.responseType, isHoldPoint: it.isHoldPoint })),
      hold1: item('Hold 1:', true),
      hold2: item('Hold 2:', true),
      check: item('Embedded', false),
      witness: item('Consultant', false),
    };
  });

  const instanceStatus = (id) => async (s) => (await s.get('quality', `${P}/forms/${id}`))?.status;
  const newInstance = (s, name, activityId, scheduledFor, dueDate, title) => {
    const fullTitle = b.name(title);
    const clientRequestId = b.ref(name);
    return s.create(name, 'site', `${P}/forms`, {
      templateId: itpTemplate.templateId,
      title: fullTitle,
      activityId,
      locationId: locations.zoneA,
      assigneeUserId: user.site,
      inspectorUserId: user.quality,
      approverUserId: user.pm,
      scheduledFor,
      dueDate,
      clientRequestId,
    }, {
      fields: { status: 'scheduled', activityId, templateId: itpTemplate.templateId, templateVersion: 1 },
      // An interrupted create is found by its clientRequestId among the activity's instances, never sent again.
      find: async (s2) => one(rowsOf(await s2.get('quality', `${P}/forms?status=all&activityId=${activityId}&search=${encodeURIComponent(fullTitle)}`)), (row) => row.clientRequestId === clientRequestId, `form instance ${clientRequestId}`),
    });
  };
  const answer = (s, name, id, responses, status) =>
    s.act(name, 'site', 'PUT', `${P}/forms/${id}/responses`, { responses }, {
      fields: { status },
      verify: async (s2) => {
        const row = await s2.get('quality', `${P}/forms/${id}`);
        const answered = new Map((row.sections || []).flatMap((section) => section.items || []).map((item) => [item.id, item.response?.value]));
        return responses.every((r) => answered.get(r.itemId) === r.value);
      },
    });
  const formAct = (s, name, persona, id, action, payload, status, extra = {}) =>
    s.act(name, persona, 'POST', `${P}/forms/${id}/${action}`, payload, {
      fields: { status, ...extra },
      verify: async (s2) => (await instanceStatus(id)(s2)) === status,
    });
  const all = (overrides = {}) => [
    { itemId: itpTemplate.hold1, value: overrides.hold1 || 'pass' },
    { itemId: itpTemplate.hold2, value: overrides.hold2 || 'pass' },
    { itemId: itpTemplate.check, value: 'pass' },
    { itemId: itpTemplate.witness, value: 'yes' },
  ];

  // A110, pending hold: one scheduled instance (nothing answered) and one in progress (the two
  // hold items unanswered). The daily report below sits on the same activity.
  await b.step('itp.pending', async (s) => {
    const scheduled = await newInstance(s, 'itp.A110.scheduled', A.A110, before(1), later(5), 'ITP A110 pile caps, scheduled');
    const inProgress = await newInstance(s, 'itp.A110.in-progress', A.A110, before(2), later(4), 'ITP A110 pile caps, in progress');
    await formAct(s, 'itp.A110.in-progress.start', 'site', inProgress.id, 'start', {}, 'in_progress');
    await answer(s, 'itp.A110.in-progress.answers', inProgress.id, [{ itemId: itpTemplate.check, value: 'pass' }, { itemId: itpTemplate.witness, value: 'yes' }], 'in_progress');
    return { scheduled: scheduled.id, inProgress: inProgress.id };
  }, { needs: ['itp.template'] });

  // A120, failed hold: hold 1 answered "fail", signed and completed (outcome fail).
  await b.step('itp.failed', async (s) => {
    const row = await newInstance(s, 'itp.A120.failed', A.A120, before(3), before(1), 'ITP A120 ground beams, hold failed');
    await formAct(s, 'itp.A120.failed.start', 'site', row.id, 'start', {}, 'in_progress');
    await answer(s, 'itp.A120.failed.answers', row.id, all({ hold1: 'fail' }), 'in_progress');
    await signature(s, 'itp.A120.failed.signature', row.id);
    await formAct(s, 'itp.A120.failed.complete', 'site', row.id, 'complete', {}, 'complete', { outcome: 'fail' });
    return { instanceId: row.id, signatureId: s.id('itp.A120.failed.signature') };
  }, { needs: ['itp.template'], verify: signedVerify('complete') });

  // A140, voided hold: started, partly answered, voided with a reason (released).
  await b.step('itp.voided', async (s) => {
    const row = await newInstance(s, 'itp.A140.voided', A.A140, before(4), before(2), 'ITP A140 column kickers, raised against the wrong area');
    await formAct(s, 'itp.A140.voided.start', 'site', row.id, 'start', {}, 'in_progress');
    await answer(s, 'itp.A140.voided.answers', row.id, [{ itemId: itpTemplate.check, value: 'pass' }], 'in_progress');
    await formAct(s, 'itp.A140.voided.void', 'quality', row.id, 'void', { reason: b.name('Raised against the wrong area') }, 'void');
    return { instanceId: row.id };
  }, { needs: ['itp.template'] });

  // A150, the retroactive hold: everything passed, signed, completed and closed; the template edit
  // below then adds a hold item the closed instance never answered (HR-Q2 probe).
  const itpClosed = await b.step('itp.closed', async (s) => {
    const row = await newInstance(s, 'itp.A150.closed', A.A150, before(6), before(3), 'ITP A150 slab on grade, released and closed');
    await formAct(s, 'itp.A150.closed.start', 'site', row.id, 'start', {}, 'in_progress');
    await answer(s, 'itp.A150.closed.answers', row.id, all(), 'in_progress');
    await signature(s, 'itp.A150.closed.signature', row.id);
    await formAct(s, 'itp.A150.closed.complete', 'site', row.id, 'complete', {}, 'complete', { outcome: 'pass' });
    await formAct(s, 'itp.A150.closed.close', 'quality', row.id, 'close', { reason: b.name('Accepted, pour released') }, 'closed');
    return { instanceId: row.id, signatureId: s.id('itp.A150.closed.signature') };
  }, { needs: ['itp.template'], verify: signedVerify('closed') });

  // A170: everything passed, signed and completed, left complete (outcome pass).
  await b.step('itp.passed', async (s) => {
    const row = await newInstance(s, 'itp.A170.passed', A.A170, before(5), before(2), 'ITP A170 roof waterproofing, passed');
    await formAct(s, 'itp.A170.passed.start', 'site', row.id, 'start', {}, 'in_progress');
    await answer(s, 'itp.A170.passed.answers', row.id, all(), 'in_progress');
    await signature(s, 'itp.A170.passed.signature', row.id);
    await formAct(s, 'itp.A170.passed.complete', 'site', row.id, 'complete', {}, 'complete', { outcome: 'pass' });
    return { instanceId: row.id, signatureId: s.id('itp.A170.passed.signature') };
  }, { needs: ['itp.template'], verify: signedVerify('complete') });

  const holdsOn = async (s) => {
    const out = {};
    for (const code of ['A100', 'A110', 'A120', 'A140', 'A150', 'A170']) {
      const data = await s.get('quality', `${P}/forms/hold-points?activityId=${A[code]}`);
      out[code] = { open: data.open, states: (data.holdPoints || []).map((point) => point.state).sort() };
    }
    return out;
  };

  // The hold points as the five instances left them, BEFORE the template edit, in a step of their own
  // (round 2, R2-C): it is recorded done before the edit is sent, so a run cut off after the edit took
  // effect resumes past this reading and never asserts it again against the edited template. A state
  // written by the pre-round-2 code took this reading inside itp.template-edit: once that step is done,
  // its recorded reading is adopted; if that code sent the edit without finishing the step, the reading
  // can no longer be taken (fail closed, never re-read after the edit).
  const holdsBeforeEdit = await b.step('itp.holds.before-edit', async (s) => {
    const legacy = b.isDone('itp.template-edit') ? b.out('itp.template-edit').beforeEdit : null;
    s.assert(Boolean(legacy) || !b.state.records['itp.template.edit'], `the template edit was sent (records["itp.template.edit"] is ${b.state.records['itp.template.edit']?.status}) before the hold points were read: the before-edit reading can no longer be taken; check by hand`);
    const beforeEdit = legacy || await holdsOn(s);
    s.assert(beforeEdit.A100.open === 0, 'A100 (plain) has no hold point', beforeEdit);
    s.assert(beforeEdit.A110.open === 4 && beforeEdit.A110.states.every((state) => state === 'pending'), 'A110 has 4 pending hold points (2 instances x 2)', beforeEdit);
    s.assert(beforeEdit.A120.open === 1 && sameList(beforeEdit.A120.states, ['failed']), 'A120 has 1 failed hold point (hold 2 passed)', beforeEdit);
    s.assert(beforeEdit.A140.open === 0 && beforeEdit.A150.open === 0 && beforeEdit.A170.open === 0, 'A140 (void), A150 (closed) and A170 (passed) are released', beforeEdit);
    return beforeEdit;
  }, { needs: ['itp.pending', 'itp.failed', 'itp.voided', 'itp.closed', 'itp.passed'] });

  // The template edit (plan §3.2 "a closed one later hit by a template edit"): a third hold item is
  // added. HEAD's gate reads the current template (HR-Q2 today), so the closed A150 instance and the
  // complete A170 one get a pending hold point; HR-Q2's recommendation (gate on the instance's own
  // version) would leave them released. The hold points before and after are recorded, not judged.
  // Resumable across its own edit: an interrupted edit is adopted by its verify (version 2), and the
  // edited template is read back live and asserted whether the edit was sent now or adopted.
  await b.step('itp.template-edit', async (s) => {
    const beforeEdit = holdsBeforeEdit;
    const current = await s.get('quality', `${P}/forms/templates/${itpTemplate.templateId}`);
    const sections = (current.sections || []).map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map((item) => ({ id: item.id, label: item.label, responseType: item.responseType, isHoldPoint: item.isHoldPoint, inspectionPointType: item.inspectionPointType, required: item.required })),
    }));
    const target = one(sections, (section) => section.title === SECTION_TITLE, `template section ${SECTION_TITLE}`);
    s.assert(Boolean(target), `the template still has its section ${SECTION_TITLE}`, sections.map((section) => section.title));
    target.items.push({ label: 'Hold 3: concrete delivery tickets checked against the mix design', responseType: 'pass_fail', isHoldPoint: true });
    const data = await s.act('itp.template.edit', 'quality', 'PATCH', `${P}/forms/templates/${itpTemplate.templateId}`, {
      description: b.name('Two hold points released by the quality engineer before the pour; a third added after the first pours'),
      sections,
    }, {
      fields: { holdPointCount: 3, version: 2 },
      verify: async (s2) => (await s2.get('quality', `${P}/forms/templates/${itpTemplate.templateId}`))?.version === 2,
    });
    const edited = await s.get('quality', `${P}/forms/templates/${itpTemplate.templateId}`);
    s.expectFields(edited, { version: 2, holdPointCount: 3 }, `the template after the edit${data ? '' : ' (adopted from an interrupted run)'}`);
    const afterEdit = await holdsOn(s);
    s.note(`hold points before the template edit ${JSON.stringify(beforeEdit)}; after ${JSON.stringify(afterEdit)} (HR-Q2: HEAD gates on the current template)`);
    return { version: edited.version, beforeEdit, afterEdit, closedInstance: itpClosed.instanceId };
  }, { needs: ['itp.holds.before-edit'] });

  // ── the daily report with equipment on the pending-hold activity A110 ───────
  await b.step('daily-report', async (s) => {
    const notes = b.name('Pile caps: blinding and starter bars, excavator on site');
    const clientRequestId = b.ref('DR-A110');
    const data = await s.create('daily-report.A110', 'site', `${P}/daily-reports`, {
      activityId: A.A110,
      date: cal.reportDay,
      shift: 'day',
      weather: { summary: b.name('Fair'), condition: 'clear', temperatureC: 29, rainfallMm: 0, delayImpact: false },
      manpower: [{ trade: 'Concrete gang', workers: 6, hours: 8 }],
      materials: [{ name: b.name('Cement OPC 42.5N'), qty: 40, unit: 'bag' }],
      equipment: [{ equipmentId: equipment.equipmentId, name: b.name('Excavator 20 t'), hours: 6 }],
      issues: [{ title: b.name('Hold points open'), description: b.name('Both pile-cap hold points still open'), severity: 'medium', status: 'open' }],
      notes,
      status: 'submitted',
      progress: { method: 'percent', pctComplete: 10, notes: b.name('Blinding complete') },
      clientRequestId,
    }, {
      fields: { status: 'submitted', activityId: A.A110, notes },
      // An interrupted create is found on its day by its clientRequestId, never sent again.
      find: async (s2) => one(rowsOf(await s2.get('site', `${P}/daily-reports?activityId=${A.A110}&date=${cal.reportDay}`)), (row) => row.clientRequestId === clientRequestId, `daily report ${clientRequestId}`),
    });
    s.assert((data.equipment || []).length === 1, 'the report carries one equipment line', data.equipment);
    return { reportId: data.id };
  }, { needs: ['itp.pending', 'equipment'] });

  // ── legacy ITP register: failed, waived, passed (WP8.quality.inputs087FLD) ──
  const legacy = await b.step('legacy-itp', async (s) => {
    const out = {};
    for (const [key, pointType, target, code] of [['failed', 'hold', 'failed', 'A120'], ['waived', 'witness', 'waived', 'A140'], ['passed', 'review', 'passed', 'A150']]) {
      const title = b.name(`Legacy ITP ${key}: ${code} inspection point`);
      await s.create(`legacy-itp.${key}`, 'quality', `${P}/itp`, {
        title,
        pointType,
        status: 'pending',
        activityId: A[code],
        dueDate: before(1),
        inspectionDate: before(2),
        inspector: b.name('Quality inspector'),
        notes: b.name('Inspection and test plan point from the ITP schedule'),
      }, {
        fields: { title, status: 'pending', pointType },
        get: null, // no single-row route: the step's verify re-reads the register
        find: async (s2) => one(rowsOf(await s2.get('quality', `${P}/itp`)), (r) => r.title === title, `legacy ITP ${title}`),
      });
      const row = { id: s.id(`legacy-itp.${key}`) };
      await s.act(`legacy-itp.${key}.${target}`, 'quality', 'PATCH', `${P}/itp/${row.id}`, {
        status: target,
        inspectionDate: before(1),
        comment: b.name(`Recorded ${target}`),
      }, {
        fields: { status: target },
        verify: async (s2) => one(rowsOf(await s2.get('quality', `${P}/itp`)), (r) => r.id === row.id, `legacy ITP ${row.id}`)?.status === target,
      });
      out[key] = row.id;
    }
    return out;
  }, {
    verify: async (s, out) => {
      const rows = rowsOf(await s.get('quality', `${P}/itp`));
      const wrong = Object.entries(out).filter(([key, id]) => one(rows, (r) => r.id === id, `legacy ITP ${id}`)?.status !== key);
      return wrong.length ? `legacy ITPs no longer as built: ${JSON.stringify(wrong)}` : true;
    },
  });

  // ── evidence for closeouts (the workflow store, as the closeout dialogs send it) ──
  // No find (R2-11, fail closed): the product lists a workflow upload only once a record cites it, and
  // nothing cites it before the closeout, so an upload cut off before its answer was recorded stops the
  // build for a check by hand; it is never sent again. Once cited, the step's verify re-reads it on the
  // record (evidenceOn).
  const evidence = async (s, name, persona) => {
    const file = { filename: b.file(`${name}.pdf`), contentType: 'application/pdf', body: pdf(b.ref(name)) };
    const fileOf = (d) => one(rowsOf(d), (row) => row.fileName === file.filename, `uploaded ${file.filename}`);
    const data = await s.upload(name, persona, `${P}/workflow/uploads`, file, {
      field: 'files',
      get: null,
      idOf: (d) => fileOf(d)?.documentId ?? null,
      fields: { $status: 201 },
    });
    const item = fileOf(data);
    s.assert(Boolean(item?.documentId), `${name}: the upload answers a stored document named ${file.filename}`, data);
    return { fileName: item.fileName, fileUrl: item.fileUrl, storageKey: item.storageKey || item.key || item.documentId, mimeType: item.mimeType, sizeBytes: item.sizeBytes, description: b.name('Closeout evidence') };
  };
  /** The closeout evidence a record carries now (its attachments, as the workflow read model presents them). */
  const evidenceOn = (row, ref) => (row?.attachments || row?.attachmentRefs || []).some((att) => (ref.storageKey && att.storageKey === ref.storageKey) || att.fileName === ref.fileName);

  // ── NCRs: 2 major and 3 minor across every state (WP8.quality.dashboard087FLD = 21) ──
  const ncrs = await b.step('ncr', async (s) => {
    const out = {};
    const list = async (s2) => rowsOf(await s2.get('quality', `${P}/ncr`));
    const status = (id) => async (s2) => one(await list(s2), (r) => r.id === id, `NCR ${id}`)?.status;
    for (const [key, severity, target, code, raiser] of [
      ['major-open', 'major', 'open', 'A120', 'site'], // closed by the WP-8 proof ("closing a major NCR leaves 21")
      ['major-closed', 'major', 'closed', 'A140', 'quality'],
      ['minor-open', 'minor', 'open', 'A100', 'site'],
      ['minor-submitted', 'minor', 'submitted', 'A150', 'quality'],
      ['minor-closed', 'minor', 'closed', 'A170', 'site'],
    ]) {
      const description = b.name(`NCR ${key}: defective work at ${code}`);
      await s.create(`ncr.${key}`, raiser, `${P}/ncr`, {
        severity,
        description,
        disposition: b.name('Repair to the approved method statement'),
        responsible: b.name('Delta Formwork foreman'),
        assigneeUserId: user.site,
        assigneeCompanyId: companies.subcontractor,
        activityId: A[code],
        dueDate: later(10),
        comment: b.name('Raised after inspection'),
      }, {
        fields: { severity, status: 'open', description },
        get: null, // no single-row route: the step's verify re-reads the register
        find: async (s2) => one(await list(s2), (r) => r.description === description, `NCR ${description}`),
      });
      const row = { id: s.id(`ncr.${key}`) };
      let ref = null;
      if (target !== 'open') {
        ref = await evidence(s, `ncr.${key}.evidence`, 'site');
        await s.act(`ncr.${key}.closeout`, 'site', 'POST', `${P}/ncr/${row.id}/close`, {
          closureComment: b.name('Defective work cut out and made good; re-inspected'),
          responsible: b.name('Delta Formwork foreman'),
          dueDate: later(10),
          attachmentRefs: [ref],
        }, { fields: { status: 'submitted' }, verify: async (s2) => ['submitted', 'closed'].includes(await status(row.id)(s2)) });
      }
      if (target === 'closed') {
        await s.act(`ncr.${key}.approve`, 'quality', 'POST', `${P}/ncr/${row.id}/approve`, { comment: b.name('Repair accepted') }, {
          fields: { status: 'closed' },
          verify: async (s2) => (await status(row.id)(s2)) === 'closed',
        });
      }
      if (ref) s.assert(evidenceOn(one(await list(s), (r) => r.id === row.id, `NCR ${row.id}`), ref), `NCR ${key} carries its closeout evidence ${ref.fileName}`);
      out[key] = { id: row.id, severity, status: target, evidence: ref ? { fileName: ref.fileName, storageKey: ref.storageKey } : null };
    }
    return out;
  }, {
    verify: async (s, out) => {
      const rows = rowsOf(await s.get('quality', `${P}/ncr`));
      const wrong = Object.entries(out).filter(([, n]) => {
        const r = one(rows, (x) => x.id === n.id, `NCR ${n.id}`);
        return !r || r.status !== n.status || r.severity !== n.severity || (n.evidence && !evidenceOn(r, n.evidence));
      });
      return wrong.length ? `NCRs (or their closeout evidence) no longer as built: ${JSON.stringify(wrong)}` : true;
    },
  });

  // ── punch items with a final approver (WP8.punch.mix: draft 2, open 2, ready 1, dispute 1, closed 1, void 1) ──
  const punchAct = (s, name, persona, id, action, target, reason) =>
    s.act(name, persona, 'POST', `${P}/punch/${id}/transition`, { action, ...(reason ? { reason: b.name(reason) } : {}) }, {
      fields: { status: target },
      verify: async (s2) => (await s2.get('quality', `${P}/punch/${id}`))?.status === target,
    });
  const walkPunch = async (s, key, id, target, { observation = false } = {}) => {
    if (target === 'draft') return;
    await punchAct(s, `${key}.open`, 'site', id, 'open', 'open');
    if (target === 'open') return;
    if (target === 'void') return punchAct(s, `${key}.void`, observation ? 'pm' : 'quality', id, 'void', 'void', 'Duplicate of another item');
    if (target === 'in_dispute') return punchAct(s, `${key}.dispute`, 'site', id, 'dispute', 'in_dispute', 'Not in the subcontract scope');
    if (observation && target === 'closed') return punchAct(s, `${key}.close`, 'pm', id, 'close', 'closed', 'Made safe');
    await punchAct(s, `${key}.ready`, 'site', id, 'ready_for_review', 'ready_for_review');
    if (target === 'ready_for_review') return undefined;
    // close: only the final approver may (WP8.punch.closeByNonApprover)
    return punchAct(s, `${key}.close`, 'quality', id, 'close', 'closed', 'Verified on the walk-down');
  };
  /** An interrupted punch or observation create is found by its title (a b.name text, the item's own), never sent again. */
  const punchFind = (title, kind) => async (s2) => one(rowsOf(await s2.get('quality', `${P}/punch?kind=all&status=all&search=${encodeURIComponent(title)}`)), (row) => row.title === title && row.kind === kind, `${kind} ${title}`);
  await b.step('punch', async (s) => {
    const out = {};
    const plans = [['draft-1', 'draft', 'A100'], ['draft-2', 'draft', 'A110'], ['open-1', 'open', 'A120'], ['open-2', 'open', 'A130'], ['ready', 'ready_for_review', 'A140'], ['dispute', 'in_dispute', 'A150'], ['closed', 'closed', 'A160'], ['void', 'void', 'A170']];
    for (const [key, target, code] of plans) {
      const title = b.name(`Punch ${key}: snag at ${code}`);
      const row = await s.create(`punch.${key}`, 'site', `${P}/punch`, {
        title,
        description: b.name('Snag found on the walk-round'),
        kind: 'punch',
        priority: 'normal',
        trade: 'Finishes',
        locationId: locations.zoneB,
        activityId: A[code],
        assigneeUserId: user.site,
        assigneeCompanyId: companies.subcontractor,
        managerUserId: user.pm,
        finalApproverUserId: user.quality,
        dueDate: later(14),
        clientRequestId: b.ref(`punch.${key}`),
      }, {
        fields: { title, kind: 'punch', status: 'draft', finalApproverUserId: user.quality },
        find: punchFind(title, 'punch'),
      });
      await walkPunch(s, `punch.${key}`, row.id, target);
      out[key] = { id: row.id, status: target };
    }
    const counts = Object.values(out).reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
    s.assert(sameList(counts, { draft: 2, open: 2, ready_for_review: 1, in_dispute: 1, closed: 1, void: 1 }), 'the punch mix of WP8.punch.mix', counts);
    return out;
  }, { verify: async (s, out) => { for (const row of Object.values(out)) { const r = await s.get('quality', `${P}/punch/${row.id}`); if (r.status !== row.status) return `punch ${row.id} is ${r.status}`; } return true; } });

  // ── observations, one per type (WP8.punch.openObservations 2: safety open + environmental draft) ──
  await b.step('observations', async (s) => {
    const out = {};
    for (const [type, target, code] of [['safety', 'open', 'A110'], ['environmental', 'draft', 'A100'], ['quality', 'closed', 'A150'], ['work_to_complete', 'void', 'A160'], ['commissioning', 'closed', 'A180']]) {
      const title = b.name(`Observation ${type} at ${code}`);
      const row = await s.create(`observation.${type}`, 'quality', `${P}/punch`, {
        title,
        description: b.name('Observed on the daily walk'),
        kind: 'observation',
        observationType: type,
        hazard: type === 'safety' ? b.name('Fall into excavation') : null,
        contributingCondition: b.name('Barriers moved for plant access'),
        priority: type === 'safety' ? 'urgent' : 'normal',
        locationId: locations.zoneA,
        activityId: A[code],
        assigneeUserId: user.site,
        managerUserId: user.pm,
        dueDate: later(5),
        clientRequestId: b.ref(`observation.${type}`),
      }, {
        fields: { title, kind: 'observation', observationType: type, status: 'draft' },
        find: punchFind(title, 'observation'),
      });
      await walkPunch(s, `observation.${type}`, row.id, target, { observation: true });
      out[type] = { id: row.id, status: target };
    }
    return out;
  }, { verify: async (s, out) => { for (const row of Object.values(out)) { const r = await s.get('quality', `${P}/punch/${row.id}`); if (r.status !== row.status) return `observation ${row.id} is ${r.status}`; } return true; } });

  // ── safety: open near miss, closed LTI with lost days, archived near miss (WP8.safety.inputs) ──
  await b.step('safety', async (s) => {
    const list = async (s2) => rowsOf(await s2.get('quality', `${P}/safety?includeArchived=true`));
    const status = (id) => async (s2) => one(await list(s2), (r) => r.id === id, `safety record ${id}`)?.status;
    const make = async (key, incidentType, title, extra = {}) => {
      const fullTitle = b.name(title);
      await s.create(`safety.${key}`, 'site', `${P}/safety`, {
        incidentType,
        title: fullTitle,
        date: before(4),
        activityId: A.A110,
        responsible: b.name('Site supervisor'),
        investigation: b.name('Statements taken from the crew'),
        severity: 'medium',
        dueDate: later(7),
        lostDays: 0,
        status: 'open',
        comment: b.name('Reported the same shift'),
        ...extra,
      }, {
        fields: { incidentType, title: fullTitle, status: 'open' },
        get: null, // no single-row route: the step's verify re-reads the register
        find: async (s2) => one(await list(s2), (r) => r.title === fullTitle, `safety record ${fullTitle}`),
      });
      return { id: s.id(`safety.${key}`) };
    };
    const nearMiss = await make('near-miss-open', 'near_miss', 'Near miss: pallet slipped from the forks during offloading');
    const lti = await make('lti-closed', 'lti', 'LTI: operative fell from a hop-up, sprained ankle', { lostDays: 3, severity: 'high', activityId: A.A130 });
    const ref = await evidence(s, 'safety.lti-closed.evidence', 'site');
    await s.act('safety.lti-closed.closeout', 'site', 'POST', `${P}/safety/${lti.id}/close`, {
      closureComment: b.name('Corrective actions briefed and in place'),
      responsible: b.name('Site supervisor'),
      dueDate: later(7),
      attachmentRefs: [ref],
    }, { fields: { status: 'submitted' }, verify: async (s2) => ['submitted', 'closed'].includes(await status(lti.id)(s2)) });
    await s.act('safety.lti-closed.approve', 'quality', 'POST', `${P}/safety/${lti.id}/approve`, { comment: b.name('Closed out') }, {
      fields: { status: 'closed', lostDays: 3 },
      verify: async (s2) => (await status(lti.id)(s2)) === 'closed',
    });
    const archived = await make('near-miss-archived', 'near_miss', 'Near miss: entered twice in error');
    await s.act('safety.near-miss-archived.archive', 'pm', 'DELETE', `${P}/safety/${archived.id}`, undefined, {
      fields: { $status: 200 },
      verify: async (s2) => (await status(archived.id)(s2)) === 'archived',
    });
    const rows = await list(s);
    const archivedRow = one(rows, (r) => r.id === archived.id, `safety record ${archived.id}`);
    s.assert(archivedRow?.status === 'archived', 'the withdrawn near miss is archived, not deleted', archivedRow);
    s.assert(evidenceOn(one(rows, (r) => r.id === lti.id, `safety record ${lti.id}`), ref), `the LTI carries its closeout evidence ${ref.fileName}`);
    return { nearMissOpen: nearMiss.id, ltiClosed: lti.id, nearMissArchived: archived.id, ltiEvidence: { fileName: ref.fileName, storageKey: ref.storageKey } };
  }, {
    verify: async (s, out) => {
      const rows = rowsOf(await s.get('quality', `${P}/safety?includeArchived=true`));
      const want = { [out.nearMissOpen]: 'open', [out.ltiClosed]: 'closed', [out.nearMissArchived]: 'archived' };
      const wrong = Object.entries(want).filter(([id, st]) => one(rows, (r) => r.id === id, `safety record ${id}`)?.status !== st);
      if (wrong.length) return `safety records no longer as built: ${JSON.stringify(wrong)}`;
      return evidenceOn(one(rows, (r) => r.id === out.ltiClosed, `safety record ${out.ltiClosed}`), out.ltiEvidence) || `the LTI ${out.ltiClosed} no longer carries its closeout evidence`;
    },
  });

  // ── RFIs in every state (WP8.rfi.*) ─────────────────────────────────────────
  const rfiBase = (title) => ({
    subject: b.name(title),
    question: b.name(`Please confirm: ${title.toLowerCase()}. The drawings and the specification disagree.`),
    priority: 'normal',
    discipline: 'structural',
    managerUserId: user.pm,
    assigneeUserIds: [user.planner],
    distributionUserIds: [user.qs],
    activityId: A.A180,
    locationId: locations.zoneB,
  });
  const rfiStatus = (id) => async (s) => (await s.get('pm', `${P}/rfi/${id}`))?.status;
  const rfiFind = (subject) => async (s) => one(rowsOf(await s.get('pm', `${P}/rfi?limit=100&includeArchived=true&search=${encodeURIComponent(subject)}`)), (r) => r.subject === subject, `RFI ${subject}`);

  // A draft RFI: the create route offers "draft", the workflow table refuses it (RFI-DRAFT, P2 owner decision).
  await b.step('rfi.draft', async (s) => {
    const payload = { ...rfiBase('RFI draft: sleeve positions at grid E'), status: 'draft' };
    await s.create('rfi.draft', 'site', `${P}/rfi`, payload, {
      fields: { status: 'draft' },
      known: { ref: 'RFI-DRAFT', said: ['409 APPROVAL_WORKFLOW_INVALID_TRANSITION'] },
      find: rfiFind(payload.subject),
    });
  });

  await b.step('rfi', async (s) => {
    // Open, overdue only by responseRequiredBy (dueDate null) (WP8.rfi.overdueRecords "RFI-RRB").
    const rrbBody = { ...rfiBase('RFI RRB: founding level at grid A'), status: 'open', raisedDate: before(10), responseRequiredBy: before(3), dueDate: null };
    // Stored with dueDate null. The API presents dueDate = its responseRequiredBy for RFI-RRB
    // (WP8.rfi.overdueApiDueDate; workflow-support dueDateForRecord: dueDate || responseRequiredBy || ...);
    // the stored null (WP8.rfi.overdueStoredDueDate) is read in process by the WP-8 proof, read only.
    const rrb = await s.create('rfi.rrb', 'site', `${P}/rfi`, rrbBody, {
      fields: { status: 'open', subject: rrbBody.subject, responseRequiredBy: is.day(rrbBody.responseRequiredBy), dueDate: is.day(rrbBody.responseRequiredBy) },
      find: rfiFind(rrbBody.subject),
    });
    // Answered after its dueDate (responseRequiredBy null) (WP8.rfi.overdueRecords "RFI-ANS"); the API
    // presents its own dueDate (WP8.rfi.overdueApiDueDate).
    const ansBody = { ...rfiBase('RFI ANS: column kicker cover'), status: 'open', raisedDate: before(10), dueDate: before(4), responseRequiredBy: null };
    const ans = await s.create('rfi.ans', 'site', `${P}/rfi`, ansBody, {
      fields: { status: 'open', subject: ansBody.subject, dueDate: is.day(ansBody.dueDate), responseRequiredBy: is.absent },
      find: rfiFind(ansBody.subject),
    });
    await s.act('rfi.ans.answer', 'planner', 'POST', `${P}/rfi/${ans.id}/answer`, {
      response: b.name('Cover 50 mm to the column kickers, as the specification states'),
      answeredDate: before(2),
    }, { fields: { status: 'answered' }, verify: async (s2) => (await rfiStatus(ans.id)(s2)) === 'answered' });
    // Closed, with a 3-day schedule impact (WP8.rfi.scheduleImpactLink): answered, then approved.
    const closedBody = { ...rfiBase('RFI closed: slab joint layout'), status: 'open', raisedDate: before(12), dueDate: before(6), scheduleImpactFlag: true, scheduleImpact: 3 };
    const closed = await s.create('rfi.closed', 'site', `${P}/rfi`, closedBody, {
      fields: { status: 'open', subject: closedBody.subject, scheduleImpact: 3, scheduleImpactFlag: true },
      find: rfiFind(closedBody.subject),
    });
    await s.act('rfi.closed.answer', 'planner', 'POST', `${P}/rfi/${closed.id}/answer`, {
      response: b.name('Joints at 6 m centres both ways; the layout will be reissued'),
      answeredDate: before(7),
    }, { fields: { status: 'answered' }, verify: async (s2) => ['answered', 'closed'].includes(await rfiStatus(closed.id)(s2)) });
    await s.act('rfi.closed.approve', 'pm', 'POST', `${P}/rfi/${closed.id}/approve`, { comment: b.name('Answer accepted') }, {
      fields: { status: 'closed' },
      verify: async (s2) => (await rfiStatus(closed.id)(s2)) === 'closed',
    });
    // Archived.
    const archivedBody = { ...rfiBase('RFI archived: raised twice'), status: 'open', raisedDate: before(9) };
    const archived = await s.create('rfi.archived', 'site', `${P}/rfi`, archivedBody, {
      fields: { status: 'open', subject: archivedBody.subject },
      find: rfiFind(archivedBody.subject),
    });
    await s.act('rfi.archived.archive', 'pm', 'DELETE', `${P}/rfi/${archived.id}`, undefined, {
      fields: { $status: 200 },
      verify: async (s2) => (await rfiStatus(archived.id)(s2)) === 'archived',
    });
    return { rrb: rrb.id, ans: ans.id, closed: closed.id, archived: archived.id };
  }, {
    verify: async (s, out) => {
      const want = { [out.rrb]: 'open', [out.ans]: 'answered', [out.closed]: 'closed', [out.archived]: 'archived' };
      for (const [id, st] of Object.entries(want)) {
        const now = await rfiStatus(id)(s);
        if (now !== st) return `RFI ${id} is ${now}, not ${st}`;
      }
      return true;
    },
  });

  // ── submittals: one direct, one on a 2-step template (WP8.submittal.*) ──────
  /** A record's row in the document-control register (the record's revisions with their file names), or null. */
  const registerRow = async (s2, recordType, recordId, persona = 'pm') => one(rowsOf(await s2.get(persona, `${P}/doc-control/register?recordType=${recordType}`)), (row) => row.recordId === recordId, `${recordType} ${recordId} in the register`);
  /** R2-11: an interrupted revision upload is found in the register by its revision code and file name, never sent again. */
  const revisionFind = (recordType, recordId, label, fileName) => async (s2) => {
    const revision = one((await registerRow(s2, recordType, recordId))?.revisions || [], (r) => r.revision === label && r.fileName === fileName, `${recordType} revision ${label} (${fileName})`);
    return revision ? { revision } : null;
  };
  /** A step's verify: each recorded revision is still on its record in the register. */
  const revisionsListed = async (s, recordType, recordId, revisionIds) => {
    const row = await registerRow(s, recordType, recordId);
    if (!row) return `${recordType} ${recordId} is not in the document register`;
    const ids = new Set((row.revisions || []).map((r) => r.id));
    const missing = revisionIds.filter((id) => !ids.has(id));
    return missing.length ? `${recordType} ${recordId} no longer holds revisions ${missing.join(', ')}` : true;
  };
  await b.step('submittals', async (s) => {
    const templateName = b.name('Two-step review: QS 3 days, Planner 4 days');
    const template = await s.create('submittal.template', 'planner', `${P}/submittals/workflow-templates`, {
      name: templateName,
      description: b.name('QS check, then the planner'),
      isDefault: false,
      steps: [
        { name: b.name('QS review'), mode: 'sequential', days: 3, assignees: [{ type: 'user', userId: user.qs }] },
        { name: b.name('Planner review'), mode: 'sequential', days: 4, assignees: [{ type: 'user', userId: user.planner }] },
      ],
    }, {
      fields: { name: templateName },
      get: `${P}/submittals/workflow-templates`,
      find: async (s2) => one(rowsOf(await s2.get('planner', `${P}/submittals/workflow-templates`)), (r) => r.name === templateName, `submittal template ${templateName}`),
    });
    const make = async (key, extra, submitBy) => {
      const title = b.name(`Submittal ${key}: cement mill certificate`);
      return s.create(`submittal.${key}`, 'site', `${P}/submittals`, {
        title,
        specRef: '03 30 00',
        discipline: 'structural',
        activityId: A.A180,
        managerUserId: user.pm,
        distributionUserIds: [user.qs],
        leadTimeWeeks: 2, // WP8.submittal.submitByTemplated note: requiredOnSite 2027-01-25, lead time 2 weeks
        requiredOnSite: '2027-01-25',
        comment: b.name('For approval'),
        ...extra,
      }, {
        fields: { title, submitBy: is.day(submitBy) },
        find: async (s2) => one(rowsOf(await s2.get('pm', `${P}/submittals?limit=100&search=${encodeURIComponent(title)}`)), (r) => r.title === title, `submittal ${title}`),
      });
    };
    // No template, no review days: submit-by 2027-01-11 (WP8.submittal.submitByDirect).
    const direct = await make('direct', {}, WP8.submittal.submitByDirect.value);
    // On the template (3 + 4 = 7 review days): submit-by 2027-01-04 (WP8.submittal.submitByTemplated).
    const stepped = await make('templated', { workflowTemplateId: template.id }, WP8.submittal.submitByTemplated.value);
    const out = { templateId: template.id };
    for (const [key, row] of [['direct', direct], ['templated', stepped]]) {
      const filename = b.file(`submittal-${key}-rev0.pdf`);
      const revision = await s.upload(`submittal.${key}.rev0`, 'site', `${P}/doc-control/submittal/${row.id}/revisions/upload`, {
        filename, contentType: 'application/pdf', body: pdf(b.ref(`submittal-${key}-rev0`)),
      }, {
        field: 'file',
        form: { revision: '0', title: b.name(`Submittal ${key} rev 0`) },
        get: null, // no single-revision read: the register lists it (the step's verify)
        idOf: (d) => d?.revision?.id ?? null,
        fields: { 'revision.revision': '0', 'revision.fileName': filename },
        find: revisionFind('submittal', row.id, '0', filename),
      });
      const status = async (s2) => (await s2.get('pm', `${P}/submittals/${row.id}`))?.status;
      await s.act(`submittal.${key}.submit`, 'site', 'POST', `${P}/submittals/${row.id}/submit`, { comment: b.name('Submitted for review') }, {
        fields: { status: 'under_review' },
        verify: async (s2) => (await status(s2)) === 'under_review',
      });
      out[key] = { id: row.id, revisionId: revision.revision.id };
    }
    return out;
  }, {
    verify: async (s, out) => {
      for (const key of ['direct', 'templated']) {
        const listed = await revisionsListed(s, 'submittal', out[key].id, [out[key].revisionId]);
        if (listed !== true) return listed;
        const status = (await s.get('pm', `${P}/submittals/${out[key].id}`))?.status;
        if (status !== 'under_review') return `submittal ${out[key].id} is ${status}, not under_review`;
      }
      return true;
    },
  });

  // ── drawing S-1, revisions A-F, and the current-only fixture (WP8.drawing.*) ──
  const drawing = await b.step('drawing.S-1', async (s) => {
    const title = b.name('S-1 foundation layout');
    await s.create('drawing.S-1', 'planner', `${P}/drawings`, {
      drawingNumber: 'S-1',
      title,
      status: 'active',
      activityId: A.A180,
      activityIds: [A.A180],
      issueDate: cal.issueDay,
      comment: b.name('Registered for the foundation works'),
    }, {
      fields: { drawingNumber: 'S-1', title },
      get: null, // no single-drawing route: the step's verify re-reads the register
      find: async (s2) => one(rowsOf(await s2.get('planner', `${P}/drawings`)), (r) => r.drawingNumber === 'S-1' && r.title === title, `drawing S-1 ${title}`),
    });
    const drawingRow = { id: s.id('drawing.S-1') };
    const register = (s2, persona = 'pm') => registerRow(s2, 'drawing', drawingRow.id, persona);
    const revisionState = async (s2, id) => one((await register(s2))?.revisions || [], (r) => r.id === id, `S-1 revision ${id}`);
    const revisions = {};
    for (const label of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const filename = b.file(`S-1-rev${label}.pdf`);
      const up = await s.upload(`drawing.S-1.rev${label}`, 'site', `${P}/doc-control/drawing/${drawingRow.id}/revisions/upload`, {
        filename, contentType: 'application/pdf', body: pdf(b.ref(`S-1 rev ${label}`)),
      }, {
        field: 'file',
        form: { revision: label, title: b.name(`S-1 rev ${label}`), documentNumber: 'S-1', discipline: 'structural', notes: b.name(`Rev ${label}`) },
        get: null, // no single-revision read: the register lists it (the step's verify)
        idOf: (d) => d?.revision?.id ?? null,
        fields: { 'revision.revision': label, 'revision.fileName': filename },
        find: revisionFind('drawing', drawingRow.id, label, filename),
      });
      revisions[label] = { id: s.id(`drawing.S-1.rev${label}`), documentId: up?.revision?.projectDocumentId || up?.document?.documentId || null };
      const review = ['A', 'B', 'C', 'E'].includes(label);
      if (review) {
        await s.act(`drawing.S-1.rev${label}.review`, 'site', 'POST', `${P}/doc-control/revisions/${revisions[label].id}/submit-review`, { comment: b.name(`Rev ${label} for review`) }, {
          fields: { id: revisions[label].id },
          verify: async (s2) => !['uploaded'].includes((await revisionState(s2, revisions[label].id))?.status),
        });
      }
      if (label === 'A' || label === 'B') {
        await s.act(`drawing.S-1.rev${label}.approve`, 'pm', 'POST', `${P}/doc-control/revisions/${revisions[label].id}/approve`, { comment: b.name(`Rev ${label} approved for construction`) }, {
          fields: { status: 'approved' },
          verify: async (s2) => (await revisionState(s2, revisions[label].id))?.status === 'approved',
        });
      }
    }
    // The current-only fixture (adjudication F4, WP8.drawing.currentOnlyFixture): a revision filed
    // directly as approved by a member who may approve revisions; filed approved and not latest, so B
    // stays the current approved revision and nothing is superseded. Code X1 (not A-F).
    const fixtureFile = b.file('S-1-revX1.pdf');
    const fixture = await s.upload('drawing.S-1.revX1', 'pm', `${P}/doc-control/drawing/${drawingRow.id}/revisions/upload`, {
      filename: fixtureFile, contentType: 'application/pdf', body: pdf(b.ref('S-1 rev X1 fixture')),
    }, {
      field: 'file',
      form: { revision: 'X1', status: 'approved', title: b.name('S-1 rev X1, current-only fixture'), documentNumber: 'S-1', notes: b.name('Fixture for the storeman current-only filter (adjudication F4)') },
      get: null, // no single-revision read: the register lists it (the step's verify)
      idOf: (d) => d?.revision?.id ?? null,
      fields: { 'revision.revision': 'X1', 'revision.status': 'approved', 'revision.isLatest': false, 'revision.fileName': fixtureFile },
      find: revisionFind('drawing', drawingRow.id, 'X1', fixtureFile),
    });
    revisions.X1 = { id: s.id('drawing.S-1.revX1'), documentId: fixture?.revision?.projectDocumentId || null };
    s.assert(Boolean(revisions.B.documentId), 'S-1 rev B names its stored document (the transmittal cites it)', revisions.B);
    // The state the storeman probe reads (WP8.drawing.storemanRevisions): A superseded, B approved and
    // latest, C-F not approved, X1 approved and not latest. The storeman's own view is the proof's.
    const row = await register(s);
    const byLabel = (label) => one(row?.revisions || [], (r) => r.revision === label, `S-1 rev ${label}`);
    s.expectFields(byLabel('B') || {}, { id: revisions.B.id, status: 'approved', isLatest: true }, 'S-1 rev B');
    const revA = byLabel('A');
    s.assert(Boolean(revA) && revA.id === revisions.A.id && revA.isLatest === false && (revA.status === 'superseded' || Boolean(revA.supersededAt)), 'S-1 rev A is superseded', revA);
    for (const label of ['C', 'D', 'E', 'F']) {
      const rev = byLabel(label);
      s.assert(Boolean(rev) && rev.id === revisions[label].id && rev.status !== 'approved' && !rev.isLatest, `S-1 rev ${label} is not approved`, rev);
    }
    s.expectFields(byLabel('X1') || {}, { id: revisions.X1.id, status: 'approved', isLatest: false, supersededAt: is.absent }, 'S-1 rev X1 (fixture)');
    const storeman = await register(s, 'warehouse');
    const storemanView = (storeman?.revisions || []).map((r) => r.revision).sort();
    s.note(`S-1 revisions as the PM reads them: ${(row?.revisions || []).map((r) => `${r.revision}:${r.status}${r.isLatest ? '*' : ''}`).join(' ')}; as the storeman reads them: [${storemanView.join(', ')}] (WP8.drawing.storemanRevisions expects ['B'])`);
    return { drawingId: drawingRow.id, title, revisions, storemanView };
  }, {
    needs: ['activities'],
    verify: async (s, out) => {
      const listed = one(rowsOf(await s.get('planner', `${P}/drawings`)), (r) => r.id === out.drawingId, `drawing ${out.drawingId}`);
      if (!listed || listed.title !== out.title) return `drawing S-1 ${out.drawingId} is no longer listed as built`;
      return revisionsListed(s, 'drawing', out.drawingId, Object.values(out.revisions).map((r) => r.id));
    },
  });

  // ── the transmittal citing S-1 rev B and an activity (WP8.transmittal.activityAndRevision) ──
  // Builders' adjudication 087-FLD item 5 (R2-3): the revision it issues is filed on the transmittal
  // through document control, naming S-1 rev B's stored document. That is a departure from citing it
  // in the transmittal create's own `revisions`, which WP-0 saw refused: persisted as finding WP8-TRN-1
  // (G2), reproduced by the WP-8 confirm-first proof.
  const transmittalRow = async (s2, id) => one(rowsOf(await s2.get('planner', `${P}/transmittals`)), (r) => r.id === id, `transmittal ${id}`);
  const citesRevisionB = (row, revisionId) => (row?.revisions || []).some((r) => r.id === revisionId && r.revision === 'B' && (r.projectDocumentId === drawing.revisions.B.documentId || r.storageKey === drawing.revisions.B.documentId));
  await b.step('transmittal', async (s) => {
    const subject = b.name('Issue of S-1 rev B for construction');
    await s.create('transmittal.S-1.B', 'planner', `${P}/transmittals`, {
      subject,
      sender: b.name('Site office'),
      recipient: b.name('Delta Formwork Subcontractors'),
      method: 'email',
      status: 'pending_ack',
      transmittedOn: before(5),
      activityIds: [A.A180],
      comment: b.name('S-1 rev B issued for construction'),
    }, {
      fields: { subject, status: 'pending_ack' },
      get: null, // no single-transmittal route: the step's verify re-reads the register
      find: async (s2) => one(rowsOf(await s2.get('planner', `${P}/transmittals`)), (r) => r.subject === subject, `transmittal ${subject}`),
    });
    const row = { id: s.id('transmittal.S-1.B') };
    await s.create('transmittal.S-1.B.revision', 'planner', `${P}/doc-control/transmittal/${row.id}/revisions`, {
      revision: 'B',
      projectDocumentId: drawing.revisions.B.documentId,
      documentNumber: 'S-1',
      title: b.name('S-1 rev B, issued for construction'),
      fileName: b.file('S-1-revB.pdf'),
      status: 'submitted',
      notes: b.name('Issued with the transmittal'),
    }, {
      get: null, // the transmittal lists its revisions: the step's verify re-reads it
      fields: { revision: 'B', projectDocumentId: drawing.revisions.B.documentId },
      // R2-11: an interrupted filing is found on the transmittal by its revision code and document, never sent again.
      find: async (s2) => one((await transmittalRow(s2, row.id))?.revisions || [], (r) => r.revision === 'B' && r.projectDocumentId === drawing.revisions.B.documentId, `transmittal ${row.id} revision B`),
    });
    const revisionId = s.id('transmittal.S-1.B.revision');
    s.finding('WP8-TRN-1', 'The transmittal cites S-1 rev B through POST /doc-control/transmittal/:id/revisions (planner, 201), not through the transmittal create\'s own revisions field. At WP-0 (087-FLD debug build, 2026-10-09) POST /projects/:id/transmittals with revisions [{ revision: "B", projectDocumentId: <S-1 rev B\'s stored document> }] answered 404 FILE_NOT_FOUND "Revision source file not found" (createTransmittal records the revisions without a writer, so assertDocumentsLinkable refuses a document already linked from the drawing). The doc-control path is the build path accepted by the builders\' adjudication (087-FLD item 5); the create\'s refusal is reproduced by the WP-8 confirm-first proof.');
    const listed = await transmittalRow(s, row.id);
    s.assert(Boolean(listed), 'the transmittal is listed');
    const linkedActivities = [listed.activityId, ...(listed.activityLinks || []).map((l) => l.activityId || l.activity?.id), ...(listed.activityIds || [])].filter(Boolean);
    s.assert(linkedActivities.includes(A.A180), 'the transmittal carries its activity link (A180)', { activityId: listed.activityId, activityLinks: listed.activityLinks });
    s.assert(citesRevisionB(listed, revisionId), 'the transmittal cites S-1 rev B by its document', listed.revisions);
    return { transmittalId: row.id, subject, revisionId };
  }, {
    needs: ['drawing.S-1'],
    verify: async (s, out) => {
      const listed = await transmittalRow(s, out.transmittalId);
      if (!listed || listed.subject !== out.subject) return `transmittal ${out.transmittalId} is no longer listed as built`;
      return citesRevisionB(listed, out.revisionId) || `transmittal ${out.transmittalId} no longer cites S-1 rev B (${out.revisionId})`;
    },
  });

  // ── the contractual notice letter, linked to a weather delay (WP8.transmittal.noticeLetterReadBack) ──
  const linksExactly = (delay, letterId) => {
    const links = delay?.correspondenceLinks || [];
    return links.length === 1 && links.every((l) => (l.correspondence?.id || l.correspondenceId) === letterId);
  };
  await b.step('notice-letter', async (s) => {
    const subject = b.name('Notice of delay: heavy rain and storm');
    await s.create('correspondence.notice', 'pm', `${P}/correspondence`, {
      direction: 'outgoing',
      type: 'notice',
      subject,
      date: before(4),
      status: 'open',
      activityId: A.A110,
      contractualNotice: true,
      body: b.name('Notice under the contract of delay caused by exceptionally adverse weather'),
      comment: b.name('Contractual notice to the client'),
    }, {
      fields: { subject, type: 'notice', contractualNotice: true },
      get: null, // no single-letter route: the step's verify re-reads the register
      find: async (s2) => one(rowsOf(await s2.get('pm', `${P}/correspondence`)), (r) => r.subject === subject, `correspondence ${subject}`),
    });
    const letter = { id: s.id('correspondence.notice') };
    // Linked to the 7.5-day manual contractual delay.
    const delayId = manual13.ids[1];
    const delayRow = async (s2) => one(rowsOf(await weatherList(s2)), (r) => r.id === delayId, `weather delay ${delayId}`);
    await s.act('weather.notice-link', 'planner', 'PATCH', `${P}/weather-delays/${delayId}`, { correspondenceIds: [letter.id] }, {
      fields: { id: delayId },
      verify: async (s2) => ((await delayRow(s2))?.correspondenceLinks || []).some((l) => (l.correspondence?.id || l.correspondenceId) === letter.id),
    });
    const delay = await delayRow(s);
    s.assert(linksExactly(delay, letter.id), 'the weather delay carries exactly the notice letter', delay?.correspondenceLinks);
    const register = await s.get('pm', `${P}/correspondence`);
    s.note(`correspondence summary.notices = ${register?.summary?.notices} (WP8.transmittal.noticeRegisterCount expects 1)`);
    return { letterId: letter.id, subject, weatherDelayId: delayId };
  }, {
    needs: ['weather.manual.13'],
    verify: async (s, out) => {
      const letter = one(rowsOf(await s.get('pm', `${P}/correspondence`)), (r) => r.id === out.letterId, `correspondence ${out.letterId}`);
      if (!letter || letter.subject !== out.subject || letter.contractualNotice !== true) return `the notice letter ${out.letterId} is no longer listed as built`;
      const delay = one(rowsOf(await weatherList(s)), (r) => r.id === out.weatherDelayId, `weather delay ${out.weatherDelayId}`);
      return linksExactly(delay, out.letterId) || `the weather delay ${out.weatherDelayId} no longer carries exactly the notice letter`;
    },
  });

  // ── the meeting, its createTask action items and a change event from one (WP8.transmittal.*) ──
  await b.step('meeting', async (s) => {
    const title = b.name('Weekly coordination meeting');
    const actions = [
      { itemNumber: '1', title: b.name('Price the extra blockwork at grid C'), ownerId: user.qs, priority: 'high', activityId: A.A160, createTask: true },
      { itemNumber: '2', title: b.name('Confirm the pile cap pour sequence'), ownerId: user.site, priority: 'medium', activityId: A.A110, createTask: true },
      { itemNumber: '3', title: b.name('Reissue drawing S-1 with the joint layout'), ownerId: user.planner, priority: 'low', activityId: A.A180, createTask: false },
    ];
    const meeting = await s.create('meeting.coordination', 'planner', `${P}/meetings`, {
      title,
      meetingType: 'coordination',
      status: 'draft',
      chairId: user.pm,
      activityId: A.A180,
      scheduledAt: `${before(3)}T08:00:00.000Z`,
      location: b.name('Site office, room 1'),
      objective: b.name('Review of the foundations and the coming fortnight'),
      attendees: [
        { userId: user.pm, role: 'Chair', attendanceStatus: 'attended', distributionRequired: true },
        { userId: user.planner, role: 'Minutes', attendanceStatus: 'attended', distributionRequired: true },
        { userId: user.site, role: 'Attendee', attendanceStatus: 'attended', distributionRequired: true },
        { userId: user.qs, role: 'Attendee', attendanceStatus: 'attended', distributionRequired: true },
      ],
      agendaItems: [{ title: b.name('Foundations progress'), sortOrder: 1, status: 'covered', activityId: A.A120 }],
      decisions: [{ title: b.name('Pour sequence'), decision: b.name('Pile caps before ground beams'), impact: b.name('None on the completion date'), activityId: A.A110, decidedById: user.pm }],
      actionItems: actions.map((a) => ({ ...a, description: b.name('Raised in the meeting'), dueDate: later(7), status: 'open' })),
    }, {
      fields: { title, status: 'draft' },
      find: async (s2) => one(rowsOf(await s2.get('planner', `${P}/meetings`)), (r) => r.title === title, `meeting ${title}`),
    });
    const full = await s.get('planner', `${P}/meetings/${meeting.id}`);
    const items = full.actionItems || [];
    s.assert(items.length === 3, 'the meeting holds 3 action items', items);
    const byNumber = Object.fromEntries(['1', '2', '3'].map((n) => [n, one(items, (item) => String(item.itemNumber) === n, `action item ${n}`)]));
    s.assert(Boolean(byNumber['1']?.taskId) && Boolean(byNumber['2']?.taskId) && Boolean(byNumber['3']) && !byNumber['3'].taskId, 'items 1 and 2 (createTask) carry a task, item 3 does not', items.map((i) => ({ n: i.itemNumber, taskId: i.taskId })));
    // A change event raised from action item 1 (record source meeting_action). The body sends no
    // PREFILL_OVERRIDABLE field, so the prefill stands; the code is carried by the action item's title.
    // The read-back is the answer book's wording (WP8.transmittal.meetingChangeEventReadBack, settled
    // by the builders' adjudication 087-FLD item 6): the typed link is presented as sourceRecordType /
    // sourceRecordId and sourceLinks[], not as meetingActionItemId.
    // romAmount and scheduleImpactDays are compared strictly (round 2, R2-F): the answer must carry the
    // book's number; null, a missing field or '' no longer passes for the book's 0.
    const CE = CE_BOOK;
    const titlePrefix = String(CE.title).split('<')[0];
    const action = byNumber['1'];
    const event = await s.create('change-event.meeting-action', 'qs', `${P}/meetings/action-items/${action.id}/raise-change-event`, {}, {
      named: false,
      get: (id) => `${P}/change-events/${id}`,
      fields: {
        origin: CE.origin,
        sourceRecordType: CE.sourceRecordType,
        sourceRecordId: action.id,
        sourceLinks: (v) => (Array.isArray(v) && v.length === CE.sourceLinks.length && v.every((link) => link.type === CE.sourceRecordType && link.id === action.id)) || `${CE.sourceLinks.length} source link(s), the action item`,
        title: `${titlePrefix}${action.title}`,
        type: CE.type,
        activityId: action.activityId,
        romAmount: is.number(CE.romAmount),
        scheduleImpactDays: is.number(CE.scheduleImpactDays),
      },
      find: async (s2) => one(rowsOf(await s2.get('qs', `${P}/change-events`)), (r) => r.sourceRecordType === CE.sourceRecordType && r.sourceRecordId === action.id, `change event from action item ${action.id}`),
    });
    s.assert(action.activityId === A.A160, 'action item 1 is on A160, so the change event is too', action);
    return {
      meetingId: meeting.id,
      actionItems: items.map((i) => ({ id: i.id, itemNumber: i.itemNumber, taskId: i.taskId || null })),
      changeEventId: event.id,
    };
  }, { needs: ['activities'] });

  // ── the 6-major variant, a project of its own (WP8.quality.sixMajor: 100 - 6 x 20, clamped to 0) ──
  await b.step('variant.six-major', async (s) => {
    const name = b.name('Field & quality, 6-major variant');
    const search = `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(name)}`;
    const project = await s.create('variant.project', 'pm', '/projects', {
      name,
      startDate: cal.projectStart,
      endDate: cal.projectEnd,
      projectCalendar: 'five_day',
      currency: 'EGP',
      type: 'building',
      contractType: 'unit_rate',
    }, {
      fields: { name, archivedAt: is.absent },
      get: (id) => `/projects/${id}`,
      adopt: true,
      find: async (s2) => one(rowsOf(await s2.get('pm', search)), (p) => p.name === name && !p.archivedAt, `live project ${name}`),
    });
    const VP = `/projects/${project.id}`;
    const ids = [];
    for (let i = 1; i <= 6; i += 1) {
      const description = b.name(`NCR major ${i} of 6 (variant)`);
      await s.create(`variant.ncr.${i}`, 'pm', `${VP}/ncr`, {
        severity: 'major',
        description,
        disposition: b.name('Break out and recast'),
        responsible: b.name('Main contractor'),
        dueDate: later(10),
      }, {
        fields: { severity: 'major', status: 'open', description },
        get: null, // no single-row route: the step's verify re-reads the variant's register
        find: async (s2) => one(rowsOf(await s2.get('pm', `${VP}/ncr`)), (r) => r.description === description, `variant NCR ${description}`),
      });
      ids.push(s.id(`variant.ncr.${i}`));
    }
    const rows = rowsOf(await s.get('pm', `${VP}/ncr`));
    s.assert(rows.filter((r) => r.severity === 'major').length === 6 && rows.length === 6, 'the variant holds exactly 6 major NCRs, nothing else', rows.map((r) => r.severity));
    return { projectId: project.id, ncrs: ids };
  }, {
    verify: async (s, out) => {
      const rows = rowsOf(await s.get('pm', `/projects/${out.projectId}/ncr`));
      const ids = new Set(rows.filter((r) => r.severity === 'major').map((r) => r.id));
      return (rows.length === 6 && out.ncrs.every((id) => ids.has(id))) || `the variant ${out.projectId} no longer holds exactly its 6 major NCRs`;
    },
  });

  // ── final read-back of the quality inputs as built (WP8.quality.inputs087FLD) ──
  await b.step('quality.inputs', async (s) => {
    const ncrRows = rowsOf(await s.get('quality', `${P}/ncr`));
    const itpRows = rowsOf(await s.get('quality', `${P}/itp`));
    const major = ncrRows.filter((r) => r.severity === 'major').length;
    const minor = ncrRows.filter((r) => r.severity === 'minor').length;
    const failed = itpRows.filter((r) => r.status === 'failed').length;
    s.assert(major === 2 && minor === 3 && failed === 1, 'quality inputs: 2 major, 3 minor, 1 failed legacy ITP (WP8.quality.inputs087FLD)', { major, minor, failed });
    s.assert(sameList(Object.values(ncrs).map((n) => n.status).sort(), ['closed', 'closed', 'open', 'open', 'submitted']), 'the NCRs cover open, submitted and closed', ncrs);
    s.assert(Object.keys(legacy).length === 3, 'legacy ITPs failed, waived, passed');
    return { major, minor, failedLegacyItps: failed, expectedScore: WP8.quality.dashboard087FLD.value };
  }, { needs: ['ncr', 'legacy-itp'] });
};

module.exports = { build };

// Run directly (run-all.js, or the proof lock): the 087-FLD build. Every name, reference, employee
// number and the party user's address carry b.code, so a scratch copy run under another code
// (a `_`-prefixed file calling lib.main('<code>', build)) makes its own records and never adopts these.
if (require.main === module) lib.main('087-FLD', build);
