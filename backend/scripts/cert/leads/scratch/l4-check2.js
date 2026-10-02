'use strict';
// Scratch: read-only follow-ups for L4 (vendor performance of a foreign id; error body of a ghost id).
const crypto = require('crypto');
const { as } = require('../../lib/api');

const FOREIGN = '9edaa514-806f-4540-aa5b-b50539122556';

const main = async () => {
  const a = as('pm@c030.octapm-cert.test');
  const v = as('pm@c040.octapm-cert.test');
  for (const [label, s, id] of [
    ['030 asks for the 040 company', a, FOREIGN],
    ['030 asks for a random id', a, crypto.randomUUID()],
    ['040 asks for its own company', v, FOREIGN],
  ]) {
    const perf = await s.send('GET', `/company/vendors/${id}/performance`);
    console.log(`${label}: GET /company/vendors/${id}/performance -> ${perf.status}`);
    console.log(`   ${JSON.stringify(perf.body).slice(0, 700)}`);
    const pq = await s.send('GET', `/company/vendors/${id}/prequalification`);
    console.log(`${label}: GET /company/vendors/${id}/prequalification -> ${pq.status}`);
    console.log(`   ${JSON.stringify(pq.body).slice(0, 500)}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
