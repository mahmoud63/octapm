const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const auditService = require('./audit.service');
const { assertMembers } = require('./tenant-references.service');
const { assertLineReferences, checkedPhotos } = require('./daily-report.service');

const DIARY_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];
const CREATE_STATUSES = ['draft', 'submitted'];
const EDITABLE_STATUSES = ['draft', 'rejected'];
const REVIEWABLE_STATUSES = ['submitted'];
const SHIFT_VALUES = ['day', 'night', 'swing'];
const SITE_PHOTO_DOCUMENT_TYPE = 'site_photo';

const parseDate = (value, field = 'date') => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `${field} is invalid`);
  }
  return date;
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const parseOptionalDate = (value, field) => {
  if (value === null || value === undefined || value === '') return null;
  return parseDate(value, field);
};

const normalizeList = (value) => (Array.isArray(value) ? value : []);

const normalizeShift = (value, fallback = 'day') => {
  const shift = trimOrNull(value) || fallback;
  if (!SHIFT_VALUES.includes(shift)) {
    throw new HttpError(
      400,
      'INVALID_SHIFT',
      `Shift must be one of: ${SHIFT_VALUES.join(', ')}`,
    );
  }
  return shift;
};

const normalizeWeather = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    summary: trimOrNull(value.summary),
    temperatureC:
      value.temperatureC === null || value.temperatureC === undefined
        ? null
        : toNumber(value.temperatureC, null),
    condition: trimOrNull(value.condition),
    wind: trimOrNull(value.wind),
    rainfallMm:
      value.rainfallMm === null || value.rainfallMm === undefined
        ? null
        : Math.max(0, toNumber(value.rainfallMm, 0)),
    delayImpact: Boolean(value.delayImpact),
  };
};

const normalizeIssues = (value) =>
  normalizeList(value)
    .map((issue) => {
      if (typeof issue === 'string') {
        return { description: trimOrNull(issue), severity: 'medium' };
      }
      if (!issue || typeof issue !== 'object') return null;
      return {
        description: trimOrNull(issue.description || issue.title),
        severity: trimOrNull(issue.severity) || 'medium',
        owner: trimOrNull(issue.owner),
        status: trimOrNull(issue.status) || 'open',
      };
    })
    .filter((issue) => issue?.description);

const normalizePhotos = (value) =>
  normalizeList(value)
    .map((photo) => {
      if (typeof photo === 'string') return { url: photo };
      if (!photo || typeof photo !== 'object') return null;
      return {
        key: photo.key || null,
        url: photo.url || null,
        filename: photo.filename || photo.name || null,
        originalName: photo.originalName || null,
        mimeType: photo.mimeType || photo.type || null,
        size: photo.size ?? null,
        storage: photo.storage || null,
        caption: trimOrNull(photo.caption),
        takenAt: photo.takenAt || null,
        uploadedBy: photo.uploadedBy || null,
        uploadedAt: photo.uploadedAt || null,
      };
    })
    .filter((photo) => photo && (photo.url || photo.key));

const photoAttachments = (photos) =>
  normalizePhotos(photos)
    .slice(0, 10)
    .map((photo) => ({
      url: photo.url || null,
      key: photo.key || null,
      name: photo.filename || photo.originalName || null,
      type: 'photo',
    }));

const summarizeLines = ({ manpower = [], materials = [], equipment = [], photos = [], issues = [] }) => ({
  totalWorkers: normalizeList(manpower).reduce(
    (sum, row) => sum + Math.max(0, toNumber(row?.workers, 0)),
    0,
  ),
  totalManHours: normalizeList(manpower).reduce(
    (sum, row) =>
      sum +
      Math.max(0, toNumber(row?.workers, 0)) *
        Math.max(0, toNumber(row?.hours, 0)),
    0,
  ),
  equipmentHours: normalizeList(equipment).reduce(
    (sum, row) => sum + Math.max(0, toNumber(row?.hours, 0)),
    0,
  ),
  materialLines: normalizeList(materials).length,
  photoCount: normalizeList(photos).length,
  issueCount: normalizeList(issues).length,
});

const collectPhotoKeys = (photos) => [
  ...new Set(normalizePhotos(photos).map((photo) => photo.key).filter(Boolean)),
];

const ensureProjectPhotoKeys = async ({ tx, orgId, projectId, photos }) => {
  const keys = collectPhotoKeys(photos);
  if (!keys.length) return;

  const documents = await tx.projectDocument.findMany({
    where: {
      orgId,
      projectId,
      documentType: SITE_PHOTO_DOCUMENT_TYPE,
      status: 'available',
      scanStatus: 'clean',
      OR: [{ id: { in: keys } }, { storageKey: { in: keys } }],
    },
    select: { id: true, storageKey: true },
  });
  const matched = new Set(
    documents.flatMap((document) => [document.id, document.storageKey]),
  );
  const missing = keys.filter((key) => !matched.has(key));
  if (missing.length) {
    const error = new HttpError(
      400,
      'INVALID_SITE_PHOTO_REFERENCE',
      'Photo evidence must reference uploaded site-reporting photos for this project',
    );
    error.details = { missing };
    throw error;
  }
};

