const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { requirePermission, hasPermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/custom-field.service");
const { documentViewer } = require("../services/document-text.service");

/** Custom fields on a project (OCTA-PLAT-FIELDS-025): `/projects/:projectId/custom-fields`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
// The reader of a record's values, as every door to a record reads them: the
// module decision this request makes and, for a party-scoped person, their
// parties and companies — values are given and taken only for a record of
// this project the reader may see (custom-field.service recordsOnProject;
// certification L45).
const viewerOf = (req) =>
  documentViewer({
    userId: req.user.id,
    projectAccess: req.projectAccess || null,
    canRead: (moduleName) => hasPermission(req, moduleName, "read"),
  });
const manage = requirePermission("custom_field", "update", { transition: "custom_field.manage" });

/** Values follow the record's own module: read to see them, update to change them. */
const requireRecordAccess = (action) => (req, res, next) => {
  const recordType = req.params.recordType || req.query.recordType;
  const meta = service.RECORD_TYPES[recordType];
  if (!meta) return next(new HttpError(400, "CUSTOM_FIELD_RECORD_TYPE_UNKNOWN", `Unknown record type: ${recordType}`));
  if (!hasPermission(req, meta.module, action)) return next(new HttpError(403, "FORBIDDEN", `You cannot ${action} ${meta.label.toLowerCase()} on this project`));
  return next();
};

const definitionValidators = ({ requireLabel = false } = {}) => [
  requireLabel ? body("label").isString().trim().notEmpty().isLength({ max: 120 }) : body("label").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("key").optional().isString().trim().isLength({ max: 60 }),
  body("type").optional().isIn(service.FIELD_TYPES),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("options").optional({ nullable: true }).isArray({ max: 100 }),
  body("required").optional().isBoolean().toBoolean(),
  body("hidden").optional().isBoolean().toBoolean(),
  body("validation").optional({ nullable: true }).isObject(),
  body("condition").optional({ nullable: true }),
  body("position").optional().isInt({ min: 0, max: 10000 }).toInt(),
  body("status").optional().isIn(["active", "archived"]),
  validate,
];

router.get(
  "/record-types",
  requirePermission("custom_field", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, { recordTypes: await service.describeRecordTypes({ orgId: req.user.orgId }), fieldTypes: service.FIELD_TYPES, definitions: await service.listRecordTypes({ orgId: req.user.orgId }) })),
);

router.get(
  "/schema",
  requirePermission("custom_field", "read"),
  [query("recordType").isIn(service.RECORD_TYPE_KEYS), query("recordTypeKey").optional().isString().trim(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.schemaFor({ ...scope(req), recordType: req.query.recordType, recordTypeKey: req.query.recordTypeKey || null }))),
);

router.get(
  "/definitions",
  requirePermission("custom_field", "read"),
  [query("recordType").optional().isIn(service.RECORD_TYPE_KEYS), query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await service.listDefinitions({ ...scope(req), recordType: req.query.recordType || null, includeArchived: Boolean(req.query.includeArchived), scope: "all" }) })),
);

router.post(
  "/definitions",
  manage,
  [body("recordType").isIn(service.RECORD_TYPE_KEYS), body("type").isIn(service.FIELD_TYPES), ...definitionValidators({ requireLabel: true })],
  asyncHandler(async (req, res) => sendSuccess(res, await service.createDefinition({ ...scope(req), recordType: req.body.recordType, payload: req.body, actor: actor(req) }), 201)),
);

router.patch(
  "/definitions/:definitionId",
  manage,
  [param("definitionId").isUUID(), ...definitionValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await service.updateDefinition({ ...scope(req), definitionId: req.params.definitionId, payload: req.body, actor: actor(req) }))),
);

router.delete(
  "/definitions/:definitionId",
  manage,
  [param("definitionId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.archiveDefinition({ ...scope(req), definitionId: req.params.definitionId, actor: actor(req) }))),
);

router.get(
  "/fieldsets",
  requirePermission("custom_field", "read"),
  [query("recordType").optional().isIn(service.RECORD_TYPE_KEYS), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await service.listFieldsets({ orgId: req.user.orgId, recordType: req.query.recordType || null }) })),
);

router.get(
  "/assignments",
  requirePermission("custom_field", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, { items: await service.getProjectFieldsets(scope(req)) })),
);

router.put(
  "/assignments",
  manage,
  [body("recordType").isIn(service.RECORD_TYPE_KEYS), body("fieldsetId").optional({ nullable: true }).isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await service.setProjectFieldset({ ...scope(req), recordType: req.body.recordType, fieldsetId: req.body.fieldsetId || null, actor: actor(req) }) })),
);

router.get(
  "/values",
  [query("recordType").isIn(service.RECORD_TYPE_KEYS), query("recordIds").isString().notEmpty(), validate],
  requireRecordAccess("read"),
  asyncHandler(async (req, res) => {
    const recordIds = String(req.query.recordIds).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 500);
    const values = await service.valuesForProjectRecords({ ...scope(req), recordType: req.query.recordType, recordIds, viewer: viewerOf(req) });
    return sendSuccess(res, { items: Object.fromEntries(values) });
  }),
);

router.get(
  "/values/:recordType/:recordId",
  [param("recordType").isIn(service.RECORD_TYPE_KEYS), param("recordId").isUUID(), query("recordTypeKey").optional().isString().trim(), validate],
  requireRecordAccess("read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.getValues({ ...scope(req), recordType: req.params.recordType, recordId: req.params.recordId, recordTypeKey: req.query.recordTypeKey || null, viewer: viewerOf(req) }))),
);

router.put(
  "/values/:recordType/:recordId",
  [param("recordType").isIn(service.RECORD_TYPE_KEYS), param("recordId").isUUID(), body("values").isObject(), body("recordTypeKey").optional({ nullable: true }).isString().trim(), body("partial").optional().isBoolean().toBoolean(), body("context").optional().isObject(), validate],
  requireRecordAccess("update"),
  asyncHandler(async (req, res) =>
    sendSuccess(res, await service.setValues({ ...scope(req), recordType: req.params.recordType, recordId: req.params.recordId, values: req.body.values, recordTypeKey: req.body.recordTypeKey || null, context: req.body.context || {}, partial: Boolean(req.body.partial), actor: actor(req), viewer: viewerOf(req) })),
  ),
);

module.exports = router;
