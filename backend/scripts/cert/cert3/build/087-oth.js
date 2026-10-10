'use strict';

/**
 * CERT-3 deep population, 087-OTH "CERT3 Other" (plan §3.2, D1 company 087).
 *
 * Serves WP-9 workflow notifications: a QS, a cost controller, a finance
 * officer, a site engineer and a procurement officer, all STAFF (people with
 * no persona key and no company administration), assigned ONLY to this
 * project. The WP-9 proof then asserts that `commitment.executed` on 087-COM,
 * and the pay-application and drawing-set notices, reach 0 of them (answer
 * book field-controls.js WP9.workflowNotifications.otherProjectStaff = 0,
 * .otherProjectStaffHeadcount = 5; today they are notified, HR-K4).
 *
 * The people are NAMED (R3-17), never "whoever comes first":
 *   - qs mateo.wang.6, cost_controller karim.petrov.16, site_engineer
 *     lucia.reed.9, procurement samir.carter.11: population staff of 087
 *     (spec.js; plan assumption A1 holds for these four roles);
 *   - finance: 087 has no finance staff (its finance people are the owner and
 *     the finance persona, both on other duties), so one finance officer is
 *     invited by D-ID-1 invitation and acceptance, company role finance, staff,
 *     the invitation naming this project so that acceptance assigns them here
 *     and nowhere else (builders' adjudication 087-OTH/052/006 item 1). The
 *     address carries the build state's creation stamp
 *     (cert3.087-oth.finance.<yymmddhhmmss>@c087...), so a build started
 *     afresh never re-invites an existing member (D-ID-1 Q3: 409
 *     ALREADY_MEMBER) and a resumed build keeps the same person.
 *
 * "Only here": before they are assigned, each named staff member must be
 * active (the PM's assignable list) and on no 087 project at all (every
 * project's GET /team, archived ones included, as the PM, who administers the
 * company); after the team step, and again on every resumed run, each of the
 * five is on 087-OTH, with their company role, and on no other 087 project.
 * The headcount is the answer book's otherProjectStaffHeadcount.
 */

const lib = require('./lib');

const FC = lib.answers.fieldControls;
const HEADCOUNT = FC.WP9.workflowNotifications.otherProjectStaffHeadcount.value; // 5

/** The four population staff of 087-OTH, by spec key (R3-17). */
const STAFF = { qs: 'mateo.wang.6', cost_controller: 'karim.petrov.16', site_engineer: 'lucia.reed.9', procurement: 'samir.carter.11' };
const FINANCE_KEY = 'finance';

/** Every 087 project (archived included) and who is on each, as the PM reads them. */
const assignmentsByUser = async (s, b) => {
  const projects = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const data = await s.get('pm', `/projects?limit=100&includeArchived=true${cursor ? `&cursor=${cursor}` : ''}`);
    projects.push(...(data?.items || []));
    cursor = data?.nextCursor || data?.pageInfo?.nextCursor || null;
    if (!cursor) break;
  }
  s.assert(projects.length > 0, 'the PM lists the projects of 087');
  s.assert(projects.filter((p) => p.id === b.projectId).length === 1, `the project list carries 087-OTH (${b.projectId}) once`);
  const byUser = new Map();
  for (const p of projects) {
    const team = await s.get('pm', `/projects/${p.id}/team`);
    for (const row of team?.items || []) {
      if (!row.assignmentRole) continue; // party members are not assignments
      if (!byUser.has(row.userId)) byUser.set(row.userId, []);
      byUser.get(row.userId).push({ projectId: p.id, name: p.name, role: row.assignmentRole });
    }
  }
  return { projects: projects.length, byUser };
};

