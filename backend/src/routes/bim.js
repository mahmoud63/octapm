const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { uploadLimiter } = require("../middleware/rate-limit");
const { validate } = require("../middleware/validate");
const fileStorageService = require("../services/file-storage.service");
const service = require("../services/bim.service");

/** BIM models (OCTA-BIM-IFC-043): `/projects/:projectId/bim`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actorFor = (req) => ({ id: req.user.id, name: req.user.name || null, role: getEffectiveRole(req) });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, fileStorageService.ensureTempUploadDirSync());
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname || "").toLowerCase() === ".ifc") cb(null, true);
    else cb(new HttpError(400, "UNSUPPORTED_FORMAT", "Upload the model as an IFC file (.ifc)"));
  },
});

const modelParam = [param("modelId").isUUID()];
const elementFilters = [
  query("ifcType").optional().isString().isLength({ max: 60 }),
  query("storeyGlobalId").optional().isString().isLength({ max: 60 }),
  query("typeName").optional().isString().isLength({ max: 200 }),
  query("q").optional().isString().isLength({ max: 200 }),
  query("linked").optional().isIn(["true", "false"]),
];

router.get("/models", requirePermission("bim", "read"), [query("status").optional().isIn(Object.values(service.STATUS)), query("discipline").optional().isIn(service.DISCIPLINES), query("current").optional().isIn(["true", "false"]), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listModels({ ...scope(req), query: req.query }))));

router.post(
  "/models",
  requirePermission("bim", "create"),
  uploadLimiter,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    try {
      const result = await service.createModel({ ...scope(req), userId: req.user.id, file: req.file, payload: req.body || {} });
      return sendSuccess(res, result, 202);
    } finally {
      await fileStorageService.cleanupTempFiles(req.file).catch(() => null);
    }
  }),
);

router.get(
  "/records/:recordType/:recordId/elements",
  requirePermission("bim", "read"),
  [param("recordType").isIn(service.LINK_RECORD_TYPES), param("recordId").isString().trim().notEmpty(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.elementsForRecord({ ...scope(req), recordType: req.params.recordType, recordId: req.params.recordId }))),
);

router.get("/models/:modelId", requirePermission("bim", "read"), [...modelParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getModel({ ...scope(req), modelId: req.params.modelId }))));
router.patch("/models/:modelId", requirePermission("bim", "update"), [...modelParam, body("name").optional().isString().trim().isLength({ min: 1, max: 200 }), body("discipline").optional({ nullable: true }).isIn([...service.DISCIPLINES, null]), body("notes").optional({ nullable: true }).isString().isLength({ max: 4000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateModel({ ...scope(req), modelId: req.params.modelId, payload: req.body, actor: actorFor(req) }))));
router.delete("/models/:modelId", requirePermission("bim", "delete"), [...modelParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteModel({ ...scope(req), modelId: req.params.modelId, actor: actorFor(req) }))));
router.post("/models/:modelId/reparse", requirePermission("bim", "update"), [...modelParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.reparseModel({ ...scope(req), modelId: req.params.modelId, actor: actorFor(req) }), 202)));
router.get("/models/:modelId/spatial", requirePermission("bim", "read"), [...modelParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.spatialTree({ ...scope(req), modelId: req.params.modelId }))));
router.get("/models/:modelId/quantities", requirePermission("bim", "read"), [...modelParam, ...elementFilters, query("groupBy").optional().isIn(["type", "storey"]), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.quantitySummary({ ...scope(req), modelId: req.params.modelId, query: req.query }))));

router.get(
  "/models/:modelId/elements/export.xlsx",
  requirePermission("bim", "export"),
  [...modelParam, ...elementFilters, validate],
  asyncHandler(async (req, res) => {
    const { workbook, filename } = await service.exportElements({ ...scope(req), modelId: req.params.modelId, query: req.query });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  }),
);

router.get("/models/:modelId/elements", requirePermission("bim", "read"), [...modelParam, ...elementFilters, query("cursor").optional().isUUID(), query("limit").optional().isInt({ min: 1, max: 500 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listElements({ ...scope(req), modelId: req.params.modelId, query: req.query }))));
router.get("/models/:modelId/elements/:elementId", requirePermission("bim", "read"), [...modelParam, param("elementId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getElement({ ...scope(req), modelId: req.params.modelId, elementId: req.params.elementId }))));

router.get("/models/:modelId/links", requirePermission("bim", "read"), [...modelParam, query("recordType").optional().isIn(service.LINK_RECORD_TYPES), query("recordId").optional().isString(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listLinks({ ...scope(req), modelId: req.params.modelId, query: req.query }))));
router.post(
  "/models/:modelId/links",
  requirePermission("bim", "update", { transition: "bim.link" }),
  [
    ...modelParam,
    body("recordType").isIn(service.LINK_RECORD_TYPES),
    body("recordId").isString().trim().notEmpty(),
    body("relationType").optional().isIn(service.RELATION_TYPES),
    body("elementIds").optional().isArray({ max: 5000 }),
    body("elementIds.*").isUUID(),
    body("filter").optional().isObject(),
    body("notes").optional({ nullable: true }).isString().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.createLinks({ ...scope(req), modelId: req.params.modelId, payload: req.body, actor: actorFor(req) }), 201)),
);
router.delete("/models/:modelId/links/:linkId", requirePermission("bim", "update", { transition: "bim.link" }), [...modelParam, param("linkId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteLink({ ...scope(req), modelId: req.params.modelId, linkId: req.params.linkId, actor: actorFor(req) }))));

module.exports = router;
