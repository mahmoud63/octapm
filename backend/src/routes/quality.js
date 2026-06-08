const express = require('express');
const { getQualityDashboard } = require('../services/quality.service');

const router = express.Router({ mergeParams: true });

router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await getQualityDashboard({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
