/**
 * The legacy daily report (/daily-reports) carries the progress writer's
 * warnings (verification finding, 2026-10-01: a typed figure below the
 * official one, created through a daily report and approved, lowered the
 * official figure — and so EV — with no QUANTITY_BELOW_OFFICIAL on either
 * answer, while the activity route and bulk warned). The warnings are
 * transient on the submission the progress service answers with; the report
 * is read again from the database, so they are carried onto the matching
 * progressSubmissions[i].warnings of the create, submit and approve answers.
 * The withholding of their figures is boq-figures.daily-report's (proven
 * there and live in pc-6-daily-report-withholding).
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  dailyReport: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  projectDocument: { findMany: jest.fn(async () => []), updateMany: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => ({
  recordEvent: jest.fn(async () => null),
  ENTITY_TYPES: { DAILY_REPORT: 'daily_report' },
  ACTIONS: { CREATED: 'created', APPROVED: 'approved', STATUS_CHANGED: 'status_changed' },
}));
jest.mock('../equipment.service', () => ({
  postDailyReportEquipmentUsage: jest.fn(async () => ({ usages: [], equipmentCost: 0, posted: false })),
}));
jest.mock('../progress.service', () => ({
  // The report's photos go through the evidence check (CERT-2); none here.
  prepareEvidence: jest.fn(async ({ evidence }) => evidence),
  createProgressSubmission: jest.fn(),
  approveProgressSubmissionWithClient: jest.fn(),
  serializeSubmission: (row) => ({ id: row.id, status: row.status, method: row.method, pctComplete: row.pctComplete }),
}));

const progressService = require('../progress.service');
const dailyReportService = require('../daily-report.service');

const BELOW = { code: 'QUANTITY_BELOW_OFFICIAL', officialInstalled: 300, typed: 120, message: 'approving it lowers the official installed figure to the typed one' };
const reportRow = (status, submissionStatus) => ({
  id: 'report-1',
  projectId: 'project-1',
  activityId: 'activity-1',
  date: new Date('2026-02-24'),
  status,
  photosJson: [],
  progressSubmissions: [
    { id: 'submission-1', status: submissionStatus, method: 'quantity', pctComplete: 30 },
    { id: 'submission-0', status: 'rejected', method: 'quantity', pctComplete: 10 },
  ],
});

describe('daily report answers carry the progress writer warnings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', orgId: 'org-1' });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: 'project-1', isActive: true });
  });

  it('create: the linked submission answers QUANTITY_BELOW_OFFICIAL, and the report answer carries it on that submission only', async () => {
    mockPrisma.dailyReport.create.mockResolvedValue({ ...reportRow('submitted', 'submitted'), progressSubmissions: undefined });
    mockPrisma.dailyReport.findFirst.mockImplementation(async ({ where }) => (where.clientRequestId ? null : reportRow('submitted', 'submitted')));
    progressService.createProgressSubmission.mockResolvedValue({ id: 'submission-1', status: 'submitted', warnings: [BELOW] });
    const answer = await dailyReportService.createDailyReport({
      orgId: 'org-1', projectId: 'project-1', userId: 'site-1', userRole: 'site_engineer',
      payload: { activityId: 'activity-1', date: '2026-02-24', progress: { method: 'quantity', quantityComplete: 120 } },
    });
    expect(answer.progressSubmissions).toEqual([
      { id: 'submission-1', status: 'submitted', method: 'quantity', pctComplete: 30, warnings: [BELOW] },
      { id: 'submission-0', status: 'rejected', method: 'quantity', pctComplete: 10 },
    ]);
  });

  it('approve (and review, the same service call): the one writer answers QUANTITY_BELOW_OFFICIAL, and the report answer carries it', async () => {
    mockPrisma.dailyReport.findFirst.mockResolvedValue(reportRow('submitted', 'submitted'));
    mockPrisma.dailyReport.update.mockResolvedValue(reportRow('approved', 'approved'));
    progressService.approveProgressSubmissionWithClient.mockResolvedValue({ id: 'submission-1', status: 'approved', warnings: [BELOW] });
    const answer = await dailyReportService.approveDailyReport({ orgId: 'org-1', projectId: 'project-1', reportId: 'report-1', userId: 'pm-1', userRole: 'pm' });
    expect(progressService.approveProgressSubmissionWithClient).toHaveBeenCalledTimes(1);
    expect(answer.progressSubmissions[0]).toEqual({ id: 'submission-1', status: 'approved', method: 'quantity', pctComplete: 30, warnings: [BELOW] });
    expect(answer.progressSubmissions[1].warnings).toBeUndefined();
  });

  it('an approval with no warning adds none', async () => {
    mockPrisma.dailyReport.findFirst.mockResolvedValue(reportRow('submitted', 'submitted'));
    mockPrisma.dailyReport.update.mockResolvedValue(reportRow('approved', 'approved'));
    progressService.approveProgressSubmissionWithClient.mockResolvedValue({ id: 'submission-1', status: 'approved' });
    const answer = await dailyReportService.approveDailyReport({ orgId: 'org-1', projectId: 'project-1', reportId: 'report-1', userId: 'pm-1', userRole: 'pm' });
    for (const submission of answer.progressSubmissions) expect(submission.warnings).toBeUndefined();
  });
});
