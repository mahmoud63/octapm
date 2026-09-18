const express = require('express');
const request = require('supertest');

const mockUploadWorkflowFiles = jest.fn(async () => [{ fileName: 'evidence.png', storageKey: 'k', fileUrl: '/u', mimeType: 'image/png', sizeBytes: 12, documentId: 'doc-1' }]);
const mockCleanupTempFiles = jest.fn(async () => undefined);

// The role under test is set per request by the x-role header, as the other route suites do.
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1', role: req.get('x-role') || 'site_engineer', isCompanyAdmin: false };
    next();
  },
}));

jest.mock('../../services/file-storage.service', () => ({
  ALLOWED_WORKFLOW_MIME: new Set(['image/png', 'image/jpeg', 'application/pdf']),
  DOCUMENT_TYPES: { WORKFLOW_ATTACHMENT: 'workflow_attachment' },
  MAX_WORKFLOW_FILE_BYTES: 25 * 1024 * 1024,
  uploadWorkflowFiles: (...args) => mockUploadWorkflowFiles(...args),
  cleanupTempFiles: (...args) => mockCleanupTempFiles(...args),
  getWorkflowFile: jest.fn(),
  ensureTempUploadDirSync: jest.fn(() => require('os').tmpdir()),
  isAllowedOriginalNameForType: jest.fn(() => true),
}));

const { authenticate } = require('../../middleware/auth');
const workflowUploads = require('../workflow-uploads');

function buildApp() {
  const app = express();
  app.use(authenticate);
  app.use('/projects/:projectId/workflow', workflowUploads);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL', message: err.message } }));
  return app;
}

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('workflow evidence uploads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('MOB-P2: a role with no evidence rights on any workflow module cannot fill the project workflow storage', async () => {
    const app = buildApp();
    // Warehouse holds inventory rights only: no ncr, safety, punch, inspection, change or approval write.
    const refused = await request(app)
      .post('/projects/p1/workflow/uploads')
      .set('x-role', 'warehouse')
      .attach('files', png, 'evidence.png');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('WORKFLOW_UPLOAD_FORBIDDEN');
    expect(mockUploadWorkflowFiles).not.toHaveBeenCalled();
  });

  it('the people who submit and decide the records that carry the evidence may upload', async () => {
    const app = buildApp();
    for (const role of ['pm', 'quality_engineer', 'site_engineer']) {
      mockUploadWorkflowFiles.mockClear();
      const allowed = await request(app)
        .post('/projects/p1/workflow/uploads')
        .set('x-role', role)
        .attach('files', png, 'evidence.png');
      expect(`${role}:${allowed.status}`).toBe(`${role}:201`);
      expect(mockUploadWorkflowFiles).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', projectId: 'p1', userId: 'user-1' }));
    }
  });
});
