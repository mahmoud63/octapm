const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const uploadRoot = path.join(os.tmpdir(), `pmcopilots-site-reporting-${Date.now()}`);
const workflowRoot = path.join(os.tmpdir(), `pmcopilots-workflow-${Date.now()}`);
process.env.SITE_REPORT_UPLOAD_DIR = uploadRoot;
process.env.WORKFLOW_UPLOAD_DIR = workflowRoot;

const mockPrisma = {
  project: { findFirst: jest.fn() },
  projectDocument: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const fileStorageService = require('../file-storage.service');
let createdDocuments = [];

describe('site reporting file storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createdDocuments = [];
    mockPrisma.project.findFirst.mockImplementation(({ where }) => {
      const allowedProjects = new Set([
        'org-1:project-1',
        'org-1:project-2',
        'org-2:project-2',
      ]);
      const key = `${where?.orgId}:${where?.id}`;
      return Promise.resolve(
        allowedProjects.has(key)
          ? { id: where.id, orgId: where.orgId }
          : null,
      );
    });
    mockPrisma.projectDocument.create.mockImplementation(({ data }) => {
      const document = {
        id: `doc-${mockPrisma.projectDocument.create.mock.calls.length}`,
        ...data,
        createdAt: new Date('2026-06-10T12:00:00.000Z'),
        updatedAt: new Date('2026-06-10T12:00:00.000Z'),
      };
      createdDocuments.push(document);
      return Promise.resolve(document);
    });
    mockPrisma.projectDocument.findFirst.mockImplementation(({ where }) => {
      const publicKeys = (where?.OR || []).map((entry) => entry.id || entry.storageKey);
      const documentTypeMatches = (document) => {
        if (!where?.documentType) return true;
        if (Array.isArray(where.documentType.in)) {
          return where.documentType.in.includes(document.documentType);
        }
        return document.documentType === where.documentType;
      };
      return Promise.resolve(
        createdDocuments.find(
          (document) =>
            document.orgId === where?.orgId &&
            document.projectId === where?.projectId &&
            documentTypeMatches(document) &&
            ([where?.id, where?.storageKey, ...publicKeys].includes(document.id) ||
              [where?.id, where?.storageKey, ...publicKeys].includes(
                document.storageKey,
              )),
        ) || null,
      );
    });
    mockPrisma.projectDocument.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'doc-1', ...data }),
    );
  });

  afterAll(async () => {
    await fs.rm(uploadRoot, { recursive: true, force: true });
    await fs.rm(workflowRoot, { recursive: true, force: true });
  });

  it('stores photo files under the project scope and returns attachment metadata', async () => {
    const [photo] = await fileStorageService.uploadSiteReportingFiles({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      files: [
        {
          originalname: 'north pour.png',
          mimetype: 'image/png',
          size: 68,
          buffer: Buffer.from(
            '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de',
            'hex',
          ),
        },
      ],
    });

    expect(photo.key).toBe('doc-1');
    expect(photo.url).toBe(
      `/api/v1/projects/project-1/site-reporting/uploads/${photo.key}`,
    );
    expect(photo.storage).toBe('local');
    expect(photo.scanStatus).toBe('clean');
    expect(photo.documentId).toBe('doc-1');
    expect(mockPrisma.projectDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        documentType: 'site_photo',
        originalName: 'north pour.png',
        fileName: 'north-pour.png',
        mimeType: 'image/png',
        sha256: expect.any(String),
        storageProvider: 'local',
        objectKey: expect.stringMatching(
          /^orgs\/org-1\/projects\/project-1\/site-reporting\//,
        ),
        storageKey: expect.any(String),
        scanStatus: 'clean',
        status: 'available',
        retentionExpiresAt: expect.any(Date),
      }),
    });

    const stored = await fileStorageService.getSiteReportingFile({
      orgId: 'org-1',
      projectId: 'project-1',
      key: photo.key,
    });
    expect(stored.mimeType).toBe('image/png');
    await expect(fs.stat(stored.path)).resolves.toBeTruthy();
  });

  it('rejects unsupported file types', async () => {
    await expect(
      fileStorageService.uploadSiteReportingFiles({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        files: [
          {
            originalname: 'script.txt',
            mimetype: 'text/plain',
            size: 4,
            buffer: Buffer.from('test'),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SITE_PHOTO' });
  });

  it('stores workflow evidence files under the project scope', async () => {
    const [attachment] = await fileStorageService.uploadWorkflowFiles({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      files: [
        {
          originalname: 'rfi response.pdf',
          mimetype: 'application/pdf',
          size: 8,
          buffer: Buffer.from('%PDF-1.7'),
        },
      ],
    });

    expect(attachment.key).toBe('doc-1');
    expect(attachment.fileUrl).toBe(
      `/api/v1/projects/project-1/workflow/uploads/${attachment.key}`,
    );
    expect(attachment.uploadedBy).toBe('user-1');
    expect(attachment.documentId).toBe('doc-1');
    expect(mockPrisma.projectDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentType: 'workflow_attachment',
        scanStatus: 'clean',
        status: 'available',
      }),
    });

    const stored = await fileStorageService.getWorkflowFile({
      orgId: 'org-1',
      projectId: 'project-1',
      key: attachment.key,
    });
    expect(stored.mimeType).toBe('application/pdf');
    await expect(fs.stat(stored.path)).resolves.toBeTruthy();
  });

  it('does not return a private document key through another project', async () => {
    const [attachment] = await fileStorageService.uploadWorkflowFiles({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      files: [
        {
          originalname: 'claim narrative.pdf',
          mimetype: 'application/pdf',
          size: 8,
          buffer: Buffer.from('%PDF-1.7'),
        },
      ],
    });

    await expect(
      fileStorageService.getWorkflowFile({
        orgId: 'org-1',
        projectId: 'project-2',
        key: attachment.key,
      }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });

    expect(mockPrisma.projectDocument.findFirst).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-2',
      }),
    });
  });

  it('does not return a private document key through another org', async () => {
    const [attachment] = await fileStorageService.uploadWorkflowFiles({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      files: [
        {
          originalname: 'commercial evidence.pdf',
          mimetype: 'application/pdf',
          size: 8,
          buffer: Buffer.from('%PDF-1.7'),
        },
      ],
    });

    await expect(
      fileStorageService.getWorkflowFile({
        orgId: 'org-2',
        projectId: 'project-2',
        key: attachment.key,
      }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });

    expect(mockPrisma.projectDocument.findFirst).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        orgId: 'org-2',
        projectId: 'project-2',
      }),
    });
  });

  it('rejects malware signatures before creating document metadata', async () => {
    await expect(
      fileStorageService.uploadWorkflowFiles({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        files: [
          {
            originalname: 'infected.pdf',
            mimetype: 'application/pdf',
            size: 96,
            buffer: Buffer.from(
              '%PDF-1.7\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
            ),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'FILE_VIRUS_DETECTED' });

    expect(mockPrisma.projectDocument.create).not.toHaveBeenCalled();
  });

  it('rejects files whose magic bytes do not match the claimed type', async () => {
    await expect(
      fileStorageService.uploadWorkflowFiles({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        files: [
          {
            originalname: 'fake.xlsx',
            mimetype:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 11,
            buffer: Buffer.from('plain text'),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_MISMATCH' });

    expect(mockPrisma.projectDocument.create).not.toHaveBeenCalled();
  });
});
