const express = require("express");
const { param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const markupService = require("../services/markup.service");

/**
 * Record-scoped pin routes (OCTA-DWG-MARKUP-012), mounted at
 * /projects/:projectId/drawings/pins: which sheets a record is pinned on,
 * and pin removal.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const PIN_TYPES = Object.keys(markupService.PIN_TARGETS);

router.get(
  "/",
  requirePermission("document_control", "read"),
  [
    query("recordType").isString().isIn(PIN_TYPES),
    query("recordId").isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await markupService.listPinsForRecord({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      recordType: req.query.recordType,
      recordId: req.query.recordId,
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  "/:pinId",
  requirePermission("document_control", "read"),
  [param("pinId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await markupService.deletePin({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      pinId: req.params.pinId,
      actor: {
        id: req.user.id,
        name: req.user.name || null,
        canManage: hasPermission(req, "document_control", "update"),
      },
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
