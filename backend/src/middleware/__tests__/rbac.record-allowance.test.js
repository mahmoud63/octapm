/**
 * A record-level allowance beside the role policy (Phase 22B): the person an
 * NCR is assigned to submits its closeout whatever their role.
 */
jest.mock('../../config/db', () => ({ prisma: {} }));
const { requirePermissionOr } = require('../rbac');

const run = (guard, req) => new Promise((resolve) => guard(req, {}, (err) => resolve(err ?? null)));
const amina = { id: 'u-amina', role: 'procurement', orgId: 'org-1' };
const lena = { id: 'u-lena', role: 'quality_engineer', orgId: 'org-1' };

describe('requirePermissionOr', () => {
  it('lets the assignee through although the role policy refuses the transition', async () => {
    const guard = requirePermissionOr('ncr', 'submit', { transition: 'ncr.submit' }, async (req) => req.user.id === 'u-amina');
    expect(await run(guard, { user: amina, params: {} })).toBeNull();
  });

  it('still refuses somebody the policy refuses who is not the assignee', async () => {
    const guard = requirePermissionOr('ncr', 'submit', { transition: 'ncr.submit' }, async () => false);
    expect(await run(guard, { user: amina, params: {} })).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('never consults the record for a role the policy already allows', async () => {
    const allowRecord = jest.fn(async () => true);
    const guard = requirePermissionOr('ncr', 'submit', { transition: 'ncr.submit' }, allowRecord);
    expect(await run(guard, { user: lena, params: {} })).toBeNull();
    expect(allowRecord).not.toHaveBeenCalled();
  });

  it('never widens an API key', async () => {
    const guard = requirePermissionOr('ncr', 'submit', { transition: 'ncr.submit' }, async () => true);
    const err = await run(guard, { user: amina, params: {}, apiClient: { scopes: ['*:write'] } });
    expect(err).toMatchObject({ status: 403 });
  });

  it('turns a failing lookup into the error, not a hang', async () => {
    const guard = requirePermissionOr('ncr', 'submit', { transition: 'ncr.submit' }, async () => { throw new Error('db down'); });
    expect(await run(guard, { user: amina, params: {} })).toMatchObject({ message: 'db down' });
  });
});
