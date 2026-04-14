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

const normalizeSeverity = (value) => {
  if (!value) return 'MEDIUM';
  return String(value).toUpperCase();
};

const normalizeLevel = (value) => {
  if (!value) return 'medium';
  return String(value).toLowerCase();
};

const listRisks = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  return prisma.risk.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'asc' }, { ref: 'asc' }],
  });
};

const createRisk = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.risk.count({ where: { projectId } });
  const ref = `RSK-${String(count + 1).padStart(2, '0')}`;

  return prisma.risk.create({
    data: {
      projectId,
      ref,
      description: payload.description,
      probability: normalizeLevel(payload.probability),
      impact: normalizeLevel(payload.impact),
      severity: normalizeSeverity(payload.severity),
      mitigation: payload.mitigation?.trim() || null,
      phase: payload.phase?.trim() || null,
      owner: payload.owner?.trim() || null,
      status: payload.status || 'open',
    },
  });
};

const updateRisk = async ({ orgId, projectId, riskId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.risk.findFirst({
    where: { id: riskId, projectId },
  });
  if (!existing) {
    throw new HttpError(404, 'RISK_NOT_FOUND', 'Risk not found');
  }

  const data = {};
  if (payload.description !== undefined) data.description = payload.description;
  if (payload.probability !== undefined) {
    data.probability = normalizeLevel(payload.probability);
  }
  if (payload.impact !== undefined)
    data.impact = normalizeLevel(payload.impact);
  if (payload.severity !== undefined) {
    data.severity = normalizeSeverity(payload.severity);
  }
  if (payload.mitigation !== undefined) {
    data.mitigation = payload.mitigation?.trim() || null;
  }
  if (payload.phase !== undefined) data.phase = payload.phase?.trim() || null;
  if (payload.owner !== undefined) data.owner = payload.owner?.trim() || null;
  if (payload.status !== undefined) data.status = payload.status;

  return prisma.risk.update({ where: { id: riskId }, data });
};

const deleteRisk = async ({ orgId, projectId, riskId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.risk.findFirst({
    where: { id: riskId, projectId },
  });
  if (!existing) {
    throw new HttpError(404, 'RISK_NOT_FOUND', 'Risk not found');
  }

  await prisma.risk.delete({ where: { id: riskId } });
  return { deleted: true };
};

module.exports = {
  listRisks,
  createRisk,
  updateRisk,
  deleteRisk,
};
