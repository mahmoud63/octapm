const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const auditService = require('./audit.service');
const equipmentService = require('./equipment.service');
const progressService = require('./progress.service');

const REPORT_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];
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

const reportInclude = {
  activity: {
    select: {
      id: true,
      name: true,
      wbsCode: true,
      p6ActivityId: true,
    },
  },
  progressSubmissions: true,
  equipmentUsages: {
    select: {
      id: true,
      equipmentId: true,
      equipmentName: true,
      hours: true,
      rateType: true,
      rate: true,
      costAmount: true,
      usageDate: true,
      status: true,
      dailyReportId: true,
      sourceLineIndex: true,
    },
    orderBy: { sourceLineIndex: 'asc' },
  },
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

const ensureActivity = async ({ projectId, activityId }, tx = prisma) => {
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId, isActive: true },
  });
  if (!activity) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }
  return activity;
};

const serializeDailyReport = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.projectId,
        activityId: row.activityId,
        engineerId: row.engineerId,
        date: toIso(row.date),
        shift: row.shift || 'day',
        pctProgress: row.pctProgress,
        weather: row.weatherJson || null,
        manpower: row.manpowerJson || [],
        materials: row.materialsJson || [],
        equipment: row.equipmentJson || [],
        issues: row.issuesJson || [],
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
        activity: row.activity
          ? {
              id: row.activity.id,
              name: row.activity.name,
              wbsCode: row.activity.wbsCode,
              p6ActivityId: row.activity.p6ActivityId,
            }
          : undefined,
        progressSubmissions:
          row.progressSubmissions?.map(progressService.serializeSubmission) ||
          [],
        equipmentUsagePostings:
          row.equipmentUsages?.map((usage) => ({
            id: usage.id,
            equipmentId: usage.equipmentId || null,
            equipmentName: usage.equipmentName,
            hours: usage.hours,
            rateType: usage.rateType || null,
            rate: Number(usage.rate || 0),
            costAmount: Number(usage.costAmount || 0),
            usageDate: toIso(usage.usageDate),
            status: usage.status,
            dailyReportId: usage.dailyReportId || null,
            sourceLineIndex: usage.sourceLineIndex ?? null,
          })) || [],
      }
    : null;

const buildReportData = ({ payload, projectId, userId, existing = null }) => {
  const photos = normalizePhotos(
    payload.photos !== undefined ? payload.photos : existing?.photosJson,
  );

  return {
    projectId,
    activityId: payload.activityId || existing?.activityId,
    engineerId: payload.engineerId || existing?.engineerId || userId,
    date:
      payload.date !== undefined
        ? parseDate(payload.date, 'date')
        : existing?.date,
    shift:
      payload.shift !== undefined
        ? normalizeShift(payload.shift, existing?.shift || 'day')
        : existing?.shift || 'day',
    pctProgress:
      payload.pctProgress !== undefined
        ? toNumber(payload.pctProgress)
        : existing?.pctProgress || 0,
    weatherJson:
      payload.weather !== undefined
        ? normalizeWeather(payload.weather)
        : existing?.weatherJson || null,
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
    issuesJson:
      payload.issues !== undefined
        ? normalizeIssues(payload.issues)
        : existing?.issuesJson || [],
    photosJson: photos,
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
  };
};

const createLinkedProgress = async ({
  tx,
  orgId,
  projectId,
  userId,
  userRole,
  report,
  progressPayload = null,
  status = 'submitted',
}) => {
  const progressData =
    progressPayload && typeof progressPayload === 'object'
      ? progressPayload
      : {};
  if (toNumber(report.pctProgress) <= 0 && !Object.keys(progressData).length) {
    return null;
  }

  return progressService.createProgressSubmission({
    orgId,
    projectId,
    activityId: report.activityId,
    userId,
    userRole,
    payload: {
      ...progressData,
      method:
        progressData.method || progressData.progressMethod || 'percent',
      pctComplete:
        progressData.pctComplete !== undefined
          ? progressData.pctComplete
          : report.pctProgress,
      source: 'daily_report',
      status,
      notes: progressData.notes || report.notes || undefined,
      evidence: progressData.evidence || { photos: report.photosJson || [] },
    },
    dailyReportId: report.id,
    fallbackPhotos: report.photosJson || [],
    tx,
  });
};

const getReportOrThrow = async ({ projectId, reportId }, tx = prisma) => {
  const row = await tx.dailyReport.findFirst({
    where: { id: reportId, projectId },
    include: reportInclude,
  });

  if (!row) {
    throw new HttpError(404, 'DAILY_REPORT_NOT_FOUND', 'Daily report not found');
  }

  return row;
};

