/**
 * CERT-2 (group trivial-7): the project health's material risk reads each
 * material's order lines WITH their order's status, as procurement.service
 * reads them (ALERT_MATERIAL_INCLUDE): a line on a cancelled or closed order
 * is no promise the material can still wait on (buildMaterialRiskRow
 * isOpenMaterialLine). Read without it, a material ordered on an order since
 * cancelled kept that order's promised date in the health's supply-chain risk.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1', role: 'pm', isCompanyAdmin: true };
    next();
  },
}));
jest.mock('../../services/earned-value.service', () => ({
  buildOfficialEvReport: jest.fn(async () => ({ ev: 0, ac: 0, spi: null, cpi: null, reporting: {} })),
}));

const day = (n) => new Date(Date.now() + n * 86_400_000);
// What the database holds: one material, ordered, needed in 5 days, on one
// line promised in 60 days on an order since cancelled.
const mockLine = { id: 'line-1', status: 'ordered', promisedDate: day(60), createdAt: day(-3), order: { status: 'cancelled' } };
const mockCalls = {};
jest.mock('../../config/db', () => {
  const model = (name) => ({
    findMany: jest.fn(async (args) => {
      mockCalls[name] = args;
      if (name !== 'activityMaterial') return [];
      // As Prisma answers: a line carries its order only when the query asked for it.
      const withOrder = Boolean(args?.include?.poLines?.include?.order);
      const { order, ...bare } = mockLine;
      return [{
        id: 'material-1', projectId: 'project-1', activityId: 'activity-1', name: 'Cable', status: 'ordered', plannedQty: 3,
        requiredDate: day(5), leadWeeks: 0, bufferDays: 0, receivedQty: 0, issuedQty: 0,
        activity: { id: 'activity-1', name: 'Pull cable' },
        poLines: [withOrder ? { ...bare, order } : bare],
      }];
    }),
    count: jest.fn(async () => 0),
  });
  const models = {};
  return {
    prisma: new Proxy({}, {
      get: (_target, name) => {
        if (name === 'project') return { findFirst: jest.fn(async () => ({ id: 'project-1', orgId: 'org-1', startDate: new Date('2026-01-05T00:00:00Z'), dataDate: null })) };
        if (!models[name]) models[name] = model(name);
        return models[name];
      },
    }),
  };
});

const app = express();
app.use(express.json());
app.use('/projects/:projectId/health', require('../health'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message } }));

describe('project health: a material\'s lines are read with their order\'s status (CERT-2 trivial-7)', () => {
  it('asks for each line\'s order status, as procurement.service does', async () => {
    const res = await request(app).get('/projects/project-1/health');
    expect(res.status).toBe(200);
    expect(mockCalls.activityMaterial.include.poLines).toEqual({ include: { order: { select: { status: true } } }, orderBy: { createdAt: 'desc' }, take: 5 });
  });

  it('a material on a cancelled order carries no promise and no late-delivery risk from it', async () => {
    const res = await request(app).get('/projects/project-1/health');
    expect(res.status).toBe(200);
    // Every risk row the answer lists for the material (the supply chain's top risks).
    const rows = [];
    const visit = (node) => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === 'object') {
        if (node.item === 'Cable') rows.push(node);
        Object.values(node).forEach(visit);
      }
    };
    visit(res.body);
    // Read with its order, the line is on a cancelled order: no promise, so no
    // "delivered after it is needed" on the cancelled order's date (60 days out).
    expect(rows.map((row) => row.expectedDeliveryDate ?? null).filter(Boolean)).toEqual([]);
  });
});
