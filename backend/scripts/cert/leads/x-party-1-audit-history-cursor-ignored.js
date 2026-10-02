'use strict';

/**
 * Extra finding X-PARTY-1 (found while reproducing L43) — the project history cannot
 * be paged: GET /projects/:p/audit ignores `cursor` unless source=audit.
 *
 * audit.service.js listEvents applies the cursor only when the audit table is
 * the single source (`auditOnly && cursor`); for the default source=all, and
 * for source=approval / status / comment, every request returns the first
 * `limit` rows again together with the same nextCursor. A client that follows
 * nextCursor loops for ever, and everything after the first page of the
 * project's history — the official trail of approvals, status changes and
 * comments — is unreachable.
 *
 * Read-only. Actor: the PM of company 072 (any audit reader sees the same).
 *
 * Exit code 0 = the second page differs from the first; 2 = it is the same page.
 */

const pv = require('./lib/party-visibility');

pv.main(async () => {
  const P = pv.project().id;
  const pm = pv.api.as(pv.PM);
  const results = [];

  console.log('X-PARTY-1 — paging the project history');
  console.log(`project ${P} (072-01), reader ${pv.PM}`);

  for (const source of ['all', 'approval', 'status', 'comment', 'audit']) {
    const base = `/projects/${P}/audit?source=${source}&limit=5&order=desc`;
    const first = await pm.send('GET', base);
    const ids1 = (first.body?.data?.events || []).map((e) => e.id);
    const cursor = first.body?.data?.nextCursor || null;
    console.log(`\n> [PM] GET /api/v1${base}`);
    console.log(`< ${first.status} ${ids1.length} events, nextCursor ${cursor}; first ids ${ids1.slice(0, 2).join(', ')}`);
    if (!cursor) {
      console.log('  no further page for this source');
      results.push({ source, verdict: 'single page' });
      continue;
    }
    const second = await pm.send('GET', `${base}&cursor=${encodeURIComponent(cursor)}`);
    const ids2 = (second.body?.data?.events || []).map((e) => e.id);
    const cursor2 = second.body?.data?.nextCursor || null;
    console.log(`> [PM] GET /api/v1${base}&cursor=${cursor}`);
    console.log(`< ${second.status} ${ids2.length} events, nextCursor ${cursor2}; first ids ${ids2.slice(0, 2).join(', ')}`);
    const same = ids1.length > 0 && ids1.length === ids2.length && ids1.every((id, i) => id === ids2[i]);
    results.push({ source, verdict: same ? 'SAME PAGE AGAIN' : 'advances', sameCursor: cursor === cursor2 });
  }

  console.log('\nSummary');
  for (const r of results) console.log(`  source=${r.source.padEnd(8)} ${r.verdict}${r.sameCursor ? ' (and the same nextCursor: a client following it never ends)' : ''}`);

  const broken = results.filter((r) => r.verdict === 'SAME PAGE AGAIN').map((r) => r.source);
  if (broken.length) {
    return pv.verdict('X-PARTY-1', 'CONFIRMED', `GET /projects/:p/audit returns the first page again for source=${broken.join(', ')} whatever cursor is sent; only source=audit pages, so the rest of the project's history cannot be read.`);
  }
  return pv.verdict('X-PARTY-1', 'NOT_REPRODUCED', 'the history advances with the cursor for every source.');
});
