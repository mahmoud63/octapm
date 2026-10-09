'use strict';

/**
 * D-PAGE-1 proof (register: cursor pagination lost rows that tie on the sort).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-page-1-proof.js
 *
 * Read only, in process, on the certification database. For the lists the
 * sweep found defective — users, tasks, meetings, conversation messages — it
 * walks the service two rows at a time, for every sort and both directions,
 * and compares what the walk returned with the truth:
 *   - users: the database's own list of the workspace's people;
 *   - tasks, meetings, messages: one page of up to 100 (or 200), which crosses
 *     no page boundary, from the same service and viewer.
 * Each list is checked where the data has ties on its sort values (the
 * population generator creates many rows in one instant; many tasks share a
 * status or have no due date), and the number of tied rows is printed, so a
 * pass is not a pass on data that could not fail.
 *
 * Exit 0 when every walk returns every row exactly once, 2 otherwise, 1 on a
 * setup error.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('../lib/cert-env');
process.env.DATABASE_URL = guard.certDatabaseUrl();

const fs = require('fs');
const { buildPopulation } = require('../lib/spec');

const RESULTS = 'C:/Temp/octapm-cert/results/cert3/d-page-1.json';
const PAGE = 2;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 2000) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
};

// Walks a list to exhaustion; `fetchPage({ limit, cursor })` answers { items, nextCursor }.
const walk = async (fetchPage, limit) => {
  const seen = [];
  let cursor = null;
  for (let guardCount = 0; guardCount < 2000; guardCount += 1) {
    const page = await fetchPage({ limit, cursor });
    seen.push(...page.items.map((row) => row.id));
    if (!page.nextCursor || page.items.length === 0) return seen;
    if (page.nextCursor === cursor) throw new Error('the cursor did not advance');
    cursor = page.nextCursor;
  }
  throw new Error('pagination did not terminate');
};
const compare = (walked, truth) => {
  const unique = new Set(walked);
  const missing = [...truth].filter((id) => !unique.has(id));
  const extra = [...unique].filter((id) => !truth.has(id));
  return { ok: walked.length === unique.size && missing.length === 0 && extra.length === 0, walked: walked.length, unique: unique.size, truth: truth.size, missing: missing.length, extra: extra.length, repeated: walked.length - unique.size };
};
const tiesIn = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0);
};

const main = async () => {
  if (process.env.CERT_INPROCESS !== '1') throw new Error('run through C:\\Temp\\octapm-cert\\run-locked.js (CERT_INPROCESS=1)');
  const { prisma } = require('../../../src/config/db');
  const membershipService = require('../../../src/services/membership.service');
  const userService = require('../../../src/services/user.service');
  const taskService = require('../../../src/services/task.service');
  const meetingService = require('../../../src/services/meeting.service');
  const conversationService = require('../../../src/services/conversation.service');
  const { companies } = buildPopulation();
  const byCode = new Map(companies.map((c) => [c.code, c]));
  const certOrgs = await prisma.organisation.findMany({ where: { slug: { startsWith: 'cert-' } }, select: { id: true, slug: true } });
  const codeOf = (org) => org.slug.slice(5, 8);
  const pmOf = async (org) => {
    const company = byCode.get(codeOf(org));
    if (!company) return null;
    return prisma.user.findFirst({ where: { email: `pm@${company.domain}` }, select: { id: true, role: true } });
  };

  // ── users: the four workspaces with the most people ─────────────────────
  console.log('── users ──');
  const userCounts = [];
  for (const org of certOrgs) {
    userCounts.push({ org, n: await prisma.user.count({ where: membershipService.userInOrgWhere({ tx: prisma, orgId: org.id }) }) });
  }
  userCounts.sort((a, b) => b.n - a.n || a.org.slug.localeCompare(b.org.slug));
  const userOrgs = [userCounts.find((u) => codeOf(u.org) === '044'), ...userCounts.slice(0, 3)].filter(Boolean)
    .filter((u, i, all) => all.findIndex((x) => x.org.id === u.org.id) === i);
  for (const { org } of userOrgs) {
    const people = await prisma.user.findMany({ where: membershipService.userInOrgWhere({ tx: prisma, orgId: org.id }), select: { id: true, createdAt: true, name: true } });
    const truth = new Set(people.map((p) => p.id));
    const failures = [];
    for (const sortBy of ['created', 'name', 'email', 'projects']) {
      for (const sortDir of ['asc', 'desc']) {
        const walked = await walk(async ({ limit, cursor }) => {
          const page = await userService.listUsers({ orgId: org.id, query: { limit, sortBy, sortDir, ...(cursor ? { cursor } : {}) } });
          return { items: page.items, nextCursor: page.pagination.nextCursor };
        }, PAGE);
        const r = compare(walked, truth);
        if (!r.ok) failures.push(`${sortBy}/${sortDir}: ${JSON.stringify(r)}`);
      }
    }
    const tied = tiesIn(people.map((p) => p.createdAt.toISOString()));
    console.log(`        ${org.slug}: ${truth.size} people, ${tied} sharing a createdAt with another`);
    check(`users ${org.slug}: every sort and direction, ${PAGE} per page, returns each of the workspace's ${truth.size} people exactly once (${tied} tie on createdAt)`, failures.length === 0, failures.join(' | '));
  }
  const limited = await userService.listUsers({ orgId: userOrgs[0].org.id, query: { limit: 3 } });
  check('users: the page size asked for is honoured (limit 3 gives 3 people and a cursor)', limited.items.length === 3 && limited.pagination.limit === 3 && Boolean(limited.pagination.nextCursor),
    `${limited.items.length} items, limit ${limited.pagination.limit}`);

  // ── tasks and meetings: the projects with the most of them ──────────────
  for (const kind of ['task', 'meeting']) {
    console.log(`── ${kind}s ──`);
    const grouped = await prisma[kind].groupBy({ by: ['projectId'], _count: { _all: true }, where: { project: { org: { slug: { startsWith: 'cert-' } } } } });
    const candidates = grouped.filter((g) => g._count._all >= 5 && g._count._all <= 100)
      .sort((a, b) => b._count._all - a._count._all || a.projectId.localeCompare(b.projectId)).slice(0, 4);
    if (!candidates.length) throw new Error(`no project with 5-100 ${kind}s`);
    for (const g of candidates) {
      const project = await prisma.project.findUnique({ where: { id: g.projectId }, select: { id: true, orgId: true, org: { select: { id: true, slug: true } } } });
      const pm = await pmOf(project.org);
      if (!pm) throw new Error(`no PM persona for ${project.org.slug}`);
      const sorts = kind === 'task' ? ['created', 'updated', 'due', 'priority', 'status'] : ['created', 'updated', 'scheduled', 'status', 'type'];
      const list = async ({ limit, cursor, sortBy, sortDir }) => {
        const args = { orgId: project.orgId, projectId: project.id, userId: pm.id, role: 'pm', query: { limit, sortBy, sortDir, ...(cursor ? { cursor } : {}) } };
        const page = kind === 'task' ? await taskService.listTasks(args) : await meetingService.listMeetings(args);
        return { items: page.items || page.rows || [], nextCursor: page.pagination?.nextCursor || null };
      };
      const failures = [];
      for (const sortBy of sorts) {
        for (const sortDir of ['asc', 'desc']) {
          const one = await list({ limit: 100, cursor: null, sortBy, sortDir });
          if (one.nextCursor) throw new Error(`${kind}s of ${project.id}: more than 100 for one page`);
          const truth = new Set(one.items.map((row) => row.id));
          const r = compare(await walk(({ limit, cursor }) => list({ limit, cursor, sortBy, sortDir }), PAGE), truth);
          if (!r.ok) failures.push(`${sortBy}/${sortDir}: ${JSON.stringify(r)}`);
        }
      }
      const rows = await prisma[kind].findMany({ where: { projectId: project.id }, select: kind === 'task' ? { status: true, dueDate: true } : { status: true, scheduledAt: true } });
      const tiedStatus = tiesIn(rows.map((r) => r.status));
      const nullDates = rows.filter((r) => (kind === 'task' ? r.dueDate : r.scheduledAt) === null).length;
      console.log(`        ${project.org.slug} ${project.id}: ${rows.length} ${kind}s, ${tiedStatus} sharing a status, ${nullDates} without a ${kind === 'task' ? 'due date' : 'scheduled time'}`);
      check(`${kind}s of a project in ${project.org.slug} (${rows.length}): every sort and direction, ${PAGE} per page, returns each exactly once (${tiedStatus} tie on status, ${nullDates} with no date)`, failures.length === 0, failures.join(' | '));
    }
  }

  // ── conversation messages ───────────────────────────────────────────────
  console.log('── messages ──');
  const convs = await prisma.conversationMessage.groupBy({ by: ['conversationId'], _count: { _all: true } });
  const convPick = convs.filter((c) => c._count._all >= 3 && c._count._all <= 200).sort((a, b) => b._count._all - a._count._all || a.conversationId.localeCompare(b.conversationId)).slice(0, 3);
  for (const c of convPick) {
    const conv = await prisma.conversation.findUnique({ where: { id: c.conversationId }, select: { id: true, orgId: true } });
    const member = await prisma.conversationMember.findFirst({ where: { conversationId: conv.id }, orderBy: { id: 'asc' }, select: { userId: true } });
    const viewer = await prisma.user.findUnique({ where: { id: member.userId }, select: { id: true, role: true, isCompanyAdmin: true } });
    const list = async ({ limit, cursor }) => conversationService.listMessages({ orgId: conv.orgId, viewer, conversationId: conv.id, cursor, limit });
    const one = await list({ limit: 200, cursor: null });
    const truth = new Set(one.items.map((m) => m.id));
    const r = compare(await walk(list, PAGE), truth);
    const times = await prisma.conversationMessage.findMany({ where: { conversationId: conv.id }, select: { createdAt: true } });
    check(`messages of a conversation (${truth.size}): ${PAGE} per page returns each exactly once (${tiesIn(times.map((t) => t.createdAt.toISOString()))} tie on createdAt)`, r.ok, JSON.stringify(r));
  }
  if (convPick.length) {
    const conv = await prisma.conversation.findUnique({ where: { id: convPick[0].conversationId }, select: { id: true, orgId: true } });
    const member = await prisma.conversationMember.findFirst({ where: { conversationId: conv.id }, orderBy: { id: 'asc' }, select: { userId: true } });
    const viewer = await prisma.user.findUnique({ where: { id: member.userId }, select: { id: true, role: true, isCompanyAdmin: true } });
    const unknown = await conversationService.listMessages({ orgId: conv.orgId, viewer, conversationId: conv.id, cursor: '00000000-0000-4000-8000-000000000000', limit: 2 });
    check('messages: a cursor the conversation does not have pages nothing (it used to start again from the newest page)', unknown.items.length === 0 && unknown.nextCursor === null, JSON.stringify({ items: unknown.items.length, next: unknown.nextCursor }));
  } else {
    console.log('        no conversation with 3-200 messages: the message walk is covered by the unit tests only');
  }
  await prisma.$disconnect();
};

const finish = (error = null) => {
  const failed = results.filter((r) => !r.ok).length;
  const out = { proof: 'd-page-1-proof', at: new Date().toISOString(), total: results.length, failed, error: error ? String(error.stack || error.message) : null, results };
  try {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
  } catch (e) {
    console.error(`could not write ${RESULTS}: ${e.message}`);
  }
  console.log(`\nd-page-1 proof: ${results.length - failed} passed, ${failed} failed of ${results.length}`);
  process.exitCode = error ? 1 : failed ? 2 : 0;
};

main()
  .then(() => finish())
  .catch((error) => {
    console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
    finish(error);
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref());
