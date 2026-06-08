const { PLANS, planRank, getVisiblePlanIds, getPrice } = require('../plans');

describe('plan catalog', () => {
  it('ranks plans low→high', () => {
    expect(planRank('trial')).toBeLessThan(planRank('individual'));
    expect(planRank('individual')).toBeLessThan(planRank('business'));
    expect(planRank('business')).toBeLessThan(planRank('enterprise'));
  });

  it('annual price is 20% off monthly', () => {
    expect(getPrice('individual', 'monthly')).toBe(49);
    expect(getPrice('individual', 'annual')).toBe(39);
    expect(getPrice('business', 'monthly')).toBe(499);
    expect(getPrice('business', 'annual')).toBe(399);
  });
});

describe('getVisiblePlanIds', () => {
  it('shows all three paid tiers for a user with no active plan', () => {
    expect(getVisiblePlanIds(null)).toEqual(['individual', 'business', 'enterprise']);
    expect(getVisiblePlanIds('trial')).toEqual(['individual', 'business', 'enterprise']);
  });

  it('shows current + next-higher only for an active subscriber', () => {
    expect(getVisiblePlanIds('individual')).toEqual(['individual', 'business']);
    expect(getVisiblePlanIds('business')).toEqual(['business', 'enterprise']);
  });

  it('shows only the current plan at the highest tier', () => {
    expect(getVisiblePlanIds('enterprise')).toEqual(['enterprise']);
  });
});
