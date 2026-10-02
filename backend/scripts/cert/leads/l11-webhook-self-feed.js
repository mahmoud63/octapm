'use strict';

/**
 * L11 — an outbound webhook subscribed to "*" (or "job.progress") feeds on the
 * job.progress events of its own webhook.deliver jobs.
 *
 * Company 032 only. Nothing is delivered anywhere: the certification API runs
 * with the job worker off, and the receiver is an address nobody answers on.
 *
 *   Phase A  create a subscription to "*", do NOTHING else, and watch the
 *            delivery count for WATCH_A_MS. Then pause it and watch again.
 *   Phase B  the same subscription narrowed to "job.progress" only, seeded
 *            with ONE redelivery, watched for WATCH_B_MS. Then pause.
 *   Always   pause, then delete the subscription on the way out.
 *
 *   Phase C  (between A and the pause) ONE more event in the company — an edit
 *            of the subscription — and the rate is measured again: every
 *            event starts another chain that never ends.
 *
 * Active looping is bounded to WATCH_A_MS + WATCH_C_MS + WATCH_B_MS (55 s).
 *
 * exit 0 = the product does not feed on itself; exit 2 = it does.
 */

const { as } = require('../lib/api');

const LEAD = 'L11';
const PM = 'pm@c032.octapm-cert.test';
const URL_WANTED = 'https://hooks.c032.octapm-cert.test/hook';
// 203.0.113.0/24 is TEST-NET-3 (RFC 5737): reserved for documentation, routed
// nowhere. It passes the product's "public address" check, so the subscription
// can be saved, and no receiver can ever exist behind it.
const URL_FALLBACK = 'https://203.0.113.32/hook';
const NAME = 'cert-L11 self-feed probe';

// Seconds, overridable for a short run: L11_WATCH_A_S, L11_WATCH_C_S, L11_WATCH_B_S (0 skips C or B).
const windowMs = (name, fallback) => (/^\d+$/.test(process.env[name] || '') ? Number(process.env[name]) : fallback) * 1000;
const WATCH_A_MS = windowMs('L11_WATCH_A_S', 30);
// Phase C: ONE more event while the first chain is still running.
const WATCH_C_MS = windowMs('L11_WATCH_C_S', 10);
const WATCH_B_MS = windowMs('L11_WATCH_B_S', 15);
const QUIET_MS = 8_000;
const POLL_MS = 2_000;
// One event legitimately makes one delivery. A handful more could be in flight
// when a pause lands. Anything beyond this with no action taken is the loop.
const GROWTH_THRESHOLD = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const short = (value, n = 600) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > n ? `${text.slice(0, n)}…` : text;
};
const withoutSecret = (body) => JSON.parse(JSON.stringify(body ?? null, (key, value) => (key === 'secret' && value ? '(withheld)' : value)));

const pm = as(PM);
const say = (...args) => console.log(...args);
const show = (label, method, route, payload, res) => {
  say(`\n>>> ${label}`);
  say(`    ${method} /api/v1${route}${payload !== undefined ? `  ${short(payload, 300)}` : ''}`);
  say(`<<< ${res.status}  ${short(withoutSecret(res.body), 700)}`);
};

/** Everything seen of the subscription's deliveries, across polls. */
const seen = new Map();
const observe = async (id) => {
  const [one, list] = await Promise.all([
    pm.send('GET', `/integrations/webhooks/${id}`),
    pm.send('GET', `/integrations/webhooks/${id}/deliveries?limit=200`),
  ]);
  for (const item of list.body?.data?.items || []) seen.set(item.id, item);
  return { count: one.body?.data?.deliveryCount ?? null, status: one.body?.data?.status ?? null, listStatus: list.status };
};

const tally = () => {
  const byType = {};
  const byStatus = {};
  const jobIds = new Set();
  for (const item of seen.values()) {
    byType[item.eventType] = (byType[item.eventType] || 0) + 1;
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    if (item.payload?.entity?.type === 'background_job' && item.payload?.payload?.jobType === 'webhook.deliver') jobIds.add(item.payload.entity.id);
  }
  return { byType, byStatus, jobIds };
};

