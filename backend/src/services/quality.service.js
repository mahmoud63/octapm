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

const getQualityDashboard = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const [ncrs, itps, defects, tests, safety] = await Promise.all([
    prisma.ncrRecord.findMany({ where: { projectId } }),
    prisma.itpRecord.findMany({ where: { projectId } }),
    prisma.defectRecord.findMany({ where: { projectId } }),
    prisma.materialTest.findMany({ where: { projectId } }),
    prisma.safetyIncident.findMany({ where: { projectId } }),
  ]);

  const majorNcrs = ncrs.filter((row) => row.severity === 'major').length;
  const minorNcrs = ncrs.filter((row) => row.severity === 'minor').length;
  const failedItps = itps.filter((row) => row.status === 'failed').length;

  const qualityScore = Math.max(
    0,
    100 - majorNcrs * 20 - minorNcrs * 8 - failedItps * 15,
  );

  const openDefects = defects.filter((row) => row.status !== 'closed').length;
  const testsPassed = tests.filter((row) => row.result === 'pass').length;
  const testsFailed = tests.filter((row) => row.result === 'fail').length;

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
    },
    trend: {
      ncrOpen: ncrs.filter((row) => row.status !== 'closed').length,
      itpPending: itps.filter((row) => row.status === 'pending').length,
      defectsOpen: openDefects,
    },
  };
};

module.exports = {
  getQualityDashboard,
};
