const {
  deriveActivityPrefix,
  formatActivityCode,
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
