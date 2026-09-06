const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const fileStorageService = require("../services/file-storage.service");
const service = require("../services/inbound-email.service");

/**
 * Inbound email webhook (OCTA-COMM-CONV-042): `POST /public/inbound-email/:provider`.
 * No login — the provider authenticates with the shared token (Postmark /
 * SendGrid / generic: `?token=`, `X-Inbound-Token` or basic-auth password) or
 * its HMAC signature (Mailgun). Multipart bodies (Mailgun, SendGrid) are
 * accepted with their attachments; JSON bodies carry attachments as base64.
 */
const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, fileStorageService.ensureTempUploadDirSync());
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase().slice(0, 12)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});

const cleanup = async (files = []) => {
  for (const file of files) await fileStorageService.cleanupTempFiles(file).catch(() => null);
};

router.post(
  "/:provider",
  (req, res, next) => (req.is("multipart/form-data") ? upload.any()(req, res, next) : next()),
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const files = Array.isArray(req.files) ? req.files : [];
    try {
      service.verifyWebhook({ provider, headers: req.headers, query: req.query, body: req.body || {} });
      const parsed = service.parsePayload({ provider, body: req.body || {}, files });
      const result = await service.receive({ provider, parsed });
      return sendSuccess(res, result);
    } finally {
      await cleanup(files);
    }
  }),
);

module.exports = router;
