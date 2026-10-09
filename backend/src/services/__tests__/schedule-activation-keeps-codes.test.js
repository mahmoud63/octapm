/**
 * CERT-3 WP-1, Fix 2 (plan §5 defect fixes: "activation keeps the activity
 * code and budget, and suggests mapping by code"), as the integration owner
 * adjudicated it:
 *
 *   H1  Mapping goes by tiers, each across every active activity: the
 *       activity code (looked up in the revision's activityCode and in the
 *       file's own code, which a file import stages as p6ActivityId), then the
 *       P6 id, then the WBS code or the name.
 *   H2  A mapped activity's code is the revision's when the revision states
 *       one (a generated revision), else the activity's own (a file import —
 *       the data-loss fix).
 *   H3  A mapped activity always keeps its budget; its category is the
 *       revision's when stated, else its own; its milestone flag is the
 *       revision's when the revision's stored row states a boolean, else its
 *       own.
 *
 * Pure: a real XER goes through the real parser and the real staging
 * (importXer → buildImportSnapshot; Prisma only receives the revision row it
 * would write, which is read back here as the database would hand it back,
 * JSON), the real normaliser (buildReadinessActivitiesFromSnapshot, which
 * reads the stored rows as activation's getSnapshotActivities does), then
 * suggestActivityMappings and mappedActivityData.
 */
