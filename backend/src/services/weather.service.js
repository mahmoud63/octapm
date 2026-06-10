const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const auditService = require('./audit.service');
const {
  RECORD_TYPES,
  attachEvidenceToRecords,
  syncEvidenceReferences,
} = require('./commercial-traceability.service');

const activityTraceSelect = {
  id: true,
  name: true,
  p6ActivityId: true,
  wbsCode: true,
  totalFloat: true,
  isCritical: true,
};

const weatherDelayInclude = {
  activityLinks: {
    include: { activity: { select: activityTraceSelect } },
    orderBy: [{ createdAt: 'asc' }],
  },
  eotClaimLinks: {
    include: {
      eotClaim: {
        select: {
          id: true,
          ref: true,
          eventName: true,
          status: true,
          delayDays: true,
          eotDaysGranted: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  },
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const toMonth = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const summarizeWeatherDelay = (row) => ({
  description: row.description,
  delayDays: row.delayDays,
  contractual: row.contractual,
  monthKey: row.monthKey,
  activityLinkCount: row.activityLinks?.length || 0,
  eotClaimLinkCount: row.eotClaimLinks?.length || 0,
});

const normalizeActivityLinks = (payload = {}) => {
  if (payload.activityLinks !== undefined) {
    return (Array.isArray(payload.activityLinks) ? payload.activityLinks : [])
      .map((link) => ({
        activityId: trimOrNull(link?.activityId || link?.id),
        delayStart: link?.delayStart || null,
        delayEnd: link?.delayEnd || null,
        delayDays: Number(link?.delayDays ?? payload.delayDays) || 0,
        notes: trimOrNull(link?.notes),
      }))
      .filter((link) => link.activityId);
  }

  if (payload.affectedActivityIds !== undefined) {
    return (Array.isArray(payload.affectedActivityIds)
      ? payload.affectedActivityIds
      : []
    )
      .map((activityId) => ({
        activityId: trimOrNull(activityId),
        delayStart: null,
        delayEnd: null,
        delayDays: Number(payload.delayDays) || 0,
        notes: null,
      }))
      .filter((link) => link.activityId);
  }

  return null;
};

const syncActivityLinks = async ({ tx, projectId, weatherDelayId, payload }) => {
  const links = normalizeActivityLinks(payload);
  if (links === null) return null;

  await tx.weatherDelayActivityLink.deleteMany({
    where: { projectId, weatherDelayId },
  });
  if (links.length === 0) return { count: 0 };

  const ids = [...new Set(links.map((link) => link.activityId))];
  const activities = await tx.activity.findMany({
    where: { projectId, id: { in: ids } },
    select: activityTraceSelect,
  });
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const missing = ids.filter((id) => !activityById.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      'WEATHER_DELAY_ACTIVITY_NOT_FOUND',
      'One or more linked weather delay activities were not found in this project',
    );
  }

  await tx.weatherDelayActivityLink.createMany({
    data: links.map((link) => {
      const activity = activityById.get(link.activityId);
      const floatDays = Math.max(0, Number(activity.totalFloat) || 0);
      return {
        projectId,
        weatherDelayId,
        activityId: link.activityId,
        delayStart: link.delayStart ? new Date(link.delayStart) : null,
        delayEnd: link.delayEnd ? new Date(link.delayEnd) : null,
        delayDays: link.delayDays,
        floatDays,
        isCritical: Boolean(activity.isCritical) || floatDays <= 0,
        notes: link.notes,
      };
    }),
    skipDuplicates: true,
  });

  return { count: links.length };
};

const listWeatherDelays = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });

  const rows = await prisma.weatherDelay.findMany({
    where: { projectId },
    include: weatherDelayInclude,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  const allowance = Number(project.weatherAllowanceDays) || 20;
  const contractualUsed = rows.reduce((sum, row) => {
    if (!row.contractual) return sum;
    return sum + (Number(row.delayDays) || 0);
  }, 0);

  const consumedPct = allowance > 0 ? (contractualUsed / allowance) * 100 : 0;

  const monthlyMap = new Map();
  for (const row of rows) {
    const month = toMonth(row.date) || row.monthKey || 'unknown';
    const current = monthlyMap.get(month) || {
      month,
      contractual: 0,
      nonContractual: 0,
    };

    if (row.contractual) {
      current.contractual += Number(row.delayDays) || 0;
    } else {
      current.nonContractual += Number(row.delayDays) || 0;
    }

    monthlyMap.set(month, current);
  }

  const enrichedRows = await attachEvidenceToRecords({
    projectId,
    recordType: RECORD_TYPES.WEATHER_DELAY,
    records: rows,
  });

  return {
    rows: enrichedRows,
    summary: {
      allowance,
      contractualUsed,
      remaining: Math.max(allowance - contractualUsed, 0),
      consumedPct,
      warning: consumedPct >= 70,
    },
    monthly: Array.from(monthlyMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
  };
};

const createWeatherDelay = async ({ orgId, projectId, payload, userId = null }) => {
  await ensureProject({ orgId, projectId });

  return prisma.$transaction(async (tx) => {
    const created = await tx.weatherDelay.create({
      data: {
        projectId,
        date: payload.date ? new Date(payload.date) : new Date(),
        description: payload.description,
        delayDays: Number(payload.delayDays) || 0,
        contractual:
          payload.contractual !== undefined ? Boolean(payload.contractual) : true,
        monthKey: payload.monthKey || toMonth(payload.date || new Date()),
      },
      include: weatherDelayInclude,
    });

    const activityTrace = await syncActivityLinks({
      tx,
      projectId,
      weatherDelayId: created.id,
      payload,
    });
    const evidence = await syncEvidenceReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.WEATHER_DELAY,
      recordId: created.id,
      payload,
      userId,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.WEATHER_DELAY,
      entityId: created.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      newSummary: summarizeWeatherDelay(created),
      summary: {
        transition: 'weather_delay.create',
        delayDays: created.delayDays,
        contractual: created.contractual,
        activityLinks: activityTrace?.count ?? 0,
        correspondenceLinks: evidence.correspondenceCount,
        attachmentRefs: evidence.attachmentCount,
      },
      attachments: evidence.attachments,
    });

    const reloaded = await tx.weatherDelay.findFirst({
      where: { id: created.id },
      include: weatherDelayInclude,
    });
    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.WEATHER_DELAY,
      records: [reloaded],
    });
    return enriched;
  });
};

