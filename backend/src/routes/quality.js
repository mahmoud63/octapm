const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { getQualityDashboard } = require("../services/quality.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const data = await getQualityDashboard({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
