const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/purchase-order.service");

/**
 * The purchase order lifecycle (OCTA-COM-PO-053).
 *
 * Mounted at `/projects/:projectId/purchase-orders`, beside the older
 * `/procurement/purchase-orders` which still creates them and records
 * deliveries. This router owns the commercial half: approval, issue,
 * acknowledgement, cancellation and closing.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({
  orgId: req.user.orgId,
  projectId: req.params.projectId,
  // Carried on every read so ball-in-court can say "your action" rather than
  // naming a role the reader already holds.
  viewer: { id: req.user.id, role: getEffectiveRole(req) },
});
const actor = (req) => ({ id: req.user.id, role: getEffectiveRole(req) });
const orderId = param("orderId").isUUID();
const reason = (max = 2000) =>
  body("reason").optional({ nullable: true }).isString().trim().isLength({ max });

router.get(
  "/",
  requirePermission("procurement", "read"),
  [
    query("status").optional().isIn(service.STATUSES),
    query("supplierId").optional({ values: "falsy" }).isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.listOrders({
        ...scope(req),
        status: req.query.status ?? null,
        supplierId: req.query.supplierId ?? null,
      })
    )
  )
);

router.get(
  "/:orderId",
  requirePermission("procurement", "read"),
  [orderId, validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await service.getOrder({ ...scope(req), orderId: req.params.orderId }))
  )
);

/** The header, while the order is still ours to edit. */
router.patch(
  "/:orderId",
  requirePermission("procurement", "update", { transition: "po.issue" }),
  [
    orderId,
    body("item").optional().isString().trim().isLength({ min: 1, max: 200 }),
    body("supplierId").optional({ nullable: true }).isUUID(),
    body("supplier").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("buyer").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body("deliveryLocationId").optional({ nullable: true }).isUUID(),
    body("deliveryAddress").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("deliveryTerms").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("paymentTerms").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("taxRate").optional().isFloat({ min: 0, max: 100 }).toFloat(),
    body("requiredBy").optional({ nullable: true }).isISO8601(),
    body("promisedDate").optional({ nullable: true }).isISO8601(),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.updateOrder({
        ...scope(req),
        orderId: req.params.orderId,
        actor: actor(req),
        payload: req.body,
      })
    )
  )
);

const transitions = [
  ["submit", "submitOrder", "submit", "po.submit"],
  ["approve", "approveOrder", "approve", "po.approve"],
  ["reject", "rejectOrder", "approve", "po.approve"],
  ["issue", "issueOrder", "update", "po.issue"],
  ["acknowledge", "acknowledgeOrder", "update", "po.acknowledge"],
  ["cancel", "cancelOrder", "delete", "po.cancel"],
];

for (const [suffix, method, action, transition] of transitions) {
  router.post(
    `/:orderId/${suffix}`,
    requirePermission("procurement", action, { transition }),
    [
      orderId,
      reason(),
      ...(suffix === "acknowledge"
        ? [body("acknowledgedRef").optional({ nullable: true }).isString().trim().isLength({ max: 120 })]
        : []),
      validate,
    ],
    asyncHandler(async (req, res) =>
      sendSuccess(
        res,
        await service[method]({
          ...scope(req),
          orderId: req.params.orderId,
          actor: actor(req),
          reason: req.body?.reason ?? null,
          acknowledgedRef: req.body?.acknowledgedRef ?? null,
        })
      )
    )
  );
}

/**
 * Closing an order.
 *
 * Refused while deliveries are outstanding unless `force` is set and a reason
 * is given: short-closing on purpose and closing by mistake need telling
 * apart.
 */
router.post(
  "/:orderId/close",
  requirePermission("procurement", "update", { transition: "po.close" }),
  [orderId, reason(), body("force").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.closeOrder({
        ...scope(req),
        orderId: req.params.orderId,
        actor: actor(req),
        reason: req.body?.reason ?? null,
        force: Boolean(req.body?.force),
      })
    )
  )
);

module.exports = router;
