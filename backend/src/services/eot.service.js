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

const calculateEot = async ({
  orgId,
  projectId,
  eventName,
  eventType,
  delayDays,
  eotDaysGranted,
  ldRatePerDay,
  affectedActivityIds,
  analysis,
}) => {
  const project = await ensureProject({ orgId, projectId });

  const ids = Array.isArray(affectedActivityIds) ? affectedActivityIds : [];
  const affectedActivities = ids.length
    ? await prisma.activity.findMany({
        where: { projectId, id: { in: ids } },
        select: {
          id: true,
          name: true,
          wbsCode: true,
          totalFloat: true,
          isCritical: true,
        },
      })
    : [];

  const totalDelay = Number(delayDays) || 0;
  const eot = Math.max(0, Number(eotDaysGranted) || 0);
  const rate =
    Number(ldRatePerDay) > 0
      ? Number(ldRatePerDay)
      : Number(project.ldRatePerDay) || 0;

  const floatBuffer = affectedActivities.reduce((sum, activity) => {
    return sum + Math.max(0, Number(activity.totalFloat) || 0);
  }, 0);

  const floatSensitive = affectedActivities.filter(
    (activity) =>
      (Number(activity.totalFloat) || 0) <= 0 || activity.isCritical,
  ).length;

  const effectiveDelay = Math.max(0, totalDelay - floatBuffer);
  const ldApplicableDays = Math.max(0, effectiveDelay - eot);
  const ldLiability = ldApplicableDays * rate;

  const claimLetter = [
    `Subject: Extension of Time Claim - ${eventName}`,
    '',
    `Project: ${project.name}`,
    `Event Type: ${eventType || 'Delay Event'}`,
    `Claimed Delay: ${totalDelay} days`,
    `EOT Requested/Granted: ${eot} days`,
    `Impacted Critical Activities: ${floatSensitive}`,
    `Liquidated Damages Exposure: ${ldLiability.toFixed(2)}`,
    '',
    'We request formal review and approval of this EOT claim in line with contract provisions.',
    analysis ? `\nSupporting Analysis:\n${analysis}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    eventName,
    eventType: eventType || null,
    totalDelay,
    eotDaysGranted: eot,
    ldRatePerDay: rate,
    floatBuffer,
    effectiveDelay,
    ldApplicableDays,
    ldLiability,
    affectedActivities,
    analysis: analysis || null,
    claimLetter,
  };
};

const listEotClaims = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  return prisma.eotClaim.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });
};

const createEotClaim = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.eotClaim.count({ where: { projectId } });
  const ref = `EOT-${String(count + 1).padStart(2, '0')}`;

  const calc = await calculateEot({
    orgId,
    projectId,
    eventName: payload.eventName,
    eventType: payload.eventType,
    delayDays: payload.delayDays,
    eotDaysGranted: payload.eotDaysGranted,
    ldRatePerDay: payload.ldRatePerDay,
    affectedActivityIds: payload.affectedActivityIds,
    analysis: payload.analysis,
  });

  return prisma.eotClaim.create({
    data: {
      projectId,
      ref,
      eventName: calc.eventName,
      eventType: calc.eventType,
      delayDays: calc.totalDelay,
      eotDaysGranted: calc.eotDaysGranted,
      ldRatePerDay: calc.ldRatePerDay,
      ldLiability: calc.ldLiability,
      affectedActivities: calc.affectedActivities,
      analysis: calc.analysis,
      claimLetter: calc.claimLetter,
      status: payload.status || 'draft',
    },
  });
};

const updateEotClaim = async ({ orgId, projectId, claimId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.eotClaim.findFirst({
    where: { id: claimId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'EOT_CLAIM_NOT_FOUND', 'EOT claim not found');
  }

  return prisma.eotClaim.update({
    where: { id: claimId },
    data: {
      status: payload.status ?? existing.status,
      analysis: payload.analysis ?? existing.analysis,
      claimLetter: payload.claimLetter ?? existing.claimLetter,
      eotDaysGranted:
        payload.eotDaysGranted !== undefined
          ? Number(payload.eotDaysGranted) || 0
          : existing.eotDaysGranted,
    },
  });
};

module.exports = {
  calculateEot,
  listEotClaims,
  createEotClaim,
  updateEotClaim,
};
