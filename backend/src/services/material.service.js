const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const procurementService = require('./procurement.service');

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
  const { project } = await verifyActivity(orgId, projectId, activityId);

  const rows = await prisma.activityMaterial.findMany({
    where: { activityId },
    include: {
      supplier: true,
      procurementPackage: true,
      materialMaster: true,
      poLines: {
        include: {
          order: true,
          supplier: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      usages: {
        include: {
          dailyReport: {
            select: { id: true, date: true, shift: true, status: true },
          },
        },
        orderBy: { usageDate: 'desc' },
        take: 10,
      },
      receiptLines: {
        include: {
          receipt: {
            select: {
              id: true,
              receiptNumber: true,
              receivedAt: true,
              status: true,
            },
          },
          dailyReport: {
            select: { id: true, date: true, shift: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      leadTimeAlerts: true,
      activity: { select: procurementService.ACTIVITY_SELECT },
    },
    orderBy: { createdAt: 'asc' },
  });

  return procurementService.enrichActivityMaterials(rows, project);
};

const resolveSupplier = async ({ tx = prisma, projectId, payload }) => {
  if (payload.supplierId) {
    const supplier = await tx.procurementSupplier.findFirst({
      where: { id: payload.supplierId, projectId },
    });
    if (!supplier) {
      throw new HttpError(400, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
    }
    return supplier;
  }

  const supplierName = payload.supplierName?.trim();
  if (!supplierName) return null;

  const existing = await tx.procurementSupplier.findFirst({
    where: { projectId, name: supplierName },
  });
  if (existing) return existing;

  return tx.procurementSupplier.create({
    data: {
      projectId,
      name: supplierName,
      status: 'approved',
      contactName: payload.supplierContact || null,
    },
  });
};

const ensurePackage = async ({ tx = prisma, projectId, packageId }) => {
  if (!packageId) return null;
  const row = await tx.procurementPackage.findFirst({
    where: { id: packageId, projectId },
  });
  if (!row) {
    throw new HttpError(
      400,
      'PROCUREMENT_PACKAGE_NOT_FOUND',
      'Procurement package not found',
    );
  }
  return row;
};

const parseNullableDate = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', 'Invalid material date');
  }
  return date;
};

const toNonNegativeInt = (value, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
};

const normalizeRequiredTiming = (value, fallback = 'activity_start') =>
  ['activity_start', 'activity_finish'].includes(value) ? value : fallback;

const normalizeMaterialWrite = (payload, existing = {}) => {
  const data = {};

  if (payload.name !== undefined) data.name = payload.name;
  if (payload.code !== undefined) data.code = payload.code?.trim() || null;
  if (payload.spec !== undefined) data.spec = payload.spec?.trim() || null;
  if (payload.notes !== undefined) data.notes = payload.notes?.trim() || null;
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
  if (payload.qty !== undefined) {
    data.qty = payload.qty;
    data.plannedQty = payload.qty;
  }
  if (payload.plannedQty !== undefined) {
    data.plannedQty = payload.plannedQty;
    data.qty = payload.plannedQty;
  }
  if (payload.materialMasterId !== undefined) {
    data.materialMasterId = payload.materialMasterId || null;
  }
  if (payload.procurementPackageId !== undefined) {
    data.procurementPackageId = payload.procurementPackageId || null;
  }
  if (payload.requiredDate !== undefined) {
    data.requiredDate = parseNullableDate(payload.requiredDate);
  }
  if (payload.requiredTiming !== undefined) {
    data.requiredTiming = normalizeRequiredTiming(
      payload.requiredTiming,
      existing.requiredTiming || 'activity_start',
    );
  }
  if (payload.needOffsetDays !== undefined) {
    data.needOffsetDays = toNonNegativeInt(payload.needOffsetDays);
  }
  if (payload.leadWeeks !== undefined) {
    data.leadWeeks = toNonNegativeInt(payload.leadWeeks);
  }
  if (payload.bufferDays !== undefined) {
    data.bufferDays = toNonNegativeInt(payload.bufferDays, 14);
  }
  if (payload.orderByDate !== undefined) {
    data.orderByDate = parseNullableDate(payload.orderByDate);
  }
  if (payload.status !== undefined) data.status = payload.status;

  return data;
};

const addMaterial = async ({ orgId, projectId, activityId, payload, actor }) => {
  const { project, activity } = await verifyActivity(orgId, projectId, activityId);

  if (!UNITS.includes(payload.unit)) {
    throw new HttpError(
      400,
      'INVALID_UNIT',
      `Unit must be one of: ${UNITS.join(', ')}`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const supplier = await resolveSupplier({ tx, projectId, payload });
    await ensurePackage({
      tx,
      projectId,
      packageId: payload.procurementPackageId,
    });

    const row = await tx.activityMaterial.create({
      data: {
        projectId,
        activityId,
        name: payload.name,
        unit: payload.unit,
        qty: payload.qty,
        plannedQty: payload.plannedQty ?? payload.qty,
        ...normalizeMaterialWrite(payload),
        supplierId: supplier?.id || null,
        createdBy: actor?.id || null,
        updatedBy: actor?.id || null,
      },
      include: {
        supplier: true,
        procurementPackage: true,
        materialMaster: true,
        poLines: true,
        usages: true,
        receiptLines: true,
        leadTimeAlerts: true,
        activity: { select: procurementService.ACTIVITY_SELECT },
      },
    });

    await procurementService.syncLeadTimeAlert({
      tx,
      projectId,
      project,
      material: { ...row, activity, poLines: [] },
    });

    return procurementService.enrichActivityMaterial(row, project);
  });
};

const updateMaterial = async ({
  orgId,
  projectId,
  activityId,
  materialId,
  payload,
  actor,
}) => {
  const { project, activity } = await verifyActivity(orgId, projectId, activityId);

  const material = await prisma.activityMaterial.findFirst({
    where: { id: materialId, activityId },
    include: {
      poLines: true,
      usages: true,
    },
  });
  if (!material)
    throw new HttpError(404, 'MATERIAL_NOT_FOUND', 'Material not found');

  return prisma.$transaction(async (tx) => {
    const supplier = await resolveSupplier({ tx, projectId, payload });
    await ensurePackage({
      tx,
      projectId,
      packageId: payload.procurementPackageId,
    });

    const data = normalizeMaterialWrite(payload, material);
    if (supplier) data.supplierId = supplier.id;
    if (actor?.id) data.updatedBy = actor.id;

    const row = await tx.activityMaterial.update({
      where: { id: materialId },
      data,
      include: {
        supplier: true,
        procurementPackage: true,
        materialMaster: true,
        poLines: true,
        usages: true,
        receiptLines: true,
        leadTimeAlerts: true,
        activity: { select: procurementService.ACTIVITY_SELECT },
      },
    });

    await procurementService.syncLeadTimeAlert({
      tx,
      projectId,
      project,
      material: { ...row, activity },
    });

    return procurementService.enrichActivityMaterial(row, project);
  });
};

const deleteMaterial = async ({ orgId, projectId, activityId, materialId }) => {
  await verifyActivity(orgId, projectId, activityId);

  const material = await prisma.activityMaterial.findFirst({
    where: { id: materialId, activityId },
    include: {
      poLines: { select: { id: true } },
      usages: { select: { id: true } },
    },
  });
  if (!material)
    throw new HttpError(404, 'MATERIAL_NOT_FOUND', 'Material not found');

  if (material.poLines.length > 0 || material.usages.length > 0) {
    throw new HttpError(
      409,
      'MATERIAL_HAS_PROCUREMENT_ACTIVITY',
      'Material cannot be deleted after PO lines, receipts, or usage have been recorded',
    );
  }

  await prisma.activityMaterial.delete({ where: { id: materialId } });
  return { deleted: true };
};

const recordMaterialUsage = async ({
  orgId,
  projectId,
  activityId,
  materialId,
  payload,
  actor,
}) =>
  procurementService.recordActivityMaterialUsage({
    orgId,
    projectId,
    activityId,
    materialId,
    payload,
    actor,
  });

module.exports = {
  listMaterials,
  addMaterial,
  updateMaterial,
  deleteMaterial,
  recordMaterialUsage,
};
