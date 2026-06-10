const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  RECORD_TYPES,
  assignmentData,
  attachWorkflowDetailsToRecords,
  primaryActivityIdFromPayload,
  recordWorkflowHistory,
  syncWorkflowReferences,
} = require('./workflow-support.service');
const approvalWorkflowService = require('./approval-workflow.service');

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const listSafetyIncidents = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await prisma.safetyIncident.findMany({
    where: { projectId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SAFETY_INCIDENT,
    records,
  });

  return {
    rows,
    summary: {
      open: rows.filter((row) => row.status === 'open').length,
      investigating: rows.filter((row) => row.status === 'investigating')
        .length,
      closed: rows.filter((row) => row.status === 'closed').length,
      lti: rows.filter((row) => row.incidentType === 'lti').length,
      nearMiss: rows.filter((row) => row.incidentType === 'near_miss').length,
      lostDays: rows.reduce((sum, row) => sum + (Number(row.lostDays) || 0), 0),
    },
  };
};

const createSafetyIncident = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.safetyIncident.count({ where: { projectId } });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.safetyIncident.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || `SAF-${String(count + 1).padStart(3, '0')}`,
        incidentType: payload.incidentType,
        severity: payload.severity?.trim() || null,
        title: payload.title,
        date: payload.date ? new Date(payload.date) : new Date(),
        lostDays: Number(payload.lostDays) || 0,
        status: payload.status || 'open',
        ...assignmentData(payload),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        closedDate:
          payload.status === 'closed'
            ? payload.closedDate
              ? new Date(payload.closedDate)
              : new Date()
            : null,
        investigation: payload.investigation?.trim() || null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.investigation,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment || payload.investigation,
      metadata: {
        ref: created.ref,
        incidentType: created.incidentType,
        severity: created.severity,
        activityId: created.activityId,
      },
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SAFETY_INCIDENT,
    records: [row],
  });
  return enriched;
};

const updateSafetyIncident = async ({
  orgId,
  projectId,
  incidentId,
  payload,
  userId,
  userRole,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'SAFETY_INCIDENT_NOT_FOUND',
      'Safety incident not found',
    );
  }

  const nextStatus = payload.status ?? existing.status;
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.safetyIncident.update({
      where: { id: incidentId },
      data: {
        activityId,
        incidentType: payload.incidentType ?? existing.incidentType,
        severity:
          payload.severity !== undefined
            ? payload.severity?.trim() || null
            : existing.severity,
        title: payload.title ?? existing.title,
        date:
          payload.date !== undefined
            ? payload.date
              ? new Date(payload.date)
              : null
            : existing.date,
        lostDays:
          payload.lostDays !== undefined
            ? Number(payload.lostDays) || 0
            : existing.lostDays,
        status: nextStatus,
        ...assignmentData(payload, existing),
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
        closedDate:
          nextStatus === 'closed'
            ? payload.closedDate
              ? new Date(payload.closedDate)
              : existing.closedDate || new Date()
            : null,
        investigation:
          payload.investigation !== undefined
            ? payload.investigation?.trim() || null
            : existing.investigation,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment,
      metadata: {
        ref: updated.ref,
        incidentType: updated.incidentType,
        severity: updated.severity,
        activityId: updated.activityId,
      },
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SAFETY_INCIDENT,
    records: [row],
  });
  return enriched;
};

const deleteSafetyIncident = async ({ orgId, projectId, incidentId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'SAFETY_INCIDENT_NOT_FOUND',
      'Safety incident not found',
    );
  }

  await prisma.safetyIncident.delete({ where: { id: incidentId } });
  return { deleted: true };
};

module.exports = {
  listSafetyIncidents,
  createSafetyIncident,
  updateSafetyIncident,
  deleteSafetyIncident,
};