const watch = async (id, ms, label) => {
  const started = Date.now();
  const first = await observe(id);
  say(`\n--- ${label}: watching for ${ms / 1000} s, sending nothing but GETs ---`);
  say(`    t=+0.0s   deliveries=${first.count}   subscription=${first.status}`);
  let last = first;
  while (Date.now() - started < ms) {
    await sleep(Math.min(POLL_MS, Math.max(0, ms - (Date.now() - started))));
    last = await observe(id);
    const { jobIds } = tally();
    say(`    t=+${((Date.now() - started) / 1000).toFixed(1).padStart(4)}s   deliveries=${last.count}   webhook.deliver jobs named by the deliveries so far=${jobIds.size}`);
  }
  const seconds = (Date.now() - started) / 1000;
  const grew = (last.count ?? 0) - (first.count ?? 0);
  say(`    => +${grew} deliveries in ${seconds.toFixed(1)} s = ${(grew / seconds).toFixed(2)} per second (${Math.round((grew / seconds) * 3600)} per hour)`);
  return { from: first.count, to: last.count, grew, seconds, rate: grew / seconds };
};

const main = async () => {
  let id = null;
  let paused = false;
  const result = { a: null, c: null, aQuiet: null, bControl: null, b: null, bQuiet: null, url: null };
  try {
    const before = await pm.send('GET', '/integrations/webhooks');
    show('What company 032 has before the test', 'GET', '/integrations/webhooks', undefined, before);
    for (const item of before.body?.data?.items || []) {
      if (item.name === NAME) {
        say(`    (a subscription left by an earlier run, ${item.id}: removing it)`);
        await pm.send('PATCH', `/integrations/webhooks/${item.id}`, { status: 'paused' });
        await pm.send('DELETE', `/integrations/webhooks/${item.id}`);
      } else if (item.status === 'active') {
        say(`    NOTE: another active subscription exists (${item.id} "${item.name}" ${JSON.stringify(item.eventTypes)}); it is left alone.`);
      }
    }

    // ── Phase A ───────────────────────────────────────────────────────────
    let payload = { name: NAME, url: URL_WANTED, eventTypes: ['*'], description: 'Certification lead L11. Safe to delete.' };
    let created = await pm.send('POST', '/integrations/webhooks', payload);
    show('Create the subscription to "*" with the receiver named in the brief', 'POST', '/integrations/webhooks', payload, created);
    if (created.status !== 201) {
      say(`    The product refused that URL (${created.body?.error?.code}): the name does not resolve, and a webhook must resolve to a public address when saved.`);
      say(`    Using ${URL_FALLBACK} instead: a documentation address (TEST-NET-3) that passes the check and that nobody can answer on.`);
      payload = { ...payload, url: URL_FALLBACK };
      created = await pm.send('POST', '/integrations/webhooks', payload);
      show('Create the subscription to "*" with the documentation address', 'POST', '/integrations/webhooks', payload, created);
    }
    if (created.status !== 201) throw new Error(`could not create the subscription: ${created.status} ${short(created.body)}`);
    id = created.body.data.id;
    result.url = payload.url;

    say('\n    From here the script takes NO action in company 032: the only event was the audit record of the subscription being created.');
    result.a = await watch(id, WATCH_A_MS, 'Phase A ("*")');

    // ── Phase C: every further event in the company starts another chain ──
    if (WATCH_C_MS > 0) {
      const edit = { description: 'Certification lead L11. Safe to delete. (edited once)' };
      const edited = await pm.send('PATCH', `/integrations/webhooks/${id}`, edit);
      show('Phase C: ONE more event in the company (an edit of the subscription\'s description)', 'PATCH', `/integrations/webhooks/${id}`, edit, edited);
      result.c = await watch(id, WATCH_C_MS, 'Phase C ("*", two events so far)');
    }

    const pause = { status: 'paused' };
    const pausedRes = await pm.send('PATCH', `/integrations/webhooks/${id}`, pause);
    show('Pause the subscription', 'PATCH', `/integrations/webhooks/${id}`, pause, pausedRes);
    paused = pausedRes.status === 200;
    await sleep(1000); // whatever was already in flight lands
    result.aQuiet = await watch(id, QUIET_MS, 'After the pause');

    // What the deliveries are, and that each names the job of the one before.
    const { byType, byStatus, jobIds } = tally();
    say('\n--- What the deliveries carry ---');
    say(`    by event:  ${JSON.stringify(byType)}`);
    say(`    by status: ${JSON.stringify(byStatus)}   (pending with attempt 0 = no worker ran them)`);
    say(`    distinct webhook.deliver BackgroundJob ids named in the payloads: ${jobIds.size}`);
    const ordered = [...seen.values()].sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
    say('    the first five, oldest first:');
    for (const item of ordered.slice(0, 5)) {
      say(`      ${item.createdAt}  delivery ${item.id.slice(0, 8)}  event=${item.eventType}  about=${item.payload?.entity?.type}:${String(item.payload?.entity?.id || '').slice(0, 8)}  jobType=${item.payload?.payload?.jobType ?? '-'}  attempt=${item.attempt}  status=${item.status}`);
    }
    if (ordered.length > 6) {
      const gaps = [];
      for (let i = 1; i < ordered.length; i += 1) gaps.push(new Date(ordered[i].createdAt) - new Date(ordered[i - 1].createdAt));
      gaps.sort((x, y) => x - y);
      say(`    time between consecutive deliveries: median ${gaps[Math.floor(gaps.length / 2)]} ms (the event bus delay is 150 ms)`);
    }

    // ── Phase B ───────────────────────────────────────────────────────────
    const narrow = { eventTypes: ['job.progress'], status: 'active' };
    const narrowed = WATCH_B_MS > 0 ? await pm.send('PATCH', `/integrations/webhooks/${id}`, narrow) : { status: 'skipped' };
    if (WATCH_B_MS > 0) show('Phase B: the same subscription, now only "job.progress", active again', 'PATCH', `/integrations/webhooks/${id}`, narrow, narrowed);
    if (narrowed.status === 200) {
      paused = false;
      await sleep(500);
      result.bControl = await watch(id, 4_000, 'Phase B control (no job event yet)');
      const seedFrom = ordered[0];
      if (!seedFrom) throw new Error('no delivery exists to redeliver: the subscription to "*" recorded nothing, not even its own creation');
      const seeded = await pm.send('POST', `/integrations/webhooks/deliveries/${seedFrom.id}/redeliver`, {});
      show('One redelivery: one new delivery and one webhook.deliver job', 'POST', `/integrations/webhooks/deliveries/${seedFrom.id}/redeliver`, {}, seeded);
      result.b = await watch(id, WATCH_B_MS, 'Phase B ("job.progress" only, after ONE redelivery)');
      const pausedAgain = await pm.send('PATCH', `/integrations/webhooks/${id}`, pause);
      show('Pause the subscription again', 'PATCH', `/integrations/webhooks/${id}`, pause, pausedAgain);
      paused = pausedAgain.status === 200;
      await sleep(1000);
      result.bQuiet = await watch(id, 6_000, 'After the second pause');
    }

    // The company cannot see or cancel what it queued.
    const projects = await pm.send('GET', '/projects');
    const projectList = projects.body?.data?.items || projects.body?.data?.projects || (Array.isArray(projects.body?.data) ? projects.body.data : []);
    if (projectList[0]?.id) {
      const jobs = await pm.send('GET', `/projects/${projectList[0].id}/jobs`);
      const items = jobs.body?.data?.items || jobs.body?.data?.jobs || [];
      say(`\n>>> Can the company see the queued delivery jobs?  GET /api/v1/projects/${projectList[0].id}/jobs`);
      say(`<<< ${jobs.status}  ${items.length} job(s) listed, ${items.filter((job) => (job.type || job.jobType) === 'webhook.deliver').length} of type webhook.deliver   (they carry no project, and the jobs API is per project)`);
    }
  } finally {
    if (id) {
      if (!paused) {
        const res = await pm.send('PATCH', `/integrations/webhooks/${id}`, { status: 'paused' }).catch((error) => ({ status: `failed: ${error.message}` }));
        say(`\n(clean-up) pause -> ${res.status}`);
      }
      const final = await pm.send('GET', `/integrations/webhooks/${id}`).catch(() => null);
      say(`\n(clean-up) the subscription ends with ${final?.body?.data?.deliveryCount} deliveries, status ${final?.body?.data?.status}`);
      const removed = await pm.send('DELETE', `/integrations/webhooks/${id}`).catch((error) => ({ status: `failed: ${error.message}` }));
      say(`(clean-up) DELETE /api/v1/integrations/webhooks/${id} -> ${removed.status}  (its deliveries go with it; the queued webhook.deliver jobs stay in BackgroundJob and no API route reaches them)`);
    }
  }

  const { a, c, aQuiet, bControl, b, bQuiet } = result;
  say('\n=== Summary ===');
  say(`    receiver used: ${result.url}`);
  if (a) say(`    Phase A  "*", no action taken:            ${a.from} -> ${a.to} deliveries in ${a.seconds.toFixed(1)} s  (${a.rate.toFixed(2)}/s)`);
  if (c) say(`    Phase C  "*", after ONE more event:       ${c.from} -> ${c.to} deliveries in ${c.seconds.toFixed(1)} s  (${c.rate.toFixed(2)}/s = ${(c.rate / (a.rate || 1)).toFixed(1)} x Phase A)`);
  if (aQuiet) say(`    after the pause:                          ${aQuiet.from} -> ${aQuiet.to} in ${aQuiet.seconds.toFixed(1)} s`);
  if (bControl) say(`    Phase B  control, no job event:           ${bControl.from} -> ${bControl.to} in ${bControl.seconds.toFixed(1)} s`);
  if (b) say(`    Phase B  "job.progress", one redelivery:  ${b.from} -> ${b.to} deliveries in ${b.seconds.toFixed(1)} s  (${b.rate.toFixed(2)}/s)`);
  if (bQuiet) say(`    after the second pause:                   ${bQuiet.from} -> ${bQuiet.to} in ${bQuiet.seconds.toFixed(1)} s`);

  const loopA = a && a.grew > GROWTH_THRESHOLD;
  const loopB = b && b.grew > GROWTH_THRESHOLD;
  const stopped = (!aQuiet || aQuiet.grew <= 1) && (!bQuiet || bQuiet.grew <= 1);
  if (loopA || loopB) {
    process.exitCode = 2;
    const patterns = [loopA ? '"*"' : null, loopB ? '"job.progress"' : null].filter(Boolean).join(' and ');
    say(`\nVERDICT ${LEAD}: CONFIRMED — a subscription to ${patterns} made ${loopA ? a.grew : b.grew} deliveries and as many webhook.deliver jobs in ${(loopA ? a.seconds : b.seconds).toFixed(0)} s from one event with no further action (${(loopA ? a.rate : b.rate).toFixed(1)}/s, worker off); growth ${stopped ? 'stopped' : 'did NOT stop'} when the subscription was paused.`);
  } else {
    process.exitCode = 0;
    say(`\nVERDICT ${LEAD}: NOT_REPRODUCED — one event made ${a ? a.grew : '?'} deliveries in ${a ? a.seconds.toFixed(0) : '?'} s under "*" and ${b ? b.grew : '?'} under "job.progress": the subscription does not feed on its own delivery jobs.`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  console.log(`\nVERDICT ${LEAD}: NOT_REPRODUCED — the script could not complete (${error.message}); see the error above.`);
});
