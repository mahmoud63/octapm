'use strict';
// Shared identifiers for group foreign-ids-b (companies 028 attacker, 042 victim).
// Discovered through the API in _explore-fib.js / _explore-fib2.js.
module.exports = {
  ATTACKER: {
    pm: 'pm@c028.octapm-cert.test',
    orgId: '10efd4c2-bdf0-53a6-84a4-dc79d51eeb94',
    project: 'b4c7a085-ac7d-4282-b62a-82f1a9bcd083', // Convention Centre Hall 3 (028-01)
    project2: 'ea0bcf2b-142a-47e7-9643-0a4c3452b391', // Mixed-Use Podium (028-02)
  },
  VICTIM: {
    pm: 'pm@c042.octapm-cert.test',
    orgId: '5a6b925d-c129-51d6-b392-944c23d91d79',
    pmUserId: '22f32a8d-7b62-5403-bbb1-1c1ec4603345',
    qsUserId: '22682802-4899-54a0-8dfb-bf8f8accbaf9',
    siteUserId: '92102e6e-a684-59ec-9fec-4a1555f2c9d2',
    project: '917e3a18-a7e7-443a-94b7-c080025223ba', // Logistics Park Warehouse B
    activity: 'b9ed6711-5ae5-4e03-9620-0a37109456fb', // Site clearance
  },
};
