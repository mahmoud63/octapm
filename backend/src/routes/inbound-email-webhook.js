const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { requestRefusal } = require("../middleware/reject-null-bytes");
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
      // A body no provider sends and the verification itself cannot read —
      // nested past the guard's depth, or an object with its own toString or
      // valueOf key, which a signature's `${timestamp}${token}` cannot turn
      // into text (a TypeError, 500) — is refused before verification
      // (CERT-2, robustness-6). It says nothing about the token.
      const malformed = requestRefusal(req, { characters: false, multipartText: false });
      if (malformed) throw malformed;
      service.verifyWebhook({ provider, headers: req.headers, query: req.query, body: req.body || {} });
      // The same guard as every other route (CERT-2), after the provider is
      // verified so an unauthenticated caller learns nothing from it. A NUL is
      // not a character of an e-mail (RFC 5322 text excludes it) and a lone
      // surrogate is not text at all: either would fail at the write with a
      // 500 the provider retries for ever. Refused 400, the temporary files
      // removed by the cleanup below.
      const refusal = requestRefusal(req, { multipartText: false });
      if (refusal) throw refusal;
      const parsed = service.parsePayload({ provider, body: req.body || {}, files });
      const result = await service.receive({ provider, parsed });
      return sendSuccess(res, result);
    } finally {
      await cleanup(files);
    }
  }),
);

module.exports = router;
