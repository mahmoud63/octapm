const { prisma } = require('../config/db');

const PROCUREMENT_KEYWORDS = [
  'procure',
  'procurement',
  'purchase',
  'order',
  'supply',
  'delivery',
  'fabrication',
  'manufacture',
  'vendor',
  'equipment',
  'material',
  'long lead',
  'long-lead',
  'submittal',
  'shop drawing',
  'approval',
];

function isProcurementActivity(name) {
  const source = String(name || '').toLowerCase();
  return PROCUREMENT_KEYWORDS.some((keyword) => source.includes(keyword));
}

async function seedCostRecords(projectId) {
  const activities = await prisma.activity.findMany({
    where: { projectId, isActive: true },
    select: { id: true },
  });

  if (!activities.length) return 0;

  const existing = await prisma.costRecord.findMany({
    where: { projectId },
    select: { activityId: true },
  });

  const covered = new Set(existing.map((row) => row.activityId));
  const toCreate = activities.filter((activity) => !covered.has(activity.id));

  if (!toCreate.length) return 0;

  await prisma.costRecord.createMany({
    data: toCreate.map((activity) => ({
      projectId,
      activityId: activity.id,
      labour: 0,
      material: 0,
      equipment: 0,
      subcontract: 0,
      indirect: 0,
      overhead: 0,
      contingency: 0,
      budget: 0,
      committed: 0,
      actual: 0,
      forecast: 0,
    })),
    skipDuplicates: true,
  });

  return toCreate.length;
}

function formatOrderBy(earlyStart) {
  if (earlyStart === null || earlyStart === undefined) return null;
  const day = Number(earlyStart);
  if (!Number.isFinite(day)) return null;
  return `D+${Math.max(0, Math.round(day))}`;
}

async function seedLongLeadItems(projectId) {
  const activities = await prisma.activity.findMany({
    where: { projectId, isActive: true },
    select: { id: true, name: true, earlyStart: true },
  });

  const procurementActivities = activities.filter((activity) =>
    isProcurementActivity(activity.name),
  );

  if (!procurementActivities.length) return 0;

  const existing = await prisma.longLeadItem.findMany({
    where: { projectId },
    select: { activityId: true },
  });

  const covered = new Set(
    existing.map((row) => row.activityId).filter(Boolean),
  );
  const toCreate = procurementActivities.filter(
    (activity) => !covered.has(activity.id),
  );

  if (!toCreate.length) return 0;

  await prisma.longLeadItem.createMany({
    data: toCreate.map((activity) => ({
      projectId,
      activityId: activity.id,
      item: activity.name,
      leadWeeks: 0,
      requiredTiming: 'activity_start',
      needOffsetDays: 0,
      bufferDays: 14,
      orderBy: formatOrderBy(activity.earlyStart),
      warehouseStatus: 'not_received',
      criticality: 'medium',
      risk: 'Auto-seeded from imported schedule',
      status: 'not_ordered',
      supplier: null,
    })),
    skipDuplicates: true,
  });

  return toCreate.length;
}

async function runPostImportSeeding(projectId) {
  const costSeeded = await seedCostRecords(projectId);
  const longLeadSeeded = await seedLongLeadItems(projectId);

  return { costSeeded, longLeadSeeded };
}

module.exports = {
  runPostImportSeeding,
  seedCostRecords,
  seedLongLeadItems,
};
