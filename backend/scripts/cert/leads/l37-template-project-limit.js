'use strict';

/**
 * L37 — the plan's project limit, and "create project from template".
 *
 * Company 029 is on the Individual plan (3 live projects allowed) and already
 * has its 3. POST /projects must refuse a fourth (402 PROJECT_LIMIT_REACHED);
 * the lead says POST /company/project-templates/:id/create-project makes it
 * anyway, because enforceProjectLimit is mounted on POST /projects only.
 *
 * The script puts things back: the extra project is archived (which frees its
 * place) and the template is archived.
 *
 * Exit code 0 = the template path is refused like POST /projects; 2 = it
 * creates a project past the limit.
 */

const { call, must, who, section, say, listOf, stamp, verdict, run, SetupError } = require('./_finance-lib');

const LEAD = 'L37';
const COMPANY = '029';

const liveProjects = async (pm) => {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const data = await must(pm, 'GET', `/projects?limit=100${cursor ? `&cursor=${cursor}` : ''}`, undefined, { quiet: true });
    rows.push(...listOf(data, 'projects'));
    cursor = data?.pagination?.nextCursor;
    if (!cursor) break;
  }
  return rows.filter((row) => !row.archivedAt && row.status !== 'archived');
};

run(LEAD, async () => {
  const pm = who(COMPANY, 'pm');

  section('1. the plan and what it allows');
  const sub = await must(pm, 'GET', '/billing/subscription', undefined, {
    show: (d) => ({ plan: d.plan, status: d.status ?? d.state, recognized: d.recognized, limits: d.limits, projectsUsed: d.projectsUsed ?? d.usage }),
  });
  const limit = sub?.limits?.projectLimit ?? sub?.projectLimit ?? null;
  const before = await liveProjects(pm);
  say(`   live projects now: ${before.length}; plan limit: ${limit === null ? 'unlimited' : limit}`);
  if (limit === null) throw new SetupError(`Company ${COMPANY} is on a plan with no project limit: the lead cannot be tested here.`);
  if (before.length < limit) throw new SetupError(`Company ${COMPANY} has ${before.length} live projects, under its limit of ${limit}: the limit is not reached, so nothing can be learned.`);

  section('2. control — the ordinary door refuses a project past the limit');
  const direct = await call(pm, 'POST', '/projects', { name: `L37 control ${stamp()}` });
  const controlRefused = direct.status === 402 && direct.error?.code === 'PROJECT_LIMIT_REACHED';
  if (direct.ok) {
    // The limit did not hold even here: put the project away and say so.
    await call(pm, 'DELETE', `/projects/${direct.data.id}`);
  }
  say(`   POST /projects past the limit: ${direct.status} ${direct.error?.code ?? ''} (expected 402 PROJECT_LIMIT_REACHED)`);

  section('3. the template door');
  const template = await must(pm, 'POST', '/company/project-templates', { name: `L37 template ${stamp()}`, description: 'Certification lead L37' }, { show: (d) => ({ id: d.id, name: d.name, status: d.status }) });
  const made = await call(pm, 'POST', `/company/project-templates/${template.id}/create-project`, { name: `L37 past the limit ${stamp()}` }, {
    show: (d) => ({ id: d.project?.id ?? d.id, name: d.project?.name ?? d.name, status: d.project?.status ?? d.status, applied: d.applied }),
  });
  const after = await liveProjects(pm);
  say(`   live projects after the template call: ${after.length} (limit ${limit})`);

  section('4. putting things back');
  const createdId = made.ok ? made.data?.project?.id ?? made.data?.id : null;
  if (createdId) await call(pm, 'DELETE', `/projects/${createdId}`, undefined, { show: (d) => ({ id: d.id, status: d.status, archivedAt: d.archivedAt }) });
  await call(pm, 'DELETE', `/company/project-templates/${template.id}`, undefined, { show: (d) => ({ id: d.id, status: d.status }) });
  const restored = await liveProjects(pm);
  say(`   live projects at the end: ${restored.length}`);

  section('result');
  say(`   expected: 402 PROJECT_LIMIT_REACHED from both doors; the company stays at ${limit} live projects`);
  say(`   observed: POST /projects -> ${direct.status} ${direct.error?.code ?? ''}; create-project -> ${made.status} ${made.error?.code ?? ''}; live projects ${before.length} -> ${after.length}`);

  if (!controlRefused) {
    return verdict(LEAD, 'PARTLY_CONFIRMED', `the control itself failed: POST /projects past the limit answered ${direct.status} ${direct.error?.code ?? ''}, and create-project answered ${made.status}.`);
  }
  if (made.ok && after.length > limit) {
    return verdict(LEAD, 'CONFIRMED', `on the Individual plan (limit ${limit}, ${before.length} live) POST /projects answered 402 PROJECT_LIMIT_REACHED but create-project-from-template answered ${made.status} and the company had ${after.length} live projects.`);
  }
  if (made.status === 402) {
    return verdict(LEAD, 'NOT_REPRODUCED', `create-project-from-template answered 402 ${made.error?.code} at the limit, as POST /projects does.`);
  }
  return verdict(LEAD, 'NOT_REPRODUCED', `create-project-from-template answered ${made.status} ${made.error?.code ?? ''} and the company stayed at ${after.length} live projects.`);
});
