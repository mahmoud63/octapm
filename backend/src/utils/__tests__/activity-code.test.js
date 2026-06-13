const {
  deriveActivityPrefix,
  formatActivityCode,
  nextActivityCode,
} = require('../activity-code');

describe('deriveActivityPrefix', () => {
  it('takes the first two letters of the first word', () => {
    expect(deriveActivityPrefix('Concrete Works')).toBe('CO');
    expect(deriveActivityPrefix('Steel Works')).toBe('ST');
  });

  it('uppercases regardless of input casing', () => {
    expect(deriveActivityPrefix('concrete works')).toBe('CO');
  });

  it('pads a single-letter first word with X', () => {
    expect(deriveActivityPrefix('A frame')).toBe('AX');
  });

  it('falls back to AC when no letters are present', () => {
    expect(deriveActivityPrefix('123')).toBe('AC');
    expect(deriveActivityPrefix('')).toBe('AC');
    expect(deriveActivityPrefix(null)).toBe('AC');
  });

  it('ignores leading non-letters in the first word', () => {
    expect(deriveActivityPrefix('1.2 Excavation')).toBe('EX');
  });
});

describe('formatActivityCode', () => {
  it('zero-pads the sequence to three digits', () => {
    expect(formatActivityCode('CO', 1)).toBe('CO-001');
    expect(formatActivityCode('ST', 42)).toBe('ST-042');
    expect(formatActivityCode('CO', 1000)).toBe('CO-1000');
  });
});

describe('nextActivityCode', () => {
  it('counts existing first-class activity codes before legacy fallbacks', async () => {
    const tx = {
      activity: {
        findMany: jest.fn().mockResolvedValue([
          { activityCode: 'EX-003', p6ActivityId: null, wbsCode: null },
          { activityCode: null, p6ActivityId: 'EX-002', wbsCode: null },
          { activityCode: null, p6ActivityId: null, wbsCode: 'EX-001' },
        ]),
      },
    };

    await expect(nextActivityCode('project-1', 'Excavation', tx)).resolves.toBe(
      'EX-004',
    );

    expect(tx.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { activityCode: { startsWith: 'EX-' } },
          ]),
        }),
        select: { activityCode: true, p6ActivityId: true, wbsCode: true },
      }),
    );
  });
});
