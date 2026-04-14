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

const listMaterialTests = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.materialTest.findMany({
    where: { projectId },
    orderBy: [{ testDate: 'desc' }, { createdAt: 'desc' }],
  });

  const passed = rows.filter((row) => row.result === 'pass').length;
  const failed = rows.filter((row) => row.result === 'fail').length;
  const pending = rows.filter((row) => row.result === 'pending').length;
  const passRate = passed + failed > 0 ? (passed / (passed + failed)) * 100 : 0;

  return {
    rows,
    summary: {
      passed,
      failed,
      pending,
      passRate,
    },
  };
};

const createMaterialTest = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.materialTest.count({ where: { projectId } });

  return prisma.materialTest.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `MTEST-${String(count + 1).padStart(3, '0')}`,
      testType: payload.testType,
      specValue: payload.specValue?.trim() || null,
      actualValue: payload.actualValue?.trim() || null,
      result: payload.result || 'pending',
      testDate: payload.testDate ? new Date(payload.testDate) : null,
      labName: payload.labName?.trim() || null,
      millCertRef: payload.millCertRef?.trim() || null,
      notes: payload.notes?.trim() || null,
    },
  });
};

const updateMaterialTest = async ({ orgId, projectId, testId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.materialTest.findFirst({
    where: { id: testId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'MATERIAL_TEST_NOT_FOUND',
      'Material test not found',
    );
  }

  return prisma.materialTest.update({
    where: { id: testId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
      testType: payload.testType ?? existing.testType,
      specValue:
        payload.specValue !== undefined
          ? payload.specValue?.trim() || null
          : existing.specValue,
      actualValue:
        payload.actualValue !== undefined
          ? payload.actualValue?.trim() || null
          : existing.actualValue,
      result: payload.result ?? existing.result,
      testDate:
        payload.testDate !== undefined
          ? payload.testDate
            ? new Date(payload.testDate)
            : null
          : existing.testDate,
      labName:
        payload.labName !== undefined
          ? payload.labName?.trim() || null
          : existing.labName,
      millCertRef:
        payload.millCertRef !== undefined
          ? payload.millCertRef?.trim() || null
          : existing.millCertRef,
      notes:
        payload.notes !== undefined
          ? payload.notes?.trim() || null
          : existing.notes,
    },
  });
};

const deleteMaterialTest = async ({ orgId, projectId, testId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.materialTest.findFirst({
    where: { id: testId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'MATERIAL_TEST_NOT_FOUND',
      'Material test not found',
    );
  }

  await prisma.materialTest.delete({ where: { id: testId } });
  return { deleted: true };
};

module.exports = {
  listMaterialTests,
  createMaterialTest,
  updateMaterialTest,
  deleteMaterialTest,
};
