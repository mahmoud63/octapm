'use strict';

/**
 * The cross-company file attack: the routes that serve a stored file's bytes,
 * bound to each victim's real files, asked by the victim's own project
 * manager (it must answer) and then by outsiders (they must not).
 *
 * Why its own sweep: the read sweep binds a route's parameters by matching
 * them to records of the victim's busiest project, so a file in any other
 * project — and a route keyed by a storage key rather than an id — is never
 * bound there (doc-control revision download and preview, BOQ, import,
 * schedule, site-reporting and workflow uploads, report-run downloads). Here
 * every binding comes from the database: a real file with its own project,
 * by its id and, where the route also takes it, by its storage key.
 *
 *   node scripts/cert/isolation/file-attacks.js --name=files1
 *   node scripts/cert/isolation/file-attacks.js --name=t --victims=031 --per-kind=1
 *
 * Verdicts on each outsider answer (rules shared with the other sweeps):
 *   REFUSED             401, 403, 404
 *   LEAK                the owner's own bytes, or the victim's canary text in the bytes
 *   FILTERED            2xx, the same as the answer for random ids in the victim's place
 *   ANSWERED            any other 2xx — counted as a cross-company read until triaged
 *   REFUSED_VALIDATION  400, for triage; REFUSED_LATE other 4xx; SERVER_ERROR 5xx
 *
 * The owner's downloads come first (they may write access records, which is
 * the product working); then the database is fingerprinted, the outsiders
 * attack, and it is fingerprinted again: an outsider's attempt may change
 * nothing at all. A kind with no file, or whose file the owner cannot read,
 * is reported as unbound — never silently skipped.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const crypto = require('crypto');
const guard = require('../lib/cert-env');
const { as, raw, pool } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const fingerprint = require('./fingerprint');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const NAME = arg('name', 'files');
const VICTIMS = arg('victims')?.split(',') || null;
const PER_KIND = Number(arg('per-kind', 2));
const CONCURRENCY = Number(arg('concurrency', 6));

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const bytesOf = (res) => res.buffer || Buffer.from(res.text ?? '', 'utf8');

/** Stored-document routes by document type; each takes the document's id or its storage key. */
const DOCUMENT_ROUTES = {
  boq_upload: ['/projects/{projectId}/boq/uploads/{documentId}', (p, k) => `/projects/${p}/boq/uploads/${k}`],
  schedule_import: ['/projects/{projectId}/import/uploads/{documentId}', (p, k) => `/projects/${p}/import/uploads/${k}`],
  progress_import: ['/projects/{projectId}/import/uploads/{documentId}', (p, k) => `/projects/${p}/import/uploads/${k}`],
  schedule_generation_source: ['/projects/{projectId}/schedule/uploads/{documentId}', (p, k) => `/projects/${p}/schedule/uploads/${k}`],
  site_photo: ['/projects/{projectId}/site-reporting/uploads/{key}', (p, k) => `/projects/${p}/site-reporting/uploads/${k}`],
  workflow_attachment: ['/projects/{projectId}/workflow/uploads/{key}', (p, k) => `/projects/${p}/workflow/uploads/${k}`],
};