/**
 * What a site diary names is this company's and this project's (certification
 * CERT-2), as a daily report's is. The diary stored its engineer, its photos —
 * an uploader (a person), a bare id as a link, a link into another company's
 * project — and its equipment and material lines as given, and served them
 * back; an engineer who exists nowhere answered 500 from the database's foreign
 * key, another company's person 201, which told the two apart. The engineer is
 * now a member of this organisation (another company's person and a nowhere
 * id get the same 404); the photos take the shape progress evidence takes and
 * name this project's files only, each uploader read from its document
 * (daily-report.service checkedPhotos, progress.service prepareEvidence); the
 * lines name this project's equipment and materials (daily-report.service
 * assertLineReferences). Each is checked when the request sends it, so a
 * diary can still be edited for anything else.
 */
const assertEngineer = ({ tx, orgId, engineerId }) =>
  assertMembers({ tx, orgId, userIds: [engineerId], code: 'USER_NOT_FOUND', message: 'The engineer is not a member of this organisation' });

const linkPhotoDocuments = async ({
  tx,
  orgId,
  projectId,
  photos,
  entityType,
  entityId,
}) => {
  const keys = collectPhotoKeys(photos);
  if (!keys.length) return;

  await tx.projectDocument.updateMany({
    where: {
      orgId,
      projectId,
      documentType: SITE_PHOTO_DOCUMENT_TYPE,
      status: 'available',
      OR: [{ id: { in: keys } }, { storageKey: { in: keys } }],
    },
    data: {
      linkedEntityType: entityType,
      linkedEntityId: entityId,
    },
  });
};

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  return project;
};

const startOfDay = (value) => {
  const date = parseDate(value, 'date');
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = parseDate(value, 'date');
  date.setHours(23, 59, 59, 999);
  return date;
};

const serializeSiteDiary = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.projectId,
        engineerId: row.engineerId || null,
        date: toIso(row.date),
        shift: row.shift || 'day',
        weather: row.weather || null,
        weatherDetails: row.weatherJson || null,
        workers: row.workers || 0,
        visitors: row.visitors || null,
        workDone: row.workDone || null,
        issues: row.issues || null,
        issueItems: row.issuesJson || [],
        instructions: row.instructions || null,
        manpower: row.manpowerJson || [],
        materials: row.materialsJson || [],
        equipment: row.equipmentJson || [],
        photos: row.photosJson || [],
        notes: row.notes || null,
        lineSummary: summarizeLines({
          manpower: row.manpowerJson,
          materials: row.materialsJson,
          equipment: row.equipmentJson,
          photos: row.photosJson,
          issues: row.issuesJson,
        }),
        clientRequestId: row.clientRequestId || null,
        clientCreatedAt: toIso(row.clientCreatedAt),
        deviceId: row.deviceId || null,
        status: row.status,
        submittedAt: toIso(row.submittedAt),
        reviewedBy: row.reviewedBy || null,
        reviewedAt: toIso(row.reviewedAt),
        rejectionReason: row.rejectionReason || null,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      }
    : null;