lib.main('087-OTH', async (b) => {
  b.assert(Object.keys(STAFF).length + 1 === HEADCOUNT, `087-OTH holds ${HEADCOUNT} people (WP9.workflowNotifications.otherProjectStaffHeadcount): four staff and the finance officer`);

  await b.project({
    title: 'Other',
    payload: { startDate: '2026-01-05', endDate: '2026-12-31', projectCalendar: 'five_day', currency: 'EGP', type: 'building', contractType: 'unit_rate' },
    fields: { projectCalendar: 'five_day', currency: 'EGP', startDate: lib.is.day('2026-01-05') },
  });

  // ── the four named staff: staff of their role, active, and on no 087 project before they are put here ──
  const named = await b.step('staff.named', async (s) => {
    const assignable = await s.get('pm', `${b.P}/team/assignable`);
    const active = new Set((assignable?.items || []).map((u) => u.userId));
    const { projects, byUser } = await assignmentsByUser(s, b);
    const out = { projects, people: {} };
    for (const [role, key] of Object.entries(STAFF)) {
      const person = b.person(key);
      const staff = b.company.staff(role).filter((p) => p.key === key);
      s.assert(staff.length === 1 && person.role === role && !person.persona && !person.isOwner && !person.isAdmin, `${key} is one of 087's ${role} staff (no persona, not the owner, no company administration; plan assumption A1)`, { role: person.role, persona: person.persona, isAdmin: person.isAdmin });
      s.assert(active.has(person.id), `${key} (${role}) is active in 087 (the PM's assignable list)`);
      const elsewhere = (byUser.get(person.id) || []).filter((a) => a.projectId !== b.projectId);
      s.assert(elsewhere.length === 0, `${key} (${role}) is on no other 087 project`, elsewhere);
      out.people[role] = { key, userId: person.id, email: person.email };
    }
    return out;
  });

  // ── the finance officer: invited (D-ID-1) onto this project, company role finance, staff ──
  const stamp = String(b.state.createdAt || '').replace(/\D/g, '').slice(2, 14); // yymmddhhmmss of this build's state
  b.assert(/^\d{12}$/.test(stamp), `the build state carries its creation time (${b.state.createdAt})`);
  const invited = await b.invite(FINANCE_KEY, {
    inviter: 'pm',
    email: `cert3.${b.code.toLowerCase()}.finance.${stamp}@${b.company.domain}`,
    role: 'finance',
    name: b.name('Finance officer'),
    projectId: b.projectId,
  });
  await b.step('finance.staff', async (s) => {
    const me = await s.get(FINANCE_KEY, '/auth/me');
    s.assert(me?.id === invited.userId, `the finance officer signs in as the invited user ${invited.userId} (got ${me?.id})`);
    s.assert(String(me?.role).toLowerCase() === 'finance' && me?.isCompanyAdmin === false, `the finance officer holds company role finance with no company administration (role ${me?.role}, isCompanyAdmin ${me?.isCompanyAdmin})`);
    return { key: FINANCE_KEY, userId: invited.userId, email: invited.email, role: 'finance', isCompanyAdmin: me.isCompanyAdmin };
  }, { needs: [`invite.${FINANCE_KEY}`] });

  // b.team keys: the staff keys and the invited finance key, each with their company role (null = company role).
  // The finance officer is already on the project through the invitation: POST /team answers 200.
  const members = { ...Object.fromEntries(Object.values(named.people).map((p) => [p.key, null])), [FINANCE_KEY]: null };
  b.assert(Object.keys(members).length === HEADCOUNT, `${HEADCOUNT} people go on 087-OTH`);
  await b.team(members);

  // "Assigned only here": every one of the five is on 087-OTH, with their company role, and on no other 087 project.
  // Re-asserted on every resumed run too (a later builder must not have put them anywhere else).
  const everyone = () => ({ ...Object.fromEntries(Object.entries(named.people).map(([role, p]) => [role, p])), finance: { key: FINANCE_KEY, userId: invited.userId } });
  const onlyHere = async (s) => {
    const { byUser } = await assignmentsByUser(s, b);
    const out = {};
    for (const [role, p] of Object.entries(everyone())) {
      const rows = byUser.get(p.userId) || [];
      s.assert(rows.length === 1 && rows[0].projectId === b.projectId, `${p.key} (${role}) is assigned to 087-OTH only`, rows);
      s.assert(rows[0].role === role, `${p.key} is on 087-OTH as ${role}`, rows[0]);
      out[role] = p.key;
    }
    s.assert(Object.keys(out).length === HEADCOUNT, `${HEADCOUNT} people are assigned to 087-OTH only`);
    return out;
  };
  await b.step('staff.only-here', onlyHere, { needs: ['staff.named', 'finance.staff', 'team'], verify: async (s) => Boolean(await onlyHere(s)) });
});
