const { prisma } = require('../config/db');
const { addMoney, multiplyMoney, toMoneyNumber } = require('../utils/money');

async function getExtraServices() {
  const configs = await prisma.extraServicesConfig.findMany({
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

async function calculateFinancials(items, valueSummary = null) {
  const subtotal1 = items.reduce(
    (sum, item) => addMoney(sum, item.amount ?? 0),
    0,
  );
  const extraServices = await getExtraServices();

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

module.exports = { calculateFinancials, getExtraServices, getDefaultExtraServices };
