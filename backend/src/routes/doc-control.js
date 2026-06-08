const express = require('express');
const { getDocControlDashboard } = require('../services/doc-control.service');

const router = express.Router({ mergeParams: true });

router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await getDocControlDashboard({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
