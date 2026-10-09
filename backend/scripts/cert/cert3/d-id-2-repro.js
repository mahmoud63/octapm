'use strict';

/**
 * D-ID-2 reproduction (CERT-3 plan §4 WP-0 "Identity leftovers"; register
 * docs/certification/OCTAPM_LAUNCH_BLOCKERS.md: "D-ID-2 (P3, CERT-3) Lists of
 * past records (project team history, API-client owners) still show a former
 * member's current name and e-mail."). It reproduces and records; it fixes
 * nothing.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-id-2-repro.js [A=052] [B=025]
 *
 * In process (CERT_INPROCESS=1), on the certification database, through the
 * lock runner only, under the CERT-3 harness (cert3/lib/harness.js): exit 0
 * when no surface shows the reported behaviour, 2 when one does (the defect
 * as reported is present), 1 on a setup error. Results:
 * C:\Temp\octapm-cert\results\cert3\d-id-2-repro.json.
 *
 * Throwaway people of a fresh stamp, made through the product (invitation,
 * then acceptance). They are homed in B: B, their home, is the only company
 * that may change their name (user.service updateUser: "managed by their own
 * workspace"), so B renames them after they have left A, and A's lists then
 * show whether they read the person live.
 *   S  a former member by SUSPENSION: A deactivates S (the product's way out).
 *   L  a former member that LEFT: fixture, its A membership written `left`
 *      with leftAt (no product route writes `left`; membership doc §1).
 * Each joined A as pm and made records there: S created task T, commented on
 * it and invited a throwaway e-mail to A's project (the project's team
 * history); A's PM put S on the project team and on a party of the project,
 * and made an API key acting as S. L created task TL; A's PM made an API key
 * acting as L. The original name is N0 ("... as recorded"), B's later name N1
 * ("... renamed by home").
 *
 * Surfaces at HEAD 886c9f1 that list past records with a person's name or
 * e-mail (read with git show; * = driven here):
 *  * GET /projects/:id/audit — the project history, including the team
 *    history (user_invitation events). audit.service attachActorNames looks
 *    each actor up in User by id with no organisation filter, so actorName is
 *    the person's name now, wherever they are. Its own comment says "a person
 *    no longer in the organisation left as null for the screen to label", and
 *    the web prints "Former user" for a null (audit-history-panel.tsx:311).
 *    actorRole falls back to User.role (the home mirror) when a row has none.
 *  * GET /integrations/api-clients — api-client.service serialize: owner
 *    { id, name, email, role } read live from User; role is User.role, the
 *    home company's mirror, not the role the key acts with here.
 *  * GET /projects/:id/tasks/:id — task.service taskInclude: createdBy,
 *    assignee, updatedBy, closedBy, comments[].author,
 *    attachments[].uploadedBy and history[].actor, each { id, name, email,
 *    role } read live.
 *  * GET /projects/:id/team — permission-template.service listProjectTeam:
 *    assignments and active party places with the user's live name, e-mail,
 *    role and status (the identity's status, not this workspace's standing).
 *  * GET /projects/:id/parties — company-party.service sanitizeMember: user
 *    { name, email, role, status } read live for every active party place.
 *    Same live-read pattern, found and not driven here: comment.service
 *    (author and mentions: name, email), conversation.service (members and
 *    message authors: name, email, role), meeting.service (attendees: name,
 *    email, status), punch.service (assignee, manager, final approver: name,
 *    email), risk.service userRefSelect (name, email), form.service
 *    personSelect (name, email), workflow-support / rfi-workflow /
 *    submittal-workflow services (people: name, email), activity.service
 *    (activity assignments: name, email — removed by a suspension),
 *    custom-field.service attachValues (report values: name, else e-mail;
 *    "past ones included" on purpose).
 *
 * What a former member should show — the expected answer and its source are
 * the RULES below; R1-R3 are proposals for the owner (neither the membership
 * doc nor the CERT-3 plan states what identity data a workspace keeps of a
 * person who has left), R0 is the code's own stated contract.
 *
 * Fixtures (SQL, throwaway people only): L's A membership written `left`.
 * Cleanup (finally, best effort, through the product): the run's pending
 * invitations revoked, its tasks archived (DELETE archives), its API keys
 * revoked, its party removed, S's project assignment removed if anything left
 * it. S stays suspended in A and L stays LEFT: throwaway former members, as
 * the D-ID-1 proofs leave their people.
 */

const harness = require('./lib/harness');

harness.prepareInProcess();

const api = require('../lib/api');
const invitations = require('../lib/invitations');

invitations.captureMail({ quiet: true });

const NAME = 'd-id-2-repro';
const A_CODE = process.argv[2] || '052';
const B_CODE = process.argv[3] || '025';

