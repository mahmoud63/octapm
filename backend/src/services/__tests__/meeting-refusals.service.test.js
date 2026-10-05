/**
 * CERT-2 (group evidence-lines-5): a meeting's refusals do not hand back the
 * ids they were sent.
 *
 * MEETING_USER_INVALID listed { userIds }, MEETING_PARTY_INVALID
 * { projectPartyIds }, MEETING_TASK_INVALID { taskIds }, and the distribution
 * refusals MEETING_DISTRIBUTION_USER_INVALID / _PARTY_INVALID theirs — another
 * company's ids in the answer, as MEETING_ACTIVITY_INVALID once did. Each
 * refusal now carries no details: the answer is the same whichever id is
 * missing, another company's or one that exists nowhere.
 */
const { referenceCounterMock } = require('./helpers/reference-counter-mock');

const mockPrisma = {
  ...referenceCounterMock(),
  $transaction: jest.fn((callback) => callback(mockPrisma)),
  meeting: { count: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  meetingAttendee: { createMany: jest.fn(), deleteMany: jest.fn() },
  meetingAgendaItem: { createMany: jest.fn(), deleteMany: jest.fn() },
  meetingDecision: { createMany: jest.fn(), deleteMany: jest.fn() },
  meetingActionItem: { create: jest.fn(), deleteMany: jest.fn(), update: jest.fn() },
  meetingDistribution: { create: jest.fn() },
  meetingComment: { create: jest.fn() },
  activity: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  projectParty: { findMany: jest.fn() },
  task: { findMany: jest.fn() },
  auditEvent: { create: jest.fn() },
  recordHistorySnapshot: { create: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../notification.service', () => ({ NOTIFICATION_CATEGORIES: { WORKFLOW: 'workflow' }, createNotifications: jest.fn() }));
jest.mock('../task.service', () => ({ createTask: jest.fn() }));
jest.mock('../project-authorization.service', () => ({ assertProjectAccess: jest.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', role: 'pm' })) }));

const meetingService = require('../meeting.service');

const orgId = 'org-1';
const projectId = '22222222-2222-4222-8222-222222222222';
const meetingId = '33333333-3333-4333-8333-333333333333';
const FOREIGN = '99999999-9999-4999-8999-999999999999';
const NOWHERE = '88888888-8888-4888-8888-888888888888';

const create = (payload) => meetingService.createMeeting({ orgId, projectId, payload: { title: 'Coordination', ...payload }, userId: 'creator-1', userRole: 'pm' });
const update = (payload) => meetingService.updateMeeting({ orgId, projectId, meetingId, payload, userId: 'creator-1', userRole: 'pm' });
const distribute = (payload) => meetingService.distributeMeeting({ orgId, projectId, meetingId, payload, userId: 'creator-1', userRole: 'pm' });
const answerOf = (error, id) => JSON.stringify([error.status, error.code, error.message, error.details ?? null]).split(id).join('<sent>');

const meetingRow = () => ({
  id: meetingId, orgId, projectId, meetingNumber: 'MTG-0001', title: 'Coordination', meetingType: 'coordination', status: 'draft', activityId: null,
  attendees: [], agendaItems: [], decisions: [], actionItems: [], distributions: [], comments: [],
  createdAt: new Date('2026-06-12T12:00:00.000Z'), updatedAt: new Date('2026-06-12T12:00:00.000Z'),
});

describe('meeting refusals carry no ids (CERT-2, evidence-lines-5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
    // Nothing the requests name is this project's.
    mockPrisma.activity.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.projectParty.findMany.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.meeting.findFirst.mockResolvedValue(meetingRow());
  });

  it.each([
    ['an attendee person', (id) => ({ attendees: [{ userId: id, name: 'x' }] }), 'MEETING_USER_INVALID'],
    ['the chair', (id) => ({ chairId: id }), 'MEETING_USER_INVALID'],
    ['an action item owner', (id) => ({ actionItems: [{ title: 't', ownerId: id, dueDate: '2026-06-20' }] }), 'MEETING_USER_INVALID'],
    ['an attendee party', (id) => ({ attendees: [{ projectPartyId: id, name: 'x' }] }), 'MEETING_PARTY_INVALID'],
    ['an action item task', (id) => ({ actionItems: [{ title: 't', ownerName: 'o', dueDate: '2026-06-20', taskId: id }] }), 'MEETING_TASK_INVALID'],
  ])('%s: refused without the id, another company\'s and a nowhere id alike (create and update)', async (_label, payload, code) => {
    const answers = [];
    for (const id of [FOREIGN, NOWHERE]) {
      for (const send of [create, update]) {
        const error = await send(payload(id)).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code });
        expect(error.details).toBeUndefined();
        expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(id);
        answers.push(answerOf(error, id));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.meeting.create).not.toHaveBeenCalled();
    expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
  });

  it.each([
    ['userIds', (id) => ({ userIds: [id] }), 'MEETING_DISTRIBUTION_USER_INVALID'],
    ['recipientUserIds', (id) => ({ recipientUserIds: [id] }), 'MEETING_DISTRIBUTION_USER_INVALID'],
    ['projectPartyIds', (id) => ({ projectPartyIds: [id] }), 'MEETING_DISTRIBUTION_PARTY_INVALID'],
    ['partyIds', (id) => ({ partyIds: [id] }), 'MEETING_DISTRIBUTION_PARTY_INVALID'],
  ])('distribution to %s outside the project: refused without the id, another company\'s and a nowhere id alike', async (_label, payload, code) => {
    const answers = [];
    for (const id of [FOREIGN, NOWHERE]) {
      const error = await distribute(payload(id)).catch((thrown) => thrown);
      expect(error).toMatchObject({ status: 400, code });
      expect(error.details).toBeUndefined();
      answers.push(answerOf(error, id));
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.meetingDistribution.create).not.toHaveBeenCalled();
  });
});
