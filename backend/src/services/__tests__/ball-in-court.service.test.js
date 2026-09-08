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

  it('does not tell a PM that everything is their action', () => {
    // The permission policy lets a PM make nearly every transition, so
    // deriving "yours" from it put "Your action" on every row of every
    // register a PM opened. Whose turn it is comes from the workflow; what
    // they may do comes from the policy (OCTA-UX-BIC-097).
    const pm = { role: 'pm' };
    const qs = { role: 'qs' };

    const draft = ballInCourt('commitment', { status: 'draft' }, pm);
    expect(draft.state).toBe('awaiting');
    expect(draft.label).toBe('Awaiting the QS — to be sent for approval');
    // ...but a PM may still submit it, and the button hangs on this.
    expect(draft.canAct).toBe(true);
    expect(draft.action.roles).toContain('pm');

    // It is the QS's turn, and the QS is told so.
    expect(ballInCourt('commitment', { status: 'draft' }, qs).label).toBe('Your action');

    // And where the PM genuinely is the party, they are still told.
    const pending = ballInCourt('commitment', { status: 'pending' }, pm);
    expect(pending.label).toBe('Your action');
    expect(pending.isYou).toBe(true);

    // A QS cannot approve it, and is not told it is theirs.
    const forQs = ballInCourt('commitment', { status: 'pending' }, qs);
    expect(forQs.label).toBe('Awaiting the project manager — approval');
    expect(forQs.canAct).toBe(false);
  });

  it('does not name the vendor on a record waiting on one of our own roles', () => {
    // Every caller has a vendor to hand and no way to know when it is the
    // wrong answer, so the service refuses it rather than trusting them.
    // Before this, an approved claim read "Awaiting E2E Concrete — payment"
    // when it was waiting on finance (OCTA-UX-BIC-096).
    const named = { name: 'Meridian Piling' };
    const approved = ballInCourt('sub_pay_app', { status: 'approved' }, null, named);
    expect(approved.label).toBe('Awaiting finance — payment');
    expect(approved.party.label).not.toMatch(/Meridian/);

    const draftCommitment = ballInCourt('commitment', { status: 'draft' }, null, named);
    expect(draftCommitment.label).toMatch(/QS/i);
    expect(draftCommitment.label).not.toMatch(/Meridian/);

    // And still uses it where the external party really is the one waiting.
    const draftClaim = ballInCourt('sub_pay_app', { status: 'draft' }, null, named);
    expect(draftClaim.label).toBe('Awaiting Meridian Piling — the claim to be submitted');
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