const RULES = {
  R0: {
    status: 'decided',
    statement: 'In the project history an actor who is no longer part of the organisation (LEFT) is not named: actorName is null, which the screen labels "Former user". A suspended member is still part of the workspace (membership doc §5, "Part of the workspace": active or suspended), so R0 does not cover S.',
    sources: [
      'backend/src/services/audit.service.js attachActorNames (HEAD 886c9f1): "a person no longer in the organisation left as null for the screen to label"',
      "frontend/src/features/audit/components/audit-history-panel.tsx:311 (HEAD): event.actorName || 'Former user'",
      'docs/architecture/OCTAPM_MEMBERSHIP_AND_RBAC.md §5 table, "Part of the workspace"',
    ],
  },
  R1: {
    status: 'proposed',
    statement: "A past record keeps naming a former member, by the name it was recorded under; a rename made afterwards by the person's home company does not reach this workspace's records.",
    sources: [
      'docs/user-guide/roles/ADMIN_GUIDE.md, "A person has lost access to their email": "History recorded under the old account stays under the old name."',
      'backend/src/services/permission-template.service.js removeProjectMember (HEAD): a removed person\'s change orders, receipts and approvals "still name them"',
      'backend/src/services/custom-field.service.js attachValues (HEAD): report names of past people kept on purpose (L38 review, C2-L38-W)',
      "docs/architecture/OCTAPM_MEMBERSHIP_AND_RBAC.md §5.1: name, e-mail and password belong to the identity's home workspace",
      'register D-ID-2: "current name"',
    ],
    open: 'Owner: may a list of past records show the live name (today), or must it keep the name the record was made under? No document decides it.',
  },
  R2: {
    status: 'proposed',
    statement: "A workspace does not show a former member's e-mail on its lists of past records (the e-mail belongs to the identity); an address the workspace typed itself (an invitation's) is its own record and is out of scope.",
    sources: [
      'register D-ID-2: "current name and e-mail"',
      "docs/architecture/OCTAPM_MEMBERSHIP_AND_RBAC.md §5.1: e-mail belongs to the identity's home workspace",
      'by analogy, owner decision L38 / D-ID-1 (journal 2026-10-05, plan §2): a workspace learns nothing of an identity it does not belong to',
    ],
    open: 'Owner: is the e-mail of someone who has left identity data the workspace may keep showing? No document decides it.',
  },
  R3: {
    status: 'proposed',
    statement: 'The project team lists who has access to the project. A member suspended in the workspace has none, so the team does not list them; a party place the suspension left behind is not access.',
    sources: [
      'docs/user-guide/roles/ADMIN_GUIDE.md, "Deactivate and bring back a person": access stops at once, project assignments removed',
      'backend/src/routes/project-team.js header (HEAD): "who has access to the project"',
    ],
  },
};

const PLAN = [
  // ── S: a former member by suspension ──
  ['S.setup', 'S setup: a new identity homed in B (B role qs, name N0) joins A by invitation as pm; with its own A session it creates task T on A\'s project 01, comments on it and invites a throwaway e-mail to that project; A\'s PM puts S on the project team, adds S to a new party of the project and makes an API key acting as S; each answered as expected', { setup: true }],
  ['S.baseline', 'S baseline, S an active member of A: the project history names S as the actor of T\'s events and of the invitation by N0; the key\'s owner is S (N0); task T names S (N0) as creator, comment author and history actor; the team and the party list S (N0)', { setup: true }],
  ['S.former', 'S becomes a former member: A deactivates S (200); S\'s A membership is suspended; S\'s identity stays active (B is present) with the same credential epoch; S\'s project assignment in A is gone', { setup: true }],
  ['S.rename', 'S\'s home company B renames S after S left A: PATCH /users/:id {name: N1} answers 200 and User.name is N1', { setup: true }],
  ['S.after', 'after the change every record is still there for A\'s PM: T\'s events and the invitation event (actor S), the key (owner S), task T (200), the team and the party lists answer 200', { setup: true }],
  ['D2.S.history.name', 'project history (GET /projects/:id/audit: T\'s events, the invitation event) does not name the suspended former member S by the name B gave S after S left (N1)', { defect: 'D-ID-2', rule: 'R1' }],
  ['D2.S.keys.name', 'GET /integrations/api-clients does not show the key\'s owner, former member S, under the live name N1', { defect: 'D-ID-2', rule: 'R1' }],
  ['D2.S.keys.email', 'GET /integrations/api-clients does not show former member S\'s e-mail on the key', { defect: 'D-ID-2', rule: 'R2' }],
  ['D2.S.task.name', 'task T (GET /projects/:id/tasks/:id: creator, comment author, history actor) does not name former member S by the live name N1', { defect: 'D-ID-2', rule: 'R1' }],
  ['D2.S.task.email', 'task T does not show former member S\'s e-mail', { defect: 'D-ID-2', rule: 'R2' }],
  ['D2.S.team', 'GET /projects/:id/team does not list the suspended former member S (the suspension ended S\'s access and removed S\'s assignment)', { defect: 'D-ID-2', rule: 'R3' }],
  ['D2.S.party.name', 'GET /projects/:id/parties does not show former member S on the party under the live name N1', { defect: 'D-ID-2', rule: 'R1' }],
  ['D2.S.party.email', 'GET /projects/:id/parties does not show former member S\'s e-mail on the party', { defect: 'D-ID-2', rule: 'R2' }],
  // ── L: a former member that left ──
  ['L.setup', 'L setup: a second new identity homed in B (qs, N0) joins A by invitation as pm and creates task TL on A\'s project 01; A\'s PM makes an API key acting as L', { setup: true }],
  ['L.baseline', 'L baseline, L an active member of A: TL\'s history events name L by N0; the key\'s owner is L (N0); task TL names L (N0) as creator', { setup: true }],
  ['L.former', 'L becomes a former member that LEFT A (fixture: its A membership written left with leftAt; no product route writes left); L\'s identity stays active, B active', { setup: true }],
  ['L.rename', 'B renames L after L left A: PATCH /users/:id {name: N1} answers 200 and User.name is N1', { setup: true }],
  ['L.after', 'after the change every record is still there for A\'s PM: TL\'s events (actor L), the key (owner L), task TL (200)', { setup: true }],
  ['D2.L.history.null', 'project history leaves the actor who LEFT the organisation unnamed: actorName null on every TL event by L (the screen labels it "Former user")', { defect: 'D-ID-2', rule: 'R0' }],
  ['D2.L.keys.name', 'GET /integrations/api-clients does not show the key\'s owner, former member L, under the live name N1', { defect: 'D-ID-2', rule: 'R1' }],
  ['D2.L.keys.email', 'GET /integrations/api-clients does not show former member L\'s e-mail on the key', { defect: 'D-ID-2', rule: 'R2' }],
  ['D2.L.task.name', 'task TL (creator, history actor) does not name former member L by the live name N1', { defect: 'D-ID-2', rule: 'R1' }],
  ['D2.L.task.email', 'task TL does not show former member L\'s e-mail', { defect: 'D-ID-2', rule: 'R2' }],
  ['G.fingerprint', 'no company other than A and B changed during the run', { guard: true }],
];

