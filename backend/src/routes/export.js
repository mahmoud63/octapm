const express = require('express');
const { asyncHandler } = require('../utils/async-handler');
const { authenticate } = require('../middleware/auth');
const { generateProjectExport } = require('../services/export.service');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

router.get(
  '/xlsx',
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

// TODO (Phase 2): add server-side PDF export endpoint via Puppeteer.

module.exports = router;
