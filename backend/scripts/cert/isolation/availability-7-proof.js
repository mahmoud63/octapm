'use strict';

/**
 * The CERT-2 proof of group availability-7: the availability regressions the
 * fix rounds introduced, each reproduced in process against the baseline
 * commit (f16c14f) loaded beside the working tree, so a difference is the
 * code's.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/availability-7-proof.js [attacker=042] [victim=043] [--only=guard,orders,evidence] [--no-fingerprint]
 *
 * The baseline is extracted read-only with git archive to C:/Temp/availability-7-head
 * (or CERT_AVAIL7_BASELINE_DIR), its node_modules this checkout's, and its
 * app, api client and progress.service are loaded in this process beside the
 * working tree's.
 *
 * GUARD    middleware/reject-null-bytes inspectValue walked an array by its
 *          length, and multer builds a SPARSE array from a bracketed field
 *          index ("zz[100000000]=x" is length 100,000,001 holding one
 *          element): one tiny multipart request cost seconds of CPU, linear in
 *          an index the caller chooses, and the inbound-email door runs that
 *          walk before it verifies the provider — an unauthenticated DoS.
 *          Walked by the elements present now: the same request answers within
 *          the baseline's time (which answers in milliseconds only because the
 *          baseline predates the walk-before-verification on the inbound door
 *          — so the comparison is the end-to-end request on each tree, and the
 *          tree must answer in well under a second whatever the baseline does).
 *          NULs and deep bodies are still refused.
 * ORDERS   The round-5/6 lead-time alert sync read ~10 queries per scope with
 *          nothing batched across scopes, so an order whose lines are each on
 *          their own package, or on none, was slower than the baseline and
 *          500'd (transaction expired) where the baseline answered: 220 lines
 *          each on a package, 500 no-package lines, cancel/close far slower.
 *          Batched across all scopes of one write now: create, cancel, close
 *          and receipts answer up to 500 lines with no 5xx, no slower than the
 *          baseline by more than noise (create) or a small margin (the steps
 *          that now also work the one scope the baseline left stale).
 * EVIDENCE progress.service read every token of an evidence text holding a
 *          route word and built a URL for each: 8.5 MB of distinct tokens held
 *          the event loop ~2.2 s (baseline ~8 ms). A token the parser takes as
 *          written is judged without a URL now, and one where no file route
 *          begins is not read: within ~2x the baseline. And prepareEvidence
 *          looked up 2N+2 bind variables for N file keys — 16,384+ keys 500'd
 *          ("too many bind variables"); more than a generous cap is a 400
 *          before any lookup.
 *
 * Every REFUSED/BOUNDED check is GATED on the attacker's own legitimate
 * request succeeding. No answer is a 5xx; company 043's data does not change
 * (fingerprint, before and after the run). Re-runnable: every record is fresh.
 * Final line "availability-7 proof: N passed, M failed of T"; exit 0 on all.
 */

process.env.REQUEST_LOG_FORMAT = process.env.REQUEST_LOG_FORMAT || 'off';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'cert-not-used';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const { as, raw, multipart } = require('../lib/api');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');
const timing = require('./availability-7-timing');

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '042';
const VICTIM = positional[1] || '043';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const INPROCESS = process.env.CERT_INPROCESS === '1';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `AV7-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const WORKTREE = path.join(__dirname, '..', '..', '..', '..');
const BACKEND = path.join(__dirname, '..', '..', '..');
const BASELINE = process.env.CERT_AVAIL7_BASELINE || 'f16c14f';
const BASELINE_DIR = process.env.CERT_AVAIL7_BASELINE_DIR || 'C:/Temp/availability-7-head';
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const results = [];
const answers = [];
let section = 'setup';
const check = (name, ok, detail = '') => {
  results.push({ section, name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`);
};
const want = () => !ONLY || new RegExp(ONLY).test(section);
const firstLine = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
const said = (res) => `${res?.status} ${res?.body?.error?.code || ''} ${firstLine(res?.body?.error?.message).slice(0, 100)}`.trim();
const ok2xx = (res) => Boolean(res) && res.status >= 200 && res.status < 300;
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;

const print = console.log.bind(console);
console.log = (...args) => {
  if (String(args[0] || '').startsWith('[email:local]')) return;
  print(...args);
};
console.error = () => {};

