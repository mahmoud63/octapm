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

const getQualityDashboard = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const [ncrs, itps, defects, tests, safety, fieldItems] = await Promise.all([
    prisma.ncrRecord.findMany({ where: { projectId } }),
    prisma.itpRecord.findMany({ where: { projectId } }),
    prisma.defectRecord.findMany({ where: { projectId } }),
    prisma.materialTest.findMany({ where: { projectId } }),
    prisma.safetyIncident.findMany({ where: { projectId } }),
    // Punch items and observations share one table (OCTA-FLD-PUNCH-013 / OBS-015).
    prisma.punchItem?.findMany
      ? prisma.punchItem.findMany({
          where: { projectId, status: { notIn: ['closed', 'void'] } },
          select: { kind: true, observationType: true, status: true },
        })
      : Promise.resolve(null),
  ]);

  const majorNcrs = ncrs.filter((row) => row.severity === 'major').length;
  const minorNcrs = ncrs.filter((row) => row.severity === 'minor').length;
  const failedItps = itps.filter((row) => row.status === 'failed').length;

  const qualityScore = Math.max(
    0,
    100 - majorNcrs * 20 - minorNcrs * 8 - failedItps * 15,
  );

  const openPunch = fieldItems
    ? fieldItems.filter((row) => row.kind !== 'observation').length
    : null;
  const openObservations = (fieldItems || []).filter(
    (row) => row.kind === 'observation',
  );
  const observationsByType = {};
  for (const row of openObservations) {
    const type = row.observationType || 'untyped';
    observationsByType[type] = (observationsByType[type] || 0) + 1;
  }
  const openDefects =
    openPunch ?? defects.filter((row) => row.status !== 'closed').length;
  const testsPassed = tests.filter((row) => row.result === 'pass').length;
  const testsFailed = tests.filter((row) => row.result === 'fail').length;
  const dueAlerts = [...ncrs, ...itps, ...defects, ...tests, ...safety]
    .map(dueAlertForRecord)
    .filter(Boolean);

  return {
    metrics: {
      qualityScore,
      majorNcrs,
      minorNcrs,
      failedItps,
      openDefects,
      testsPassed,
      testsFailed,
      safetyIncidents: safety.length,
      safetyOpen: safety.filter((row) => row.status !== 'closed').length,
      observationsOpen: openObservations.length,
      safetyObservationsOpen: observationsByType.safety || 0,
      observationsByType,
      dueAlerts: dueAlerts.length,
      overdue: dueAlerts.filter((alert) => alert.severity === 'overdue').length,
    },
    trend: {
      ncrOpen: ncrs.filter((row) => row.status !== 'closed').length,
      itpPending: itps.filter((row) => row.status === 'pending').length,
      defectsOpen: openDefects,
      observationsOpen: openObservations.length,
    },
  };
};

module.exports = {
  getQualityDashboard,
};
