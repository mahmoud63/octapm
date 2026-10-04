/**
 * POST /api/v1/telemetry/events — the web and mobile clients report which
 * screens were opened (`<module>.opened`). Product usage only.
 *
 * Accepts at most 20 events per call, each a catalogue name and optionally a
 * project id. Unknown names are dropped (counted in the answer); a project id
 * that is not a project of the caller's current workspace is dropped too, so
 * one company cannot write usage against another's project. The tenant and
 * person always come from the token, never the body. Answers 202 at once —
 * events are queued, and a telemetry problem never surfaces as an error.
 */
const express = require("express");
const { body } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { validate } = require("../middleware/validate");
const { prisma } = require("../config/db");
const telemetry = require("../services/platform/telemetry.service");
const { CLIENT_EVENTS } = require("../services/platform/product-event-catalog");
const { platformOf } = require("../middleware/platform-telemetry");

const MAX_EVENTS = 20;
const router = express.Router();

router.post(
  "/events",
  [
    body("events").isArray({ min: 1, max: MAX_EVENTS }),
    body("events.*.name").isString().isLength({ max: 64 }),
    body("events.*.projectId").optional({ nullable: true }).isUUID(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const events = req.body.events.filter((e) => Object.prototype.hasOwnProperty.call(CLIENT_EVENTS, e.name));
    const projectIds = [...new Set(events.map((e) => e.projectId).filter(Boolean))];
    const own = projectIds.length
      ? new Set(
          (
            await prisma.project.findMany({
              where: { id: { in: projectIds }, orgId: req.user.orgId },
              select: { id: true },
            })
          ).map((p) => p.id),
        )
      : new Set();
    let accepted = 0;
    for (const event of events) {
      if (event.projectId && !own.has(event.projectId)) continue;
      if (
        telemetry.trackClientEvent({
          orgId: req.user.orgId,
          userId: req.user.id,
          projectId: event.projectId || null,
          name: event.name,
          platform: platformOf(req),
        })
      ) {
        accepted += 1;
      }
    }
    return sendSuccess(res, { accepted, dropped: req.body.events.length - accepted }, 202);
  }),
);

module.exports = router;
