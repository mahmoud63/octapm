/**
 * CERT-2 (group trivial-7): a schedule file's durations, float and lags are a
 * programme's — at most 36,500 days either way, as the activity routes take
 * them — in every format (they share import.service buildImportSnapshot).
 * They were staged as given and taken live on activation.
 */
const XLSX = require('@e965/xlsx');

const mockProject = { id: 'project-1', orgId: 'org-1', startDate: new Date('2026-01-05T00:00:00.000Z'), projectCalendar: 'five_day' };
const mockTx = {
  scheduleRevision: { findMany: jest.fn(async () => []), update: jest.fn(), create: jest.fn(async ({ data }) => ({ id: 'revision-1', ...data })) },
};
jest.mock('../../config/db', () => ({
  prisma: {
    project: { findFirst: jest.fn(async () => mockProject) },
    $transaction: jest.fn(async (fn) => fn(mockTx)),
  },
}));
jest.mock('../post-import.service', () => ({ runPostImportSeeding: jest.fn() }));
jest.mock('../progress.service', () => ({}));

const importService = require('../import.service');

const workbook = (rows) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['activity_code', 'name', 'duration_days', 'predecessors'], ...rows]), 'Schedule');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
};
const dryRun = (rows) => importService.importScheduleXlsx({ projectId: 'project-1', orgId: 'org-1', input: workbook(rows), dryRun: true });

const xer = (tasks, preds = []) => [
  'ERMHDR\t19.12',
  '%T\tPROJWBS',
  '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num',
  '%R\tW1\t\tP\tProgramme\t1',
  '%T\tTASK',
  '%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct',
  ...tasks.map(([id, code, hours, floatHours = 0]) => `%R\t${id}\t${code}\tTask ${code}\tW1\t${hours}\t${hours}\t2026-01-05 08:00\t2026-01-09 17:00\t2026-01-05 08:00\t2026-01-09 17:00\t${floatHours}\t0`),
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  ...preds.map(([id, task, pred, lagHours]) => `%R\t${id}\t${task}\t${pred}\tPR_FS\t${lagHours}`),
  '%E',
  '',
].join('\n');
const importXer = (content) => importService.importXer({ projectId: 'project-1', orgId: 'org-1', xerContent: content });

describe('schedule import figures (CERT-2 trivial-7)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('xlsx: durations and lags up to 36,500 days are staged', async () => {
    const report = await dryRun([['A1', 'Dig', 36_500, ''], ['A2', 'Pour', 5, 'A1 FS+36500']]);
    expect(report).toMatchObject({ dryRun: true, activityCount: 2, dependencyCount: 1 });
  });

  it('xlsx: a duration or a lag past 36,500 days is refused whole, 400 SCHEDULE_FIGURE_OUT_OF_RANGE naming it', async () => {
    await expect(dryRun([['A1', 'Dig', 36_501, ''], ['A2', 'Pour', 5, '']])).rejects.toMatchObject({
      status: 400,
      code: 'SCHEDULE_FIGURE_OUT_OF_RANGE',
      details: { problemCount: 1, problems: [{ activity: 'A1', fields: ['duration', 'originalDuration', 'remainingDuration'], values: { duration: 36_501, originalDuration: 36_501, remainingDuration: 36_501 } }] },
    });
    await expect(dryRun([['A1', 'Dig', 2, ''], ['A2', 'Pour', 5, 'A1 FS+40000']])).rejects.toMatchObject({
      code: 'SCHEDULE_FIGURE_OUT_OF_RANGE',
      details: { problemCount: 1, problems: [expect.objectContaining({ fields: ['lagDays'], values: { lagDays: 40_000 } })] },
    });
  });

  it('XER: 36,500 days (292,000 hours) is staged; a duration, a float or a lag past it is refused before anything is written', async () => {
    const staged = await importXer(xer([['T1', 'A1', 292_000], ['T2', 'A2', 40]], [['P1', 'T2', 'T1', 8]]));
    expect(staged).toMatchObject({ staged: true, imported: 2, dependencyCount: 1 });
    for (const [label, content] of [
      ['duration', xer([['T1', 'A1', 292_008], ['T2', 'A2', 40]])],
      ['float', xer([['T1', 'A1', 40, 8_000_000], ['T2', 'A2', 40]])],
      ['lag', xer([['T1', 'A1', 40], ['T2', 'A2', 40]], [['P1', 'T2', 'T1', 400_000]])],
      ['duration of 10^9 days', xer([['T1', 'A1', 8e9], ['T2', 'A2', 40]])],
    ]) {
      mockTx.scheduleRevision.create.mockClear();
      await expect(importXer(content)).rejects.toMatchObject({ status: 400, code: 'SCHEDULE_FIGURE_OUT_OF_RANGE' });
      expect([label, mockTx.scheduleRevision.create.mock.calls.length]).toEqual([label, 0]);
    }
  });
});
