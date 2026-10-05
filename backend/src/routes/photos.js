const express = require("express");
const { body, param, query } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const attachmentService = require("../services/attachment.service");
const photoAssistantService = require("../services/photo-assistant.service");
const { documentViewer } = require("../services/document-text.service");

/** Project photo gallery: every image attached anywhere on the project the caller may read. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);
// OCTA-AI-PHOTO-034: `/ai/*` and `/:photoId/ai/*` — registered before the photo routes.
router.use(require("./photo-assistant"));

// Who reads, as every door to a document reads them (document-text.service
// documentViewer): a photo is its document's, and its document its records'.
// The gallery, a photo's file and thumbnail, and an edit of a photo reach
// only a caller who may read that document (certification R31).
const viewerOf = (req) =>
  documentViewer({
    userId: req.user.id,
    projectAccess: req.projectAccess || null,
    canRead: (moduleName) => hasPermission(req, moduleName, "read"),
  });

router.get(
  "/",
  requirePermission("document_control", "read"),
  [
    query("from").isString().optional().custom(dateInput),
    query("to").isString().optional().custom(dateInput),
    query("locationId").isString().optional().isUUID(),
    query("tag").optional().isString().trim(),
    query("recordType").isString().optional().isIn(attachmentService.RECORD_TYPES),
    query("recordId").optional().isString().trim(),
    query("search").optional().isString().trim(),
    query("cursor").isString().optional().isUUID(),
    query("limit").isString().optional().isInt({ min: 1, max: 200 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await attachmentService.listPhotos({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
      viewer: viewerOf(req),
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
    body("locationId").optional({ nullable: true }).isString().isUUID(),
    body("takenAt").optional({ nullable: true }).custom(dateInput),
    validate,
  ],
  asyncHandler(async (req, res) => {
    // A photo the caller may not read is answered as a missing one.
    await photoAssistantService.readablePhoto({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      photoId: req.params.photoId,
      viewer: viewerOf(req),
    });
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
        viewer: viewerOf(req),
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
        viewer: viewerOf(req),
      }),
    ),
  ),
);

module.exports = router;
