const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { dueAlertForRecord } = require('./workflow-support.service');

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const getDocControlDashboard = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const [rfis, submittals, drawings, transmittals, correspondence] =
    await Promise.all([
      prisma.rfi.findMany({ where: { projectId } }),
      prisma.submittal.findMany({ where: { projectId } }),
      prisma.drawingRecord.findMany({ where: { projectId } }),
      prisma.transmittal.findMany({ where: { projectId } }),
      prisma.correspondence.findMany({ where: { projectId } }),
    ]);

  const now = Date.now();
  const avgRfiTurnaroundDays = (() => {
    const closed = rfis.filter((row) => row.answeredDate && row.raisedDate);
    if (!closed.length) return 0;
    const total = closed.reduce((sum, row) => {
      const diff =
        new Date(row.answeredDate).getTime() -
        new Date(row.raisedDate).getTime();
      return sum + diff / (1000 * 60 * 60 * 24);
    }, 0);
    return total / closed.length;
  })();
  const dueAlerts = [
    ...rfis,
    ...submittals,
    ...drawings,
    ...transmittals,
    ...correspondence,
  ]
    .map(dueAlertForRecord)
    .filter(Boolean);

  return {
    metrics: {
      rfiOpen: rfis.filter((row) => row.status !== 'closed').length,
      rfiOverdue: rfis.filter(
        (row) =>
          row.status !== 'closed' &&
          row.responseRequiredBy &&
          new Date(row.responseRequiredBy).getTime() < now,
      ).length,
      avgRfiTurnaroundDays,
      submittalPending: submittals.filter((row) => row.status === 'pending')
        .length,
      submittalResubmit: submittals.filter((row) => row.status === 'resubmit')
        .length,
      drawingsActive: drawings.filter((row) => row.status === 'active').length,
      drawingsSuperseded: drawings.filter((row) => row.status === 'superseded')
        .length,
      transmittalPendingAck: transmittals.filter(
        (row) => row.status === 'pending_ack',
      ).length,
      contractualNotices: correspondence.filter((row) => row.contractualNotice)
        .length,
      dueAlerts: dueAlerts.length,
      overdue: dueAlerts.filter((alert) => alert.severity === 'overdue').length,
    },
  };
};

module.exports = {
  getDocControlDashboard,
};