const updateWeatherDelay = async ({
  orgId,
  projectId,
  weatherId,
  payload,
  userId = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.weatherDelay.findFirst({
    where: { id: weatherId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'WEATHER_DELAY_NOT_FOUND',
      'Weather delay not found',
    );
  }

  const nextDate =
    payload.date !== undefined
      ? payload.date
        ? new Date(payload.date)
        : null
      : existing.date;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.weatherDelay.update({
      where: { id: weatherId },
      data: {
        date: nextDate,
        description: payload.description ?? existing.description,
        delayDays:
          payload.delayDays !== undefined
            ? Number(payload.delayDays) || 0
            : existing.delayDays,
        contractual:
          payload.contractual !== undefined
            ? Boolean(payload.contractual)
            : existing.contractual,
        monthKey:
          payload.monthKey !== undefined
            ? payload.monthKey || null
            : toMonth(nextDate) || existing.monthKey,
      },
      include: weatherDelayInclude,
    });

    const activityTrace = await syncActivityLinks({
      tx,
      projectId,
      weatherDelayId: updated.id,
      payload,
    });
    const evidence = await syncEvidenceReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.WEATHER_DELAY,
      recordId: updated.id,
      payload,
      userId,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.WEATHER_DELAY,
      entityId: updated.id,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      oldSummary: summarizeWeatherDelay(existing),
      newSummary: summarizeWeatherDelay(updated),
      summary: {
        transition: 'weather_delay.update',
        delayDays: updated.delayDays,
        contractual: updated.contractual,
        activityLinks: activityTrace?.count ?? updated.activityLinks?.length ?? 0,
        correspondenceLinks: evidence.correspondenceCount,
        attachmentRefs: evidence.attachmentCount,
      },
      attachments: evidence.attachments,
    });

    const [enriched] = await attachEvidenceToRecords({
      tx,
      projectId,
      recordType: RECORD_TYPES.WEATHER_DELAY,
      records: [updated],
    });
    return enriched;
  });
};

const deleteWeatherDelay = async ({
  orgId,
  projectId,
  weatherId,
  userId = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.weatherDelay.findFirst({
    where: { id: weatherId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'WEATHER_DELAY_NOT_FOUND',
      'Weather delay not found',
    );
  }

  await prisma.$transaction(async (tx) => {
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.WEATHER_DELAY,
      entityId: existing.id,
      action: auditService.ACTIONS.DELETED,
      actorId: userId,
      oldSummary: summarizeWeatherDelay(existing),
      summary: {
        transition: 'weather_delay.delete',
        delayDays: existing.delayDays,
        contractual: existing.contractual,
      },
    });

    await tx.weatherDelay.delete({ where: { id: weatherId } });
  });
  return { deleted: true };
};

module.exports = {
  listWeatherDelays,
  createWeatherDelay,
  updateWeatherDelay,
  deleteWeatherDelay,
};
