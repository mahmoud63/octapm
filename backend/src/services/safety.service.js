const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

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

  const rows = await prisma.safetyIncident.findMany({
    where: { projectId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
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

const createSafetyIncident = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.safetyIncident.count({ where: { projectId } });

  return prisma.safetyIncident.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `SAF-${String(count + 1).padStart(3, '0')}`,
      incidentType: payload.incidentType,
      severity: payload.severity?.trim() || null,
      title: payload.title,
      date: payload.date ? new Date(payload.date) : new Date(),
      lostDays: Number(payload.lostDays) || 0,
      status: payload.status || 'open',
      investigation: payload.investigation?.trim() || null,
    },
  });
};

const updateSafetyIncident = async ({
  orgId,
  projectId,
  incidentId,
  payload,
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

  return prisma.safetyIncident.update({
    where: { id: incidentId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
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
      status: payload.status ?? existing.status,
      investigation:
        payload.investigation !== undefined
          ? payload.investigation?.trim() || null
          : existing.investigation,
    },
  });
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
