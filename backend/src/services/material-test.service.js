const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { nextRef } = require("../utils/reference-number");
const {
  RECORD_TYPES,
  workflowAssignmentData,
  attachWorkflowDetailsToRecords,
  assertPayloadActivity,
  primaryActivityIdFromPayload,
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

const listMaterialTests = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await prisma.materialTest.findMany({
    where: { projectId },
    orderBy: [{ testDate: 'desc' }, { createdAt: 'desc' }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.MATERIAL_TEST,
    records,
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
  await assertPayloadActivity({ projectId, payload });

  const generatedRef = await nextRef(prisma, { table: 'MaterialTest', scopeColumn: 'projectId', scopeId: projectId, prefix: 'MTEST' });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.materialTest.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || generatedRef,
        testType: payload.testType,
        specValue: payload.specValue?.trim() || null,
        actualValue: payload.actualValue?.trim() || null,
        result: payload.result || 'pending',
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          status: payload.result || 'pending',
        })),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        testDate: payload.testDate ? new Date(payload.testDate) : null,
        labName: payload.labName?.trim() || null,
        millCertRef: payload.millCertRef?.trim() || null,
        notes: payload.notes?.trim() || null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.MATERIAL_TEST,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.MATERIAL_TEST,
      recordId: created.id,
      newStatus: created.result,
      comment: payload.comment || payload.statusComment || payload.notes,
      force: true,
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.MATERIAL_TEST,
    records: [row],
  });
  return enriched;
};

const updateMaterialTest = async ({ orgId, projectId, testId, payload, userId, userRole }) => {
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

  const nextResult = payload.result ?? existing.result;
  await assertPayloadActivity({ projectId, payload });
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.materialTest.update({
      where: { id: testId },
      data: {
        activityId,
        testType: payload.testType ?? existing.testType,
        specValue:
          payload.specValue !== undefined
            ? payload.specValue?.trim() || null
            : existing.specValue,
        actualValue:
          payload.actualValue !== undefined
            ? payload.actualValue?.trim() || null
            : existing.actualValue,
        result: nextResult,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          existing,
          status: nextResult,
        })),
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
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
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.MATERIAL_TEST,
      recordId: testId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.MATERIAL_TEST,
      recordId: testId,
      oldStatus: existing.result,
      newStatus: updated.result,
      comment: payload.comment || payload.statusComment,
      userId,
      userRole,
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.MATERIAL_TEST,
    records: [row],
  });
  return enriched;
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
