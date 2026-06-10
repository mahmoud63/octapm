const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

const mockUploadRoot = path.join(os.tmpdir(), `pmcopilots-boq-route-${Date.now()}`);

const mockProcessBoqUpload = jest.fn();
const mockUploadBoqFile = jest.fn();
const mockCleanupTempFiles = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 'user-1',
      orgId: 'org-1',
      role: 'pm',
    };
    next();
  },
}));

jest.mock('../../services/boq.service', () => ({
  generateBoqTemplate: jest.fn(),
  processBoqUpload: mockProcessBoqUpload,
  getBoqJob: jest.fn(),
  getProjectBoq: jest.fn(),
  updateBoqItem: jest.fn(),
  createManualBoqItem: jest.fn(),
  deleteBoqItem: jest.fn(),
  createActivity: jest.fn(),
  updateActivity: jest.fn(),
  deleteActivity: jest.fn(),
}));

jest.mock('../../services/file-storage.service', () => ({
  DOCUMENT_TYPES: { BOQ_UPLOAD: 'boq_upload' },
  ensureTempUploadDirSync: jest.fn(() => {
    require('fs').mkdirSync(mockUploadRoot, { recursive: true });
    return mockUploadRoot;
  }),
  isAllowedOriginalNameForType: jest.fn(() => true),
  uploadBoqFile: mockUploadBoqFile,
  getBoqUploadFile: jest.fn(),
  cleanupTempFiles: mockCleanupTempFiles,
}));

const boqRouter = require('../boq');

const buildApp = () => {
  const app = express();
  app.use('/projects/:projectId/boq', boqRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
    }),
  );
  return app;
};

describe('BOQ upload storage route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadBoqFile.mockImplementation(({ file }) =>
      Promise.resolve({
        documentId: 'doc-1',
        filename: file.originalname,
        downloadUrl: '/api/v1/projects/project-1/boq/uploads/doc-1',
        scanStatus: 'clean',
      }),
    );
    mockProcessBoqUpload.mockResolvedValue({
      jobId: 'job-1',
      revisionId: 'rev-1',
      mode: 'imported',
      baselineLocked: false,
      comparison: null,
    });
    mockCleanupTempFiles.mockResolvedValue();
  });

  afterAll(async () => {
    await fs.rm(mockUploadRoot, { recursive: true, force: true });
  });

  it('streams BOQ uploads to a temp file before storage and parsing', async () => {
    const res = await request(buildApp())
      .post('/projects/project-1/boq/upload')
      .attach('file', Buffer.from('not parsed in route test'), {
        filename: 'client-boq.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(200);

    const fileArg = mockUploadBoqFile.mock.calls[0][0].file;
    expect(fileArg.path).toEqual(expect.stringContaining(mockUploadRoot));
    expect(fileArg.buffer).toBeUndefined();
    expect(mockProcessBoqUpload).toHaveBeenCalledWith(
      'project-1',
      { path: fileArg.path },
      null,
      expect.objectContaining({
        orgId: 'org-1',
        userId: 'user-1',
        documentId: 'doc-1',
      }),
    );
    expect(mockCleanupTempFiles).toHaveBeenCalledWith(fileArg);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        revisionId: 'rev-1',
        document: { documentId: 'doc-1', scanStatus: 'clean' },
      },
    });
  });
});
