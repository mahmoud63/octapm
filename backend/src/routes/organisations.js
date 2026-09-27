const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { workspaceDefaultValidators } = require("../middleware/workspace-defaults");
const organisationService = require("../services/organisation.service");

/**
 * Workspaces as things that are made and change kind (ENT-6).
 *
 * Not behind the members-only gate app.js puts in front of the company
 * routers: creating a further workspace is an identity's own act, open to
 * any active session — a guest of one workspace may start a company of
 * their own. Conversion is the owner's, checked in the service against the
 * workspace the token is bound to, never against an id the client chose.
 */
const router = express.Router();
router.use(authenticate);

const getRequestContext = (req) => ({
  userAgent: req.get("user-agent") || null,
  ipAddress: req.ip || req.socket?.remoteAddress || null,
});

/** A person's session, not a key: an API key acts as one person in one workspace and makes no new ones. */
const refuseApiKeys = (req, res, next) => {
  if (req.apiClient) {
    return next(new HttpError(403, "API_KEY_FORBIDDEN", "An API key cannot create or convert a workspace"));
  }
  return next();
};

router.post(
  "/",
  refuseApiKeys,
  [
    body("name").isString().trim().isLength({ min: 2, max: 120 }),
    ...workspaceDefaultValidators,
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await organisationService.createWorkspace({
      userId: req.user.id,
      name: req.body.name,
      currency: req.body.currency,
      timezone: req.body.timezone,
      actor: req.user,
      context: getRequestContext(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/:id/convert",
  refuseApiKeys,
  [
    param("id").isUUID(),
    body("name").optional({ values: "falsy" }).isString().trim().isLength({ min: 2, max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await organisationService.convertToCompany({
      orgId: req.params.id,
      actor: req.user,
      name: req.body.name,
      context: getRequestContext(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
