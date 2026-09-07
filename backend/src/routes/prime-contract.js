const express = require("express");
const { body, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { moneyBody } = require("../utils/money");
const service = require("../services/prime-contract.service");

/**
 * The client contract and what it bills (OCTA-COM-PRIME-051).
 *
 * Sits under the `ipc` permission module: whoever may see a payment
 * certificate may see the contract it is measured against, and whoever
 * certifies may record what the client paid.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const rate = (name) =>
  body(name).optional({ nullable: true }).isFloat({ min: 0, max: 100 }).toFloat();

router.get(
  "/",
  requirePermission("ipc", "read"),
  asyncHandler(async (req, res) => {
    const contract = await service.ensureContract({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
    });
    return sendSuccess(res, service.serializeContract(contract));
  })
);

router.patch(
  "/",
  requirePermission("ipc", "update", { transition: "contract.manage" }),
  [
    body("title").optional().isString().trim().isLength({ min: 1, max: 200 }),
    body("contractType").optional().isIn(service.CONTRACT_TYPES),
    body("status").optional().isIn(service.CONTRACT_STATUSES),
    body("currency").optional().isString().trim().isLength({ min: 3, max: 3 }),
    body("clientCompanyId").optional({ nullable: true }).isUUID(),
    moneyBody("originalValue"),
    moneyBody("advanceAmount"),
    rate("retentionRate"),
    rate("retentionCapRate"),
    rate("advanceRate"),
    rate("advanceRecoveryRate"),
    rate("materialsOnSiteRate"),
    rate("taxRate"),
    body("paymentTermsDays").optional().isInt({ min: 0, max: 365 }).toInt(),
    body("startDate").optional({ nullable: true }).isISO8601(),
    body("completionDate").optional({ nullable: true }).isISO8601(),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.updateContract({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        payload: req.body,
      })
    )
  )
);

/** The client billing statement: the summary block and the SOV table. */
router.get(
  "/statement",
  requirePermission("ipc", "read"),
  [query("period").optional().isString().trim().isLength({ max: 40 }), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.buildStatement({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        period: req.query.period ?? null,
      })
    )
  )
);

/** What the client owes, and how late it is. */
router.get(
  "/receivables",
  requirePermission("ipc", "read"),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.receivables({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
      })
    )
  )
);

router.get(
  "/advances",
  requirePermission("ipc", "read"),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.listAdvances({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
      })
    )
  )
);

/** The client pays the advance. */
router.post(
  "/advances",
  requirePermission("ipc", "create", { transition: "advance.record" }),
  [
    moneyBody("amount", { required: true }),
    body("reference").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body("occurredAt").optional({ nullable: true }).isISO8601(),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.recordAdvancePayment({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        payload: req.body,
      }),
      201
    )
  )
);

module.exports = router;
