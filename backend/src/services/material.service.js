const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const UNITS = [
  'TON',
  'KG',
  'M3',
  'M2',
  'M',
  'PCS',
  'L',
  'BAG',
  'SHEET',
  'ROLL',
  'LOAD',
];

const verifyActivity = async (orgId, projectId, activityId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const activity = await prisma.activity.findFirst({
    where: { id: activityId, projectId },
  });
  if (!activity)
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');

  return { project, activity };
};

const listMaterials = async ({ orgId, projectId, activityId }) => {
  await verifyActivity(orgId, projectId, activityId);

  return prisma.activityMaterial.findMany({
    where: { activityId },
    orderBy: { createdAt: 'asc' },
  });
};

const addMaterial = async ({ orgId, projectId, activityId, payload }) => {
  await verifyActivity(orgId, projectId, activityId);

  if (!UNITS.includes(payload.unit)) {
    throw new HttpError(
      400,
      'INVALID_UNIT',
      `Unit must be one of: ${UNITS.join(', ')}`,
    );
  }

  return prisma.activityMaterial.create({
    data: {
      activityId,
      name: payload.name,
      unit: payload.unit,
      qty: payload.qty,
    },
  });
};

const updateMaterial = async ({
  orgId,
  projectId,
  activityId,
  materialId,
  payload,
}) => {
  await verifyActivity(orgId, projectId, activityId);

  const material = await prisma.activityMaterial.findFirst({
    where: { id: materialId, activityId },
  });
  if (!material)
    throw new HttpError(404, 'MATERIAL_NOT_FOUND', 'Material not found');

  const data = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.unit !== undefined) {
    if (!UNITS.includes(payload.unit)) {
      throw new HttpError(
        400,
        'INVALID_UNIT',
        `Unit must be one of: ${UNITS.join(', ')}`,
      );
    }
    data.unit = payload.unit;
  }
  if (payload.qty !== undefined) data.qty = payload.qty;

  return prisma.activityMaterial.update({ where: { id: materialId }, data });
};

const deleteMaterial = async ({ orgId, projectId, activityId, materialId }) => {
  await verifyActivity(orgId, projectId, activityId);

  const material = await prisma.activityMaterial.findFirst({
    where: { id: materialId, activityId },
  });
  if (!material)
    throw new HttpError(404, 'MATERIAL_NOT_FOUND', 'Material not found');

  await prisma.activityMaterial.delete({ where: { id: materialId } });
  return { deleted: true };
};

module.exports = { listMaterials, addMaterial, updateMaterial, deleteMaterial };
