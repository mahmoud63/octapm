const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const companyPartyService = require("../services/company-party.service");

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const partyPayloadValidators = ({ requireRole = true } = {}) => [
  requireRole
    ? body("role").isString().trim().notEmpty().isIn(companyPartyService.PARTY_ROLES)
    : body("role").optional().isString().trim().notEmpty().isIn(companyPartyService.PARTY_ROLES),
  body("companyId").optional({ nullable: true }).isUUID(),
  body("companyName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("name").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("legalName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("tradeName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("registrationNumber").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("taxNumber").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("email").optional({ nullable: true }).isEmail().normalizeEmail(),
  body("phone").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("website").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("address").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("contactName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("contactEmail").optional({ nullable: true }).isEmail().normalizeEmail(),
  body("contactPhone").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("accessLevel").optional().isIn(companyPartyService.ACCESS_LEVELS),
  body("permissionProfile").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("status").optional().isIn(["active", "inactive"]),
];

router.get(
  "/",
  requirePermission("project_parties", "read"),
  [
    query("role").optional().isIn(["all", ...companyPartyService.PARTY_ROLES]),
    query("status").optional().isIn(["all", "active", "inactive"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await companyPartyService.listProjectParties({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  requirePermission("project_parties", "create", {
    transition: "party.assign",
  }),
  [...partyPayloadValidators({ requireRole: true }), validate],
  asyncHandler(async (req, res) => {
    const result = await companyPartyService.upsertProjectParty({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  "/:partyId",
  requirePermission("project_parties", "update", {
    transition: "party.update",
  }),
  [param("partyId").isUUID(), ...partyPayloadValidators({ requireRole: false }), validate],
  asyncHandler(async (req, res) => {
    const result = await companyPartyService.upsertProjectParty({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: { ...req.body, partyId: req.params.partyId },
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  "/:partyId",
  requirePermission("project_parties", "delete", {
    transition: "party.remove",
  }),
  [param("partyId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await companyPartyService.removeProjectParty({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      partyId: req.params.partyId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:partyId/members",
  requirePermission("project_parties", "submit", {
    transition: "party.member.add",
  }),
  [
    param("partyId").isUUID(),
    body("userId").isUUID(),
    body("role").optional().isString().trim().isLength({ max: 80 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await companyPartyService.addProjectPartyMember({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      partyId: req.params.partyId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.delete(
  "/:partyId/members/:userId",
  requirePermission("project_parties", "delete", {
    transition: "party.member.remove",
  }),
  [param("partyId").isUUID(), param("userId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await companyPartyService.removeProjectPartyMember({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      partyId: req.params.partyId,
      userId: req.params.userId,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
