'use strict';
/**
 * L11 independent check (scratch): does every further event add another
 * never-ending chain, who may create the subscription, can another company
 * see it, and does company 012 feel company 032's chains (worker off)?
 * Bounded: about 25 s of looping, always pauses and deletes.
 */
const { as } = require('../../lib/api');

const PM32 = as('pm@c032.octapm-cert.test');
const SITE32 = as('site@c032.octapm-cert.test');
const PM12 = as('pm@c012.octapm-cert.test');
const NAME = 'cert-L11 checker scale probe';
const URL = 'https://203.0.113.32/hook';
const K = Number(process.env.L11_K || 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = async (id) => (await PM32.send('GET', `/integrations/webhooks/${id}`)).body?.data?.deliveryCount ?? null;

const latency = async (ms) => {
  const samples = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = process.hrtime.bigint();
    const res = await PM12.send('GET', '/projects');
    samples.push({ ms: Number(process.hrtime.bigint() - t) / 1e6, status: res.status });
    await sleep(150);
  }
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  return { n: sorted.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1], statuses: [...new Set(samples.map((s) => s.status))] };
};
const fmt = (l) => `n=${l.n} median=${l.median.toFixed(0)}ms p95=${l.p95.toFixed(0)}ms max=${l.max.toFixed(0)}ms statuses=${l.statuses}`;

const rate = async (id, ms, alongside = null) => {
  const from = await count(id);
  const t0 = Date.now();
  const sideResult = await (alongside ? alongside(ms) : sleep(ms));
  const to = await count(id);
  const s = (Date.now() - t0) / 1000;
  return { from, to, perSecond: (to - from) / s, seconds: s, sideResult };
};

(async () => {
  let id = null;
  try {
    for (const item of (await PM32.send('GET', '/integrations/webhooks')).body?.data?.items || []) {
      if (item.name === NAME) {
        await PM32.send('PATCH', `/integrations/webhooks/${item.id}`, { status: 'paused' });
        await PM32.send('DELETE', `/integrations/webhooks/${item.id}`);
      }
    }
    const payload = { name: NAME, url: URL, eventTypes: ['*'] };

    const refused = await SITE32.send('POST', '/integrations/webhooks', payload);
    console.log(`site@c032 POST /integrations/webhooks -> ${refused.status} ${refused.body?.error?.code || ''}`);
    if (refused.status === 201) {
      await SITE32.send('PATCH', `/integrations/webhooks/${refused.body.data.id}`, { status: 'paused' });
      await SITE32.send('DELETE', `/integrations/webhooks/${refused.body.data.id}`);
    }

    const base = await latency(5000);
    console.log(`baseline, pm@c012 GET /projects, no chain running: ${fmt(base)}`);

    const created = await PM32.send('POST', '/integrations/webhooks', payload);
    console.log(`pm@c032 POST /integrations/webhooks ["*"] -> ${created.status}`);
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    id = created.body.data.id;

    const foreign = await PM12.send('GET', `/integrations/webhooks/${id}`);
    const foreignList = await PM12.send('GET', `/integrations/webhooks/${id}/deliveries`);
    console.log(`pm@c012 GET /integrations/webhooks/<032 id> -> ${foreign.status} ${foreign.body?.error?.code || ''}; .../deliveries -> ${foreignList.status} ${foreignList.body?.error?.code || ''}`);

    await sleep(500);
    const one = await rate(id, 5000);
    console.log(`1 event (the creation): ${one.from} -> ${one.to} in ${one.seconds.toFixed(1)}s = ${one.perSecond.toFixed(2)}/s`);

    const t = Date.now();
    for (let i = 0; i < K; i += 1) {
      const r = await PM32.send('PATCH', `/integrations/webhooks/${id}`, { description: `edit ${i + 1}` });
      if (r.status !== 200) throw new Error(`edit ${i} -> ${r.status}`);
    }
    console.log(`${K} more events (PATCH description x${K}) sent in ${Date.now() - t} ms; nothing else is sent to company 032 from here`);
    await sleep(2500);
    const many = await rate(id, 9000, latency);
    console.log(`${K + 1} events: ${many.from} -> ${many.to} in ${many.seconds.toFixed(1)}s = ${many.perSecond.toFixed(2)}/s = ${(many.perSecond / one.perSecond).toFixed(1)} x the one-event rate`);
    console.log(`meanwhile, pm@c012 GET /projects: ${fmt(many.sideResult)}`);

    const paused = await PM32.send('PATCH', `/integrations/webhooks/${id}`, { status: 'paused' });
    await sleep(1500);
    const quiet = await rate(id, 4000);
    console.log(`pause -> ${paused.status}; then ${quiet.from} -> ${quiet.to} in ${quiet.seconds.toFixed(1)}s`);
    const after = await latency(4000);
    console.log(`after the pause, pm@c012 GET /projects: ${fmt(after)}`);
  } finally {
    if (id) {
      await PM32.send('PATCH', `/integrations/webhooks/${id}`, { status: 'paused' }).catch(() => null);
      const end = await PM32.send('GET', `/integrations/webhooks/${id}`).catch(() => null);
      const del = await PM32.send('DELETE', `/integrations/webhooks/${id}`).catch((e) => ({ status: e.message }));
      console.log(`clean-up: ended with ${end?.body?.data?.deliveryCount} deliveries, status ${end?.body?.data?.status}; DELETE -> ${del.status}`);
      const left = await PM32.send('GET', '/integrations/webhooks');
      console.log(`company 032 subscriptions left: ${(left.body?.data?.items || []).length}`);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