const SURFACES = {
  driven: [
    'GET /projects/:id/audit (actorName; team history = user_invitation events) — audit.service attachActorNames',
    'GET /integrations/api-clients (owner name, email, role) — api-client.service serialize',
    'GET /projects/:id/tasks/:id (createdBy, comments[].author, history[].actor: name, email, role) — task.service taskInclude',
    'GET /projects/:id/team (name, email, status) — permission-template.service listProjectTeam',
    'GET /projects/:id/parties (members[].user name, email, role, status) — company-party.service sanitizeMember',
  ],
  foundNotDriven: [
    'comment.service: author and mentions (name, email)',
    'conversation.service: members and message authors (name, email, role)',
    'meeting.service: attendees (name, email, status)',
    'punch.service: assignee, manager, final approver (name, email)',
    'risk.service userRefSelect (name, email)',
    'form.service personSelect (name, email)',
    'workflow-support / rfi-workflow / submittal-workflow services: people (name, email)',
    'activity.service: activity assignments (name, email; removed by a suspension)',
    'custom-field.service attachValues: report values (name, else e-mail; past people kept on purpose)',
  ],
};

const h = harness.createHarness({
  name: NAME,
  plan: PLAN,
  rules: RULES,
  mailPrefix: 'did2',
  meta: {
    defect: 'D-ID-2',
    register: 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md (D-ID-2, P3, CERT-3)',
    writtenAgainst: 'HEAD 886c9f1 (cert/full-saas-certification)',
    a: A_CODE,
    b: B_CODE,
    surfaces: SURFACES,
  },
});

// What the cleanup needs, filled in as the run makes it.
const ctx = { db: null, aPm: null, projectA: null, taskIds: [], keyIds: [], partyId: null, teamUserId: null, leftFixture: 0 };

