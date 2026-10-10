'use strict';

/**
 * CERT-3 deep population, 052-FLD "CERT3 Field & quality" (plan §3.2 "D2,
 * company 052": "052-FLD: quality 21; safety 75; weather 65% then 70%;
 * labour 650.00"), 052 Summit General Contractors, USD, America/Chicago.
 *
 * The same answers as 087-FLD under another company's people (answer book
 * field-controls.js "052-FLD" and commercial.js WP7.weather["052-FLD"]):
 *   - quality 21: NCRs 2 major + 3 minor (open, submitted and closed among
 *     them; closed NCRs keep counting, HR-Q4) and legacy ITPs failed, waived
 *     and passed (only the failed one counts): 100 - 40 - 24 - 15 = 21
 *     ("052-FLD".qualityScore), read back on the quality dashboard;
 *   - safety 75: an open near miss, a closed LTI with lost days, an archived
 *     near miss ("052-FLD".safetyHealth 75), read on the project health card
 *     (R3-13). HEAD counts the archived near miss as an open investigation
 *     (health.js counts status != 'closed'), so the card reads the book's
 *     `today` 70: that step is BLOCKED HR-K1 (one health service on the
 *     workspace definitions, archived excluded) with the card's answer;
 *   - weather 65% then 70%: weatherAllowanceDays 20 set explicitly; delay
 *     entries of 2 h, 6 h and 10 h promoted from three daily logs (0.5 + 1.0 +
 *     1.5, contractual by default, adjudication C4) by the planner, who holds
 *     eot:create, as in 087-FLD (builders' adjudication R2-16 / round 2 R2-E;
 *     the site engineer's promotion stays the WP-7 HR-F4 probe), manual
 *     contractual 2.5 + 7.5 (13 -> 65%, no warning, 7 remaining), then 1.0
 *     (14 -> 70%, warning, 6 remaining), then a 10-day non-contractual delay
 *     that adds nothing (WP8.weather.nonContractualAddsNothing: 14). The
 *     product's GET /weather-delays is read at 13, before the 14th delay
 *     exists (weather.at13.read), and again at 14 (weather.at14.read, which
 *     needs the reading at 13), and once more after the non-contractual delay;
 *     each reading is kept in its own step's out and judged against the
 *     answer book in a step of its own, so a resumed run judges the answer of
 *     that moment. Nothing is computed by the builder (R2-E). HEAD stores the
 *     half-days truncated (Int column; HR-C11, undecided): each judgement is
 *     BLOCKED HR-C11 when the product gives the book's known answer
 *     (WP7.weather["087-FLD.composition"].today and WP8.weather.todayBelow /
 *     todayAt: 11 / 55% then 12 / 60%, no warning; nonContractualAddsNothing
 *     today 12), and fails on any other answer;
 *   - labour 650.00: one worker at 50.00, 8 h regular + 2 h overtime (x1.5)
 *     + 1 h double (x2), approved ("052-FLD".labour).
 *
 * Every promotion answer must carry delayDays, which is asserted against
 * WP8.dailyLog.promote<n>h (R3-13). Resumable (G4): interrupted creates are
 * found by their clientRequestId, notes or title, and an interrupted
 * promotion by the register row its daily-log entry names (read from the
 * weather register, never invented; R2-C); uploads, which no lookup lists,
 * fail closed; every step holding records with no read-back route has a
 * verify that reads them live. Every find by identity asserts that at most one
 * record matches (lanes.atMostOne; R2-D).
 *
 * Run alone: node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/052-fld.js
 */

const lib = require('./lib');
const lanes = require('./lanes');

const { is, dates } = lib;
const FC = lib.answers.fieldControls;
const CM = lib.answers.commercial;
const WP8 = FC.WP8;
const F052 = WP8['052-FLD']; // field-controls.js WP8["052-FLD"]
const W052 = CM.WP7.weather['052-FLD'];
const COMPOSITION = CM.WP7.weather['087-FLD.composition']; // the same record set; its `today` is HR-C11's known answer
const PROMOTED_CONTRACTUAL = CM.WP7.weather['087-FLD.promoted.contractual'].value; // true: a promotion is contractual by default (C4)
const NON_CONTRACTUAL_LEAF = WP8.weather.nonContractualAddsNothing; // value 14, today 12 (HR-C11); 052-FLD judges against this leaf too
const listOf = lanes.listOf;
const { atMostOne } = lanes; // G6 / R2-D: every find by identity names at most one record

const PROMOTED_HOURS = [2, 6, 10];
const PROMOTED_DAYS = COMPOSITION.value.promoted; // [0.5, 1.0, 1.5]
const MANUAL_13 = COMPOSITION.value.at13Manual; // [2.5, 7.5]
const MANUAL_14 = COMPOSITION.value.at14Add; // [1.0]
const NON_CONTRACTUAL = COMPOSITION.value.nonContractual; // [10]
const ALLOWANCE = WP8.weather.allowance.value; // 20
const RATE = 50;

