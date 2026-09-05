const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const engine = require("../services/workflow-engine.service");

/** Workflow inbox across projects (OCTA-PLAT-WF-024): `/workflows/my-steps`. */
const router = express.Router();
router.use(authenticate);

router.get(
  "/my-steps",
  requirePermission("workflow", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, { items: await engine.myAssignments({ orgId: req.user.orgId, userId: req.user.id }) })),
);

module.exports = router;
