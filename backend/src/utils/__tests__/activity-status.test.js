const { STATUSES, deriveActivityStatus } = require('../activity-status');

const PAST = '2020-03-01';
const FUTURE = '2099-03-01';

describe('activity status', () => {
  it('reads nothing done as to do', () => {
    expect(deriveActivityStatus(0, FUTURE)).toBe('todo');
  });

  it('reads part done as in progress', () => {
    expect(deriveActivityStatus(40, FUTURE)).toBe('in_progress');
  });

  it('reads all done as complete', () => {
    expect(deriveActivityStatus(100, FUTURE)).toBe('complete');
  });

  it('reads nothing done and overdue as delayed', () => {
    expect(deriveActivityStatus(0, PAST)).toBe('delayed');
  });

  /**
   * The case the four separate copies of this rule disagreed about, and the
   * one that matters: work under way that has run past its finish date. Three
   * of them answered "in progress", which is true and useless — every late
   * activity that anybody has touched disappeared from the delayed count.
   */
  it('reads part done and overdue as delayed, not merely in progress', () => {
    expect(deriveActivityStatus(40, PAST)).toBe('delayed');
    expect(deriveActivityStatus(99, PAST)).toBe('delayed');
  });

  it('leaves finished work finished, however late it was', () => {
    expect(deriveActivityStatus(100, PAST)).toBe('complete');
  });

  it('says nothing about lateness when there is no finish date', () => {
    expect(deriveActivityStatus(40, null)).toBe('in_progress');
    expect(deriveActivityStatus(0, null)).toBe('todo');
  });

  it('judges lateness against the moment it is given', () => {
    const before = new Date('2020-02-01');
    const after = new Date('2020-04-01');
    expect(deriveActivityStatus(40, PAST, before)).toBe('in_progress');
    expect(deriveActivityStatus(40, PAST, after)).toBe('delayed');
  });

  it('only ever answers with a status the API documents', () => {
    const answers = [
      deriveActivityStatus(0, PAST),
      deriveActivityStatus(40, PAST),
      deriveActivityStatus(100, PAST),
      deriveActivityStatus(0, FUTURE),
      deriveActivityStatus(40, FUTURE),
      deriveActivityStatus(100, FUTURE),
    ];
    for (const answer of answers) expect(STATUSES).toContain(answer);
  });
});