/** The baseline commit's backend, extracted read-only (git archive), with this checkout's node_modules. */
const extractBaseline = () => {
  const marker = path.join(BASELINE_DIR, 'BASELINE');
  const sha = execFileSync('git', ['rev-parse', BASELINE], { cwd: WORKTREE, encoding: 'utf8' }).trim();
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === sha && fs.existsSync(path.join(BASELINE_DIR, 'backend', 'src', 'app.js'))) return { sha, dir: BASELINE_DIR, made: false };
  fs.rmSync(BASELINE_DIR, { recursive: true, force: true });
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const tar = execFileSync('git', ['archive', '--format=tar', sha, 'backend/src', 'backend/scripts/cert/lib', 'backend/package.json', 'shared'], { cwd: WORKTREE, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', BASELINE_DIR], { input: tar });
  for (const [link, target] of [[path.join(BASELINE_DIR, 'node_modules'), path.join(WORKTREE, 'node_modules')], [path.join(BASELINE_DIR, 'backend', 'node_modules'), path.join(BACKEND, 'node_modules')]]) {
    if (!fs.existsSync(link)) fs.symlinkSync(fs.realpathSync(target), link, 'junction');
  }
  fs.writeFileSync(marker, sha);
  return { sha, dir: BASELINE_DIR, made: true };
};

/** A copy of a source file loaded beside the real one (its requires resolve in src/services). */
const SERVICES = path.join(BACKEND, 'src', 'services');
const loadProgressService = (source, tag) => {
  const filename = path.join(SERVICES, `progress.service.${tag}.js`);
  const copy = new Module(filename, module);
  copy.filename = filename;
  copy.paths = Module._nodeModulePaths(SERVICES);
  copy._compile(source, filename);
  return copy.exports;
};

const NO_DATABASE = {
  projectDocument: { findMany: async () => [] },
  photo: { findMany: async () => [] },
  documentRevision: { findMany: async () => [] },
};
const fill = (bytes, make) => {
  const parts = [];
  let size = 0;
  for (let i = 0; size < bytes; i += 1) {
    parts.push(make(i));
    size += parts.at(-1).length + 1;
  }
  return parts.join(' ');
};
const mb = (text) => `${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB`;

const main = async () => {
  print(`availability-7 proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: a running API does not run the working tree'}${ONLY ? `, only /${ONLY}/` : ''}${FINGERPRINT ? '' : ', no fingerprint'}\n`);
  if (!INPROCESS) throw new Error('availability-7 runs in process only (CERT_INPROCESS=1)');

  const baseline = extractBaseline();
  check(`setup: the baseline ${BASELINE} (${baseline.sha.slice(0, 12)}) is extracted read-only to ${baseline.dir}${baseline.made ? ' (made now)' : ''}`, fs.existsSync(path.join(baseline.dir, 'backend', 'src', 'app.js')));
  const headApi = (() => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(path.join(baseline.dir, 'backend', 'scripts', 'cert', 'lib', 'api.js'));
  })();

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const val = async (sql, params = []) => {
    const row = (await q(sql, params))[0];
    return row ? Object.values(row)[0] : null;
  };
  const orgOf = async (code) => val('select id::text from "Organisation" where slug like $1', [`cert-${code}-%`]);
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  check(`setup: both companies exist (${ATTACKER} ${attackerOrg}, ${VICTIM} ${victimOrg})`, Boolean(attackerOrg && victimOrg));

  const place = await timing.placeFor(ATTACKER);
  const AP = `/projects/${place.projectId}`;
  check(`setup: the orders go on company ${ATTACKER}'s ${place.projectKey} (${place.projectId})`, (await val('select "orgId"::text from "Project" where id = $1', [place.projectId])) === attackerOrg);
  // The own documents evidence may name, uploaded the way the web client uploads them.
  const pm = as(`pm@${place.company.domain}`);
  const planner = as(`planner@${place.company.domain}`);
  const pngBlob = () => new Blob([PNG_1X1], { type: 'image/png' });
  let ownDoc = null;
  {
    const uploaded = await pm.send('POST', `${AP}/site-reporting/uploads`, undefined, { form: multipart({ field: 'files', filename: `${STAMP}.png`, contentType: 'image/png', body: PNG_1X1 }) });
    ownDoc = Array.isArray(uploaded.body?.data) ? uploaded.body.data[0]?.documentId : null;
    check('setup: an own site photo is uploaded, for evidence to name', ok2xx(uploaded) && Boolean(ownDoc), said(uploaded));
  }
  // A fresh activity to submit progress to (the submission gates), assigned to the site engineer as the clients make them.
  const siteEngineer = await val('select id::text from "User" where email = $1', [`site@${place.company.domain}`]);
  let evidenceActivity = place.activityId;
  {
    const made = await planner.send('POST', `${AP}/activities`, { name: `AV7 ${STAMP} evidence`, duration: 3, ...(siteEngineer ? { engineerIds: [siteEngineer] } : {}) });
    if (ok2xx(made) && made.body?.data?.id) evidenceActivity = made.body.data.id;
    check('setup: a fresh activity for the evidence submissions is created', ok2xx(made) && Boolean(made.body?.data?.id), said(made));
  }

  const snapshot = async () => {
    if (!FINGERPRINT) return null;
    await db.query('begin transaction isolation level repeatable read read only');
    try {
      return await fingerprint.take(db);
    } finally {
      await db.query('rollback');
    }
  };
  const runStart = await snapshot();

  // ══ GUARD: the unauthenticated multipart DoS ══════════════════════════════
  section = 'guard';
  if (want()) {
    print('\n── guard: a far bracketed field index costs milliseconds, not seconds, on the inbound door and an authenticated upload ──');
    if (!process.env.INBOUND_MAILGUN_SIGNING_KEY) process.env.INBOUND_MAILGUN_SIGNING_KEY = `av7-${crypto.randomBytes(8).toString('hex')}`;
    // One tiny multipart request whose bracketed field index makes multer build a huge sparse array.
    const DOS_INDEX = 300_000_000;
    const sparseForm = (value = 'x') => {
      const form = new FormData();
      form.append(`zz[${DOS_INDEX}]`, value);
      form.append('files', pngBlob(), `${STAMP}.png`);
      return form;
    };
    // A JSON body nested far past the guard's depth, as a provider never sends.
    const deepBody = `{"signature":{"timestamp":"1","token":"t","signature":"s"},"x":${'['.repeat(400)}1${']'.repeat(400)}}`;
    const timed = async (send) => {
      const started = process.hrtime.bigint();
      const res = await send();
      return { res, ms: ms(started) };
    };
    // [label, tree raw/as, send(form) → the request]
    const doors = [
      ['inbound e-mail (no auth)', (form) => raw('POST', '/public/inbound-email/mailgun', { form }), (form) => headApi.raw('POST', '/public/inbound-email/mailgun', { form })],
      ['site-reporting upload (pm)', (form) => pm.send('POST', `${AP}/site-reporting/uploads`, undefined, { form }), (form) => headApi.as(`pm@${place.company.domain}`).send('POST', `${AP}/site-reporting/uploads`, undefined, { form })],
    ];
    for (const [door, treeSend, headSend] of doors) {
      const tree = await timed(() => treeSend(sparseForm()));
      const head = await timed(() => headSend(sparseForm()));
      answers.push({ route: `tree ${door} sparse`, status: tree.res.status, text: tree.res.text || '' });
      check(`${door}: a field at index ${DOS_INDEX.toLocaleString('en-US')} is answered in ${tree.ms.toFixed(0)} ms (baseline ${head.ms.toFixed(0)} ms), well under a second and no 5xx`,
        tree.ms < 800 && tree.res.status < 500, `tree ${said(tree.res)} in ${tree.ms.toFixed(0)} ms; baseline ${said(head.res)} in ${head.ms.toFixed(0)} ms`);
      check(`${door}: the baseline is far slower on the same request (${head.ms.toFixed(0)} ms vs ${tree.ms.toFixed(0)} ms) — the regression is real`,
        head.ms > tree.ms * 2 && head.ms > tree.ms + 400, `tree ${tree.ms.toFixed(0)} ms; baseline ${head.ms.toFixed(0)} ms`);
    }
    // A deep body is still refused, before the inbound door verifies the provider.
    const deep = await timed(() => raw('POST', '/public/inbound-email/mailgun', { json: deepBody }));
    answers.push({ route: 'tree inbound deep', status: deep.res.status, text: deep.res.text || '' });
    check('inbound e-mail: a body nested past the guard\'s depth is 400 before verification, fast', deep.res.status === 400 && /nested more than/.test(deep.res.body?.error?.message || '') && deep.ms < 800, `${said(deep.res)} in ${deep.ms.toFixed(0)} ms`);
    // A NUL is still refused on the authenticated upload, held at a far index.
    const nul = await pm.send('POST', `${AP}/site-reporting/uploads`, undefined, { form: (() => { const f = new FormData(); f.append('zz[100000000]', 'a\u0000b'); f.append('files', pngBlob(), `${STAMP}.png`); return f; })() });
    answers.push({ route: 'tree upload nul', status: nul.status, text: nul.text || '' });
    check('site-reporting upload: a NUL held at a far index is still refused 400 (disallowed character or not text)', nul.status === 400 && nul.body?.error?.code === 'VALIDATION_ERROR', said(nul));
    // The legitimate client shape still passes the guard: tags and documentIds as repeated fields.
    const legit = await pm.send('POST', `${AP}/site-reporting/uploads`, undefined, { form: multipart({ field: 'files', filename: `${STAMP}.png`, contentType: 'image/png', body: PNG_1X1 }) });
    answers.push({ route: 'tree upload legit', status: legit.status, text: legit.text || '' });
    check('site-reporting upload: a clean upload still passes the guard (201)', ok2xx(legit), said(legit));
  }

  // ══ ORDERS: large purchase orders of every shape, against the baseline ═════
  section = 'orders';
  if (want()) {
    print('\n── orders: create, cancel, close and receipts of every shape, up to 500 lines, against the baseline ──');
    const trees = [timing.treeOf(BACKEND, 'tree'), timing.treeOf(path.join(baseline.dir, 'backend'), 'head')];
    const plan = timing.parsePlan('220:many:late:create,cancel;360:none:late:create,cancel,close;500:one:late:create,cancel;500:none:late:create,cancel,close;240:one:late:create,cancel,close,receipt');
    const byKey = new Map();
    const { results: timings } = await timing.runInterleaved({
      trees,
      plan,
      reps: 2,
      attacker: ATTACKER,
      onResult: (out) => {
        const key = `${out.lines}:${out.shape}:${out.when}`;
        if (!byKey.has(key)) byKey.set(key, { tree: [], head: [] });
        byKey.get(key)[out.tree].push(out);
      },
    });
    const no5xx = timings.filter((out) => out.tree === 'tree' && ['create', 'update', 'cancel', 'close', 'receipt'].some((step) => out[step] && out[step].status >= 500));
    check(`every timed request on the working tree answered without a 5xx (${timings.filter((o) => o.tree === 'tree').length} order runs, up to 500 lines)`, no5xx.length === 0, no5xx.map((o) => `${o.lines}:${o.shape} ${JSON.stringify(o)}`).slice(0, 4).join('\n        '));
    const best = (list, step) => Math.min(...list.map((o) => o[step]?.ms ?? Infinity));
    const status = (list, step) => list.map((o) => o[step]?.said).join(',');
    for (const [key, { tree, head }] of byKey) {
      const [lines, shape] = key.split(':');
      for (const step of ['create', 'cancel', 'close', 'receipt']) {
        if (!tree.some((o) => o[step])) continue;
        const t = best(tree, step);
        const h = best(head, step);
        const treeOk = tree.every((o) => !o[step] || o[step].status < 500);
        // create: no slower than the baseline + noise. The steps that now also
        // work the one scope the baseline left stale: + a small margin, or the
        // baseline did not answer at all (a 5xx the fix removed).
        const bound = step === 'create' ? h * 1.25 + 150 : Math.max(h * 1.25 + 200, 400);
        const headAnswered = head.every((o) => !o[step] || o[step].status < 500);
        const within = !headAnswered || t <= bound;
        check(`${lines} lines, ${shape}: ${step} on the tree is ${treeOk ? 'answered' : 'a 5xx'} (${status(tree, step)}) and ${headAnswered ? `within the baseline + margin (best ${t.toFixed(0)} ms vs ${h.toFixed(0)} ms)` : `the baseline 5xx'd (${status(head, step)})`}`,
          treeOk && within, `tree best ${t.toFixed(0)} ms (${status(tree, step)}); baseline best ${h.toFixed(0)} ms (${status(head, step)})`);
      }
    }
    // The alerts are right after the batched sync: a cancelled many-package order resolves every scope.
    const cancelled = timings.find((o) => o.tree === 'tree' && o.shape === 'many' && o.cancel?.status === 200 && o.create?.orderId);
    if (cancelled) {
      const open = Number(await val('select count(*)::int from "ProcurementLeadTimeAlert" a join "ProcurementPoLine" l on l.id = a."poLineId" where l."orderId" = $1 and a.status <> $2', [cancelled.create.orderId, 'resolved']));
      const total = Number(await val('select count(*)::int from "ProcurementLeadTimeAlert" a join "ProcurementPoLine" l on l.id = a."poLineId" where l."orderId" = $1', [cancelled.create.orderId]));
      check(`a cancelled many-package order (${cancelled.lines} lines) leaves no open lead-time alert on any of its lines — the batched sync resolved every scope (${total} alerts, all resolved)`, total > 0 && open === 0, `open alerts ${open} of ${total}`);
    }
  }

  // ══ EVIDENCE: the adversarial scan cost and the bind-variable cap ══════════
  section = 'evidence';
  if (want()) {
    print('\n── evidence: an 8.5 MB adversarial text is scanned within ~2x the baseline, and a cap stops the lookup overflowing ──');
    const current = require('../../../src/services/progress.service');
    let head = null;
    try {
      head = loadProgressService(fs.readFileSync(path.join(baseline.dir, 'backend', 'src', 'services', 'progress.service.js'), 'utf8'), 'av7-head');
    } catch (error) {
      check('setup: the baseline progress.service could not be loaded', false, error.message);
    }
    // Measured through prepareEvidence (no database), the one reader both the
    // baseline (f16c14f, which scans no links) and the working tree export.
    const scanTime = async (service, evidence) => {
      const started = process.hrtime.bigint();
      let outcome;
      try {
        await service.prepareEvidence({ projectId: place.projectId, evidence }, NO_DATABASE);
        outcome = 'read';
      } catch (error) {
        outcome = error.code || error.message;
      }
      return { outcome, ms: ms(started) };
    };
    const timedScan = async (text) => {
      let worst = 0;
      let last = Date.now();
      const timer = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last - 5); last = now; }, 5);
      const now = await scanTime(current, { notes: text });
      clearInterval(timer);
      const then = head ? await scanTime(head, { notes: text }) : null;
      return { now, then, worst };
    };
    // The adversarial tokens the round-6 scan read every one of, building a URL
    // for each: now read without a URL (the parser takes them as written) and
    // within 2x the baseline, which scanned no links at all.
    // The task's adversarial example: 8.5 MB of distinct "projects<i>uploads"
    // tokens, which hold no file-route start ("projects/" or "/bids/") — so the
    // scanner never looks inside them, and the scan is within 2x the baseline
    // (which scanned no links). The round-6 scanner read every one and built a
    // URL for each (~2.2 s).
    {
      const text = fill(8.5 * 1024 * 1024, (i) => `projects${i}uploads`);
      const { now, then, worst } = await timedScan(text);
      print(`  scan of ${mb(text)} of distinct "projects<i>uploads" tokens: now ${now.ms.toFixed(0)} ms (${now.outcome}); baseline ${then ? `${then.ms.toFixed(0)} ms (${then.outcome})` : 'n/a'}; event loop held at most ${worst} ms`);
      check(`TIMED 8.5 MB of distinct "projects<i>uploads" tokens: ${now.ms.toFixed(0)} ms, within 2x the baseline's ${then ? then.ms.toFixed(0) : '?'} ms + 100 ms, the event loop never held over 250 ms`,
        Boolean(then) && now.outcome === 'read' && now.ms <= then.ms * 2 + 100 && worst < 250, `now ${JSON.stringify(now)} baseline ${JSON.stringify(then)} held ${worst}`);
    }
    // Tokens that DO hold a file-route start are looked at once each — a token
    // where no file route begins ("projects/<i>uploads", no route name), and a
    // link that genuinely needs normalising (a dot segment, parsed once). The
    // baseline resolved no link, so there is nothing to be 2x of; each is well
    // under a second and the event loop is never held.
    for (const [label, make] of [
      ['distinct "projects/<i>uploads<i>" tokens (a route start, no file route)', (i) => `projects/${i}uploads${i}`],
      ['distinct "/projects/<i>/./uploads/<i>" links (each parsed once)', (i) => `/projects/${i}/./uploads/${i}`],
    ]) {
      const text = fill(8.5 * 1024 * 1024, make);
      const { now, then, worst } = await timedScan(text);
      print(`  scan of ${mb(text)} of ${label}: now ${now.ms.toFixed(0)} ms (${now.outcome}); baseline ${then ? `${then.ms.toFixed(0)} ms (${then.outcome}, resolves no link)` : 'n/a'}; event loop held at most ${worst} ms`);
      check(`TIMED ${mb(text)} of ${label}: ${now.ms.toFixed(0)} ms (baseline ${then ? then.ms.toFixed(0) : '?'} ms), well under a second, the event loop never held over 250 ms`,
        now.outcome === 'read' && now.ms < 800 && worst < 250, `now ${JSON.stringify(now)} held ${worst}`);
    }
    // The bind-variable overflow: 16,384+ distinct keys 500'd; above the cap it is a 400 before any lookup.
    const CAP = current.MAX_EVIDENCE_FILES;
    const key = (i) => `0d0c0000-eeee-4eee-8eee-${String(i).padStart(12, '0')}`;
    const submitProgress = (pct, note, evidence) => pm.send('POST', `${AP}/activities/${evidenceActivity}/progress`, { pctComplete: pct, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${note}`, evidence });
    const overEvidence = { photos: Array.from({ length: CAP + 1 }, (_, i) => ({ key: key(i) })) };
    const over = await submitProgress(7, 'over', overEvidence);
    answers.push({ route: 'tree over-cap', status: over.status, text: over.text || '' });
    check(`a submission naming more than ${CAP} files is refused 400 VALIDATION_ERROR (the lookup's bind variables once overflowed to a 500)`, over.status === 400 && over.body?.error?.code === 'VALIDATION_ERROR', said(over));
    const overStored = Number(await val('select count(*)::int from "ProgressSubmission" where "projectId" = $1 and notes = $2', [place.projectId, `${STAMP} over`]));
    check('…and nothing of the over-cap submission is stored', overStored === 0, `stored ${overStored}`);
    // 8.5 MB of distinct bidder-portal keys: the baseline resolved none, but the second CERT round's reader would name every one — the cap stops the lookup overflowing. The scan refuses, the event loop never held.
    const manyKeys = await scanTime(current, { photos: [{ url: 'https://x.test/a.jpg', caption: fill(8.5 * 1024 * 1024, (i) => `/public/bids/t${i}/documents/d${i}`) }] });
    check(`8.5 MB of distinct bidder-portal keys is refused 400 before any lookup (${manyKeys.outcome}) in ${manyKeys.ms.toFixed(0)} ms, not 16,384+ bind variables to Postgres`, manyKeys.outcome === 'VALIDATION_ERROR' && manyKeys.ms < 800, JSON.stringify(manyKeys));
    // The own file, named many times, still passes (the cap counts distinct files).
    const ownMany = await submitProgress(8, 'own-many', { photos: Array.from({ length: CAP + 50 }, () => ({ key: ownDoc })) });
    answers.push({ route: 'tree own-many', status: ownMany.status, text: ownMany.text || '' });
    check(`GATE: the own file named ${CAP + 50} times (one distinct file) is accepted — the cap counts distinct files, not photos`, ok2xx(ownMany), said(ownMany));
    // A genuine evidence text with the own link is stored unchanged.
    const genuine = await submitProgress(9, 'genuine', { notes: `poured, see /api/v1/projects/${place.projectId}/site-reporting/uploads/${ownDoc}`, photos: [{ key: ownDoc }] });
    answers.push({ route: 'tree genuine', status: genuine.status, text: genuine.text || '' });
    check('GATE: a genuine evidence text naming the own file is accepted (201)', ok2xx(genuine), said(genuine));
  }

  // ── no 5xx, no victim change ──────────────────────────────────────────────
  section = 'invariants';
  const errors = answers.filter((a) => a.status >= 500 || a.status === 0);
  check('no answer gathered by this proof is a 5xx', errors.length === 0, errors.slice(0, 8).map((a) => `${a.status} ${a.route} ${firstLine(a.text).slice(0, 100)}`).join('\n        '));
  if (FINGERPRINT) {
    const runEnd = await snapshot();
    const moved = fingerprint.compare(runStart, runEnd).filter((c) => !c.noise && c.org === VICTIM);
    check(`company ${VICTIM}'s data did not change (every table, whole run)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  }
  await db.end();

  const bySection = new Map();
  for (const r of results) {
    const e = bySection.get(r.section) || { passed: 0, failed: 0 };
    e[r.ok ? 'passed' : 'failed'] += 1;
    bySection.set(r.section, e);
  }
  print('\nper section:');
  for (const [name, e] of bySection) print(`  ${e.failed ? 'FAIL' : 'ok  '}  ${name}: ${e.passed} passed, ${e.failed} failed`);
  const failed = results.filter((r) => !r.ok);
  print(`\navailability-7 proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  print(`availability-7 proof ERROR ${error?.stack || error}`);
  process.exit(1);
});
