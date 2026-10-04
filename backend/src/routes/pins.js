const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const markupService = require("../services/markup.service");

/**
 * Pins on a sheet (OCTA-DWG-MARKUP-012). Mounted at
 * /projects/:projectId/drawings/sheets/:sheetId/pins. Dropping a pin needs
 * read on document control plus, for the target record, `create` when the
 * pin creates it or `read` when it links an existing one. Record-scoped
 * listing and deletion live in routes/record-pins.js.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const PIN_TYPES = Object.keys(markupService.PIN_TARGETS);

const actorFor = (req) => ({
  id: req.user.id,
  name: req.user.name || null,
  role: getEffectiveRole(req),
  projectAccess: req.projectAccess || null,
  canManage: hasPermission(req, "document_control", "update"),
});

router.get(
  "/",
  requirePermission("document_control", "read"),
  [param("sheetId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await markupService.listPins({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      sheetId: req.params.sheetId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  requirePermission("document_control", "read"),
  [
    param("sheetId").isUUID(),
    body("x").isFloat({ min: 0, max: 1 }).toFloat(),
    body("y").isFloat({ min: 0, max: 1 }).toFloat(),
    body("recordType").isIn(PIN_TYPES),
    body("recordId").optional({ nullable: true }).isString().trim().notEmpty(),
    body("create").optional({ nullable: true }).isObject(),
    body("sheetRevisionId").optional({ nullable: true }).isString().isUUID(),
    body("label").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("color").optional({ nullable: true }).isString().trim().isLength({ max: 9 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const moduleName = markupService.moduleForPinTarget(req.body.recordType);
    const creating = !req.body.recordId && Boolean(req.body.create);
    if (!hasPermission(req, moduleName, creating ? "create" : "read")) {
      const forbidden = new HttpError(
        403,
        "FORBIDDEN",
        creating
          ? `You cannot create ${req.body.recordType} records on this project`
          : `You cannot link ${req.body.recordType} records on this project`,
      );
      forbidden.details = { module: moduleName, action: creating ? "create" : "read" };
      throw forbidden;
    }
    const result = await markupService.createPin({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      sheetId: req.params.sheetId,
      sheetRevisionId: req.body.sheetRevisionId || null,
      x: req.body.x,
      y: req.body.y,
      recordType: req.body.recordType,
      recordId: req.body.recordId || null,
      create: req.body.create || null,
      label: req.body.label || null,
      color: req.body.color || null,
      actor: actorFor(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

module.exports = router;
