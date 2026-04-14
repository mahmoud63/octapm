const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const RATE_TYPES = ['hourly', 'daily'];

const verifyProject = async (orgId, projectId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return project;
};

const listEquipment = async ({ orgId, projectId }) => {
  await verifyProject(orgId, projectId);

  return prisma.equipment.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });
};

const addEquipment = async ({ orgId, projectId, payload }) => {
  await verifyProject(orgId, projectId);

  if (!RATE_TYPES.includes(payload.rateType)) {
    throw new HttpError(
      400,
      'INVALID_RATE_TYPE',
      'rateType must be "hourly" or "daily"',
    );
  }

  return prisma.equipment.create({
    data: {
      projectId,
      name: payload.name,
      rateType: payload.rateType,
      rate: payload.rate ?? 0,
    },
  });
};

const updateEquipment = async ({ orgId, projectId, equipmentId, payload }) => {
  await verifyProject(orgId, projectId);

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, projectId },
  });
  if (!equipment)
    throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');

  const data = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.rateType !== undefined) {
    if (!RATE_TYPES.includes(payload.rateType)) {
      throw new HttpError(
        400,
        'INVALID_RATE_TYPE',
        'rateType must be "hourly" or "daily"',
      );
    }
    data.rateType = payload.rateType;
  }
  if (payload.rate !== undefined) data.rate = payload.rate;

  return prisma.equipment.update({ where: { id: equipmentId }, data });
};

const deleteEquipment = async ({ orgId, projectId, equipmentId }) => {
  await verifyProject(orgId, projectId);

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, projectId },
  });
  if (!equipment)
    throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');

  await prisma.equipment.delete({ where: { id: equipmentId } });
  return { deleted: true };
};

module.exports = {
  listEquipment,
  addEquipment,
  updateEquipment,
  deleteEquipment,
};
