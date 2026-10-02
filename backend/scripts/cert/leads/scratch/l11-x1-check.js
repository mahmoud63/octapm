'use strict';

/**
 * Independent check of L11-X1 (company 012 only).
 *
 * What can a company administrator see and do about webhook deliveries that
 * are still queued when the subscription is paused, and after it is deleted?
 *
 * The "*" subscription is live for about 2.5 s only (it feeds on itself, L11),
 * enough to name a handful of webhook.deliver job ids in its own deliveries.
 */

const { as } = require('../../lib/api');

const PM = 'pm@c012.octapm-cert.test';
const URL = 'https://203.0.113.12/hook'; // TEST-NET-3: nobody answers
const NAME = 'cert-L11-X1 checker probe';
const pm = as(PM);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v, n = 420) => {
  const t = typeof v === 'string' ? v : JSON.stringify(v, (k, x) => (k === 'secret' && x ? '(withheld)' : x));
  return t && t.length > n ? `${t.slice(0, n)}…` : t;
};
const step = async (label, method, route, payload) => {
  const res = await pm.send(method, route, payload);
  console.log(`\n>>> ${label}\n    ${method} /api/v1${route}${payload !== undefined ? `  ${short(payload, 200)}` : ''}\n<<< ${res.status}  ${short(res.body)}`);
  return res;
};

