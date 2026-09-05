const crypto = require("crypto");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { validate } = require("../middleware/validate");
const fileStorageService = require("../services/file-storage.service");
const service = require("../services/bid.service");

/**
 * Bidder portal (OCTA-PRE-BID-027): `/public/bids/:token`. No login — the
 * token from the invitation email is the credential; every response is
 * scoped to that one invitation, so bidders never see each other.
 */
const router = express.Router();

const tokenParam = param("token").isString().trim().isLength({ min: 20, max: 200 });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, fileStorageService.ensureTempUploadDirSync());
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (fileStorageService.ALLOWED_WORKFLOW_MIME.has(file.mimetype)) return cb(null, true);
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  },
});

router.get("/:token", [tokenParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.portalView(req.params.token))));

router.get(
  "/:token/documents/:documentId",
  [tokenParam, param("documentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const file = await service.portalDocument(req.params.token, req.params.documentId);
    if (file.redirectUrl) return res.redirect(302, file.redirectUrl);
    res.type(file.mimeType);
    return res.sendFile(file.path);
  }),
);

router.post(
  "/:token/questions",
  [tokenParam, body("question").isString().trim().notEmpty().isLength({ max: 4000 }), body("askedBy").optional({ nullable: true }).isString().trim().isLength({ max: 120 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.portalAsk(req.params.token, { question: req.body.question, askedBy: req.body.askedBy || null }), 201)),
);

router.put(
  "/:token/bid",
  [tokenParam, body("lines").optional().isArray({ max: 500 }), body("lines.*.packageLineId").optional().isUUID(), body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }), body("inclusions").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }), body("exclusions").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }), body("validityDays").optional({ nullable: true }).isInt({ min: 0, max: 3650 }), body("leadTimeDays").optional({ nullable: true }).isInt({ min: 0, max: 3650 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.portalSaveBid(req.params.token, req.body))),
);

router.post("/:token/bid/submit", [tokenParam, body("submittedBy").optional({ nullable: true }).isString().trim().isLength({ max: 120 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.portalSubmitBid(req.params.token, { submittedBy: req.body?.submittedBy || null }))));

router.post("/:token/bid/withdraw", [tokenParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.portalWithdrawBid(req.params.token))));

router.post("/:token/decline", [tokenParam, body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.portalDecline(req.params.token, { reason: req.body?.reason || null }))));

router.post(
  "/:token/upload",
  [tokenParam, validate],
  upload.single("file"),
  asyncHandler(async (req, res) => {
    try {
      return sendSuccess(res, await service.portalUpload(req.params.token, { file: req.file }), 201);
    } finally {
      await fileStorageService.cleanupTempFiles(req.file ? [req.file] : []);
    }
  }),
);

module.exports = router;