const listDailyReports = async ({
  orgId,
  projectId,
  activityId = null,
  status = null,
  date = null,
  from = null,
  to = null,
}) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId };
  if (activityId) where.activityId = activityId;
  if (status) where.status = status;
  if (date) where.date = { gte: startOfDay(date), lte: endOfDay(date) };
  if (!date && (from || to)) {
    where.date = {};
    if (from) where.date.gte = startOfDay(from);
    if (to) where.date.lte = endOfDay(to);
  }

  const rows = await prisma.dailyReport.findMany({
    where,
    include: reportInclude,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  return rows.map(serializeDailyReport);
};

const createDailyReport = async ({
  orgId,
  projectId,
  userId,
  userRole,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);

    const clientRequestId = trimOrNull(payload.clientRequestId);
    if (clientRequestId) {
      const existing = await tx.dailyReport.findFirst({
        where: { projectId, clientRequestId },
        include: reportInclude,
      });
      if (existing) return serializeDailyReport(existing);
    }

    await ensureActivity({ projectId, activityId: payload.activityId }, tx);

    const status = payload.status || 'submitted';
    if (!CREATE_STATUSES.includes(status)) {
      throw new HttpError(
        400,
        'INVALID_DAILY_REPORT_STATUS',
        `Daily report status must be one of: ${CREATE_STATUSES.join(', ')}`,
      );
    }

    const data = buildReportData({ payload, projectId, userId });
    await ensureProjectPhotoKeys({
      tx,
      orgId,
      projectId,
      photos: data.photosJson,
    });

    const now = new Date();
    const report = await tx.dailyReport.create({
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
      photos: report.photosJson,
      entityType: 'daily_report',
      entityId: report.id,
    });

    await createLinkedProgress({
      tx,
      orgId,
      projectId,
      userId,
      userRole,
      report,
      progressPayload: payload.progress || null,
      status: status === 'submitted' ? 'submitted' : 'draft',
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DAILY_REPORT,
      entityId: report.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      newStatus: report.status,
      newSummary: {
        activityId: report.activityId,
        date: toIso(report.date),
        shift: report.shift,
        pctProgress: report.pctProgress,
        clientRequestId: report.clientRequestId,
      },
      summary: { transition: 'daily_report.create' },
      attachments: photoAttachments(report.photosJson),
    });

    return serializeDailyReport(
      await tx.dailyReport.findFirst({
        where: { id: report.id, projectId },
        include: reportInclude,
      }),
    );
  });

const getDailyReport = async ({ orgId, projectId, reportId }) => {
  await ensureProject({ orgId, projectId });
  return serializeDailyReport(await getReportOrThrow({ projectId, reportId }));
};

const updateDailyReport = async ({
  orgId,
  projectId,
  reportId,
  userId,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await getReportOrThrow({ projectId, reportId }, tx);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        400,
        'DAILY_REPORT_NOT_EDITABLE',
        'Only draft or rejected daily reports can be updated',
      );
    }

    const data = buildReportData({ payload, projectId, userId, existing });
    if (data.activityId !== existing.activityId) {
      await ensureActivity({ projectId, activityId: data.activityId }, tx);
    }
    await ensureProjectPhotoKeys({
      tx,
      orgId,
      projectId,
      photos: data.photosJson,
    });

    const row = await tx.dailyReport.update({
      where: { id: reportId },
      data: {
        ...data,
        status: 'draft',
        submittedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      },
      include: reportInclude,
    });

    await linkPhotoDocuments({
      tx,
      orgId,
      projectId,
      photos: row.photosJson,
      entityType: 'daily_report',
      entityId: row.id,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DAILY_REPORT,
      entityId: row.id,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      oldStatus: existing.status,
      newStatus: row.status,
      oldSummary: {
        activityId: existing.activityId,
        pctProgress: existing.pctProgress,
        clientRequestId: existing.clientRequestId,
      },
      newSummary: {
        activityId: row.activityId,
        pctProgress: row.pctProgress,
        clientRequestId: row.clientRequestId,
      },
      summary: { transition: 'daily_report.update' },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeDailyReport(row);
  });

