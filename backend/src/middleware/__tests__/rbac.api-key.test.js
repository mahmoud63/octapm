/**
 * A role-only guard used to let a read-only API key write (Phase 21D, CX21-415).
 */
jest.mock('../../config/db', () => ({ prisma: {} }));
const { requireRoles } = require('../rbac');

const run = (req) => new Promise((resolve) => requireRoles('pm', 'planning_eng')(req, {}, (err) => resolve(err ?? null)));

describe('requireRoles with an API key', () => {
  const pm = { id: 'u1', role: 'pm', orgId: 'org-1' };

  it('refuses a write from a read-only key, whatever the owner\'s role', async () => {
    const err = await run({ user: pm, method: 'PATCH', baseUrl: '/api/v1/projects', apiClient: { scopes: ['*:read'] } });
    expect(err).toMatchObject({ status: 403, code: 'API_KEY_SCOPE' });
    const del = await run({ user: pm, method: 'DELETE', baseUrl: '/api/v1/projects', apiClient: { scopes: ['*:read', 'inventory:write'] } });
    expect(del).toMatchObject({ status: 403, code: 'API_KEY_SCOPE' });
  });

  it('lets a write through with a write scope, and reads through as before', async () => {
    expect(await run({ user: pm, method: 'PATCH', baseUrl: '/api/v1/projects', apiClient: { scopes: ['*:write'] } })).toBeNull();
    expect(await run({ user: pm, method: 'GET', baseUrl: '/api/v1/projects', apiClient: { scopes: ['*:read'] } })).toBeNull();
    expect(await run({ user: pm, method: 'PATCH', baseUrl: '/api/v1/projects' })).toBeNull();
  });
});

const { noApiKey } = require('../rbac');

describe('noApiKey on account-security routes', () => {
  it('CX21-429: refuses an API key and lets a person through', async () => {
    const withKey = await new Promise((resolve) => noApiKey({ user: { id: 'u1' }, apiClient: { scopes: ['*:write'] } }, {}, (err) => resolve(err ?? null)));
    expect(withKey).toMatchObject({ status: 403, code: 'API_KEY_FORBIDDEN' });
    const person = await new Promise((resolve) => noApiKey({ user: { id: 'u1' } }, {}, (err) => resolve(err ?? null)));
    expect(person).toBeNull();
  });
});

describe('requireRoles reads through an API key', () => {
  const owner = { id: 'u1', role: 'pm', orgId: 'org-1' };
  const read = (req) => new Promise((resolve) => requireRoles('pm', 'finance')(req, {}, (err) => resolve(err ?? null)));

  it('CX21-476: a read through a role guard needs a read scope on the module the route is mounted on', async () => {
    expect(await read({ user: owner, method: 'GET', baseUrl: '/api/v1/billing', apiClient: { scopes: ['inventory:read'] } })).toMatchObject({ status: 403, code: 'API_KEY_SCOPE' });
    expect(await read({ user: owner, method: 'GET', baseUrl: '/api/v1/billing', apiClient: { scopes: ['billing:read'] } })).toBeNull();
    expect(await read({ user: owner, method: 'GET', baseUrl: '/api/v1/billing', apiClient: { scopes: ['*:read'] } })).toBeNull();
    expect(await read({ user: owner, method: 'GET', baseUrl: '/api/v1/billing' })).toBeNull();
  });
});