const main = async () => {
  const [A, B] = h.companies(A_CODE, B_CODE);
  const db = await h.connect();
  ctx.db = db;
  const { one } = h.sql(db);
  const orgA = await h.orgOf(db, A_CODE);
  const orgB = await h.orgOf(db, B_CODE);
  const projectA = h.projectId(A_CODE);
  ctx.projectA = projectA;
  // A's PM persona is a company administrator in 052 (plan §3.1): team, parties and API keys.
  const aPm = api.as(`pm@${A.domain}`);
  const bPm = api.as(`pm@${B.domain}`);
  ctx.aPm = aPm;
  console.log(`${NAME}: A ${A_CODE} (${orgA.id}), B ${B_CODE} (${orgB.id}); A project ${projectA}\n`);
  const printBefore = await h.fingerprint.take(db);

  const userRow = (id) => one('select "orgId", name, status, role, "credentialEpoch" as epoch from "User" where id = $1', [id]);
  const membershipIn = (orgId, userId) => one(`select id, role, status, kind, ${h.sqlIso('"leftAt"')} as "leftAt" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`, [orgId, userId]);
  const assignments = async (userId) => (await one('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, userId])).n;
  const partyPlace = (userId) => (ctx.partyId ? one('select status, role from "ProjectPartyMember" where "projectPartyId" = $1 and "userId" = $2', [ctx.partyId, userId]) : null);

  // ── the surfaces, each read as A's PM ──
  const shows = (value, email) => JSON.stringify(value ?? null).toLowerCase().includes(String(email).toLowerCase());
  const history = async (label, entityType, entityId) => {
    const res = h.keep(label, await aPm.send('GET', `/projects/${projectA}/audit?entityType=${entityType}&entityId=${entityId}&order=desc&limit=100`));
    return { res, events: Array.isArray(res.body?.data?.events) ? res.body.data.events : [] };
  };
  const actorEvents = (events, userId) => events.filter((e) => e.actorId === userId).map((e) => ({ action: e.action, source: e.source || null, actorName: e.actorName ?? null, actorRole: e.actorRole ?? null }));
  const read = async (p, when, { teamAndParty = false } = {}) => {
    const r = {};
    const t = await history(`${p.label} ${when}: history of the task`, 'task', p.taskId);
    r.historyAnswer = h.said(t.res);
    r.taskEvents = actorEvents(t.events, p.id);
    if (p.invitationId) {
      const i = await history(`${p.label} ${when}: history of the invitation`, 'user_invitation', p.invitationId);
      r.invitationAnswer = h.said(i.res);
      r.invitationEvents = actorEvents(i.events, p.id);
    }
    const k = h.keep(`${p.label} ${when}: api-clients`, await aPm.send('GET', '/integrations/api-clients?includeRevoked=true'));
    r.keysAnswer = h.said(k);
    const key = (Array.isArray(k.body?.data?.items) ? k.body.data.items : []).find((item) => item.id === p.keyId) || null;
    r.key = key ? { status: key.status, ownerId: key.owner?.id ?? null, ownerName: key.owner?.name ?? null, ownerRole: key.owner?.role ?? null, emailShown: shows(key, p.email) } : null;
    const tk = h.keep(`${p.label} ${when}: task`, await aPm.send('GET', `/projects/${projectA}/tasks/${p.taskId}`));
    r.taskAnswer = h.said(tk);
    const task = tk.status === 200 ? tk.body?.data || null : null;
    const people = task
      ? [
          task.createdBy?.id === p.id ? { where: 'createdBy', ...task.createdBy } : null,
          task.assignee?.id === p.id ? { where: 'assignee', ...task.assignee } : null,
          ...(task.comments || []).filter((c) => c.author?.id === p.id).map((c) => ({ where: 'comment author', ...c.author })),
          ...(task.history || []).filter((e) => e.actor?.id === p.id).map((e) => ({ where: `history ${e.action}`, ...e.actor })),
        ].filter(Boolean)
      : [];
    r.task = task ? { people: people.map((x) => ({ where: x.where, name: x.name ?? null, role: x.role ?? null })), emailShown: shows(task, p.email) } : null;
    if (teamAndParty) {
      const tm = h.keep(`${p.label} ${when}: team`, await aPm.send('GET', `/projects/${projectA}/team`));
      r.teamAnswer = h.said(tm);
      const member = (Array.isArray(tm.body?.data?.items) ? tm.body.data.items : []).find((m) => m.userId === p.id) || null;
      r.team = member
        ? { listed: true, name: member.name ?? null, status: member.status ?? null, source: member.source ?? null, viaParty: Boolean(member.party), assignmentRole: member.assignmentRole ?? null, emailShown: shows(member, p.email) }
        : { listed: false };
      const pl = h.keep(`${p.label} ${when}: parties`, await aPm.send('GET', `/projects/${projectA}/parties`));
      r.partiesAnswer = h.said(pl);
      const party = (Array.isArray(pl.body?.data?.items) ? pl.body.data.items : []).find((x) => x.id === ctx.partyId) || null;
      const m = party?.members?.find((x) => x.userId === p.id) || null;
      r.party = { partyListed: Boolean(party), member: m ? { status: m.status, name: m.user?.name ?? null, userRole: m.user?.role ?? null, userStatus: m.user?.status ?? null, emailShown: shows(m, p.email) } : null };
    }
    return r;
  };
  /** Which name a surface used: the one recorded (N0), the home company's later one (N1), none, or another. */
  const nameIs = (p, value) => (value === p.n1 ? 'N1 (live: renamed by home after leaving)' : value === p.n0 ? 'N0 (as recorded)' : value === null ? 'null' : `other: ${value}`);
  const namesSaid = (p, list) => (list.length ? list.map((v) => nameIs(p, v)).join(' | ') : 'none');

  // A person homed in B (made by B's invitation) who joins A as pm by A's invitation.
  const person = async (label) => {
    const tag = label.toUpperCase();
    const p = { label, email: h.mail(label, B.domain), n0: `DID2 ${tag} ${h.STAMP} as recorded`, n1: `DID2 ${tag} ${h.STAMP} renamed by home` };
    const made = await invitations.createByInvitation({ inviter: bPm, email: p.email, role: 'qs', name: p.n0, db });
    h.keep(`${label}: B invites`, made.invited);
    h.keep(`${label}: accepts B`, made.accepted);
    p.id = made.userId;
    p.made = `B ${h.said(made.invited)} -> ${h.said(made.accepted)}`;
    p.ready = false;
    if (!p.id) return p;
    const joined = await invitations.joinByInvitation({ inviter: aPm, email: p.email, role: 'pm', name: p.n0, homeOrgId: orgB.id, db });
    h.keep(`${label}: A invites`, joined.invited);
    h.keep(`${label}: accepts A`, joined.accepted);
    p.made += `; A ${h.said(joined.invited)} -> ${h.said(joined.accepted)}`;
    p.inA = api.as(p.email, orgA.id);
    p.user0 = await userRow(p.id);
    p.a0 = await membershipIn(orgA.id, p.id);
    p.b0 = await membershipIn(orgB.id, p.id);
    p.standing = `user home B ${p.user0?.orgId === orgB.id}, ${p.user0?.status}, named N0 ${p.user0?.name === p.n0}, User.role ${p.user0?.role}; A ${p.a0?.status}/${p.a0?.kind}/${p.a0?.role}; B ${p.b0?.status}/${p.b0?.role}`;
    p.ready = joined.accepted?.status === 200 && p.user0?.orgId === orgB.id && p.user0.status === 'active' && p.user0.name === p.n0
      && p.a0?.status === 'active' && p.a0.kind === 'member' && p.a0.role === 'pm' && p.b0?.status === 'active' && p.b0.role === 'qs';
    return p;
  };
  const createTask = async (p, title) => {
    const res = h.keep(`${p.label}: creates a task`, await p.inA.send('POST', `/projects/${projectA}/tasks`, { title, description: 'D-ID-2 reproduction (throwaway)' }));
    p.taskId = res.status === 201 ? res.body?.data?.id || null : null;
    if (p.taskId) ctx.taskIds.push(p.taskId);
    return res;
  };
  const makeKey = async (p) => {
    const res = h.keep(`A makes a key acting as ${p.label}`, await aPm.send('POST', '/integrations/api-clients', { name: `did2 ${p.label} ${h.STAMP}`, scopes: ['*:read'], projectIds: [projectA], userId: p.id }));
    p.keyId = res.status === 201 ? res.body?.data?.id || null : null;
    if (p.keyId) ctx.keyIds.push(p.keyId);
    return res;
  };
  const rename = async (p) => {
    const res = h.keep(`B renames ${p.label}`, await bPm.send('PATCH', `/users/${p.id}`, { name: p.n1 }));
    const u = await userRow(p.id);
    const ok = h.is(res, '200') && u?.name === p.n1 && u.orgId === orgB.id;
    return { ok, detail: `rename ${h.said(res)}; User.name is N1 ${u?.name === p.n1}; still homed in B ${u?.orgId === orgB.id}` };
  };

  // ════════════════════════════════════════════════════════════════════════════
  // S a former member by suspension
  // ════════════════════════════════════════════════════════════════════════════
  await h.section('S a former member by suspension', async () => {
    const S = await person('s');
    const made = {};
    if (S.ready) {
      made.task = await createTask(S, `DID2 T ${h.STAMP}`);
      made.comment = S.taskId ? h.keep('S comments on T', await S.inA.send('POST', `/projects/${projectA}/tasks/${S.taskId}/comments`, { body: `DID2 comment ${h.STAMP}` })) : null;
      made.invite = h.keep('S invites a throwaway e-mail to the project', await S.inA.send('POST', '/users/invitations', { email: h.mail('x', A.domain), role: 'qs', projectId: projectA }));
      S.invitationId = made.invite.status === 201 ? made.invite.body?.data?.id || null : null;
      made.team = h.keep('A puts S on the project team', await aPm.send('POST', `/projects/${projectA}/team`, { userId: S.id }));
      if (made.team.status === 201 || made.team.status === 200) ctx.teamUserId = S.id;
      made.party = h.keep('A makes a party', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `DID2 Party ${h.STAMP}` }));
      ctx.partyId = made.party.status === 201 ? made.party.body?.data?.id || null : null;
      made.place = ctx.partyId ? h.keep('A adds S to the party', await aPm.send('POST', `/projects/${projectA}/parties/${ctx.partyId}/members`, { userId: S.id })) : null;
      made.key = await makeKey(S);
      // Not part of the setup: can A assign T to S at all? (task.service
      // ensureAssigneeInProject reads User.orgId and User.status: S's home.)
      made.assign = S.taskId ? h.keep('A assigns T to S', await aPm.send('PATCH', `/projects/${projectA}/tasks/${S.taskId}`, { assigneeId: S.id })) : null;
    }
    const setupOk = S.ready && h.is(made.task, '201') && Boolean(S.taskId) && h.is(made.comment, '201') && h.is(made.invite, '201') && Boolean(S.invitationId)
      && h.is(made.team, ['201', '200']) && h.is(made.party, '201') && Boolean(ctx.partyId) && h.is(made.place, '201') && h.is(made.key, '201') && Boolean(S.keyId);
    h.check('S.setup', setupOk, `${S.made}; ${S.standing || 'no identity'}; task ${h.said(made.task)}; comment ${h.said(made.comment)}; invitation ${h.said(made.invite)}; team ${h.said(made.team)}; party ${h.said(made.party)}; party place ${h.said(made.place)}; key ${h.said(made.key)}; (assigning T to S: ${h.said(made.assign)})`);
    h.observe('S.assignTaskToForeignHomedMember', { answer: h.said(made.assign), note: 'S is an active pm of A homed in B' });
    if (made.assign && made.assign.status !== 200) {
      h.lead('A cannot assign a task to its own active member homed in another company: task.service ensureAssigneeInProject filters User.orgId (the home) and User.status, not the membership here', { answer: h.said(made.assign) });
    }
    if (!setupOk) throw new Error('S setup incomplete');

    const before = await read(S, 'before', { teamAndParty: true });
    h.observe('S.before', before);
    const allN0 = (events) => events.length > 0 && events.every((e) => e.actorName === S.n0);
    const baselineOk = before.historyAnswer === '200' && allN0(before.taskEvents) && before.invitationAnswer === '200' && allN0(before.invitationEvents)
      && before.keysAnswer === '200' && before.key?.ownerId === S.id && before.key.ownerName === S.n0
      && before.taskAnswer === '200' && Boolean(before.task?.people.some((x) => x.where === 'createdBy')) && before.task.people.some((x) => x.where === 'comment author') && before.task.people.every((x) => x.name === S.n0)
      && before.teamAnswer === '200' && before.team.listed === true && before.team.name === S.n0
      && before.partiesAnswer === '200' && before.party.member?.name === S.n0;
    h.check('S.baseline', baselineOk, `history ${before.historyAnswer}: T events by S ${before.taskEvents.length} (${namesSaid(S, before.taskEvents.map((e) => e.actorName))}); invitation ${before.invitationAnswer}: ${namesSaid(S, (before.invitationEvents || []).map((e) => e.actorName))}; keys ${before.keysAnswer}: ${JSON.stringify(before.key)}; task ${before.taskAnswer}: ${JSON.stringify(before.task?.people)}; team ${before.teamAnswer}: ${JSON.stringify(before.team)}; parties ${before.partiesAnswer}: ${JSON.stringify(before.party)}`);
    if (before.key && before.key.ownerRole !== S.a0?.role) {
      h.lead('GET /integrations/api-clients shows the owner\'s role from User.role (the home company\'s mirror), not the role the key acts with in this workspace — for a current member too', { ownerRoleShown: before.key.ownerRole, roleInA: S.a0?.role, roleAtHome: S.b0?.role });
    }
    if (!baselineOk) throw new Error('S baseline: the surfaces do not carry S as expected');

    const deact = h.keep('A deactivates S', await aPm.send('PATCH', `/users/${S.id}/deactivate`, {}));
    const u1 = await userRow(S.id);
    const a1 = await membershipIn(orgA.id, S.id);
    const b1 = await membershipIn(orgB.id, S.id);
    const assigned = await assignments(S.id);
    const place = await partyPlace(S.id);
    h.check('S.former', h.is(deact, '200') && a1?.status === 'suspended' && u1?.status === 'active' && u1.epoch === S.user0.epoch && b1?.status === 'active' && assigned === 0,
      `deactivate ${h.said(deact)}; A ${a1?.status}; identity ${u1?.status}, epoch ${S.user0.epoch} -> ${u1?.epoch}; B ${b1?.status}; project assignments ${assigned}; party place ${JSON.stringify(place)}`);
    h.observe('S.partyPlaceAfterSuspension', place);
    if (place?.status === 'active') {
      h.lead('A suspension leaves the person\'s party places active (user.service deactivateUser removes project and activity assignments only), so Activate brings that party access back, while the admin guide says project assignments are not restored', { partyPlace: place });
    }
    if (a1?.status !== 'suspended') throw new Error('S is not a former member');

    const renamed = await rename(S);
    h.check('S.rename', renamed.ok, renamed.detail);
    if (!renamed.ok) throw new Error('S was not renamed by its home');

    const after = await read(S, 'after', { teamAndParty: true });
    h.observe('S.after', after);
    const afterOk = after.historyAnswer === '200' && after.taskEvents.length > 0 && after.invitationAnswer === '200' && after.invitationEvents.length > 0
      && after.keysAnswer === '200' && after.key?.ownerId === S.id && after.taskAnswer === '200' && Boolean(after.task) && after.task.people.length > 0
      && after.teamAnswer === '200' && after.partiesAnswer === '200' && after.party.partyListed === true;
    h.check('S.after', afterOk, `history ${after.historyAnswer} (T events by S ${after.taskEvents.length}); invitation ${after.invitationAnswer} (${(after.invitationEvents || []).length}); keys ${after.keysAnswer} (key ${after.key ? 'listed' : 'missing'}); task ${after.taskAnswer} (${after.task?.people.length ?? 0} places naming S); team ${after.teamAnswer}; parties ${after.partiesAnswer} (party listed ${after.party.partyListed})`);
    if (!afterOk) throw new Error('S after: a record is missing');

    const historyNames = [...after.taskEvents, ...after.invitationEvents].map((e) => e.actorName);
    h.check('D2.S.history.name', historyNames.every((n) => n !== S.n1), `actorName on S's ${historyNames.length} events: ${namesSaid(S, historyNames)}`);
    h.check('D2.S.keys.name', after.key.ownerName !== S.n1, `owner name: ${nameIs(S, after.key.ownerName)}; owner role shown ${after.key.ownerRole} (S is ${S.a0.role} in A, ${S.b0.role} at home); key status ${after.key.status}`);
    h.check('D2.S.keys.email', after.key.emailShown === false, `S's e-mail ${after.key.emailShown ? 'is shown' : 'is not shown'} on the key`);
    h.check('D2.S.task.name', after.task.people.every((x) => x.name !== S.n1), after.task.people.map((x) => `${x.where}: ${nameIs(S, x.name)}`).join(' | '));
    h.check('D2.S.task.email', after.task.emailShown === false, `S's e-mail ${after.task.emailShown ? 'is shown' : 'is not shown'} on task T`);
    h.check('D2.S.team', after.team.listed === false, after.team.listed
      ? `S listed: name ${nameIs(S, after.team.name)}, status shown ${after.team.status} (S is suspended in A), source ${after.team.source}, via party ${after.team.viaParty}, assignment ${after.team.assignmentRole}, e-mail ${after.team.emailShown ? 'shown' : 'not shown'}`
      : 'S not listed');
    const pm = after.party.member;
    h.check('D2.S.party.name', !pm || pm.name !== S.n1, pm ? `S on the party: name ${nameIs(S, pm.name)}, place ${pm.status}, user status shown ${pm.userStatus}, user role shown ${pm.userRole}` : 'S not on the party list');
    h.check('D2.S.party.email', !pm || pm.emailShown === false, pm ? `S's e-mail ${pm.emailShown ? 'is shown' : 'is not shown'} on the party` : 'S not on the party list');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // L a former member that left
  // ════════════════════════════════════════════════════════════════════════════
  await h.section('L a former member that left', async () => {
    const L = await person('l');
    const made = {};
    if (L.ready) {
      made.task = await createTask(L, `DID2 TL ${h.STAMP}`);
      made.key = await makeKey(L);
    }
    const setupOk = L.ready && h.is(made.task, '201') && Boolean(L.taskId) && h.is(made.key, '201') && Boolean(L.keyId);
    h.check('L.setup', setupOk, `${L.made}; ${L.standing || 'no identity'}; task ${h.said(made.task)}; key ${h.said(made.key)}`);
    if (!setupOk) throw new Error('L setup incomplete');

    const before = await read(L, 'before');
    h.observe('L.before', before);
    const baselineOk = before.historyAnswer === '200' && before.taskEvents.length > 0 && before.taskEvents.every((e) => e.actorName === L.n0)
      && before.keysAnswer === '200' && before.key?.ownerId === L.id && before.key.ownerName === L.n0
      && before.taskAnswer === '200' && Boolean(before.task?.people.some((x) => x.where === 'createdBy')) && before.task.people.every((x) => x.name === L.n0);
    h.check('L.baseline', baselineOk, `history ${before.historyAnswer}: TL events by L ${before.taskEvents.length} (${namesSaid(L, before.taskEvents.map((e) => e.actorName))}); keys ${before.keysAnswer}: ${JSON.stringify(before.key)}; task ${before.taskAnswer}: ${JSON.stringify(before.task?.people)}`);
    if (!baselineOk) throw new Error('L baseline: the surfaces do not carry L as expected');

    // Fixture: L leaves A (no product route writes `left`).
    const left = await db.query(
      `update "OrganizationMembership" set status = 'left', "leftAt" = ${h.NOW_UTC}, "updatedAt" = ${h.NOW_UTC}
        where "orgId" = $1 and "userId" = $2 and status = 'active'`,
      [orgA.id, L.id],
    );
    ctx.leftFixture = left.rowCount;
    const u1 = await userRow(L.id);
    const a1 = await membershipIn(orgA.id, L.id);
    const b1 = await membershipIn(orgB.id, L.id);
    h.check('L.former', left.rowCount === 1 && a1?.status === 'left' && Boolean(a1.leftAt) && u1?.status === 'active' && b1?.status === 'active',
      `fixture rows ${left.rowCount}; A ${a1?.status} leftAt ${a1?.leftAt}; identity ${u1?.status}; B ${b1?.status}`);
    if (a1?.status !== 'left') throw new Error('L is not a former member');

    const renamed = await rename(L);
    h.check('L.rename', renamed.ok, renamed.detail);
    if (!renamed.ok) throw new Error('L was not renamed by its home');

    const after = await read(L, 'after');
    h.observe('L.after', after);
    const afterOk = after.historyAnswer === '200' && after.taskEvents.length > 0 && after.keysAnswer === '200' && after.key?.ownerId === L.id
      && after.taskAnswer === '200' && Boolean(after.task) && after.task.people.length > 0;
    h.check('L.after', afterOk, `history ${after.historyAnswer} (TL events by L ${after.taskEvents.length}); keys ${after.keysAnswer} (key ${after.key ? 'listed' : 'missing'}); task ${after.taskAnswer} (${after.task?.people.length ?? 0} places naming L)`);
    if (!afterOk) throw new Error('L after: a record is missing');

    const names = after.taskEvents.map((e) => e.actorName);
    h.check('D2.L.history.null', names.every((n) => n === null), `actorName on L's ${names.length} events: ${namesSaid(L, names)}`);
    h.check('D2.L.keys.name', after.key.ownerName !== L.n1, `owner name: ${nameIs(L, after.key.ownerName)}; owner role shown ${after.key.ownerRole}; key status ${after.key.status}`);
    h.check('D2.L.keys.email', after.key.emailShown === false, `L's e-mail ${after.key.emailShown ? 'is shown' : 'is not shown'} on the key`);
    h.check('D2.L.task.name', after.task.people.every((x) => x.name !== L.n1), after.task.people.map((x) => `${x.where}: ${nameIs(L, x.name)}`).join(' | '));
    h.check('D2.L.task.email', after.task.emailShown === false, `L's e-mail ${after.task.emailShown ? 'is shown' : 'is not shown'} on task TL`);
    if (after.key.status === 'active') {
      h.lead('A key whose owner is no longer part of the workspace is still listed as active (it cannot authenticate: API_KEY_OWNER_INACTIVE); the list does not say so', { key: after.key });
    }
  });

  const changes = h.fingerprint.changes(printBefore, await h.fingerprint.take(db), { exclude: [A_CODE, B_CODE] });
  h.check('G.fingerprint', changes.length === 0, changes.length ? changes.map((c) => `${c.table}:${c.org} ${c.rowsBefore}->${c.rowsAfter}`).join(', ') : 'no change outside A and B');
};

const cleanup = async () => {
  const notes = [];
  const { db, aPm, projectA } = ctx;
  if (!db) return notes;
  try { notes.push(`pending invitations of the run revoked: ${await h.revokeRunInvitations(db)}`); } catch (error) { notes.push(`invitations: ${error.message}`); }
  for (const id of ctx.keyIds) {
    try { notes.push(`API key revoked ${h.said(h.keep('cleanup: revoke key', await aPm.send('DELETE', `/integrations/api-clients/${id}`)))}`); } catch (error) { notes.push(`API key: ${error.message}`); }
  }
  for (const id of ctx.taskIds) {
    try { notes.push(`task archived ${h.said(h.keep('cleanup: archive task', await aPm.send('DELETE', `/projects/${projectA}/tasks/${id}`)))}`); } catch (error) { notes.push(`task: ${error.message}`); }
  }
  if (ctx.partyId) {
    try { notes.push(`party removed ${h.said(h.keep('cleanup: remove party', await aPm.send('DELETE', `/projects/${projectA}/parties/${ctx.partyId}`)))}`); } catch (error) { notes.push(`party: ${error.message}`); }
  }
  if (ctx.teamUserId) {
    try {
      const still = (await db.query('select 1 from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, ctx.teamUserId])).rowCount;
      notes.push(still ? `S's assignment removed ${h.said(h.keep('cleanup: remove S from the team', await aPm.send('DELETE', `/projects/${projectA}/team/${ctx.teamUserId}`)))}` : "S's assignment: already removed by the suspension");
    } catch (error) { notes.push(`team: ${error.message}`); }
  }
  notes.push(`S stays suspended in A; L stays LEFT in A (fixture rows ${ctx.leftFixture}); both throwaway`);
  return notes;
};

h.run({ main, cleanup });