/** Every (template, path) to try for one company, from its real rows. */
const bindingsFor = async (db, orgId) => {
  const out = [];
  const add = (kind, template, pathText, projectId, recordKey) => out.push({ kind, template, path: pathText, projectId, recordKey });
  const docs = await db.query(
    `SELECT id, "projectId", "storageKey", "documentType" FROM "ProjectDocument" WHERE "orgId" = $1 AND "documentType" = ANY($2) ORDER BY id`,
    [orgId, Object.keys(DOCUMENT_ROUTES)],
  );
  const taken = {};
  for (const d of docs.rows) {
    taken[d.documentType] = (taken[d.documentType] || 0) + 1;
    if (taken[d.documentType] > PER_KIND) continue;
    const [template, build] = DOCUMENT_ROUTES[d.documentType];
    add(`${d.documentType} by id`, template, build(d.projectId, d.id), d.projectId, d.id);
    if (d.storageKey) add(`${d.documentType} by storage key`, template, build(d.projectId, encodeURIComponent(d.storageKey)), d.projectId, encodeURIComponent(d.storageKey));
  }
  for (const a of (await db.query(`SELECT "projectId", "documentId" FROM "Attachment" WHERE "orgId" = $1 ORDER BY id LIMIT $2`, [orgId, PER_KIND])).rows) {
    add('attachment', '/projects/{projectId}/attachments/documents/{documentId}', `/projects/${a.projectId}/attachments/documents/${a.documentId}`, a.projectId, a.documentId);
  }
  const revisions = await db.query(
    `SELECT r.id, r."projectId" FROM "DocumentRevision" r JOIN "Project" p ON p.id = r."projectId" WHERE p."orgId" = $1 AND r."storageKey" IS NOT NULL ORDER BY r.id LIMIT $2`,
    [orgId, PER_KIND],
  );
  for (const r of revisions.rows) {
    add('doc-control revision download', '/projects/{projectId}/doc-control/revisions/{revisionId}/download', `/projects/${r.projectId}/doc-control/revisions/${r.id}/download`, r.projectId, r.id);
    add('doc-control revision preview', '/projects/{projectId}/doc-control/revisions/{revisionId}/preview', `/projects/${r.projectId}/doc-control/revisions/${r.id}/preview`, r.projectId, r.id);
  }
  for (const p of (await db.query(`SELECT id, "projectId" FROM "Photo" WHERE "orgId" = $1 ORDER BY id LIMIT $2`, [orgId, PER_KIND])).rows) {
    add('photo file', '/projects/{projectId}/photos/{photoId}/file', `/projects/${p.projectId}/photos/${p.id}/file`, p.projectId, p.id);
    add('photo thumbnail', '/projects/{projectId}/photos/{photoId}/thumbnail', `/projects/${p.projectId}/photos/${p.id}/thumbnail`, p.projectId, p.id);
  }
  // A run holds the format it was made in; asking for the other one is an honest 404.
  for (const r of (await db.query(`SELECT id, format FROM "ReportRun" WHERE "orgId" = $1 AND status = 'succeeded' ORDER BY id LIMIT $2`, [orgId, PER_KIND])).rows) {
    add('report run download', '/reports/runs/{runId}/download', `/reports/runs/${r.id}/download?format=${r.format === 'xlsx' ? 'xlsx' : 'pdf'}`, null, r.id);
  }
  return out;
};

const KINDS_EXPECTED = [...new Set([...Object.keys(DOCUMENT_ROUTES).flatMap((t) => [`${t} by id`, `${t} by storage key`]), 'attachment', 'doc-control revision download', 'doc-control revision preview', 'photo file', 'photo thumbnail', 'report run download'])];

