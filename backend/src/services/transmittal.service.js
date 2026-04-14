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

const listTransmittals = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.transmittal.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });

  return {
    rows,
    summary: {
      pendingAck: rows.filter((row) => row.status === 'pending_ack').length,
      acknowledged: rows.filter((row) => row.status === 'acknowledged').length,
    },
  };
};

const createTransmittal = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.transmittal.count({ where: { projectId } });

  return prisma.transmittal.create({
    data: {
      projectId,
      ref: payload.ref || `TRM-${String(count + 1).padStart(3, '0')}`,
      subject: payload.subject,
      sender: payload.sender,
      recipient: payload.recipient,
      method: payload.method || 'email',
      status: payload.status || 'pending_ack',
      transmittedOn: payload.transmittedOn
        ? new Date(payload.transmittedOn)
        : new Date(),
      acknowledgedOn: payload.acknowledgedOn
        ? new Date(payload.acknowledgedOn)
        : null,
      documentsJson: payload.documentsJson || null,
      notes: payload.notes?.trim() || null,
    },
  });
};

const updateTransmittal = async ({
  orgId,
  projectId,
  transmittalId,
  payload,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.transmittal.findFirst({
    where: { id: transmittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'TRANSMITTAL_NOT_FOUND', 'Transmittal not found');
  }

  return prisma.transmittal.update({
    where: { id: transmittalId },
    data: {
      subject: payload.subject ?? existing.subject,
      sender: payload.sender ?? existing.sender,
      recipient: payload.recipient ?? existing.recipient,
      method: payload.method ?? existing.method,
      status: payload.status ?? existing.status,
      transmittedOn:
        payload.transmittedOn !== undefined
          ? payload.transmittedOn
            ? new Date(payload.transmittedOn)
            : null
          : existing.transmittedOn,
      acknowledgedOn:
        payload.acknowledgedOn !== undefined
          ? payload.acknowledgedOn
            ? new Date(payload.acknowledgedOn)
            : null
          : existing.acknowledgedOn,
      documentsJson:
        payload.documentsJson !== undefined
          ? payload.documentsJson || null
          : existing.documentsJson,
      notes:
        payload.notes !== undefined
          ? payload.notes?.trim() || null
          : existing.notes,
    },
  });
};

const deleteTransmittal = async ({ orgId, projectId, transmittalId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.transmittal.findFirst({
    where: { id: transmittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'TRANSMITTAL_NOT_FOUND', 'Transmittal not found');
  }

  await prisma.transmittal.delete({ where: { id: transmittalId } });
  return { deleted: true };
};

module.exports = {
  listTransmittals,
  createTransmittal,
  updateTransmittal,
  deleteTransmittal,
};
