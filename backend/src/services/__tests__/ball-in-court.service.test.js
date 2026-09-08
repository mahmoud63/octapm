const { ballInCourt, SUPPORTED, WAITING } = require('../ball-in-court.service');

/**
 * Whose move it is (OCTA-UX-BALLINCOURT-087).
 *
 * The point of these is that the answer is derived. A stored "next action"
 * drifts the moment somebody transitions a record by another route, and a label
 * typed onto a screen drifts the moment the workflow changes — both were found
 * in the UX phases of this programme.
 */
describe('whose move it is', () => {
  const pm = { role: 'pm' };
  const buyer = { role: 'procurement' };
  const storeman = { role: 'warehouse' };

  it('names the party a record is waiting on', () => {
    const result = ballInCourt('purchase_order', { status: 'pending_approval' }, buyer);
    expect(result.state).toBe('awaiting');
    expect(result.label).toBe('Awaiting the project manager — approval');
    expect(result.party.role).toBe('pm');
  });

  it('says it is yours when you are the one who can act', () => {
    const result = ballInCourt('purchase_order', { status: 'pending_approval' }, pm);
    expect(result.state).toBe('yours');
    expect(result.label).toBe('Your action');
  });

  /**
   * The roles come from the permission policy, not from a second list here.
   * A buyer may submit a draft order, so a draft is theirs; a storeman may not,
   * so for them the same record names procurement.
   */
  it('takes the roles from the permission policy that will decide the request', () => {
    expect(ballInCourt('purchase_order', { status: 'draft' }, buyer).state).toBe('yours');
    const forStoreman = ballInCourt('purchase_order', { status: 'draft' }, storeman);
    expect(forStoreman.state).toBe('awaiting');
    expect(forStoreman.action.roles).toEqual(expect.arrayContaining(['procurement', 'pm']));
  });

  it('never claims a finished record is waiting on anybody', () => {
    for (const status of ['closed', 'cancelled']) {
      const result = ballInCourt('purchase_order', { status }, pm);
      expect(result.state).toBe('none');
      expect(result.label).toBeNull();
    }
  });

  it('names the actual company when the record knows one', () => {
    const result = ballInCourt(
      'purchase_order',
      { status: 'issued' },
      buyer,
      { name: 'Alpha Cladding' },
    );
    expect(result.label).toContain('Alpha Cladding');
  });

  it('falls back to the trade when no company is named', () => {
    const result = ballInCourt('purchase_order', { status: 'issued' }, buyer);
    expect(result.label).toBe('Awaiting the supplier to acknowledge');
  });

  /**
   * The label is what a person reads. Permission codes are ours.
   */
  it('never puts a permission code in front of a user', () => {
    for (const type of SUPPORTED) {
      for (const status of Object.keys(WAITING[type])) {
        const { label, action } = ballInCourt(type, { status }, pm);
        if (label) expect(label).not.toMatch(/\.[a-z_]+\b/);
        // The transition is still available to the UI, just not as text.
        if (action) expect(action.transition).toMatch(/^[a-z_]+\.[a-z_]+$/);
      }
    }
  });

  it('says nothing rather than guessing about a record it does not know', () => {
    const result = ballInCourt('space_station', { status: 'orbiting' }, pm);
    expect(result.state).toBe('none');
    expect(result.label).toBeNull();
  });

  it('says nothing about a state that is not in the table', () => {
    const result = ballInCourt('purchase_order', { status: 'teleported' }, pm);
    expect(result.state).toBe('none');
  });

  it('covers every handoff the programme has asked about', () => {
    expect(ballInCourt('sub_pay_app', { status: 'submitted' }, buyer).label).toMatch(/QS/);
    expect(ballInCourt('sub_pay_app', { status: 'approved' }, buyer).label).toMatch(/finance/i);
    expect(ballInCourt('bid_package', { status: 'closed' }, buyer).label).toMatch(/project manager/i);
    expect(ballInCourt('commitment', { status: 'pending' }, buyer).label).toMatch(/project manager/i);
    expect(ballInCourt('direct_cost', { status: 'pending' }, buyer).label).toMatch(/project manager/i);
    expect(ballInCourt('long_lead_item', { status: 'ordered' }, buyer).label).toMatch(/delivery/i);
  });
});
