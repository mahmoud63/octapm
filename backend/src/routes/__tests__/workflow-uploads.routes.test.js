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

const mockFindWorkflowDocument = jest.fn(async () => null);
const mockGetWorkflowFile = jest.fn();
jest.mock('../../services/file-storage.service', () => ({
  ALLOWED_WORKFLOW_MIME: new Set(['image/png', 'image/jpeg', 'application/pdf']),
  DOCUMENT_TYPES: { WORKFLOW_ATTACHMENT: 'workflow_attachment' },
  MAX_WORKFLOW_FILE_BYTES: 25 * 1024 * 1024,
  uploadWorkflowFiles: (...args) => mockUploadWorkflowFiles(...args),
  cleanupTempFiles: (...args) => mockCleanupTempFiles(...args),
  findWorkflowDocument: (...args) => mockFindWorkflowDocument(...args),
  getWorkflowFile: (...args) => mockGetWorkflowFile(...args),
  ensureTempUploadDirSync: jest.fn(() => require('os').tmpdir()),
  isAllowedOriginalNameForType: jest.fn(() => true),
}));

// The download asks the visibility rule /attachments/documents asks (certification L2).
const mockDocumentReadableToViewer = jest.fn(async () => true);
jest.mock('../../services/document-text.service', () => ({
  documentViewer: (viewer) => viewer,
  documentReadableToViewer: (...args) => mockDocumentReadableToViewer(...args),
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

describe('workflow evidence downloads (certification L2)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const filePath = path.join(os.tmpdir(), `cert-l2-${process.pid}.pdf`);
  beforeAll(() => fs.writeFileSync(filePath, '%PDF-1.4 certification L2'));
  afterAll(() => fs.rmSync(filePath, { force: true }));
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetWorkflowFile.mockResolvedValue({ path: filePath, mimeType: 'application/pdf', fileName: 'x.pdf' });
  });

  it('serves a workflow document only to a caller who may read it through a record it is linked from', async () => {
    const app = buildApp();
    mockFindWorkflowDocument.mockResolvedValue({ id: 'doc-1' });
    mockDocumentReadableToViewer.mockResolvedValue(false);
    const refused = await request(app).get('/projects/p1/workflow/uploads/doc-1').set('x-role', 'site_engineer');
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe('FILE_NOT_FOUND');
    expect(mockGetWorkflowFile).not.toHaveBeenCalled();
    // the decision is the caller's own: its user and its module reads
    const [{ orgId, projectId, documentId, viewer }] = mockDocumentReadableToViewer.mock.calls[0];
    expect({ orgId, projectId, documentId, userId: viewer.userId }).toEqual({ orgId: 'org-1', projectId: 'p1', documentId: 'doc-1', userId: 'user-1' });
    expect(viewer.canRead('document_control')).toBe(true);
    expect(viewer.canRead('commitment')).toBe(false); // a site engineer does not read commitments

    mockDocumentReadableToViewer.mockResolvedValue(true);
    const served = await request(app).get('/projects/p1/workflow/uploads/doc-1').set('x-role', 'site_engineer');
    expect(served.status).toBe(200);
    expect(mockGetWorkflowFile).toHaveBeenCalledWith({ orgId: 'org-1', projectId: 'p1', key: 'doc-1' });
  });

  it('a legacy file with no document row needs document control read', async () => {
    const app = buildApp();
    mockFindWorkflowDocument.mockResolvedValue(null);
    const served = await request(app).get('/projects/p1/workflow/uploads/legacy.pdf').set('x-role', 'pm');
    expect(served.status).toBe(200);
    const refused = await request(app).get('/projects/p1/workflow/uploads/legacy.pdf').set('x-role', 'not_a_role');
    expect(refused.status).toBe(404);
    expect(mockDocumentReadableToViewer).not.toHaveBeenCalled();
  });
});