const round2 = (v) => Math.round(Number(v) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A minimal one-page PDF carrying `text` (closeout evidence). */
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

async function body(b) {
  // The answer book agrees with itself before anything is built on it.
  b.assert(sameList(PROMOTED_HOURS.map(FC.rules.promoteDays), PROMOTED_DAYS), `the promotion rule gives ${PROMOTED_DAYS} for ${PROMOTED_HOURS} h`);
  b.assert(ALLOWANCE === 20 && F052.labour.value === 65000 && F052.qualityScore.value === 21 && F052.safetyHealth.value === 75, 'the 052-FLD figures: allowance 20, labour 650.00, quality 21, safety 75');
  b.assert(sameList(W052.value, { first: [65, false], then: [70, true] }), 'WP7.weather["052-FLD"]: 65% then 70%');
  b.assert(sameList(W052.value, { first: [F052.weatherBelowPct.value, WP8.weather.belowWarning.value], then: [F052.weatherAtPct.value, F052.weatherAtWarning.value] }), 'the two books agree on 052-FLD\'s weather at 13 and 14');
  b.assert(COMPOSITION.today.at13Pct === WP8.weather.todayBelow.value && COMPOSITION.today.at14Pct === WP8.weather.todayAt.value, 'the two books agree on HR-C11\'s known answer at 13 and 14');
  b.assert(NON_CONTRACTUAL_LEAF.value === WP8.weather.atContractualUsed.value && NON_CONTRACTUAL_LEAF.today === COMPOSITION.today.at14Used, `WP8.weather.nonContractualAddsNothing (value ${NON_CONTRACTUAL_LEAF.value}, today ${NON_CONTRACTUAL_LEAF.today}) is the figure at 14 and its HR-C11 known answer`);
  b.assert(PROMOTED_CONTRACTUAL === true && sameList(PROMOTED_DAYS, CM.WP7.weather['087-FLD.promoted.days'].value), 'the promoted delays are 0.5 / 1.0 / 1.5, contractual (WP7.weather["087-FLD.promoted.*"])');

  // ── calendar: the days, chosen once from the run date (a resumed run keeps them) ──
  const cal = await b.step('calendar', async () => ({
    runDate: b.today,
    projectStart: b.date(-60),
    projectEnd: dates.addDays(b.today, 240),
    logDays: [-6, -5, -4].map((n) => b.date(n)), // D1..D3, the promotion days
    timesheetDay: b.date(-3),
    weatherDays: [-12, -11, -10, -9].map((n) => b.date(n)),
    incidentDay: b.date(-8),
  }));
  const later = (n) => dates.addDays(cal.runDate, n); // a plan date (due), never a transaction
  for (const d of [...cal.logDays, cal.timesheetDay, ...cal.weatherDays, cal.incidentDay, cal.projectStart]) b.past(d);

  await b.project({
    title: 'Field & quality',
    payload: {
      startDate: cal.projectStart, endDate: cal.projectEnd, projectCalendar: 'five_day', currency: 'USD', type: 'building', contractType: 'unit_rate',
      weatherAllowanceDays: ALLOWANCE, // WP8.weather.allowance: set explicitly, not the `|| 20` default
    },
    fields: { projectCalendar: 'five_day', currency: 'USD', weatherAllowanceDays: ALLOWANCE, startDate: is.day(cal.projectStart) },
  });
  const P = b.P;
  await b.team({ planner: 'planning_eng', site: 'site_engineer', quality: null, cost: 'cost_controller' });

  // ── activities: every timesheet entry is linked to a schedule activity (TIMESHEET_ENTRY_ACTIVITY_REQUIRED;
  // CLAUDE.md's activity-linked data model), and the field records name one too. Hand-built: 052-FLD has no programme.
  const acts = await b.step('activities', async (s) => {
    const siteId = await b.userId('site');
    const out = {};
    for (const [index, [code, title]] of [['A100', 'Site clearance'], ['A110', 'Bulk excavation'], ['A120', 'Foundation concrete']].entries()) {
      const start = dates.addDays(cal.projectStart, 5 + index * 10);
      const name = b.name(`${code} ${title}`);
      const data = await s.create(`activity.${code}`, 'planner', `${P}/activities`, {
        name, activityCode: code, wbsCode: `FLD.${index + 1}`, category: 'civil', startDate: start, endDate: dates.addDays(start, 70), duration: 50, engineerIds: [siteId],
      }, {
        fields: { name, activityCode: code },
        find: async (s2) => atMostOne(s2, listOf(await s2.get('planner', `${P}/activities`)), (row) => row.activityCode === code && row.name === name, `activity ${code}`),
      });
      out[code] = data.id;
    }
    return out;
  });

  // ── evidence for closeouts (the workflow store, as the closeout dialogs send it; HR-X1: a stored document) ──
  // No lookup lists the workflow store's files, so an interrupted upload is never sent again (fail closed,
  // G4); the step holding it reads it back live (GET /workflow/uploads/:key) in its verify.
  const evidence = async (s, name, persona) => {
    const file = { filename: b.file(`${name}.pdf`), contentType: 'application/pdf', body: pdf(b.ref(name)) };
    const mine = (d) => listOf(d).filter((f) => f.fileName === file.filename || f.filename === file.filename); // by name (G6)
    const data = await s.upload(name, persona, `${P}/workflow/uploads`, file, {
      field: 'files',
      get: null,
      idOf: (d) => (mine(d).length === 1 ? mine(d)[0].documentId : null),
      fields: { $status: 201, '0': (v, d) => (mine(d).length === 1 && Boolean(mine(d)[0].documentId)) || `one stored document named ${file.filename}` },
    });
    const [item] = mine(data);
    s.assert(Boolean(item?.documentId), `${name}: the upload answers a stored document`, data);
    return { documentId: item.documentId, ref: { fileName: item.fileName, fileUrl: item.fileUrl, storageKey: item.storageKey || item.key || item.documentId, mimeType: item.mimeType, sizeBytes: item.sizeBytes, description: b.name('Closeout evidence') } };
  };
  /** Each closeout document still reads back from the workflow store (a step verify's live re-read). */
  const evidenceReadsBack = async (s, documentIds) => {
    for (const id of documentIds) {
      const res = await s.send('site', 'GET', `${P}/workflow/uploads/${id}`);
      if (res.status !== 200) return `closeout evidence ${id} reads back ${lib.said(res)}`;
    }
    return true;
  };

  // ── labour 650.00 ("052-FLD".labour = WP8.timesheet.mixedDay) ──
  const worker = await b.step('worker', async (s) => {
    const employeeNumber = b.ref('W1');
    const name = b.name('Steelfixer W1');
    const data = await s.create('worker.W1', 'site', `${P}/timesheets/workers`, {
      name, employeeNumber, trade: 'Steelfixer', classification: 'skilled', hourlyRate: RATE, overtimeMultiplier: 1.5, status: 'active', notes: b.name('Engaged for the field works'),
    }, {
      fields: { name, employeeNumber, hourlyRate: is.number(RATE), overtimeMultiplier: is.number(1.5), status: 'active' },
      get: `${P}/timesheets/workers?q=${encodeURIComponent(employeeNumber)}`,
      adopt: true,
      find: async (s2) => atMostOne(s2, listOf(await s2.get('site', `${P}/timesheets/workers?q=${encodeURIComponent(employeeNumber)}`)), (row) => row.employeeNumber === employeeNumber, `worker ${employeeNumber}`),
    });
    return { workerId: data.id };
  });

  await b.step('timesheet.mixed', async (s) => {
    const sheetStatus = async (s2, id) => (await s2.get('site', `${P}/timesheets/${id}`))?.status;
    const entry = (hours, timeType) => ({ workerId: worker.workerId, activityId: acts.A120, timeType, hours, startTime: '07:00', endTime: timeType === 'regular' ? '15:00' : '17:00' });
    const notes = b.name('Mixed day: regular, overtime and a double-time hour');
    const sheet = await s.create('timesheet.mixed', 'site', `${P}/timesheets`, {
      date: cal.timesheetDay,
      clientRequestId: b.ref('TS-MIXED'),
      notes,
      entries: [entry(8, 'regular'), entry(2, 'overtime'), entry(1, 'double')],
    }, {
      fields: { date: cal.timesheetDay, status: 'draft', entryCount: 3 },
      // Interrupted: the day's timesheets are read; the one carrying this build's note is adopted (G4).
      find: async (s2) => {
        const rows = listOf(await s2.get('site', `${P}/timesheets?from=${cal.timesheetDay}&to=${cal.timesheetDay}`)).filter((row) => row.notes === notes);
        if (rows.length > 1) throw new lib.BuildError(`timesheet.mixed: ${rows.length} timesheets on ${cal.timesheetDay} carry "${notes}"; resolve by hand`);
        return rows[0] || null;
      },
    });
    await s.act('timesheet.mixed.submit', 'site', 'POST', `${P}/timesheets/${sheet.id}/submit`, {}, {
      fields: { status: 'submitted' },
      verify: async (s2) => ['submitted', 'approved'].includes(await sheetStatus(s2, sheet.id)),
    });
    await s.act('timesheet.mixed.approve', 'cost', 'POST', `${P}/timesheets/${sheet.id}/approve`, {}, {
      // "052-FLD".labour: 8 x 50 + 2 x 50 x 1.5 + 1 x 50 x 2 = 650.00
      fields: { status: 'approved', totalCost: (v) => lib.toCents(v) === F052.labour.value || `totalCost ${lib.formatCents(F052.labour.value)} ("052-FLD".labour)` },
      verify: async (s2) => (await sheetStatus(s2, sheet.id)) === 'approved',
    });
    const read = await s.get('cost', `${P}/timesheets/${sheet.id}`);
    s.expectFields(read, { status: 'approved', totalCost: is.cents(F052.labour.value / 100) });
    return { timesheetId: sheet.id };
  }, {
    needs: ['worker', 'activities'],
    verify: async (s, out) => {
      const read = await s.get('cost', `${P}/timesheets/${out.timesheetId}`);
      return (read?.status === 'approved' && lib.toCents(read.totalCost) === F052.labour.value) || `timesheet ${out.timesheetId} is ${read?.status} ${read?.totalCost}`;
    },
  });

  // ── daily logs D1..D3: a weather delay entry each, promoted by the planner (WP8.dailyLog.promote2h/6h/10h) ──
  const dayLog = (s, day) => s.get('pm', `${P}/daily-logs/${day}`);
  const entryIn = (log, section, id) => (log?.sections?.[section] || []).find((row) => row.id === id) || null;
  const weatherList = (s) => s.get('planner', `${P}/weather-delays`);
  /** The register row with this id, read from GET /weather-delays (exactly the row; at most one). */
  const registerRow = async (s, id) => atMostOne(s, listOf(await weatherList(s)), (row) => row.id === id, `weather delay ${id}`);
  const promoted = [];
  for (const [i, hours] of PROMOTED_HOURS.entries()) {
    const day = cal.logDays[i];
    const key = `D${i + 1}`;
    const out = await b.step(`dailylog.${key}`, async (s) => {
      await s.act(`dl.${key}.summary`, 'site', 'PATCH', `${P}/daily-logs/${day}`, {
        summary: b.name(`Day ${i + 1}: rain stopped the works ${hours} h`),
        weather: { condition: 'rain', tempMinC: 18, tempMaxC: 27, precipitationMm: 20 + i, windMaxKph: 25, notes: b.name('Read at 07:00') },
      }, {
        fields: { summary: b.name(`Day ${i + 1}: rain stopped the works ${hours} h`) },
        verify: async (s2) => (await dayLog(s2, day))?.summary === b.name(`Day ${i + 1}: rain stopped the works ${hours} h`),
      });
      const delayRequest = b.ref(`dl.${key}.delay`);
      await s.create(`dl.${key}.delay`, 'site', `${P}/daily-logs/${day}/entries/delays`, {
        type: 'weather', description: b.name(`Rain, works stopped ${hours} hours`), hoursLost: hours, activityId: acts.A110, notes: b.name('Crew stood down'), clientRequestId: delayRequest,
      }, {
        get: null, // read live on its day by the step's verify
        idOf: (d) => d?.entryId ?? null,
        fields: { date: day, entryId: is.present },
        // Interrupted: the day's delay entries are read; the one carrying this clientRequestId is adopted (G4).
        find: async (s2) => {
          const rows = ((await dayLog(s2, day))?.sections?.delays || []).filter((row) => row.clientRequestId === delayRequest);
          if (rows.length > 1) throw new lib.BuildError(`dl.${key}.delay: ${rows.length} delay entries carry ${delayRequest} on ${day}; resolve by hand`);
          return rows[0] ? { date: day, entryId: rows[0].id } : null;
        },
      });
      const entryId = s.id(`dl.${key}.delay`);
      const promoteKey = `promote${hours}h`;
      // The planner promotes: eot:create (builders' adjudication R2-16 / round 2 R2-E, as in 087-FLD). The
      // site engineer's promotion (HR-F4's 'today': contractual by default) is the WP-7 probe, not this build.
      const data = await s.create(`weather.promote.${hours}h`, 'planner', `${P}/daily-logs/${day}/entries/delays/${entryId}/weather-delay`, {
        description: b.name(`Weather delay promoted from the daily log of ${day}`),
      }, {
        expect: 200,
        get: null, // the register has no single-row route: the step's verify re-reads the row live
        idOf: (d) => d?.weatherDelay?.id ?? null,
        // WP7.weather["087-FLD.promoted.contractual"]: contractual by default (C4). The echo of delayDays is asserted below.
        fields: { 'weatherDelay.id': is.present, 'weatherDelay.contractual': PROMOTED_CONTRACTUAL },
        // Interrupted (R2-C): the entry names the register row it was promoted to; that row is READ from the
        // register, so the contractual check runs on the stored record, never on an invented one.
        find: async (s2) => {
          const row = entryIn(await dayLog(s2, day), 'delays', entryId);
          if (!row?.weatherDelayId) return null;
          const delay = await registerRow(s2, row.weatherDelayId);
          s2.assert(Boolean(delay), `the promoted delay ${row.weatherDelayId} that entry ${entryId} names is on the weather register`);
          return { weatherDelay: { id: delay.id, contractual: delay.contractual, storedDelayDays: delay.delayDays }, adopted: true };
        },
      });
      // R3-13: the promotion's own answer echoes the computed days (daily-log.service.js:1216; WP8.dailyLog.promote<n>h),
      // only at that moment (G1); the stored figure is read at 13 (HR-C11: the Int column).
      const echoed = data?.weatherDelay?.delayDays;
      const lost = data?.adopted === true || (data?.truncated === true && echoed === undefined);
      if (lost) {
        // The answer was lost to an interruption and cannot be asked again (409 DAILY_LOG_WEATHER_DELAY_EXISTS):
        // WP8.dailyLog.promote<n>h then needs fresh records (WP-8 proof).
        s.note(`weather.promote.${hours}h was cut off before its answer was recorded and was adopted from the weather register (contractual ${data?.weatherDelay?.contractual}), so its delayDays echo (WP8.dailyLog.${promoteKey}) was not observed by this build: the WP-8 proof promotes a fresh entry for it`);
      } else {
        s.assert(echoed !== undefined && echoed !== null && Number(echoed) === WP8.dailyLog[promoteKey].value, `the promotion answers delayDays ${WP8.dailyLog[promoteKey].value} (WP8.dailyLog.${promoteKey}; the field is present)`, data?.weatherDelay);
      }
      await s.act(`dl.${key}.submit`, 'site', 'POST', `${P}/daily-logs/${day}/submit`, {}, {
        fields: { status: 'submitted' },
        verify: async (s2) => ['submitted', 'approved'].includes((await dayLog(s2, day))?.status),
      });
      await s.act(`dl.${key}.approve`, 'pm', 'POST', `${P}/daily-logs/${day}/approve`, {}, {
        fields: { status: 'approved' },
        verify: async (s2) => (await dayLog(s2, day))?.status === 'approved',
      });
      return { day, entryId, weatherDelayId: s.id(`weather.promote.${hours}h`), delayDaysEcho: echoed };
    }, {
      // The day as built, its entry promoted to this row, and the row still on the register, contractual.
      verify: async (s, o) => {
        const log = await dayLog(s, o.day);
        if (!(log?.status === 'approved' && entryIn(log, 'delays', o.entryId)?.weatherDelayId === o.weatherDelayId)) return `${o.day} is ${log?.status}, its delay entry ${o.entryId} promoted to ${entryIn(log, 'delays', o.entryId)?.weatherDelayId}`;
        const delay = await registerRow(s, o.weatherDelayId);
        if (!delay) return `the promoted delay ${o.weatherDelayId} is no longer on the weather register`;
        return delay.contractual === PROMOTED_CONTRACTUAL || `the promoted delay ${o.weatherDelayId} is not contractual`;
      },
    });
    promoted.push(out);
  }

  // ── weather: the manual delays, read from the product at 13, at 14 and after the non-contractual delay ──
  // Builders' adjudication round 2, R2-E (087-FLD item 2's principle on 052-FLD): GET /weather-delays is read
  // at 13 contractual days (before the 1.0-day delay exists) and again at 14; at14 needs at13. Each reading is
  // the product's answer, kept in its own step's out, and judged against the answer book in a step of its
  // own, so a resumed run judges the answer of that moment, never a later register. Nothing is computed:
  // the measured figures are the register's summary and its stored rows (consumedPct compared at 2 dp, F2).
  // HEAD writes every delay to the Int column WeatherDelay.delayDays (schema.prisma:2958,
  // weather.service.js:217): the half-days are stored truncated, so today's answers are HR-C11's known ones
  // (COMPOSITION.today, WP8.weather.todayBelow / todayAt, nonContractualAddsNothing.today) and each judgement
  // is BLOCKED HR-C11 with what the product answered; any other answer fails the build.
  const makeDelay = async (s, name, days, contractual, day) => {
    const description = b.name(`${contractual ? 'Contractual' : 'Non-contractual'} weather delay of ${days} day(s) from ${day}`);
    await s.create(name, 'planner', `${P}/weather-delays`, { description, date: day, delayDays: days, contractual }, {
      fields: { description, contractual },
      get: null, // the register has no single-row route: the step's verify re-reads it
      find: async (s2) => atMostOne(s2, listOf(await weatherList(s2)), (row) => row.description === description, `weather delay "${description}"`),
    });
    return s.id(name);
  };
  /** A step's verify: the delays it names are still on the register, contractual or not as made. */
  const delaysListed = (ids, contractual) => async (s) => {
    const rows = listOf(await weatherList(s));
    const wrong = (ids || []).filter((id) => atMostOne(s, rows, (row) => row.id === id, `weather delay ${id}`)?.contractual !== contractual);
    return wrong.length ? `weather delays ${wrong.join(', ')} are gone or no longer ${contractual ? 'contractual' : 'non-contractual'}` : true;
  };
  const promotedIds = () => promoted.map((p) => p.weatherDelayId);
  /** The register as the product answers it now: its summary, its monthly split, and the stored days of the rows named. */
  const readRegister = async (s, groups) => {
    const list = await weatherList(s);
    const rows = listOf(list);
    const stored = {};
    for (const [key, ids] of Object.entries(groups)) {
      stored[key] = ids.map((id) => {
        const row = atMostOne(s, rows, (r) => r.id === id, `weather delay ${id}`);
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
        note: 'the product\'s answer at that moment: half-days are stored truncated (Int column WeatherDelay.delayDays); the WP-7 weather boundaries stay red until HR-C11 is decided',
      });
    }
    s.assert(false, `the weather register at ${label} answers neither the answer book nor HR-C11's known answer`, { expected, known, measured });
    return null;
  };

  // 13.0 = promoted 0.5 + 1.0 + 1.5 + manual 2.5 + 7.5.
  const manual13 = await b.step('weather.manual.13', async (s) => {
    const ids = [];
    for (const [i, days] of MANUAL_13.entries()) ids.push(await makeDelay(s, `weather.manual.13.${i + 1}`, days, true, cal.weatherDays[i]));
    return { ids };
  }, { verify: async (s, out) => delaysListed(out.ids, true)(s) });

  // The product's answer at 13, before the 1.0-day delay exists.
  const at13 = await b.step('weather.at13.read', async (s) => {
    const reading = await readRegister(s, { promoted: promotedIds(), manual13: manual13.ids });
    s.assert(sameList(reading.contractualIds, [...promotedIds(), ...manual13.ids].sort()), 'the contractual rows on the register are exactly the three promoted and the two manual delays of this build', reading.contractualIds);
    s.assert(reading.summary.allowance === ALLOWANCE, `the allowance is ${ALLOWANCE}, set explicitly (WP8.weather.allowance)`, reading.summary);
    return reading;
  }, { needs: ['dailylog.D1', 'dailylog.D2', 'dailylog.D3', 'weather.manual.13'], verify: async (s, out) => delaysListed(out.contractualIds, true)(s) });

  // WP8.weather.below* / "052-FLD".weatherBelowPct: 13.0 -> 65%, no warning, 7 remaining.
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
      consumedPct: F052.weatherBelowPct.value,
      warning: WP8.weather.belowWarning.value,
      remaining: WP8.weather.belowRemaining.value,
    };
    // HR-C11's known answer at 13 (COMPOSITION.today, WP8.weather.todayBelow): 11, 55%, and no warning either
    // way (WP8.weather.belowWarning). The book carries no "today" for the remaining days: that figure is in
    // `measured`, not compared.
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
    for (const [i, days] of MANUAL_14.entries()) ids.push(await makeDelay(s, `weather.manual.14.${i + 1}`, days, true, cal.weatherDays[2 + i]));
    return { ids };
  }, { needs: ['weather.at13.read'], verify: async (s, out) => delaysListed(out.ids, true)(s) });

  // The product's answer at 14, before the non-contractual delay exists (it needs the reading at 13).
  const at14 = await b.step('weather.at14.read', async (s) => {
    const reading = await readRegister(s, { promoted: promotedIds(), manual13: manual13.ids, manual14: manual14.ids });
    s.assert(sameList(reading.contractualIds, [...promotedIds(), ...manual13.ids, ...manual14.ids].sort()), 'the contractual rows on the register are exactly the promoted and manual delays of this build', reading.contractualIds);
    s.assert(reading.summary.allowance === ALLOWANCE, `the allowance is ${ALLOWANCE}, set explicitly (WP8.weather.allowance)`, reading.summary);
    return reading;
  }, { needs: ['weather.at13.read', 'weather.manual.14'], verify: async (s, out) => delaysListed(out.contractualIds, true)(s) });

  // WP8.weather.at* / "052-FLD".weatherAtPct / weatherAtWarning: 14.0 -> 70%, warning, 6 remaining.
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
      consumedPct: F052.weatherAtPct.value,
      warning: F052.weatherAtWarning.value,
      remaining: WP8.weather.atRemaining.value,
    };
    // HR-C11's known answer at 14 (COMPOSITION.today, WP8.weather.todayAt): 12, 60%, no warning. The book carries
    // no "today" for the 1.0-day row or the remaining days: those are in `measured`, not compared.
    const known = {
      promotedStored: COMPOSITION.today.promotedStored,
      manualStored: COMPOSITION.today.manualStored,
      contractualUsed: COMPOSITION.today.at14Used,
      consumedPct: WP8.weather.todayAt.value,
      warning: COMPOSITION.today.warningAt14,
    };
    return judge(s, '14 contractual days', measured, expected, known);
  }, { needs: ['weather.at14.read'] });

  // The non-contractual 10 days, after the reading at 14, and the product's answer once it exists.
  const afterNonContractual = await b.step('weather.non-contractual.read', async (s) => {
    const ids = [];
    for (const [i, days] of NON_CONTRACTUAL.entries()) ids.push(await makeDelay(s, `weather.non-contractual.${i + 1}`, days, false, cal.weatherDays[3]));
    const reading = await readRegister(s, { nonContractual: ids });
    s.assert(sameList(reading.stored.nonContractual, NON_CONTRACTUAL), `the non-contractual delay is stored at ${NON_CONTRACTUAL.join(' + ')} days (WP7.weather["087-FLD.composition"].nonContractual)`, reading.stored);
    return { ids, ...reading };
  }, { needs: ['weather.at14.read'], verify: async (s, out) => delaysListed(out.ids, false)(s) });

  // R2-B5: the invariance judged against the answer-book leaf WP8.weather.nonContractualAddsNothing (value 14:
  // still 14.0 after the 10 non-contractual days; today 12, HR-C11's known answer, the truncated rows), with the
  // reading at 14 it must equal (WP8.weather.atContractualUsed 14; COMPOSITION.today.at14Used 12).
  await b.step('weather.non-contractual', async (s) => {
    const measured = {
      contractualUsedAt14: at14.summary.contractualUsed,
      contractualUsed: afterNonContractual.summary.contractualUsed,
    };
    const expected = { contractualUsedAt14: WP8.weather.atContractualUsed.value, contractualUsed: NON_CONTRACTUAL_LEAF.value };
    const known = { contractualUsedAt14: COMPOSITION.today.at14Used, contractualUsed: NON_CONTRACTUAL_LEAF.today };
    return judge(s, `the non-contractual ${NON_CONTRACTUAL.join(' + ')} days (WP8.weather.nonContractualAddsNothing)`, measured, expected, known);
  }, { needs: ['weather.at14.read', 'weather.non-contractual.read'] });

  // ── quality 21: legacy ITPs failed, waived, passed; NCRs 2 major + 3 minor ──
  await b.step('legacy-itp', async (s) => {
    const out = {};
    const list = async (s2) => listOf(await s2.get('quality', `${P}/itp`));
    for (const [key, pointType, target] of [['failed', 'hold', 'failed'], ['waived', 'witness', 'waived'], ['passed', 'review', 'passed']]) {
      const title = b.name(`Legacy ITP ${key}: inspection point`);
      await s.create(`legacy-itp.${key}`, 'quality', `${P}/itp`, {
        title, pointType, status: 'pending', dueDate: cal.incidentDay, inspectionDate: cal.incidentDay, inspector: b.name('Quality inspector'), notes: b.name('Inspection and test plan point'),
      }, {
        fields: { title, status: 'pending', pointType },
        get: null,
        find: async (s2) => atMostOne(s2, await list(s2), (r) => r.title === title, `legacy ITP "${title}"`),
      });
      const id = s.id(`legacy-itp.${key}`);
      await s.act(`legacy-itp.${key}.${target}`, 'quality', 'PATCH', `${P}/itp/${id}`, { status: target, inspectionDate: cal.incidentDay, comment: b.name(`Recorded ${target}`) }, {
        fields: { status: target },
        verify: async (s2) => (await list(s2)).find((r) => r.id === id)?.status === target,
      });
      out[key] = id;
    }
    return out;
  }, {
    verify: async (s, out) => {
      const rows = listOf(await s.get('quality', `${P}/itp`));
      const wrong = Object.entries(out).filter(([key, id]) => rows.find((r) => r.id === id)?.status !== key);
      return wrong.length ? `legacy ITPs no longer as built: ${JSON.stringify(wrong)}` : true;
    },
  });

  await b.step('ncr', async (s) => {
    const out = {};
    const list = async (s2) => listOf(await s2.get('quality', `${P}/ncr`));
    const status = async (s2, id) => (await list(s2)).find((r) => r.id === id)?.status;
    for (const [key, severity, target, raiser] of [
      ['major-open', 'major', 'open', 'site'],
      ['major-closed', 'major', 'closed', 'quality'],
      ['minor-open', 'minor', 'open', 'site'],
      ['minor-submitted', 'minor', 'submitted', 'quality'],
      ['minor-closed', 'minor', 'closed', 'site'],
    ]) {
      const description = b.name(`NCR ${key}: defective work`);
      await s.create(`ncr.${key}`, raiser, `${P}/ncr`, {
        severity, description, disposition: b.name('Repair to the approved method statement'), responsible: b.name('Formwork foreman'),
        activityId: acts.A120, dueDate: later(10), comment: b.name('Raised after inspection'),
      }, {
        fields: { severity, status: 'open', description },
        get: null,
        find: async (s2) => atMostOne(s2, await list(s2), (r) => r.description === description, `NCR "${description}"`),
      });
      const id = s.id(`ncr.${key}`);
      let evidenceId = null;
      if (target !== 'open') {
        const ev = await evidence(s, `ncr.${key}.evidence`, 'site');
        evidenceId = ev.documentId;
        await s.act(`ncr.${key}.closeout`, 'site', 'POST', `${P}/ncr/${id}/close`, {
          closureComment: b.name('Defective work cut out and made good; re-inspected'), responsible: b.name('Formwork foreman'), dueDate: later(10), attachmentRefs: [ev.ref],
        }, { fields: { status: 'submitted' }, verify: async (s2) => ['submitted', 'closed'].includes(await status(s2, id)) });
      }
      if (target === 'closed') {
        await s.act(`ncr.${key}.approve`, 'quality', 'POST', `${P}/ncr/${id}/approve`, { comment: b.name('Repair accepted') }, {
          fields: { status: 'closed' },
          verify: async (s2) => (await status(s2, id)) === 'closed',
        });
      }
      out[key] = { id, severity, status: target, evidenceId };
    }
    return out;
  }, {
    verify: async (s, out) => {
      const rows = listOf(await s.get('quality', `${P}/ncr`));
      const wrong = Object.entries(out).filter(([, n]) => { const r = rows.find((x) => x.id === n.id); return !r || r.status !== n.status || r.severity !== n.severity; });
      if (wrong.length) return `NCRs no longer as built: ${JSON.stringify(wrong)}`;
      return evidenceReadsBack(s, Object.values(out).map((n) => n.evidenceId).filter(Boolean));
    },
  });

  // "052-FLD".qualityScore: 100 - 2 x 20 - 3 x 8 - 1 x 15 = 21 on the quality dashboard
  await b.step('quality.score', async (s) => {
    const m = (await s.get('quality', `${P}/quality/dashboard`))?.metrics; // quality.service.js getQualityDashboard
    s.assert(Number(m?.qualityScore) === F052.qualityScore.value, `the quality score is ${F052.qualityScore.value} (got ${m?.qualityScore})`, m);
    s.expectFields(m, { majorNcrs: 2, minorNcrs: 3, failedItps: 1 }, 'the quality dashboard inputs');
    return { qualityScore: m.qualityScore, majorNcrs: m.majorNcrs, minorNcrs: m.minorNcrs, failedItps: m.failedItps };
  }, { needs: ['legacy-itp', 'ncr'] });

  // ── safety 75: open near miss, closed LTI with lost days, archived near miss (WP8.safety.inputs) ──
  await b.step('safety', async (s) => {
    const list = async (s2) => listOf(await s2.get('quality', `${P}/safety?includeArchived=true`));
    const status = async (s2, id) => (await list(s2)).find((r) => r.id === id)?.status;
    const make = async (key, incidentType, title, extra = {}) => {
      const fullTitle = b.name(title);
      await s.create(`safety.${key}`, 'site', `${P}/safety`, {
        incidentType, title: fullTitle, date: cal.incidentDay, activityId: acts.A110, responsible: b.name('Site supervisor'), investigation: b.name('Statements taken from the crew'),
        severity: 'medium', dueDate: later(7), lostDays: 0, status: 'open', comment: b.name('Reported the same shift'), ...extra,
      }, {
        fields: { incidentType, title: fullTitle, status: 'open' },
        get: null,
        find: async (s2) => atMostOne(s2, await list(s2), (r) => r.title === fullTitle, `safety record "${fullTitle}"`),
      });
      return s.id(`safety.${key}`);
    };
    const nearMiss = await make('near-miss-open', 'near_miss', 'Near miss: pallet slipped from the forks during offloading');
    const lti = await make('lti-closed', 'lti', 'LTI: operative fell from a hop-up, sprained ankle', { lostDays: 3, severity: 'high' });
    const ev = await evidence(s, 'safety.lti-closed.evidence', 'site');
    await s.act('safety.lti-closed.closeout', 'site', 'POST', `${P}/safety/${lti}/close`, {
      closureComment: b.name('Corrective actions briefed and in place'), responsible: b.name('Site supervisor'), dueDate: later(7), attachmentRefs: [ev.ref],
    }, { fields: { status: 'submitted' }, verify: async (s2) => ['submitted', 'closed'].includes(await status(s2, lti)) });
    await s.act('safety.lti-closed.approve', 'quality', 'POST', `${P}/safety/${lti}/approve`, { comment: b.name('Closed out') }, {
      fields: { status: 'closed', lostDays: 3 },
      verify: async (s2) => (await status(s2, lti)) === 'closed',
    });
    const archived = await make('near-miss-archived', 'near_miss', 'Near miss: entered twice in error');
    await s.act('safety.near-miss-archived.archive', 'pm', 'DELETE', `${P}/safety/${archived}`, undefined, {
      fields: { $status: 200 },
      verify: async (s2) => (await status(s2, archived)) === 'archived',
    });
    const rows = await list(s);
    s.assert(rows.find((r) => r.id === archived)?.status === 'archived', 'the withdrawn near miss is archived, not deleted', rows.find((r) => r.id === archived));
    return { nearMissOpen: nearMiss, ltiClosed: lti, nearMissArchived: archived, evidenceId: ev.documentId };
  }, {
    verify: async (s, out) => {
      const rows = listOf(await s.get('quality', `${P}/safety?includeArchived=true`));
      const want = { [out.nearMissOpen]: 'open', [out.ltiClosed]: 'closed', [out.nearMissArchived]: 'archived' };
      const wrong = Object.entries(want).filter(([id, st]) => rows.find((r) => r.id === id)?.status !== st);
      if (wrong.length) return `safety records no longer as built: ${JSON.stringify(wrong)}`;
      return evidenceReadsBack(s, [out.evidenceId]);
    },
  });

  // ── safety 75 on the project health card ("052-FLD".safetyHealth; R3-13) ──
  // Expected (archived excluded): 100 - 20 x 1 LTI - 5 x 1 open = 75. HEAD's health.js counts every status
  // but 'closed' as an open investigation, so the archived near miss counts: the book's `today` 70. That
  // known answer is BLOCKED under HR-K1 (one health service on the workspace definitions, archived excluded).
  await b.step('safety.score', async (s) => {
    const card = await s.get('pm', `${P}/health`);
    const dims = (card?.dimensions || []).filter((d) => d.key === 'safety');
    s.assert(dims.length === 1, `the health card has one safety dimension (found ${dims.length})`, (card?.dimensions || []).map((d) => d.key));
    const [safety] = dims;
    const detail = safety.detail || {};
    // The records the card reads, as the build made them: one LTI, no fatality.
    s.expectFields(detail, { ltiCount: 1, fatalityCount: 0 }, 'the safety detail (one LTI, no fatality)');
    const observed = { score: safety.score, detail };
    if (safety.score === F052.safetyHealth.value) return observed;
    if (safety.score === F052.safetyHealth.today && Number(detail.openInvestigations) === 2) {
      s.blocked('HR-K1', { expected: F052.safetyHealth.value, ...observed, note: 'GET /projects/:id/health counts the archived near miss as an open investigation (status != closed): 100 - 20 - 5 x 2 = 70 ("052-FLD".safetyHealth today)' });
    }
    s.assert(false, `the safety card is neither ${F052.safetyHealth.value} nor the known ${F052.safetyHealth.today} with the archived near miss counted open`, observed);
    return null;
  }, { needs: ['safety'] });
}

if (require.main === module) lib.main('052-FLD', (b) => body(b));
module.exports = { body };
