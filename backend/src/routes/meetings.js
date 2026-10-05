const express = require("express");
const { body, param, query } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { subscriptionGate } = require("../middleware/subscription-gate");
const { validate } = require("../middleware/validate");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const meetingService = require("../services/meeting.service");
const { dateInput } = require("../utils/date-input");
const { scalarFigure } = require("../utils/figure-input");

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(subscriptionGate);

const optionalUuid = (field) =>
  body(field).optional({ values: "falsy" }).isString().isUUID();

// A date is one text a Date reads (utils/date-input; CERT-2
// evidence-lines-5): isISO8601 alone checked a list element by element and a
// number by its digits, so ["2026-10-01"] and 20261001 were stored (201), and
// it passes the compact, week and ordinal forms ('20261001', '2026-W40',
// '2026-275') new Date() cannot read. Each is now a 400 VALIDATION_ERROR
// naming the field.

const optionalDate = (field) =>
  body(field).optional({ nullable: true }).isString().custom(dateInput);

const meetingPayloadValidators = ({ requireTitle = false } = {}) => [
  requireTitle
    ? body("title").isString().trim().notEmpty().isLength({ max: 255 })
    : body("title")
        .optional()
        .isString()
        .trim()
        .notEmpty()
        .isLength({ max: 255 }),
  optionalUuid("activityId"),
  optionalUuid("chairId"),
  body("meetingType").optional().isIn(meetingService.MEETING_TYPES),
  body("status")
    .optional()
    .isIn(
      meetingService.MEETING_STATUSES.filter((status) => status !== "archived"),
    ),
  body("location")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 500 }),
  body("objective")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 4000 }),
  body("minutesText")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 20000 }),
  optionalDate("scheduledAt"),
  optionalDate("startedAt"),
  optionalDate("endedAt"),
  optionalDate("nextMeetingAt"),
  body("attendees").optional().isArray({ max: 200 }),
  body("attendees.*.activityId").optional({ values: "falsy" }).isString().isUUID(),
  body("attendees.*.userId").optional({ values: "falsy" }).isString().isUUID(),
  body("attendees.*.projectPartyId").optional({ values: "falsy" }).isString().isUUID(),
  body("attendees.*.name")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 255 }),
  // One address (CERT-2 evidence-6): isEmail checks a list element by element, and
  // ["a@x", "b@x"] was stored as "a@x,b@x".
  body("attendees.*.email").optional({ values: "falsy" }).isString().isEmail(),
  body("attendees.*.companyName")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 255 }),
  body("attendees.*.role").optional().isString().trim().isLength({ max: 80 }),
  body("attendees.*.attendanceStatus")
    .optional()
    .isIn(meetingService.ATTENDANCE_STATUSES),
  body("attendees.*.distributionRequired").optional().isBoolean(),
  optionalDate("attendees.*.attendedAt"),
  body("agendaItems").optional().isArray({ max: 200 }),
  body("agendaItems.*.activityId").optional({ values: "falsy" }).isString().isUUID(),
  body("agendaItems.*.presenterId").optional({ values: "falsy" }).isString().isUUID(),
  // One value (utils/figure-input; CERT-2 evidence-6): [1] and [] passed isInt and were stored (201).
  body("agendaItems.*.sortOrder").optional().custom(scalarFigure).bail().isInt({ min: 0, max: 10000 }),
  body("agendaItems.*.title")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 }),
  body("agendaItems.*.notes")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 4000 }),
  body("agendaItems.*.status").optional().isIn(meetingService.AGENDA_STATUSES),
  body("decisions").optional().isArray({ max: 200 }),
  body("decisions.*.activityId").optional({ values: "falsy" }).isString().isUUID(),
  body("decisions.*.decidedById").optional({ values: "falsy" }).isString().isUUID(),
  body("decisions.*.title")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 }),
  body("decisions.*.decision")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 6000 }),
  body("decisions.*.impact")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 4000 }),
  optionalDate("decisions.*.decidedAt"),
  body("actionItems").optional().isArray({ max: 200 }),
  body("actionItems.*.activityId").optional({ values: "falsy" }).isString().isUUID(),
  body("actionItems.*.taskId").optional({ values: "falsy" }).isString().isUUID(),
  body("actionItems.*.ownerId").optional({ values: "falsy" }).isString().isUUID(),
  body("actionItems.*.itemNumber")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 50 }),
  body("actionItems.*.title")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 }),
  body("actionItems.*.description")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 4000 }),
  body("actionItems.*.ownerName")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 255 }),
  body("actionItems.*.ownerEmail").optional({ values: "falsy" }).isString().isEmail(),
  body("actionItems.*.dueDate").optional().isString().custom(dateInput),
  body("actionItems.*.priority")
    .optional()
    .isIn(meetingService.ACTION_PRIORITIES),
  body("actionItems.*.status").optional().isIn(meetingService.ACTION_STATUSES),
  body("actionItems.*.createTask").optional().isBoolean(),
  validate,
];

router.get(
  "/",
  requirePermission("meeting", "read"),
  [
    query("cursor").isString().optional({ values: "falsy" }).isUUID(),
    query("limit").isString().optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").optional().isString().trim(),
    query("meetingType").optional().isString().trim(),
    query("activityId").isString().optional({ values: "falsy" }).isUUID(),
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
    query("search").optional().isString().trim(),
    query("sortBy").isString()
      .optional()
      .isIn(["created", "updated", "scheduled", "status", "type"]),
    query("sortDir").isString().optional().isIn(["asc", "desc"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await meetingService.listMeetings({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      role: req.user.role,
      projectAccess: req.projectAccess || null,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  requirePermission("meeting", "create"),
  meetingPayloadValidators({ requireTitle: true }),
  asyncHandler(async (req, res) => {
    const result = await meetingService.createMeeting({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  "/:id",
  requirePermission("meeting", "read"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await meetingService.getMeetingById({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      meetingId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:id",
  requirePermission("meeting", "update"),
  [param("id").isUUID(), ...meetingPayloadValidators()],
  asyncHandler(async (req, res) => {
    const result = await meetingService.updateMeeting({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      meetingId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/distribute",
  requirePermission("meeting", "submit", { transition: "meeting.distribute" }),
  [
    param("id").isUUID(),
    body("message")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 4000 }),
    body("includeAttendees").optional().isBoolean(),
    body("recipientUserIds").optional().isArray({ max: 200 }),
    body("recipientUserIds.*").isString().isUUID(),
    body("userIds").optional().isArray({ max: 200 }),
    body("userIds.*").isString().isUUID(),
    body("projectPartyIds").optional().isArray({ max: 200 }),
    body("projectPartyIds.*").isString().isUUID(),
    body("partyIds").optional().isArray({ max: 200 }),
    body("partyIds.*").isString().isUUID(),
    body("recipients").optional().isArray({ max: 200 }),
    body("recipients.*.name")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 255 }),
    body("recipients.*.email").optional({ values: "falsy" }).isString().isEmail(),
    body("recipients.*.companyName")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 255 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await meetingService.distributeMeeting({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      meetingId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/comments",
  requirePermission("meeting", "submit", { transition: "meeting.comment" }),
  [
    param("id").isUUID(),
    body("body").isString().trim().notEmpty().isLength({ max: 4000 }),
    body("activityId").optional({ values: "falsy" }).isString().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await meetingService.addMeetingComment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      meetingId: req.params.id,
      body: req.body.body,
      activityId: req.body.activityId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.delete(
  "/:id",
  requirePermission("meeting", "delete"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await meetingService.deleteMeeting({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      meetingId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
