const { collectDateWarnings } = require('../activity.service');

const project = {
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
};

describe('collectDateWarnings', () => {
  it('returns no warnings when activity dates sit inside the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-03-01'),
    });
    expect(w).toEqual([]);
  });

  it('warns when the activity starts before the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2025-12-01'),
      endDate: new Date('2026-03-01'),
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/before the project/i);
  });

  it('warns when the activity ends after the project', () => {
    const w = collectDateWarnings({
      project,
      startDate: new Date('2026-02-01'),
      endDate: new Date('2027-01-15'),
    });
    expect(w[0]).toMatch(/after the project/i);
  });
});