const main = async () => {
  let id = null;
  try {
    const before = await pm.send('GET', '/integrations/webhooks');
    for (const item of before.body?.data?.items || []) {
      if (item.name === NAME) {
        await pm.send('PATCH', `/integrations/webhooks/${item.id}`, { status: 'paused' });
        await pm.send('DELETE', `/integrations/webhooks/${item.id}`);
      }
    }
    const created = await step('Create "*" subscription', 'POST', '/integrations/webhooks', { name: NAME, url: URL, eventTypes: ['*'], description: 'L11-X1 independent check. Safe to delete.' });
    if (created.status !== 201) throw new Error('could not create');
    id = created.body.data.id;
    await sleep(2500);
    await step('Pause it', 'PATCH', `/integrations/webhooks/${id}`, { status: 'paused' });
    await sleep(1200);

    const all = await pm.send('GET', `/integrations/webhooks/${id}/deliveries?limit=200`);
    const items = all.body?.data?.items || [];
    const byStatus = {};
    const jobIds = [];
    for (const d of items) {
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      if (d.payload?.entity?.type === 'background_job' && d.payload?.payload?.jobType === 'webhook.deliver') jobIds.push(d.payload.entity.id);
    }
    console.log(`\n--- deliveries on the paused subscription: ${items.length}, by status ${JSON.stringify(byStatus)}; webhook.deliver job ids named: ${jobIds.length}`);

    const pending = await pm.send('GET', `/integrations/webhooks/${id}/deliveries?status=pending&limit=200`);
    const pendingItems = pending.body?.data?.items || [];
    const first = pendingItems[0];
    console.log(`\n>>> What the administrator CAN see of the queue\n    GET /api/v1/integrations/webhooks/${id}/deliveries?status=pending&limit=200\n<<< ${pending.status}  ${pendingItems.length} pending deliveries listed; first: ${short(first && { id: first.id, eventType: first.eventType, status: first.status, attempt: first.attempt, nextAttemptAt: first.nextAttemptAt, jobIdField: Object.prototype.hasOwnProperty.call(first, 'jobId') ? first.jobId : '(not serialized)' })}`);

    const projects = await pm.send('GET', '/projects');
    const list = projects.body?.data?.items || projects.body?.data?.projects || (Array.isArray(projects.body?.data) ? projects.body.data : []);
    const pid = list[0]?.id;
    console.log(`\n--- company 012 project used for the per-project jobs API: ${pid} (${list.length} project(s))`);
    const jobId = jobIds[0];
    if (pid) {
      const any = await pm.send('GET', `/projects/${pid}/jobs?limit=100`);
      console.log(`\n>>> GET /api/v1/projects/${pid}/jobs?limit=100\n<<< ${any.status}  ${(any.body?.data?.items || []).length} job(s) of any type; summary ${JSON.stringify(any.body?.data?.summary)}`);
      const typed = await pm.send('GET', `/projects/${pid}/jobs?type=webhook.deliver&limit=100`);
      console.log(`\n>>> GET /api/v1/projects/${pid}/jobs?type=webhook.deliver&limit=100\n<<< ${typed.status}  ${(typed.body?.data?.items || []).length} job(s)`);
      if (jobId) {
        await step('Read one named webhook.deliver job through the project jobs API', 'GET', `/projects/${pid}/jobs/${jobId}`);
        await step('Cancel it through the project jobs API', 'POST', `/projects/${pid}/jobs/${jobId}/cancel`, {});
      }
    }
    if (jobId) {
      for (const [m, r] of [['GET', '/jobs'], ['GET', `/jobs/${jobId}`], ['POST', `/jobs/${jobId}/cancel`], ['GET', '/integrations/jobs'], ['GET', `/integrations/webhooks/${id}/jobs`]]) {
        const res = await pm.send(m, r, m === 'POST' ? {} : undefined);
        console.log(`    probe ${m} /api/v1${r} -> ${res.status} ${res.body?.error?.code || ''}`);
      }
    }
    if (first) {
      for (const [m, r] of [['DELETE', `/integrations/webhooks/deliveries/${first.id}`], ['POST', `/integrations/webhooks/deliveries/${first.id}/cancel`]]) {
        const res = await pm.send(m, r, m === 'POST' ? {} : undefined);
        console.log(`    probe ${m} /api/v1${r} -> ${res.status} ${res.body?.error?.code || ''}`);
      }
      await step('Redeliver while paused', 'POST', `/integrations/webhooks/deliveries/${first.id}/redeliver`, {});
    }

    // The same handler the worker runs for a queued job (runDeliveryJob), run inline by "test":
    const test = await step('What the delivery handler does for a paused subscription (the "test" send runs runDeliveryJob inline)', 'POST', `/integrations/webhooks/${id}/test`, {});
    const td = test.body?.data?.delivery;
    console.log(`    => skipped=${test.body?.data?.skipped}  delivery.status=${td?.status}  attempt=${td?.attempt}  error=${JSON.stringify(td?.error)}  responseStatus=${td?.responseStatus}  durationMs=${td?.durationMs}`);

    await sleep(3000);
    const after = await pm.send('GET', `/integrations/webhooks/${id}`);
    console.log(`\n--- 3 s later, still paused: deliveryCount=${after.body?.data?.deliveryCount} (was ${items.length} + 1 test), status=${after.body?.data?.status}`);

    const removed = await step('Delete the subscription', 'DELETE', `/integrations/webhooks/${id}`);
    if (removed.status === 200) {
      const gone = await step('Its deliveries after the delete', 'GET', `/integrations/webhooks/${id}/deliveries?status=pending`);
      if (pid && jobId) await step('The named job after the delete, through the project jobs API', 'GET', `/projects/${pid}/jobs/${jobId}`);
      if (gone.status === 404) id = null;
    }
  } finally {
    if (id) {
      await pm.send('PATCH', `/integrations/webhooks/${id}`, { status: 'paused' }).catch(() => null);
      const r = await pm.send('DELETE', `/integrations/webhooks/${id}`).catch(() => null);
      console.log(`\n(clean-up) delete -> ${r?.status}`);
    }
    const end = await pm.send('GET', '/integrations/webhooks');
    console.log(`\n(end) company 012 subscriptions: ${short((end.body?.data?.items || []).map((x) => ({ id: x.id, name: x.name, status: x.status })))}`);
  }
};

main().catch((e) => { console.error(e); process.exitCode = 1; });
