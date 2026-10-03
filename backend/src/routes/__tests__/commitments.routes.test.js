const express = require('express');
const request = require('supertest');

/**
 * Certification L44: a commitment's parts — scope, close-out, evaluation,
 * agreement — answer as the commitment does. Every route that serves one
 * (read or write) asks commitment.service.assertCommitmentVisible with the
 * caller before its own service runs, and stops on its refusal.
 */

const notFound = () => Object.assign(new Error('Commitment not found'), { status: 404, code: 'COMMITMENT_NOT_FOUND' });
const mockCommitments = {
  TYPES: ['subcontract', 'purchase_order'],
  STATUSES: ['draft'],
  INSURANCE_TYPES: ['other'],
  assertCommitmentVisible: jest.fn(async () => undefined),
};
const mockScope = { KINDS: ['work'], PARTIES: ['contractor', 'subcontractor'], getForCommitment: jest.fn(async () => ({ ok: 'scope' })), replaceItems: jest.fn(async () => ({})), agree: jest.fn(async () => ({})), reopen: jest.fn(async () => ({})) };
const mockCloseout = { STATUSES: ['open', 'complete', 'waived'], buildCloseout: jest.fn(async () => ({ ok: 'closeout' })), updateItem: jest.fn(async () => ({})), complete: jest.fn(async () => ({})), reopen: jest.fn(async () => ({})) };
const mockEvaluation = { buildEvaluation: jest.fn(async () => ({ ok: 'evaluation' })), scoreCriterion: jest.fn(async () => ({})), setVerdict: jest.fn(async () => ({})), finalise: jest.fn(async () => ({})), reopen: jest.fn(async () => ({})) };
const mockAgreement = { buildAgreement: jest.fn(async () => ({ ok: 'agreement' })), exportAgreementPdf: jest.fn(async () => ({ fileName: 'a.pdf', buffer: Buffer.from('%PDF-1.4') })) };

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1', role: 'pm', isCompanyAdmin: false };
    next();
  },
}));
jest.mock('../../services/commitment.service', () => mockCommitments);
jest.mock('../../services/scope-matrix.service', () => mockScope);
jest.mock('../../services/closeout.service', () => mockCloseout);
jest.mock('../../services/subcontractor-evaluation.service', () => mockEvaluation);
jest.mock('../../services/subcontract-agreement.service', () => mockAgreement);

const { authenticate } = require('../../middleware/auth');
const commitments = require('../commitments');

const C = '11111111-1111-4111-8111-111111111111';
const projectAccess = { role: 'pm', scope: 'party', partyAccess: [{ projectPartyId: 'party-x', companyId: 'company-x', role: 'contractor' }] };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use((req, _res, next) => {
    req.projectAccess = projectAccess;
    next();
  });
  app.use('/projects/:projectId/commitments', commitments);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL', message: err.message } }));
  return app;
}

const ROUTES = [
  ['get', 'scope', undefined, mockScope.getForCommitment],
  ['put', 'scope', { items: [{ description: 'Formwork' }] }, mockScope.replaceItems],
  ['post', 'scope/agree', {}, mockScope.agree],
  ['post', 'scope/reopen', {}, mockScope.reopen],
  ['get', 'closeout', undefined, mockCloseout.buildCloseout],
  ['patch', 'closeout/items/retention_released', { status: 'complete' }, mockCloseout.updateItem],
  ['post', 'closeout/complete', {}, mockCloseout.complete],
  ['post', 'closeout/reopen', {}, mockCloseout.reopen],
  ['get', 'evaluation', undefined, mockEvaluation.buildEvaluation],
  ['patch', 'evaluation/criteria/quality', { score: 3 }, mockEvaluation.scoreCriterion],
  ['patch', 'evaluation', { summary: 'ok' }, mockEvaluation.setVerdict],
  ['post', 'evaluation/final', {}, mockEvaluation.finalise],
  ['post', 'evaluation/reopen', { reason: 'again' }, mockEvaluation.reopen],
  ['get', 'agreement', undefined, mockAgreement.buildAgreement],
  ['get', 'agreement.pdf', undefined, mockAgreement.exportAgreementPdf],
];

const send = (app, method, path, body) => {
  const req = request(app)[method](`/projects/p1/commitments/${C}/${path}`);
  return body === undefined ? req : req.send(body);
};

describe('commitment parts follow the commitment party rule (certification L44)', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(ROUTES)('%s /%s answers 404 for a commitment the caller may not see, before its service runs', async (method, path, body, service) => {
    mockCommitments.assertCommitmentVisible.mockRejectedValueOnce(notFound());
    const res = await send(buildApp(), method, path, body);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMMITMENT_NOT_FOUND');
    expect(mockCommitments.assertCommitmentVisible).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'p1',
      commitmentId: C,
      viewer: expect.objectContaining({ id: 'user-1', projectAccess }),
    });
    expect(service).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('%s /%s is served when the commitment is the caller\'s', async (method, path, body, service) => {
    const res = await send(buildApp(), method, path, body);
    expect(res.status).toBe(200);
    expect(mockCommitments.assertCommitmentVisible).toHaveBeenCalledTimes(1);
    expect(service).toHaveBeenCalledTimes(1);
  });
});