const mockPrisma = {
  project: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';

const { parseXer, extractActivities } = require('../../parsers/xer-parser');
const importService = require('../import.service');
const {
  buildReadinessActivitiesFromSnapshot,
  suggestActivityMappings,
  mappedActivityData,
} = require('../schedule.service');

const PROJECT = {
  id: 'project-1',
  orgId: 'org-1',
  startDate: new Date('2026-01-05T00:00:00.000Z'),
  endDate: new Date('2026-12-18T00:00:00.000Z'),
  projectCalendar: null,
};

// ── the XER fixture (the layout of scripts/cert/cert3/build/files.js xer()) ──
const xerDate = (iso) => `${iso} 08:00`;
const row = (values) => `%R\t${values.map((v) => (v === null || v === undefined ? '' : String(v))).join('\t')}`;
function xerText(tasks, links) {
  return [
    ['ERMHDR', '19.12', '2026-01-05', 'Project', 'admin', 'CERT3', 'dbxDatabaseNoName', 'Project Management', 'USD'].join('\t'),
    '%T\tCALENDAR',
    '%F\tclndr_id\tdefault_flag\tclndr_name\tproj_id\tclndr_type\tday_hr_cnt\tweek_hr_cnt',
    row(['1', 'Y', 'Standard 5 Day', '', 'CA_Base', 8, 40]),
    '%T\tPROJECT',
    '%F\tproj_id\tproj_short_name\tplan_start_date\tclndr_id',
    row([4001, 'CERT3-WP1', xerDate('2026-01-05'), '1']),
    '%T\tPROJWBS',
    '%F\twbs_id\tproj_id\tparent_wbs_id\tseq_num\tproj_node_flag\twbs_short_name\twbs_name',
    row([101, 4001, '', 1, 'N', '1 Substructure', 'Substructure']),
    row([109, 4001, '', 9, 'N', '9 Completion', 'Completion']),
    '%T\tTASK',
    '%F\ttask_id\tproj_id\twbs_id\tclndr_id\tphys_complete_pct\ttask_type\tstatus_code\ttask_code\ttask_name\tremain_drtn_hr_cnt\ttarget_drtn_hr_cnt\ttotal_float_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttarget_start_date\ttarget_end_date',
    ...tasks.map((t) =>
      row([
        t.id, 4001, t.wbs, '1', 0, t.hours ? 'TT_Task' : 'TT_FinMile', 'TK_NotStart', t.code, t.name,
        t.hours, t.hours, 0, xerDate(t.es), xerDate(t.ef), xerDate(t.es), xerDate(t.ef), xerDate(t.es), xerDate(t.ef),
      ]),
    ),
    '%T\tTASKPRED',
    '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt',
    ...links.map((l, i) => row([9001 + i, l.succ, l.pred, 4001, 4001, 'PR_FS', 0])),
    '%E',
    '',
  ].join('\r\n');
}

const A100 = { id: 1001, code: 'A100', name: 'Site clearance', wbs: 101, hours: 40, es: '2026-01-05', ef: '2026-01-09' };
const A110 = { id: 1002, code: 'A110', name: 'Excavation', wbs: 101, hours: 80, es: '2026-01-12', ef: '2026-01-23' };
const A120 = { id: 1003, code: 'A120', name: 'Blinding', wbs: 101, hours: 24, es: '2026-01-26', ef: '2026-01-28' };
const M900 = { id: 1014, code: 'M900', name: 'Substructure complete', wbs: 109, hours: 0, es: '2026-01-12', ef: '2026-01-12' };
// F: three tasks, no zero-duration row. FM: the second fixture, with M900 at 0 h.
const XER_F = xerText([A100, A110, A120], [{ pred: 1001, succ: 1002 }, { pred: 1002, succ: 1003 }]);
const XER_FM = xerText([A100, M900], [{ pred: 1001, succ: 1014 }]);

/** Stage a file through importXer and read the revision back as the database would. */
async function stageXer(xerContent) {
  let written = null;
  mockPrisma.project.findFirst.mockResolvedValue(PROJECT);
  mockPrisma.$transaction.mockImplementation(async (fn) =>
    fn({
      scheduleRevision: {
        findMany: async () => [],
        update: async () => ({}),
        create: async ({ data }) => {
          written = data;
          return { id: 'revision-file' };
        },
      },
    }),
  );
  await importService.importXer({ projectId: PROJECT.id, orgId: PROJECT.orgId, xerContent });
  const snapshotJson = JSON.parse(JSON.stringify(written.snapshotJson));
  const revision = { id: 'revision-file', isActive: false, status: 'approved', source: 'xer', snapshotJson };
  const staged = buildReadinessActivitiesFromSnapshot(revision, PROJECT);
  // Activation's storedRowByKey: getSnapshotActivities maps every stored row
  // in order, so the stored row of a staged row is the one at its index.
  const rawByKey = new Map(staged.map((activity, index) => [activity.draftKey, snapshotJson.activities[index]]));
  return { revision, raw: snapshotJson.activities, staged, rawByKey };
}

/**
 * A generated (AI) revision stores every row fully normalised
 * (buildGeneratedRevisionSnapshot: normalizeSnapshotActivity, then the dates
 * as ISO strings), so its rows state a code, a budget, a category and a
 * boolean milestone flag. Built through the same normaliser, less the `id`
 * and `predecessorLinks` the readiness view adds.
 */
function generatedRevision(aiActivities) {
  const prepared = {
    snapshotJson: {
      source: 'ai',
      activities: aiActivities.map((a, index) => ({
        ...a,
        activityCode: a.activityCode || a.activityId || a.id || null,
        p6ActivityId: a.p6ActivityId || a.id,
        wbsCode: a.wbsCode || a.wbs,
        category: a.category || a.phase,
        isCritical: a.isCritical ?? a.critical,
        sortOrder: index,
      })),
    },
  };
  const stored = buildReadinessActivitiesFromSnapshot(prepared, PROJECT).map(
    // eslint-disable-next-line no-unused-vars
    ({ id, predecessorLinks, ...rest }) => JSON.parse(JSON.stringify(rest)),
  );
  const revision = { id: 'revision-ai', isActive: false, status: 'approved', source: 'ai', snapshotJson: { source: 'ai', activities: stored } };
  const staged = buildReadinessActivitiesFromSnapshot(revision, PROJECT);
  const rawByKey = new Map(staged.map((activity, index) => [activity.draftKey, stored[index]]));
  return { revision, raw: stored, staged, rawByKey };
}

// The activities a planner built by hand before the import (as createActivity
// stores them: a code of ours, no P6 id).
const handBuilt = () => [
  { id: 'h-A100', projectId: PROJECT.id, activityCode: 'A100', p6ActivityId: null, name: 'Site clearance', wbsCode: '1 Substructure', category: 'civil', budget: 0, isMilestone: false, duration: 5, sortOrder: 0 },
  { id: 'h-A110', projectId: PROJECT.id, activityCode: 'A110', p6ActivityId: null, name: 'Excavation', wbsCode: '1 Substructure', category: 'civil', budget: 60000, isMilestone: false, duration: 10, sortOrder: 1 },
  { id: 'h-A120', projectId: PROJECT.id, activityCode: 'A120', p6ActivityId: null, name: 'Blinding', wbsCode: '1 Substructure', category: 'civil', budget: 0, isMilestone: false, duration: 3, sortOrder: 2 },
];

const pairs = (suggestion) =>
  suggestion.mappings.map((m) => [m.oldActivityId, m.newActivityKey, m.matchType, m.confidence]);
const unmappedIds = (suggestion) => suggestion.unmappedExisting.map((a) => a.id);
const newKeys = (suggestion) => suggestion.newActivities.map((a) => a.key);

const STATED_BY_US_ONLY = ['activityCode', 'budget', 'category', 'isMilestone'];

describe('T1 — the staging fact: a file states its code as p6ActivityId and states no code, budget, category or milestone flag', () => {
  it('at the parser, the XER task_id is sourceTaskId and task_code is p6ActivityId', () => {
    const parsed = extractActivities(parseXer(XER_F)).activities;
    expect(parsed[0]).toMatchObject({ sourceTaskId: '1001', p6ActivityId: 'A100', name: 'Site clearance', wbsCode: '1 Substructure', originalDuration: 5 });
    // The parser's name for the task id is sourceTaskId; it carries no sourceActivityId.
    expect(parsed[0]).not.toHaveProperty('sourceActivityId');
    for (const key of STATED_BY_US_ONLY) expect([key, Object.prototype.hasOwnProperty.call(parsed[0], key)]).toEqual([key, false]);
  });

  it('in the stored snapshot row, the task id is the draftKey and sourceActivityId (no sourceTaskId), the code is p6ActivityId, and none of the four keys is written', async () => {
    const { raw } = await stageXer(XER_F);
    expect(raw).toHaveLength(3);
    expect(raw[0]).toMatchObject({ draftKey: '1001', sourceActivityId: '1001', p6ActivityId: 'A100', name: 'Site clearance', wbsCode: '1 Substructure', duration: 5 });
    expect(raw[0]).not.toHaveProperty('sourceTaskId');
    for (const stored of raw) {
      for (const key of STATED_BY_US_ONLY) expect([stored.draftKey, key, Object.prototype.hasOwnProperty.call(stored, key)]).toEqual([stored.draftKey, key, false]);
    }
  });

  it('normalised for activation, the row reads activityCode null, budget 0, category null and isMilestone false', async () => {
    const { staged } = await stageXer(XER_F);
    expect(staged[0]).toMatchObject({
      draftKey: '1001', id: '1001', sourceActivityId: '1001', p6ActivityId: 'A100',
      activityCode: null, budget: 0, category: null, isMilestone: false,
    });
  });

  it('the 0 h M900 is staged with duration 0 and start = end, with no milestone flag', async () => {
    const { raw, staged } = await stageXer(XER_FM);
    const m900 = raw.find((stored) => stored.p6ActivityId === 'M900');
    expect(m900).toMatchObject({ draftKey: '1014', duration: 0 });
    expect(m900.startDate).toBe(m900.endDate);
    expect(m900).not.toHaveProperty('isMilestone');
    expect(staged.find((activity) => activity.draftKey === '1014').isMilestone).toBe(false);
  });
});

describe('suggestActivityMappings — identifiers before resemblance (H1)', () => {
  it('T2: every hand-built activity maps to the file row its code names, by activity_code at confidence 1; nothing unmapped, nothing new', async () => {
    const { staged } = await stageXer(XER_F);
    const suggestion = suggestActivityMappings(handBuilt(), staged);
    expect(pairs(suggestion)).toEqual([
      ['h-A100', '1001', 'activity_code', 1],
      ['h-A110', '1002', 'activity_code', 1],
      ['h-A120', '1003', 'activity_code', 1],
    ]);
    for (const mapping of suggestion.mappings) expect(mapping.oldActivity.activityCode).toBe(mapping.newActivity.p6ActivityId);
    expect([unmappedIds(suggestion), newKeys(suggestion)]).toEqual([[], []]);
  });

  it('T2b: the revision\'s own activityCode is looked up before the file code for the same code', () => {
    const staged = [
      { draftKey: 'S1', name: 'One', activityCode: 'C1', p6ActivityId: 'P-1', wbsCode: null, sortOrder: 0 },
      { draftKey: 'S2', name: 'Two', activityCode: null, p6ActivityId: 'C1', wbsCode: null, sortOrder: 1 },
    ];
    const suggestion = suggestActivityMappings([{ id: 'e1', name: 'x', activityCode: 'C1', p6ActivityId: null, wbsCode: null }], staged);
    expect(pairs(suggestion)).toEqual([['e1', 'S1', 'activity_code', 1]]);
  });

  it('T3: the code matches though the names differ (A110 named "Excavation by hand", no WBS)', async () => {
    const { staged } = await stageXer(XER_F);
    const existing = handBuilt().map((a) => (a.id === 'h-A110' ? { ...a, name: 'Excavation by hand', wbsCode: null } : a));
    const suggestion = suggestActivityMappings(existing, staged);
    expect(pairs(suggestion)).toContainEqual(['h-A110', '1002', 'activity_code', 1]);
    expect(unmappedIds(suggestion)).toEqual([]);
  });

  it('T4: an earlier activity\'s WBS code or name no longer takes the row a later activity\'s code names', async () => {
    const { staged } = await stageXer(XER_F);
    // X1 shares the file's WBS and comes first; X2 bears the file's A110 name.
    const x1 = { id: 'x1', projectId: PROJECT.id, activityCode: 'X1', p6ActivityId: null, name: 'Temporary works', wbsCode: '1 Substructure', sortOrder: 0 };
    const x2 = { id: 'x2', projectId: PROJECT.id, activityCode: null, p6ActivityId: null, name: 'Excavation', wbsCode: null, sortOrder: 0 };
    const suggestion = suggestActivityMappings([x1, x2, ...handBuilt()], staged);
    expect(pairs(suggestion)).toEqual([
      ['h-A100', '1001', 'activity_code', 1],
      ['h-A110', '1002', 'activity_code', 1],
      ['h-A120', '1003', 'activity_code', 1],
    ]);
    expect(unmappedIds(suggestion)).toEqual(['x1', 'x2']);
    expect(newKeys(suggestion)).toEqual([]);
  });

  it('T4b: an earlier activity\'s P6 id no longer takes the row a later activity\'s code names (Codex H1)', async () => {
    const { staged } = await stageXer(XER_F);
    const existing = [
      { id: 'x1', projectId: PROJECT.id, activityCode: 'X1', p6ActivityId: 'A100', name: 'Old clearance', wbsCode: null, sortOrder: 0 },
      { id: 'c-A100', projectId: PROJECT.id, activityCode: 'A100', p6ActivityId: null, name: 'Clearance', wbsCode: null, sortOrder: 1 },
    ];
    const suggestion = suggestActivityMappings(existing, staged);
    expect(pairs(suggestion)).toEqual([['c-A100', '1001', 'activity_code', 1]]);
    expect(unmappedIds(suggestion)).toEqual(['x1']);
    expect(newKeys(suggestion)).toEqual(['1002', '1003']);
  });

  it('T4c: an earlier activity\'s name no longer takes the row a later activity\'s P6 id names (Codex G1)', async () => {
    const { staged } = await stageXer(XER_F);
    // w1 bears the file's A110 name and comes first; p1 carries A110 as its P6 id.
    const w1 = { id: 'w1', projectId: PROJECT.id, activityCode: null, p6ActivityId: null, name: 'Excavation', wbsCode: null, sortOrder: 0 };
    const p1 = { id: 'p1', projectId: PROJECT.id, activityCode: null, p6ActivityId: 'A110', name: 'zzz', wbsCode: null, sortOrder: 1 };
    const suggestion = suggestActivityMappings([w1, p1], staged);
    expect(pairs(suggestion)).toEqual([['p1', '1002', 'p6_activity_id', 1]]);
    expect(unmappedIds(suggestion)).toEqual(['w1']);
    expect(newKeys(suggestion)).toEqual(['1001', '1003']);
  });

  it('T4d: an activity matched by its code is not matched again by its P6 id; the row its P6 id names stays new (Codex G2)', async () => {
    const { staged } = await stageXer(XER_F);
    const e1 = { id: 'e1', projectId: PROJECT.id, activityCode: 'A100', p6ActivityId: 'A110', name: 'zzz', wbsCode: null, sortOrder: 0 };
    const suggestion = suggestActivityMappings([e1], staged);
    expect(pairs(suggestion)).toEqual([['e1', '1001', 'activity_code', 1]]);
    expect(newKeys(suggestion)).toEqual(['1002', '1003']);
  });

  describe('T4e: a generated row\'s P6 id is no alias for a code (Codex R-H1)', () => {
    // The row states code G-A and, independently, P6 id G-X.
    const AI = [{ id: 'G-A', p6ActivityId: 'G-X', name: 'Columns', wbs: '2 Frame', phase: 'structural', duration: 6, budget: 80, isMilestone: false, critical: true }];
    const x = { id: 'x', projectId: PROJECT.id, activityCode: 'G-X', p6ActivityId: null, name: 'Other', wbsCode: null, sortOrder: 0 };
    const a = { id: 'a', projectId: PROJECT.id, activityCode: 'G-A', p6ActivityId: null, name: 'Another', wbsCode: null, sortOrder: 1 };

    it('the generated row states both identifiers', () => {
      const { staged } = generatedRevision(AI);
      // Its draftKey is its P6 id, G-X.
      expect(staged[0]).toMatchObject({ draftKey: 'G-X', activityCode: 'G-A', p6ActivityId: 'G-X' });
    });

    it('the activity whose code the row states takes it, though an earlier activity\'s code is the row\'s P6 id', () => {
      const { staged } = generatedRevision(AI);
      const suggestion = suggestActivityMappings([x, a], staged);
      expect(pairs(suggestion)).toEqual([['a', 'G-X', 'activity_code', 1]]);
      expect(unmappedIds(suggestion)).toEqual(['x']);
    });

    it('alone, the activity whose code is the row\'s P6 id is not matched to it by code', () => {
      const { staged } = generatedRevision(AI);
      const suggestion = suggestActivityMappings([x], staged);
      expect(pairs(suggestion)).toEqual([]);
      expect([unmappedIds(suggestion), newKeys(suggestion)]).toEqual([['x'], ['G-X']]);
    });
  });
});

describe('T5 — regression: where no code identifies anything, the suggestion is the one it was', () => {
  // HEAD's suggestActivityMappings (c5c79aa), one greedy pass over the active
  // activities trying code, P6 id, WBS code, name in turn. With no identifier
  // the new tiers reduce to its WBS-then-name pass.
  const normalizeNameKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  function headSuggestion(existingActivities, stagedActivities) {
    const unmatched = new Set(stagedActivities.map((s) => s.draftKey));
    const first = (keyOf) => {
      const map = new Map();
      for (const s of stagedActivities) {
        const key = keyOf(s);
        if (key && !map.has(key)) map.set(key, s);
      }
      return map;
    };
    const byCode = first((s) => s.activityCode);
    const byP6 = first((s) => s.p6ActivityId);
    const byWbs = first((s) => s.wbsCode);
    const byName = first((s) => normalizeNameKey(s.name));
    const mappings = [];
    for (const e of existingActivities) {
      const match = [
        [e.activityCode ? byCode.get(e.activityCode) : null, 'activity_code', 1],
        [e.p6ActivityId ? byP6.get(e.p6ActivityId) : null, 'p6_activity_id', 1],
        [e.wbsCode ? byWbs.get(e.wbsCode) : null, 'wbs_code', 0.92],
        [byName.get(normalizeNameKey(e.name)), 'name', 0.8],
      ].find(([s]) => s && unmatched.has(s.draftKey));
      if (!match) continue;
      unmatched.delete(match[0].draftKey);
      mappings.push([e.id, match[0].draftKey, match[1], match[2]]);
    }
    const mapped = new Set(mappings.map(([id]) => id));
    return {
      pairs: mappings,
      unmapped: existingActivities.filter((e) => !mapped.has(e.id)).map((e) => e.id),
      newKeys: stagedActivities.filter((s) => unmatched.has(s.draftKey)).map((s) => s.draftKey),
    };
  }
  const asHead = (suggestion) => ({ pairs: pairs(suggestion), unmapped: unmappedIds(suggestion), newKeys: newKeys(suggestion) });

  it('a P6 id still maps by p6_activity_id at confidence 1', async () => {
    const { staged } = await stageXer(XER_F);
    const suggestion = suggestActivityMappings([{ id: 'p1', activityCode: null, p6ActivityId: 'A110', name: 'zzz', wbsCode: null }], staged);
    expect(pairs(suggestion)).toEqual([['p1', '1002', 'p6_activity_id', 1]]);
  });

  it('the answer is in the active order, not the order the tiers matched in', async () => {
    const { staged } = await stageXer(XER_F);
    // p1 matches in the P6 tier, after h-A100 matched in the code tier.
    const existing = [
      { id: 'p1', activityCode: null, p6ActivityId: 'A110', name: 'zzz', wbsCode: null },
      { ...handBuilt()[0] },
    ];
    expect(pairs(suggestActivityMappings(existing, staged))).toEqual([
      ['p1', '1002', 'p6_activity_id', 1],
      ['h-A100', '1001', 'activity_code', 1],
    ]);
  });

  it('code-less hand-built activities against the file: WBS code, then name, exactly as before', async () => {
    const { staged } = await stageXer(XER_F);
    const existing = handBuilt().map((a) => ({ ...a, activityCode: null }));
    const suggestion = suggestActivityMappings(existing, staged);
    expect(pairs(suggestion)).toEqual([
      ['h-A100', '1001', 'wbs_code', 0.92],
      ['h-A110', '1002', 'name', 0.8],
      ['h-A120', '1003', 'name', 0.8],
    ]);
    expect(asHead(suggestion)).toEqual(headSuggestion(existing, staged));
  });

  it('a WBS-against-name contest resolves in the active order, as before', () => {
    const staged = [
      { draftKey: 'S1', name: 'Alpha', wbsCode: 'W1', activityCode: null, p6ActivityId: null, sortOrder: 0 },
      { draftKey: 'S2', name: 'Beta', wbsCode: 'W2', activityCode: null, p6ActivityId: null, sortOrder: 1 },
      { draftKey: 'S3', name: 'Gamma', wbsCode: null, activityCode: null, p6ActivityId: null, sortOrder: 2 },
    ];
    const existing = [
      { id: 'E1', name: 'Beta', wbsCode: 'W1', activityCode: null, p6ActivityId: null },
      { id: 'E2', name: 'Alpha', wbsCode: null, activityCode: null, p6ActivityId: null },
      { id: 'E3', name: 'alpha ', wbsCode: 'W2', activityCode: null, p6ActivityId: null },
      { id: 'E4', name: ' GAMMA', wbsCode: null, activityCode: null, p6ActivityId: null },
    ];
    const suggestion = suggestActivityMappings(existing, staged);
    expect(pairs(suggestion)).toEqual([
      ['E1', 'S1', 'wbs_code', 0.92],
      ['E3', 'S2', 'wbs_code', 0.92],
      ['E4', 'S3', 'name', 0.8],
    ]);
    expect(unmappedIds(suggestion)).toEqual(['E2']);
    expect(asHead(suggestion)).toEqual(headSuggestion(existing, staged));
    // The answer keeps the active order, whatever tier matched.
    const reversed = [...existing].reverse();
    expect(asHead(suggestActivityMappings(reversed, staged))).toEqual(headSuggestion(reversed, staged));
  });
});

describe('mappedActivityData — what a mapped activity keeps (H2, H3)', () => {
  it('T6: a file row keeps the activity\'s code A110, budget 60000 and category civil; the file gives the P6 id, name, duration and WBS', async () => {
    const { staged, rawByKey } = await stageXer(XER_F);
    const stagedA110 = staged.find((activity) => activity.draftKey === '1002');
    const existing = { ...handBuilt()[1], name: 'Excavation by hand', duration: 7, wbsCode: null };
    const data = mappedActivityData(stagedA110, rawByKey.get('1002'), existing, PROJECT.id);
    expect(data).toMatchObject({
      activityCode: 'A110', budget: 60000, category: 'civil', isMilestone: false,
      p6ActivityId: 'A110', name: 'Excavation', duration: 10, wbsCode: '1 Substructure',
      projectId: PROJECT.id, isActive: true,
    });
  });

  it('T7: the file\'s M900 keeps the activity\'s milestone flag and category inspection; the file gives duration 0', async () => {
    const { staged, rawByKey } = await stageXer(XER_FM);
    const stagedM900 = staged.find((activity) => activity.draftKey === '1014');
    const existing = { id: 'h-M900', projectId: PROJECT.id, activityCode: 'M900', p6ActivityId: null, name: 'M900', wbsCode: null, category: 'inspection', budget: 0, isMilestone: true, duration: 0, sortOrder: 3 };
    const data = mappedActivityData(stagedM900, rawByKey.get('1014'), existing, PROJECT.id);
    expect(data).toMatchObject({ activityCode: 'M900', isMilestone: true, category: 'inspection', budget: 0, duration: 0, p6ActivityId: 'M900' });
    // A file row states no flag: an activity that is no milestone stays none.
    const notMilestone = mappedActivityData(stagedM900, rawByKey.get('1014'), { ...existing, isMilestone: false }, PROJECT.id);
    expect(notMilestone.isMilestone).toBe(false);
  });

  it('T8: an activity with no code keeps none (the file code is not copied into it); its P6 id is the file\'s', async () => {
    const { staged, rawByKey } = await stageXer(XER_F);
    const existing = { ...handBuilt()[0], activityCode: null, category: null };
    const data = mappedActivityData(staged[0], rawByKey.get('1001'), existing, PROJECT.id);
    expect([data.activityCode, data.p6ActivityId, data.category]).toEqual([null, 'A100', null]);
  });

  it('T9b: a crossed file mapping keeps no code another row of the revision carries, so no two activities export as one (Codex R-M1)', async () => {
    const { staged, rawByKey } = await stageXer(XER_F);
    // A file row carries its code as its P6 id and states no activityCode.
    expect(staged.map((activity) => [activity.draftKey, activity.activityCode, activity.p6ActivityId])).toEqual([
      ['1001', null, 'A100'], ['1002', null, 'A110'], ['1003', null, 'A120'],
    ]);
    const rowsByCode = new Map([['A100', new Set(['1001'])], ['A110', new Set(['1002'])], ['A120', new Set(['1003'])]]);
    const byKey = new Map(staged.map((activity) => [activity.draftKey, activity]));
    // The PM maps the A100 activity onto the file's A110 row; the file's A100
    // row is another activity (created new, or mapped from another activity).
    const crossed = mappedActivityData(byKey.get('1002'), rawByKey.get('1002'), handBuilt()[0], PROJECT.id, rowsByCode);
    expect([crossed.activityCode, crossed.p6ActivityId]).toEqual([null, 'A110']);
    // The exports' identity (activityCode || p6ActivityId) is distinct.
    const identity = (activity) => activity.activityCode || activity.p6ActivityId;
    expect([identity(crossed), identity(byKey.get('1001'))]).toEqual(['A110', 'A100']);
    // Mapped onto the row that carries it, the activity keeps its code; a code
    // no row carries is kept too.
    expect(mappedActivityData(byKey.get('1001'), rawByKey.get('1001'), handBuilt()[0], PROJECT.id, rowsByCode).activityCode).toBe('A100');
    expect(mappedActivityData(byKey.get('1002'), rawByKey.get('1002'), { ...handBuilt()[0], activityCode: 'H-9' }, PROJECT.id, rowsByCode).activityCode).toBe('H-9');
  });

  describe('T9: a generated revision states the code, category and milestone flag — they replace the activity\'s; the budget is kept', () => {
    const AI = [
      { id: 'G-100', name: 'Frame complete', wbs: '2 Frame', phase: 'structural', duration: 0, budget: 120, isMilestone: true, critical: true },
      { id: 'G-200', name: 'Columns', wbs: '2 Frame', phase: 'structural', duration: 6, budget: 80, isMilestone: false, critical: true },
      { id: 'G-300', name: 'Beams', wbs: '2 Frame', phase: 'structural', duration: 4, budget: 50, isMilestone: false, critical: true },
    ];

    it('the generated rows state all four (the fixture is what the normaliser stores)', () => {
      const { raw } = generatedRevision(AI);
      expect(raw[0]).toMatchObject({ activityCode: 'G-100', budget: 120, category: 'structural', isMilestone: true });
      expect(typeof raw[1].isMilestone).toBe('boolean');
    });

    it('code, category and milestone flag come from the revision; the budget stays the activity\'s', () => {
      const { staged, rawByKey } = generatedRevision(AI);
      const existing = { ...handBuilt()[0], budget: 60000, category: 'civil', isMilestone: false };
      const data = mappedActivityData(staged[0], rawByKey.get('G-100'), existing, PROJECT.id);
      expect(data).toMatchObject({ activityCode: 'G-100', category: 'structural', isMilestone: true, budget: 60000 });
      // A stated false is the revision's too.
      const flagged = mappedActivityData(staged[1], rawByKey.get('G-200'), { ...existing, isMilestone: true }, PROJECT.id);
      expect(flagged.isMilestone).toBe(false);
    });

    it('a crossed manual mapping leaves no duplicate code: a mapped activity takes the revision\'s code (H2)', () => {
      const { staged, rawByKey } = generatedRevision(AI);
      const h1 = { ...handBuilt()[0], id: 'h1', activityCode: 'G-100' };
      const h2 = { ...handBuilt()[1], id: 'h2', activityCode: 'G-200' };
      // The PM crosses the suggestion: h1 → G-200, h2 → G-300; G-100 is left
      // unmapped and is created new with its own code (activityDataFromStaged).
      const byKey = new Map(staged.map((activity) => [activity.draftKey, activity]));
      const codes = [
        mappedActivityData(byKey.get('G-200'), rawByKey.get('G-200'), h1, PROJECT.id).activityCode,
        mappedActivityData(byKey.get('G-300'), rawByKey.get('G-300'), h2, PROJECT.id).activityCode,
        byKey.get('G-100').activityCode,
      ];
      expect(codes).toEqual(['G-200', 'G-300', 'G-100']);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  it('T10: the update carries no relation key and nothing of the activity row beyond the kept fields', async () => {
    const { staged, rawByKey } = await stageXer(XER_F);
    const existing = {
      ...handBuilt()[1],
      orgId: 'org-1',
      assignments: [{ userId: 'u-1' }],
      progress: [{ id: 'progress-1', pctComplete: 100 }],
      progressMethod: { method: 'percent' },
      boqAllocations: [{ id: 'alloc-1' }],
      costLoadings: [{ id: 'loading-1' }],
      locationId: 'location-1',
      wbsNodeId: 'wbs-node-1',
      mintedByBoqItemId: 'boq-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const data = mappedActivityData(staged[1], rawByKey.get('1002'), existing, PROJECT.id);
    for (const key of ['id', 'orgId', 'assignments', 'progress', 'progressMethod', 'boqAllocations', 'costLoadings', 'locationId', 'wbsNodeId', 'mintedByBoqItemId', 'createdAt', 'updatedAt']) {
      expect([key, Object.prototype.hasOwnProperty.call(data, key)]).toEqual([key, false]);
    }
    // The scalar columns a new activity is created with, and no other.
    expect(Object.keys(data).sort()).toEqual(
      [
        'projectId', 'name', 'activityCode', 'p6ActivityId', 'wbsCode', 'calendarId', 'category', 'startDate', 'endDate',
        'duration', 'originalDuration', 'remainingDuration', 'physComplete', 'earlyStart', 'earlyFinish', 'lateStart',
        'lateFinish', 'totalFloat', 'budget', 'isMilestone', 'isCritical', 'predecessors', 'batchId', 'isActive',
        'retiredAt', 'retiredBy', 'retiredReason', 'retiredRevisionId', 'sortOrder',
      ].sort(),
    );
  });
});
