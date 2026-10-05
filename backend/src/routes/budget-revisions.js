const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { body, param } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { validate } = require("../middleware/validate");
const { requirePermission, hasPermission } = require("../middleware/rbac");
const { sendSuccess } = require("../utils/api-response");
const { moneyBody } = require("../utils/money");
const {
  listBudgetRevisions,
  createBudgetRevision,
  updateBudgetRevision,
  deleteBudgetRevision,
} = require("../services/budget-revision.service");

const router = express.Router({ mergeParams: true });

// The revisions run from the project's contract value, one of its
// commercial terms: their totals go to a reader who may read those terms
// here (ipc:read, as GET /projects/:id decides; certification R21).
const contractValueReadable = (req) => hasPermission(req, "ipc", "read");

router.get(
  "/",
  requirePermission("cost", "read"),
  asyncHandler(async (req, res) => {
    const data = await listBudgetRevisions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      contractValueReadable: contractValueReadable(req),
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("cost", "create"),
  [
    body("title").isString().trim().notEmpty(),
    body("changeType").isIn(["addition", "deduction"]),
    moneyBody("amount", { required: true }),
    body("effectiveDate").optional().isString().custom(dateInput),
    body("status")
      .optional()
      .isIn(["draft", "submitted", "approved", "rejected"]),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("linkedChangeOrder").optional({ nullable: true }).isString(),
    body("notes").optional({ nullable: true }).isString(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createBudgetRevision({
      orgId: req.user.orgId,
      canApprove: hasPermission(req, "cost", "approve"),
      contractValueReadable: contractValueReadable(req),
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row, 201);
  }),
);

router.patch(
  "/:revisionId",
  requirePermission("cost", "update"),
  [
    param("revisionId").isUUID(),
    body("changeType").optional().isIn(["addition", "deduction"]),
    moneyBody("amount"),
    body("effectiveDate").optional().isString().custom(dateInput),
    body("status")
      .optional()
      .isIn(["draft", "submitted", "approved", "rejected"]),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("linkedChangeOrder").optional({ nullable: true }).isString(),
    body("notes").optional({ nullable: true }).isString(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateBudgetRevision({
      orgId: req.user.orgId,
      canApprove: hasPermission(req, "cost", "approve"),
      contractValueReadable: contractValueReadable(req),
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:revisionId",
  requirePermission("cost", "delete"),
  [param("revisionId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteBudgetRevision({
      orgId: req.user.orgId,
      canApprove: hasPermission(req, "cost", "approve"),
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
