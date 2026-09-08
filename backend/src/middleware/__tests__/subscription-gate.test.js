const mockPrisma = { project: { count: jest.fn() } };
const mockSubscription = { ensureSubscription: jest.fn(), isExpired: jest.fn(() => false) };

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../../services/subscription.service', () => mockSubscription);

const { enforceProjectLimit } = require('../subscription-gate');

/**
 * The project limit (OCTA-BILL-PLAN-072).
 *
 * `PLANS[sub.plan]?.projectLimit ?? 0` turned a plan id the catalogue does not
 * contain into an allowance of nought — and since `count >= 0` is always true,
 * such an organisation could never create a project again, while being told to
 * upgrade. The seeded demo and UAT organisations were in exactly that state, on
 * a plan called "standard" that has never existed.
 */
describe('project limit', () => {
  const run = async (sub, projectCount = 0) => {
    mockSubscription.ensureSubscription.mockResolvedValue(sub);
    mockPrisma.project.count.mockResolvedValue(projectCount);
    const next = jest.fn();
    await enforceProjectLimit({ user: { orgId: 'org-1' } }, {}, next);
    return next.mock.calls[0][0] ?? null;
  };

  beforeEach(() => jest.clearAllMocks());

  it('lets a plan create projects up to its limit', async () => {
    expect(await run({ plan: 'business' }, 24)).toBeNull();
  });

  it('refuses once the plan is full, and names the plan', async () => {
    const error = await run({ plan: 'individual' }, 3);
    expect(error).toMatchObject({ status: 402, code: 'PROJECT_LIMIT_REACHED' });
    expect(error.message).toContain('Individual');
    expect(error.message).toContain('3 project');
  });

  it('never limits an unlimited plan', async () => {
    expect(await run({ plan: 'enterprise' }, 10_000)).toBeNull();
  });

  /**
   * The behaviour this exists for. An unknown plan is our data being wrong, and
   * saying "your plan allows 0, upgrade" is both false and unactionable.
   */
  it('calls an unknown plan a fault of ours, not a limit of theirs', async () => {
    const error = await run({ plan: 'standard' }, 0);
    expect(error).toMatchObject({ status: 500, code: 'SUBSCRIPTION_PLAN_UNKNOWN' });
    expect(error.message).toContain('standard');
    expect(error.message).not.toMatch(/upgrade/i);
    // And it must not be reported as a limit, at any project count.
    expect(error.code).not.toBe('PROJECT_LIMIT_REACHED');
  });

  it('does not brick an organisation on an unknown plan with a plausible number', async () => {
    const error = await run({ plan: 'legacy-gold' }, 7);
    expect(error.code).toBe('SUBSCRIPTION_PLAN_UNKNOWN');
  });

  /**
   * Deleting a project archives it, and the project list hides archived ones.
   * Counting them against the allowance anyway meant archiving gave nothing
   * back: an organisation could see three projects and be told it had used all
   * twenty-five, with no way to find the rest because nothing shows them.
   */
  it('counts only live projects, so archiving frees a place', async () => {
    await run({ plan: 'business' }, 24);
    expect(mockPrisma.project.count).toHaveBeenCalledWith({
      where: { orgId: 'org-1', archivedAt: null },
    });
  });

  it('says how many are live, so the refusal can be acted on', async () => {
    const error = await run({ plan: 'business' }, 25);
    expect(error.code).toBe('PROJECT_LIMIT_REACHED');
    expect(error.message).toContain('25 are live');
    expect(error.message).toMatch(/archiv/i);
  });
});
