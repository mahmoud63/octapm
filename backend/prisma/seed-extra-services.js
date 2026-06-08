/**
 * Run once after DB migration:
 *   node prisma/seed-extra-services.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.extraServicesConfig.count();
  if (existing > 0) {
    console.log('ExtraServicesConfig already seeded, skipping.');
    return;
  }

  await prisma.extraServicesConfig.createMany({
    data: [
      { label: 'VAT', percentage: 5.0, sortOrder: 0 },
      { label: 'Contractor Overhead', percentage: 10.0, sortOrder: 1 },
      { label: 'Contingency', percentage: 3.0, sortOrder: 2 },
    ],
  });

  console.log('ExtraServicesConfig seeded successfully.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
