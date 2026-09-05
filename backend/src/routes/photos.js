const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const attachmentService = require("../services/attachment.service");

/** Project photo gallery: every image attached anywhere on the project. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  requirePermission("document_control", "read"),
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    query("locationId").optional().isUUID(),
    query("tag").optional().isString().trim(),
    query("recordType").optional().isIn(attachmentService.RECORD_TYPES),
    query("recordId").optional().isString().trim(),
    query("search").optional().isString().trim(),
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await attachmentService.listPhotos({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:photoId",
  requirePermission("document_control", "create"),
  [
    param("photoId").isUUID(),
    body("caption").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("tags").optional(),
    body("locationId").optional({ nullable: true }).isUUID(),
    body("takenAt").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await attachmentService.updatePhoto({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      photoId: req.params.photoId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

const sendFile = (res, file) => {
  if (file.redirectUrl) return res.redirect(302, file.redirectUrl);
  res.type(file.mimeType);
  return res.sendFile(file.path);
};

router.get(
  "/:photoId/file",
  requirePermission("document_control", "read"),
  [param("photoId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendFile(
      res,
      await attachmentService.getPhotoFile({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        photoId: req.params.photoId,
        variant: "original",
      }),
    ),
  ),
);

router.get(
  "/:photoId/thumbnail",
  requirePermission("document_control", "read"),
  [param("photoId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendFile(
      res,
      await attachmentService.getPhotoFile({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        photoId: req.params.photoId,
        variant: "thumbnail",
      }),
    ),
  ),
);

module.exports = router;