const buildDiaryData = ({ payload, projectId, userId, existing = null }) => ({
  projectId,
  engineerId: payload.engineerId || existing?.engineerId || userId || null,
  date:
    payload.date !== undefined ? parseDate(payload.date, 'date') : existing?.date,
  shift:
    payload.shift !== undefined
      ? normalizeShift(payload.shift, existing?.shift || 'day')
      : existing?.shift || 'day',
  weather:
    payload.weather !== undefined ? trimOrNull(payload.weather) : existing?.weather,
  weatherJson:
    payload.weatherDetails !== undefined || payload.weatherJson !== undefined
      ? normalizeWeather(payload.weatherDetails || payload.weatherJson)
      : existing?.weatherJson || null,
  workers:
    payload.workers !== undefined
      ? Math.max(0, Math.round(toNumber(payload.workers)))
      : existing?.workers || 0,
  visitors:
    payload.visitors !== undefined
      ? trimOrNull(payload.visitors)
      : existing?.visitors,
  workDone:
    payload.workDone !== undefined
      ? trimOrNull(payload.workDone)
      : existing?.workDone,
  issues:
    payload.issues !== undefined ? trimOrNull(payload.issues) : existing?.issues,
  issuesJson:
    payload.issueItems !== undefined || Array.isArray(payload.issues)
      ? normalizeIssues(payload.issueItems || payload.issues)
      : existing?.issuesJson || [],
  instructions:
    payload.instructions !== undefined
      ? trimOrNull(payload.instructions)
      : existing?.instructions,
  manpowerJson:
    payload.manpower !== undefined
      ? normalizeList(payload.manpower)
      : existing?.manpowerJson || [],
  materialsJson:
    payload.materials !== undefined
      ? normalizeList(payload.materials)
      : existing?.materialsJson || [],
  equipmentJson:
    payload.equipment !== undefined
      ? normalizeList(payload.equipment)
      : existing?.equipmentJson || [],
  photosJson:
    payload.photos !== undefined
      ? normalizePhotos(payload.photos)
      : existing?.photosJson || [],
  notes:
    payload.notes !== undefined ? trimOrNull(payload.notes) : existing?.notes,
  clientRequestId:
    payload.clientRequestId !== undefined
      ? trimOrNull(payload.clientRequestId)
      : existing?.clientRequestId || null,
  clientCreatedAt:
    payload.clientCreatedAt !== undefined
      ? parseOptionalDate(payload.clientCreatedAt, 'clientCreatedAt')
      : existing?.clientCreatedAt || null,
  deviceId:
    payload.deviceId !== undefined
      ? trimOrNull(payload.deviceId)
      : existing?.deviceId || null,
});

const getDiaryOrThrow = async ({ projectId, diaryId }, tx = prisma) => {
  const row = await tx.siteDiary.findFirst({
    where: { id: diaryId, projectId },
  });

  if (!row) {
    throw new HttpError(404, 'SITE_DIARY_NOT_FOUND', 'Site diary not found');
  }

  return row;
};

const listSiteDiaries = async ({
  orgId,
  projectId,
  status = null,
  date = null,
  from = null,
  to = null,
}) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId };
  if (status) where.status = status;
  if (date) where.date = { gte: startOfDay(date), lte: endOfDay(date) };
  if (!date && (from || to)) {
    where.date = {};
    if (from) where.date.gte = startOfDay(from);
    if (to) where.date.lte = endOfDay(to);
  }

  const rows = await prisma.siteDiary.findMany({
    where,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  return rows.map(serializeSiteDiary);
};

const createSiteDiary = async ({ orgId, projectId, userId, payload }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);

    const clientRequestId = trimOrNull(payload.clientRequestId);
    if (clientRequestId) {
      const existing = await tx.siteDiary.findFirst({
        where: { projectId, clientRequestId },
      });
      if (existing) return serializeSiteDiary(existing);
    }

    const status = payload.status || 'draft';
    if (!CREATE_STATUSES.includes(status)) {
      throw new HttpError(
        400,
        'INVALID_SITE_DIARY_STATUS',
        `Site diary status must be one of: ${CREATE_STATUSES.join(', ')}`,
      );
    }

    if (payload.engineerId) await assertEngineer({ tx, orgId, engineerId: payload.engineerId });
    const data = buildDiaryData({ payload, projectId, userId });
    await assertLineReferences({ tx, projectId, equipment: data.equipmentJson, materials: data.materialsJson, record: 'Site diary' });
    await ensureProjectPhotoKeys({
      tx,
      orgId,
      projectId,
      photos: data.photosJson,
    });
    data.photosJson = await checkedPhotos({ tx, orgId, projectId, photos: data.photosJson });

    const now = new Date();
    const row = await tx.siteDiary.create({
      data: {
        ...data,
        status,
        submittedAt: status === 'submitted' ? now : null,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      },
    });

    await linkPhotoDocuments({
      tx,
      orgId,
      projectId,
      photos: row.photosJson,
      entityType: 'site_diary',
      entityId: row.id,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SITE_DIARY,
      entityId: row.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      newStatus: row.status,
      newSummary: {
        date: toIso(row.date),
        shift: row.shift,
        weather: row.weather,
        workers: row.workers,
        clientRequestId: row.clientRequestId,
      },
      summary: { transition: 'site_diary.create' },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeSiteDiary(row);
  });

const getSiteDiary = async ({ orgId, projectId, diaryId }) => {
  await ensureProject({ orgId, projectId });
  return serializeSiteDiary(await getDiaryOrThrow({ projectId, diaryId }));
};

const updateSiteDiary = async ({
  orgId,
  projectId,
  diaryId,
  userId,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await getDiaryOrThrow({ projectId, diaryId }, tx);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        400,
        'SITE_DIARY_NOT_EDITABLE',
        'Only draft or rejected site diaries can be updated',
      );
    }

    if (payload.engineerId && payload.engineerId !== existing.engineerId) {
      await assertEngineer({ tx, orgId, engineerId: payload.engineerId });
    }
    const data = buildDiaryData({ payload, projectId, userId, existing });
    await assertLineReferences({
      tx,
      projectId,
      equipment: payload.equipment !== undefined ? data.equipmentJson : [],
      materials: payload.materials !== undefined ? data.materialsJson : [],
      record: 'Site diary',
    });
    if (payload.photos !== undefined) {
      await ensureProjectPhotoKeys({
        tx,
        orgId,
        projectId,
        photos: data.photosJson,
      });
      data.photosJson = await checkedPhotos({ tx, orgId, projectId, photos: data.photosJson });
    }

    const row = await tx.siteDiary.update({
      where: { id: diaryId },
      data: {
        ...data,
        status: 'draft',
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      },
    });

    await linkPhotoDocuments({
      tx,
      orgId,
      projectId,
      photos: row.photosJson,
      entityType: 'site_diary',
      entityId: row.id,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SITE_DIARY,
      entityId: row.id,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      oldStatus: existing.status,
      newStatus: row.status,
      oldSummary: {
        workers: existing.workers,
        weather: existing.weather,
        clientRequestId: existing.clientRequestId,
      },
      newSummary: {
        workers: row.workers,
        weather: row.weather,
        clientRequestId: row.clientRequestId,
      },
      summary: { transition: 'site_diary.update' },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeSiteDiary(row);
  });

const submitSiteDiary = async ({ orgId, projectId, diaryId, userId }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await getDiaryOrThrow({ projectId, diaryId }, tx);
    if (existing.status === 'submitted') return serializeSiteDiary(existing);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        400,
        'SITE_DIARY_NOT_SUBMITTABLE',
        'Only draft or rejected site diaries can be submitted',
      );
    }

    const now = new Date();
    const row = await tx.siteDiary.update({
      where: { id: diaryId },
      data: {
        status: 'submitted',
        submittedAt: now,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      },
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SITE_DIARY,
      entityId: row.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      occurredAt: now,
      oldStatus: existing.status,
      newStatus: 'submitted',
      summary: { transition: 'site_diary.submit' },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeSiteDiary(row);
  });

