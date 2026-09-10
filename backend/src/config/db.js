const globalForPrisma = global;

/**
 * Lazy-initialise PrismaClient so that merely *importing* this module does
 * not throw when `prisma generate` has not been run (e.g. the OpenAPI
 * validation CI step, which imports the full Express app tree but never
 * makes any database calls).
 */
const getPrismaClient = () => {
  if (!globalForPrisma.__prisma) {
    const { PrismaClient } = require('@prisma/client');
    globalForPrisma.__prisma = new PrismaClient();
  }
  return globalForPrisma.__prisma;
};

const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      return getPrismaClient()[prop];
    },
    has(_target, prop) {
      return prop in getPrismaClient();
    },
  },
);

module.exports = { prisma };
