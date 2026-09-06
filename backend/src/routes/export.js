const express = require('express');
const { param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { generateProjectExport } = require('../services/export.service');
const {
  FORMATS: SCHEDULE_FORMATS,
  exportSchedule,
} = require('../services/schedule-export.service');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

router.get(
  '/xlsx',
  requirePermission('cost', 'export'),
  asyncHandler(async (req, res) => {
    const { workbook, filenameBase } = await generateProjectExport({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
    });

    const safeName = String(filenameBase)
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName || 'project'}-export.xlsx"`,
    );

    await workbook.xlsx.write(res);
    res.end();
  }),
);

// GET /projects/:projectId/export/schedule/:format — xer | p6xml | mspxml
router.get(
  '/schedule/:format',
  requirePermission('schedule', 'export'),
  [param('format').isIn(Object.keys(SCHEDULE_FORMATS)), validate],
  asyncHandler(async (req, res) => {
    const result = await exportSchedule({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
      format: req.params.format,
    });
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.content);
  }),
);

// TODO (Phase 2): add server-side PDF export endpoint via Puppeteer.

module.exports = router;