const approveSiteDiary = async ({ orgId, projectId, diaryId, userId }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await getDiaryOrThrow({ projectId, diaryId }, tx);
    if (existing.status === 'approved') return serializeSiteDiary(existing);
    if (!REVIEWABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        400,
        'SITE_DIARY_NOT_APPROVABLE',
        'Only submitted site diaries can be approved',
      );
    }

    const now = new Date();
    const row = await tx.siteDiary.update({
      where: { id: diaryId },
      data: {
        status: 'approved',
        reviewedBy: userId || null,
        reviewedAt: now,
        rejectionReason: null,
      },
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SITE_DIARY,
      entityId: row.id,
      action: auditService.ACTIONS.APPROVED,
      actorId: userId,
      occurredAt: now,
      oldStatus: existing.status,
      newStatus: 'approved',
      summary: { transition: 'site_diary.approve' },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeSiteDiary(row);
  });

const rejectSiteDiary = async ({
  orgId,
  projectId,
  diaryId,
  userId,
  reason,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await getDiaryOrThrow({ projectId, diaryId }, tx);
    if (existing.status === 'rejected') return serializeSiteDiary(existing);
    if (existing.status === 'approved') {
      throw new HttpError(
        400,
        'APPROVED_SITE_DIARY_LOCKED',
        'Approved site diaries cannot be rejected',
      );
    }
    if (!REVIEWABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        400,
        'SITE_DIARY_NOT_REJECTABLE',
        'Only submitted site diaries can be rejected',
      );
    }

    const trimmedReason = trimOrNull(reason);
    if (!trimmedReason) {
      throw new HttpError(
        400,
        'REJECTION_REASON_REQUIRED',
        'A rejection reason is required',
      );
    }

    const now = new Date();
    const row = await tx.siteDiary.update({
      where: { id: diaryId },
      data: {
        status: 'rejected',
        reviewedBy: userId || null,
        reviewedAt: now,
        rejectionReason: trimmedReason,
      },
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SITE_DIARY,
      entityId: row.id,
      action: auditService.ACTIONS.REJECTED,
      actorId: userId,
      occurredAt: now,
      oldStatus: existing.status,
      newStatus: 'rejected',
      reason: trimmedReason,
      summary: { transition: 'site_diary.reject' },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeSiteDiary(row);
  });

module.exports = {
  DIARY_STATUSES,
  listSiteDiaries,
  createSiteDiary,
  getSiteDiary,
  updateSiteDiary,
  submitSiteDiary,
  approveSiteDiary,
  rejectSiteDiary,
  serializeSiteDiary,
};