const submitDailyReport = async ({
  orgId,
  projectId,
  reportId,
  userId,
  userRole,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await getReportOrThrow({ projectId, reportId }, tx);
    if (existing.status === 'submitted') return serializeDailyReport(existing);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        400,
        'DAILY_REPORT_NOT_SUBMITTABLE',
        'Only draft or rejected daily reports can be submitted',
      );
    }

    const now = new Date();
    const row = await tx.dailyReport.update({
      where: { id: reportId },
      data: {
        status: 'submitted',
        submittedAt: now,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      },
      include: reportInclude,
    });

    const activeProgress = row.progressSubmissions.filter(
      (submission) => submission.status !== 'rejected',
    );
    if (!activeProgress.length) {
      await createLinkedProgress({
        tx,
        orgId,
        projectId,
        userId,
        userRole,
        report: row,
        status: 'submitted',
      });
    }

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DAILY_REPORT,
      entityId: row.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      occurredAt: now,
      oldStatus: existing.status,
      newStatus: 'submitted',
      summary: { transition: 'daily_report.submit' },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeDailyReport(
      await tx.dailyReport.findFirst({
        where: { id: row.id, projectId },
        include: reportInclude,
      }),
    );
  });

const approveDailyReport = async ({
  orgId,
  projectId,
  reportId,
  userId,
  userRole,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await getReportOrThrow({ projectId, reportId }, tx);
    if (existing.status === 'approved') return serializeDailyReport(existing);
    if (!REVIEWABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        400,
        'DAILY_REPORT_NOT_APPROVABLE',
        'Only submitted daily reports can be approved',
      );
    }

    let progressRows = existing.progressSubmissions.filter(
      (submission) => submission.status !== 'rejected',
    );
    if (!progressRows.length) {
      const created = await createLinkedProgress({
        tx,
        orgId,
        projectId,
        userId,
        userRole,
        report: existing,
        status: 'submitted',
      });
      progressRows = created ? [{ id: created.id, status: created.status }] : [];
    }

    for (const submission of progressRows) {
      if (submission.status === 'draft' || submission.status === 'submitted') {
        await progressService.approveProgressSubmissionWithClient({
          tx,
          orgId,
          projectId,
          activityId: existing.activityId,
          submissionId: submission.id,
          userId,
        });
      }
    }

    const now = new Date();
    const row = await tx.dailyReport.update({
      where: { id: reportId },
      data: {
        status: 'approved',
        reviewedBy: userId || null,
        reviewedAt: now,
        rejectionReason: null,
      },
      include: reportInclude,
    });

    const equipmentPosting =
      await equipmentService.postDailyReportEquipmentUsage({
        tx,
        orgId,
        projectId,
        report: row,
        actorId: userId,
        actorRole: userRole,
      });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DAILY_REPORT,
      entityId: row.id,
      action: auditService.ACTIONS.APPROVED,
      actorId: userId,
      occurredAt: now,
      oldStatus: existing.status,
      newStatus: 'approved',
      newSummary: {
        activityId: row.activityId,
        pctProgress: row.pctProgress,
        equipmentUsageCount: equipmentPosting.usages.length,
        equipmentCostPosted: equipmentPosting.equipmentCost,
      },
      summary: {
        transition: 'daily_report.approve',
        equipmentUsagePosted: equipmentPosting.posted,
      },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeDailyReport(row);
  });

const rejectDailyReport = async ({
  orgId,
  projectId,
  reportId,
  userId,
  userRole,
  reason,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await getReportOrThrow({ projectId, reportId }, tx);
    if (existing.status === 'rejected') return serializeDailyReport(existing);
    if (existing.status === 'approved') {
      throw new HttpError(
        400,
        'APPROVED_DAILY_REPORT_LOCKED',
        'Approved daily reports cannot be rejected',
      );
    }
    if (!REVIEWABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        400,
        'DAILY_REPORT_NOT_REJECTABLE',
        'Only submitted daily reports can be rejected',
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

    for (const submission of existing.progressSubmissions) {
      if (submission.status === 'draft' || submission.status === 'submitted') {
        await progressService.rejectProgressSubmissionWithClient({
          tx,
          orgId,
          projectId,
          activityId: existing.activityId,
          submissionId: submission.id,
          userId,
          reason: trimmedReason,
        });
      }
    }

    const now = new Date();
    const row = await tx.dailyReport.update({
      where: { id: reportId },
      data: {
        status: 'rejected',
        reviewedBy: userId || null,
        reviewedAt: now,
        rejectionReason: trimmedReason,
      },
      include: reportInclude,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DAILY_REPORT,
      entityId: row.id,
      action: auditService.ACTIONS.REJECTED,
      actorId: userId,
      actorRole: userRole,
      occurredAt: now,
      oldStatus: existing.status,
      newStatus: 'rejected',
      reason: trimmedReason,
      summary: { transition: 'daily_report.reject' },
      attachments: photoAttachments(row.photosJson),
    });

    return serializeDailyReport(row);
  });

module.exports = {
  REPORT_STATUSES,
  listDailyReports,
  createDailyReport,
  getDailyReport,
  updateDailyReport,
  submitDailyReport,
  approveDailyReport,
  rejectDailyReport,
  serializeDailyReport,
};
