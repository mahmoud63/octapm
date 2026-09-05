const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  RECORD_TYPES,
  workflowAssignmentData,
  attachWorkflowDetailsToRecords,
  recordDocumentRevisions,
  recordWorkflowHistory,
  syncWorkflowReferences,
} = require('./workflow-support.service');

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

  const records = await prisma.transmittal.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.TRANSMITTAL,
    records,
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

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.transmittal.create({
      data: {
        projectId,
        ref: payload.ref || `TRM-${String(count + 1).padStart(3, '0')}`,
        subject: payload.subject,
        sender: payload.sender,
        recipient: payload.recipient,
        method: payload.method || 'email',
        status: payload.status || 'pending_ack',
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          status: payload.status || 'pending_ack',
        })),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
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
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.TRANSMITTAL,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.TRANSMITTAL,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.notes,
      force: true,
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.TRANSMITTAL,
      record: created,
      payload,
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.TRANSMITTAL,
    records: [row],
  });
  return enriched;
};

const updateTransmittal = async ({
  orgId,
  projectId,
  transmittalId,
  payload,
  userId,
  userRole,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.transmittal.findFirst({
    where: { id: transmittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'TRANSMITTAL_NOT_FOUND', 'Transmittal not found');
  }

  const nextStatus = payload.status ?? existing.status;

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.transmittal.update({
      where: { id: transmittalId },
      data: {
        subject: payload.subject ?? existing.subject,
        sender: payload.sender ?? existing.sender,
        recipient: payload.recipient ?? existing.recipient,
        method: payload.method ?? existing.method,
        status: nextStatus,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          existing,
          status: nextStatus,
        })),
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
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
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.TRANSMITTAL,
      recordId: transmittalId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.TRANSMITTAL,
      recordId: transmittalId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment || payload.notes,
      userId,
      userRole,
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.TRANSMITTAL,
      record: updated,
      payload,
      userId,
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.TRANSMITTAL,
    records: [row],
  });
  return enriched;
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
