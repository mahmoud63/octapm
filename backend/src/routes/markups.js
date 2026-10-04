const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const markupService = require("../services/markup.service");

/**
 * Markup layers on a sheet (OCTA-DWG-MARKUP-012). Mounted at
 * /projects/:projectId/drawings/sheets/:sheetId/markups. Anyone who can
 * read document control has a personal layer; publishing needs
 * document_control.create.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const viewerFor = (req) => ({
  id: req.user.id,
  name: req.user.name || null,
  canManage: hasPermission(req, "document_control", "update"),
});

const shapesValidator = () => body("shapes").optional().isArray({ max: markupService.MAX_SHAPES });

router.get(
  "/",
  requirePermission("document_control", "read"),
  [param("sheetId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await markupService.listMarkups({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      sheetId: req.params.sheetId,
      viewer: viewerFor(req),
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/mine",
  requirePermission("document_control", "read"),
  [param("sheetId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await markupService.getPersonalMarkup({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      sheetId: req.params.sheetId,
      viewer: viewerFor(req),
    });
    return sendSuccess(res, result);
  }),
);

router.put(
  "/mine",
  requirePermission("document_control", "read"),
  [
    param("sheetId").isUUID(),
    shapesValidator(),
    body("name").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body("sheetRevisionId").optional({ nullable: true }).isString().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await markupService.savePersonalMarkup({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      sheetId: req.params.sheetId,
      viewer: viewerFor(req),
      shapes: req.body.shapes ?? [],
      name: req.body.name,
      sheetRevisionId: req.body.sheetRevisionId || null,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:markupId",
  requirePermission("document_control", "read"),
  [
    param("sheetId").isUUID(),
    param("markupId").isUUID(),
    shapesValidator(),
    body("name").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await markupService.updateMarkup({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      markupId: req.params.markupId,
      shapes: req.body.shapes,
      name: req.body.name,
      viewer: viewerFor(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:markupId/publish",
  requirePermission("document_control", "create"),
  [
    param("sheetId").isUUID(),
    param("markupId").isUUID(),
    body("name").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await markupService.publishMarkup({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      markupId: req.params.markupId,
      name: req.body.name,
      viewer: viewerFor(req),
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  "/:markupId",
  requirePermission("document_control", "read"),
  [param("sheetId").isUUID(), param("markupId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await markupService.deleteMarkup({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      markupId: req.params.markupId,
      viewer: viewerFor(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
