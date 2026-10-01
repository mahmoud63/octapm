const express = require("express");
const multer = require("multer");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/daily-log-assistant.service");
const dailyLog = require("../services/daily-log.service");
// PC-6: the applied draft answers with the day's log, which carries the
// quantities section — withheld like every other log answer (routes/daily-logs);
// the draft's evidence shows the model a submission's quantities only for a
// caller who may read the BOQ (daily-log-assistant.service progressLine).
const { boqFigureAccess, withheldDailyLog } = require("../utils/boq-figures");

/**
 * Daily report auto-draft (OCTA-AI-DAILY-030). Mounted inside the daily-log
 * router (`/projects/:projectId/daily-logs`), which already authenticates and
 * resolves project access. `/ai/*` sits before `/:date`.
 */
const router = express.Router({ mergeParams: true });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = param("date").matches(DATE_RE).withMessage("date must be YYYY-MM-DD");
const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const viewer = (req) => ({ id: req.user.id, projectAccess: req.projectAccess });

const AUDIO_TYPES = /^(audio\/|video\/webm|video\/mp4|application\/ogg)/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (AUDIO_TYPES.test(String(file.mimetype || ""))) return cb(null, true);
    return cb(new HttpError(400, "AI_TRANSCRIPTION_TYPE", "Attach an audio recording"));
  },
});

router.get(
  "/ai/status",
  requirePermission("progress", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, service.status())),
);

router.post(
  "/ai/transcribe",
  requirePermission("assistant", "read"),
  requirePermission("progress", "submit", { transition: "daily_log.submit" }),
  upload.single("audio"),
  [body("language").optional({ nullable: true }).isString().trim().isLength({ min: 2, max: 8 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.transcribe({ file: req.file, language: req.body?.language || null }))),
);

router.post(
  "/:date/ai/draft",
  requirePermission("assistant", "read"),
  requirePermission("progress", "update", { transition: "daily_log.update" }),
  [
    dateParam,
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 8000 }),
    body("includePhotos").optional().isBoolean().toBoolean(),
    body("photoIds").optional().isArray({ max: 20 }),
    body("photoIds.*").optional().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await service.draftReport({ ...scope(req), date: req.params.date, payload: req.body, user: { ...req.user, role: getEffectiveRole(req) }, viewer: viewer(req), access: boqFigureAccess(req) })),
  ),
);

router.post(
  "/:date/ai/apply",
  requirePermission("assistant", "read"),
  requirePermission("progress", "update", { transition: "daily_log.update" }),
  [
    dateParam,
    body("summary").optional({ nullable: true }).isString().trim().isLength({ max: 8000 }),
    body("notes").optional().isArray({ max: 20 }),
    body("notes.*.kind").optional({ nullable: true }).isIn(dailyLog.NOTE_KINDS),
    body("notes.*.text").isString().trim().isLength({ min: 1, max: 4000 }),
    body("notes.*.activityId").optional({ nullable: true }).isUUID(),
    body("notes.*.locationId").optional({ nullable: true }).isUUID(),
    body("delays").optional().isArray({ max: 10 }),
    body("delays.*.type").optional({ nullable: true }).isIn(dailyLog.DELAY_TYPES),
    body("delays.*.description").isString().trim().isLength({ min: 1, max: 2000 }),
    body("delays.*.hoursLost").optional({ nullable: true }).isFloat({ min: 0, max: 24 }),
    body("delays.*.activityId").optional({ nullable: true }).isUUID(),
    body("delays.*.locationId").optional({ nullable: true }).isUUID(),
    body("photoCaptions").optional().isArray({ max: 40 }),
    body("photoCaptions.*.photoId").isUUID(),
    body("photoCaptions.*.caption").isString().trim().isLength({ min: 1, max: 300 }),
    body("overwriteCaptions").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await service.applyDraft({ ...scope(req), date: req.params.date, payload: req.body, actor: actor(req), viewer: viewer(req) });
    return sendSuccess(res, { ...result, log: withheldDailyLog(result.log, boqFigureAccess(req)) });
  }),
);

module.exports = router;
