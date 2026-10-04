const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const documentTextService = require("../services/document-text.service");

/**
 * Document content search and text extraction status (OCTA-DOC-TEXT-010).
 * Search needs document_control.read; individual hits are further filtered
 * by the modules the document is linked from. Re-indexing needs
 * document_control.update.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const viewerFor = (req) => {
  // a party-scoped person reaches a record with a rule of its own — routed
  // to a party, attributed to a company, a person's own — through that rule
  // (CX21-530, CX21-540); a member of the project through the modules alone
  const partyScoped = require("../services/company-party.service").isPartyScopedAccess(req.projectAccess || {});
  const parties = req.projectAccess?.partyAccess || [];
  return {
    id: req.user.id,
    userId: req.user.id,
    canRead: (moduleName) => hasPermission(req, moduleName, "read"),
    partyIds: partyScoped ? parties.map((party) => party.projectPartyId).filter(Boolean) : null,
    companyIds: partyScoped ? [...new Set(parties.map((party) => party.companyId).filter(Boolean))] : null,
  };
};

router.get(
  "/search",
  requirePermission("document_control", "read"),
  [
    query("q").isString().trim().isLength({ min: 1, max: 200 }),
    query("limit").isString().optional().isInt({ min: 1, max: 50 }).toInt(),
    query("semantic").isString().optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await documentTextService.searchDocuments({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      q: req.query.q,
      limit: req.query.limit || 20,
      semantic: Boolean(req.query.semantic),
      viewer: viewerFor(req),
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/index-status",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => {
    const result = await documentTextService.getIndexStatus({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/reindex",
  requirePermission("document_control", "update"),
  [body("force").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => {
    const result = await documentTextService.reindexProject({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      requestedBy: req.user.id,
      force: Boolean(req.body.force),
    });
    return sendSuccess(res, result, 202);
  }),
);

router.get(
  "/:documentId/text",
  requirePermission("document_control", "read"),
  [
    param("documentId").isUUID(),
    query("maxChars").isString().optional().isInt({ min: 200, max: 200000 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await documentTextService.getDocumentText({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      documentId: req.params.documentId,
      viewer: viewerFor(req),
      maxChars: req.query.maxChars,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:documentId/extract",
  requirePermission("document_control", "update"),
  [param("documentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await documentTextService.enqueueExtraction({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      documentId: req.params.documentId,
      requestedBy: req.user.id,
      force: true,
    });
    return sendSuccess(res, result, result.queued ? 202 : 200);
  }),
);

module.exports = router;