const main = async () => {
  const population = buildPopulation();
  const victims = population.companies.filter((c) => !VICTIMS || VICTIMS.includes(c.code));
  const db = await guard.connectCert();

  // ── 1. bind, as each owner ───────────────────────────────────────────────
  const bound = [];
  const unbound = {};
  const note = (kind, why) => {
    unbound[kind] = unbound[kind] || {};
    unbound[kind][why] = (unbound[kind][why] || 0) + 1;
  };
  for (const victim of victims) {
    const bindings = await bindingsFor(db, victim.id);
    const seen = new Set(bindings.map((b) => b.kind));
    for (const kind of KINDS_EXPECTED) if (!seen.has(kind)) note(kind, 'no file of this kind');
    const owner = as(`pm@${victim.domain}`);
    await pool(bindings, CONCURRENCY, async (b) => {
      const res = await owner.send('GET', b.path, undefined, { binary: true }).catch((error) => ({ status: 0, text: String(error.message) }));
      if (res.status >= 200 && res.status < 300) bound.push({ ...b, victim: victim.code, ownerSha: sha(bytesOf(res)), ownerBytes: bytesOf(res).length });
      else note(b.kind, `owner ${res.status}`);
    });
  }
  console.log(`bound ${bound.length} file paths over ${new Set(bound.map((b) => b.victim)).size} companies; kinds bound: ${[...new Set(bound.map((b) => b.kind))].length}/${KINDS_EXPECTED.length}`);

  // ── 2. before ────────────────────────────────────────────────────────────
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };
  const before = await snapshot();

  // ── 3. the attacks ───────────────────────────────────────────────────────
  const byCode = new Map(population.companies.map((c) => [c.code, c]));
  const attackersFor = (code) => {
    const company = byCode.get(code);
    const next = population.companies[company.n % population.companies.length];
    const out = [{ kind: 'outsider', session: as(`pm@${next.domain}`) }];
    for (const person of population.multi) {
      const here = person.memberships.find((m) => m.code === code);
      const elsewhere = person.memberships.find((m) => m.code !== code);
      if (here && elsewhere) {
        out.push({ kind: 'member-elsewhere', session: as(person.email, elsewhere.orgId) });
        break;
      }
    }
    out.push({ kind: 'anonymous', session: null });
    return out;
  };
  const ask = (session, route) => (session ? session.send('GET', route, undefined, { binary: true }) : raw('GET', route, { binary: true })).catch((error) => ({ status: 0, text: String(error.message) }));
  const attacks = bound.flatMap((b) => attackersFor(b.victim).map((attacker) => ({ b, attacker })));
  const results = await pool(attacks, CONCURRENCY, async ({ b, attacker }) => {
    const res = await ask(attacker.session, b.path);
    const canary = new RegExp(`CANARY-${b.victim}-[A-Za-z0-9]`);
    let verdict;
    let evidence;
    if (res.status === 0) verdict = 'NOT_SENT';
    else if (res.status >= 500) verdict = 'SERVER_ERROR';
    else if ([401, 403, 404].includes(res.status)) verdict = 'REFUSED';
    else if (res.status === 400) verdict = 'REFUSED_VALIDATION';
    else if (res.status >= 400) verdict = 'REFUSED_LATE';
    else {
      const bytes = bytesOf(res);
      if (sha(bytes) === b.ownerSha) {
        verdict = 'LEAK';
        evidence = { sameBytesAsOwner: true, bytes: bytes.length };
      } else if (canary.test(bytes.toString('latin1'))) {
        verdict = 'LEAK';
        evidence = { canaryInBytes: true };
      } else {
        // The random-id control: the project and the file replaced by random ids.
        let control = b.path.split(b.recordKey).join(crypto.randomUUID());
        if (b.projectId) control = control.split(b.projectId).join(crypto.randomUUID());
        const other = await ask(attacker.session, control);
        verdict = other.status === res.status && sha(bytesOf(other)) === sha(bytes) ? 'FILTERED' : 'ANSWERED';
      }
    }
    return { victim: b.victim, attacker: attacker.kind, kind: b.kind, template: b.template, route: b.path, status: res.status, code: res.body?.error?.code || null, verdict, ...(evidence ? { evidence } : {}), ...(verdict === 'REFUSED' ? {} : { sample: String(res.text ?? '').slice(0, 200) }) };
  });

  // ── 4. after ─────────────────────────────────────────────────────────────
  const after = await snapshot();
  await db.end();
  const changes = fingerprint.compare(before, after);
  const realChanges = changes.filter((c) => !c.noise);

  const tally = (items, key) => items.reduce((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] || 0) + 1 }), {});
  const summary = {
    name: NAME,
    at: new Date().toISOString(),
    victims: victims.length,
    fileRoutesBound: new Set(bound.map((b) => b.template)).size,
    pathsBound: bound.length,
    attacks: results.length,
    byVerdict: tally(results, (r) => r.verdict),
    byAttacker: tally(results, (r) => `${r.attacker}/${r.verdict}`),
    byKind: tally(results, (r) => `${r.kind}/${r.verdict}`),
    unbound,
    dataChanged: realChanges.length,
    dataChangedTables: tally(realChanges, (c) => c.table),
    noiseChanged: tally(changes.filter((c) => c.noise), (c) => c.table),
  };
  const outDir = path.join(WORK, 'results', 'isolation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${NAME}.json`), JSON.stringify({ summary, changes: realChanges, results }));
  console.log(JSON.stringify(summary, null, 1));
  const concerning = results.filter((r) => ['LEAK', 'ANSWERED', 'REFUSED_LATE', 'SERVER_ERROR'].includes(r.verdict));
  for (const [kind, n] of Object.entries(tally(concerning, (r) => `${r.verdict} ${r.attacker} ${r.kind} -> ${r.status} ${r.code || ''}`)).sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${kind}`);
  process.exitCode = concerning.length || realChanges.length ? 2 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
