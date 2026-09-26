const { prisma } = require('../config/db');
const { addMoney, multiplyMoney, toMoneyNumber } = require('../utils/money');

/**
 * The extra services (VAT, overhead, contingency, …) a bill's totals carry.
 *
 * ExtraServicesConfig was the one table with no owner: read unfiltered, so
 * every organisation would have seen every other's percentages the day a row
 * was written (tenant matrix §1.2). ENT-1 gave it an orgId; the rows are now
 * read per organisation, and an organisation with none gets the platform
 * defaults — the same answer the empty table always gave.
 *
 * Callers know the organisation (a request) or only the project (the BOQ
 * services, which take projectId); with a project the organisation is read
 * from the project row.
 */
async function resolveOrgId({ orgId = null, projectId = null } = {}) {
  if (orgId) return orgId;
  if (!projectId) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true } });
  return project?.orgId ?? null;
}

async function getExtraServices({ orgId = null, projectId = null } = {}) {
  const resolvedOrgId = await resolveOrgId({ orgId, projectId });
  if (!resolvedOrgId) return getDefaultExtraServices();
  const configs = await prisma.extraServicesConfig.findMany({
    where: { orgId: resolvedOrgId },
    orderBy: { sortOrder: 'asc' },
  });
  if (configs.length === 0) return getDefaultExtraServices();
  return configs;
}

function getDefaultExtraServices() {
  return [
    { label: 'VAT', percentage: 5.0 },
    { label: 'Contractor Overhead', percentage: 10.0 },
    { label: 'Contingency', percentage: 3.0 },
  ];
}

/**
 * Replaces an organisation's extra services with the given list, in order.
 * Labels are unique per organisation (@@unique([orgId, label])); a repeated
 * label in the payload is refused by the route's validation before it gets
 * here. Rows of other organisations are never touched.
 */
async function setExtraServices({ orgId, services }) {
  const rows = services.map((service, index) => ({
    orgId,
    label: String(service.label).trim(),
    percentage: toMoneyNumber(service.percentage),
    sortOrder: index,
  }));
  return prisma.$transaction(async (tx) => {
    await tx.extraServicesConfig.deleteMany({ where: { orgId } });
    if (rows.length) await tx.extraServicesConfig.createMany({ data: rows });
    return tx.extraServicesConfig.findMany({ where: { orgId }, orderBy: { sortOrder: 'asc' } });
  });
}

async function calculateFinancials(items, valueSummary = null, { orgId = null, projectId = null } = {}) {
  const subtotal1 = items.reduce(
    (sum, item) => addMoney(sum, item.amount ?? 0),
    0,
  );
  const extraServices = await getExtraServices({ orgId, projectId });

  let runningTotal = subtotal1;
  const extraWithValues = extraServices.map((svc) => {
    const value = multiplyMoney(subtotal1, toMoneyNumber(svc.percentage) / 100);
    runningTotal = addMoney(runningTotal, value);
    return { label: svc.label, percentage: svc.percentage, value };
  });

  const subtotal2 = runningTotal;
  const totalProjectCost = subtotal2;

  return {
    subtotal1,
    extraServices: extraWithValues,
    subtotal2,
    totalProjectCost,
    scheduledValue: valueSummary?.scheduledValue ?? 0,
    unscheduledValue: valueSummary?.unscheduledValue ?? subtotal1,
    earnedValue: valueSummary?.earnedValue ?? 0,
    certifiedValue: valueSummary?.certifiedValue ?? 0,
  };
}

module.exports = { calculateFinancials, getExtraServices, getDefaultExtraServices, setExtraServices };
