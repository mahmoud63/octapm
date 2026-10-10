'use strict';

/**
 * lib.js live self-test (not a plan builder; run-all.js never runs it).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/_smoke.js [--blocked] [--project [--archive]] [--fresh]
 *
 * In company 087 as its PM: resolves the company (slug, id, plan §3.1 facts),
 * opens asserted sessions, reads the project list, parses every generated
 * programme and bill file with the product's parsers (files.selfCheck), makes
 * ONE throwaway directory company "CERT3 Smoke party (087-SMOKE)" (adopted,
 * never a second one, by any later run), retires it, asserts a refusal, and
 * proves there is exactly one. --blocked adds a known-answer BLOCKED step and a
 * step that needs it (exit 2). --project exercises b.project and b.team on a
 * project "CERT3 Smoke (087-SMOKE)" (adopted by name, never a second one while
 * it is live); --archive then archives it. With CERT3_BUILD_CRASH_AFTER_SEND=party the
 * first run stops after the company is made and before it is recorded; the
 * next run must adopt it, not make a second.
 */

const lib = require('./lib');

const withBlocked = process.argv.includes('--blocked');
const withProject = process.argv.includes('--project');

lib.main('087-SMOKE', async (b) => {
  const partyName = b.name('Smoke party');
  const search = `/companies?limit=100&search=${encodeURIComponent(partyName)}`;
  const findParty = async (s) => ((await s.get('pm', search))?.items || []).find((c) => c.name === partyName) || null;

  await b.step('read.projects', async (s) => {
    const page = await s.get('pm', '/projects?limit=100');
    const items = page?.items || [];
    const certified = items.filter((p) => p.name === 'OCTA PHASE21 GREENFIELD C087');
    s.assert(certified.length === 1, `the certified project OCTA PHASE21 GREENFIELD C087 is listed once (found ${certified.length} of ${items.length})`);
    return { projects: items.length, certifiedProjectId: certified[0].id, runDate: b.today, orgId: b.orgId };
  });

  await b.step('files.selfCheck', async (s) => {
    const results = await lib.files.selfCheck();
    const bad = results.filter((r) => !r.ok);
    s.assert(bad.length === 0, `every generated file reads back through the product's parsers (${bad.length} of ${results.length} do not)`, bad);
    return { files: results.length, checked: results.map((r) => r.file) };
  });

  const party = await b.step('party', async (s) => {
    const data = await s.create('party', 'pm', '/companies', { name: partyName, type: 'external', status: 'active' }, {
      fields: { name: partyName, type: 'external' },
      get: search,
      adopt: true,
      find: findParty,
    });
    return { id: data.id };
  });

  await b.step('party.retire', async (s) => {
    const data = await s.act('party.retire', 'pm', 'PATCH', `/companies/${party.id}`, { status: 'inactive' }, {
      fields: { id: party.id, status: 'inactive' },
      verify: async (s2) => (await findParty(s2))?.status === 'inactive',
    });
    return { status: data?.status ?? 'inactive' };
  }, { needs: ['party'] });

  await b.step('refusal.site-creates-project', async (s) => {
    const r = await s.refused('refusal.site-creates-project', 'site', 'POST', '/projects', { name: b.name('Never made') }, '403 FORBIDDEN');
    return { said: r.said };
  });

  await b.step('party.unique', async (s) => {
    const page = await s.get('pm', search);
    const named = (page?.items || []).filter((c) => c.name === partyName);
    s.assert(named.length === 1, `exactly one directory company is named ${partyName} (found ${named.length})`, named.map((c) => c.id));
    s.assert(named[0].id === party.id, `it is the recorded one (${party.id})`);
    return { count: named.length };
  });

  if (withProject) {
    // b.project and b.team, which every builder uses. 087 is Enterprise (no project limit); the
    // project is adopted by name on every later run, never made twice, and --archive retires it.
    await b.project({
      title: 'Smoke',
      payload: { startDate: '2026-01-05', endDate: '2026-12-31', projectCalendar: 'five_day', currency: 'EGP', type: 'building', contractType: 'unit_rate' },
      fields: { projectCalendar: 'five_day', currency: 'EGP', startDate: lib.is.day('2026-01-05') },
    });
    await b.team({ planner: 'planning_eng', site: 'site_engineer', quality: null });
    await b.step('project.read', async (s) => {
      const p = await s.get('planner', b.P);
      s.expectFields(p, { id: b.projectId, name: b.name('Smoke'), currency: 'EGP', archivedAt: lib.is.absent });
      return { id: p.id };
    }, { needs: ['project', 'team'] });
    if (process.argv.includes('--archive')) {
      await b.step('project.archive', async (s) => {
        await s.act('project.archive', 'pm', 'DELETE', b.P, undefined, {
          fields: { id: b.projectId, archivedAt: lib.is.present },
          verify: async (s2) => Boolean((await s2.get('pm', b.P))?.archivedAt),
        });
        return { archived: b.projectId };
      });
    }
  }

  if (withBlocked) {
    await b.step('blocked.known-answer', async (s) => {
      // A demonstration of `known`: the plan would expect another answer; the product gives
      // 403 FORBIDDEN today, which is declared as the known answer, so the step is BLOCKED.
      await s.refused('blocked.known-answer', 'site', 'POST', '/projects', { name: b.name('Never made either') }, '409 SMOKE_EXPECTED', {
        known: { ref: 'HR-SMOKE', said: ['403 FORBIDDEN'] },
      });
    });
    await b.step('needs.blocked', async () => ({ unreachable: true }), { needs: ['blocked.known-answer'] });
  }
});
