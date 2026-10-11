const fs = require("fs/promises");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { JobError } = require("../jobs/errors");
const jobService = require("../jobs/job.service");
const fileStorageService = require("./file-storage.service");
const embeddingService = require("./embedding.service");
const { RECORD_TYPE_MODULES } = require("./attachment.service");
const { recordWorkspacePath } = require("../utils/record-links");
const {
  chunkText,
  extractDocumentText,
  isExtractableType,
} = require("../utils/document-text");

/**
 * Document text extraction, full-text search and optional embeddings
 * (OCTA-DOC-TEXT-010). Every uploaded text-bearing document is queued for
 * the `document.extract` job; the extracted text lands in DocumentText (with
 * a generated tsvector) and overlapping DocumentChunk rows that carry
 * embeddings when a provider is configured.
 */

const TEXT_STATUS = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  UNSUPPORTED: "unsupported",
  FAILED: "failed",
});

const EMBEDDING_STATUS = Object.freeze({
  NONE: "none",
  PENDING: "pending",
  READY: "ready",
  FAILED: "failed",
  DISABLED: "disabled",
});

const EXCERPT_LENGTH = 280;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const MAX_TEXT_RESPONSE_CHARS = 20_000;
const REINDEX_BATCH = 500;
const SEMANTIC_MIN_SCORE = 0.2;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const clampLimit = (value, fallback = DEFAULT_SEARCH_LIMIT) =>
  Math.min(Math.max(Number(value) || fallback, 1), MAX_SEARCH_LIMIT);

const excerptOf = (text) => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > EXCERPT_LENGTH ? `${clean.slice(0, EXCERPT_LENGTH - 1)}…` : clean;
};

const isExtractableDocument = (document) =>
  Boolean(document) &&
  document.documentType !== fileStorageService.DOCUMENT_TYPES.SITE_PHOTO &&
  !String(document.mimeType || "").toLowerCase().startsWith("image/") &&
  isExtractableType({
    mimeType: document.mimeType,
    fileName: document.fileName || document.originalName,
  });

const ensureDocument = async ({ orgId, projectId, documentId }) => {
  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, orgId, projectId },
  });
  if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found");
  return document;
};

const serializeTextRow = (row, { includeText = false, maxChars = MAX_TEXT_RESPONSE_CHARS } = {}) => {
  if (!row) return null;
  const base = {
    documentId: row.documentId,
    status: row.status,
    extractor: row.extractor || null,
    excerpt: row.excerpt || null,
    wordCount: row.wordCount || 0,
    pageCount: row.pageCount ?? null,
    chunkCount: row.chunkCount || 0,
    embeddingStatus: row.embeddingStatus || EMBEDDING_STATUS.NONE,
    embeddingModel: row.embeddingModel || null,
    error: row.error || null,
    extractedAt: toIso(row.extractedAt),
    updatedAt: toIso(row.updatedAt),
  };
  if (!includeText) return base;
  const text = row.text || "";
  return {
    ...base,
    text: text.length > maxChars ? text.slice(0, maxChars) : text,
    truncated: text.length > maxChars,
    totalChars: text.length,
  };
};

// ─── Queueing ─────────────────────────────────────────────────────────────

const markUnsupported = ({ orgId, projectId, documentId, reason }) =>
  prisma.documentText.upsert({
    where: { documentId },
    create: {
      orgId,
      projectId,
      documentId,
      status: TEXT_STATUS.UNSUPPORTED,
      error: reason,
      embeddingStatus: EMBEDDING_STATUS.NONE,
      extractedAt: new Date(),
    },
    update: {
      status: TEXT_STATUS.UNSUPPORTED,
      error: reason,
      text: null,
      excerpt: null,
      wordCount: 0,
      chunkCount: 0,
      extractedAt: new Date(),
    },
  });

/**
 * Queues extraction for one document. Returns `{ queued: false }` when the
 * document is not text-bearing or is already indexed (unless `force`).
 */
const enqueueExtraction = async ({
  orgId,
  projectId,
  documentId,
  requestedBy = null,
  force = false,
  document = null,
}) => {
  const target = document || (await ensureDocument({ orgId, projectId, documentId }));
  if (!isExtractableDocument(target)) {
    const row = await markUnsupported({ orgId, projectId, documentId, reason: "unsupported_type" });
    return { queued: false, status: row.status, jobId: null };
  }
  const existing = await prisma.documentText.findUnique({ where: { documentId } });
  if (existing?.status === TEXT_STATUS.READY && !force) {
    return { queued: false, status: existing.status, jobId: null };
  }
  await prisma.documentText.upsert({
    where: { documentId },
    create: { orgId, projectId, documentId, status: TEXT_STATUS.PENDING },
    update: { status: TEXT_STATUS.PENDING, error: null },
  });
  const job = await jobService.enqueueJob({
    orgId,
    projectId,
    type: jobService.JOB_TYPES.DOCUMENT_EXTRACT,
    payload: { documentId, force: Boolean(force) },
    requestedBy,
    priority: -1,
  });
  return { queued: true, status: TEXT_STATUS.PENDING, jobId: job.id };
};

const reindexProject = async ({ orgId, projectId, requestedBy = null, force = false }) => {
  const documents = await prisma.projectDocument.findMany({
    where: {
      orgId,
      projectId,
      status: { in: ["available", "linked"] },
      documentType: { not: fileStorageService.DOCUMENT_TYPES.SITE_PHOTO },
    },
    include: { text: { select: { status: true } } },
    orderBy: { uploadedAt: "desc" },
    take: REINDEX_BATCH,
  });
  const summary = { queued: 0, skipped: 0, unsupported: 0, total: documents.length };
  for (const document of documents) {
    if (!isExtractableDocument(document)) {
      summary.unsupported += 1;
      if (document.text?.status !== TEXT_STATUS.UNSUPPORTED) {
        await markUnsupported({ orgId, projectId, documentId: document.id, reason: "unsupported_type" });
      }
      continue;
    }
    if (document.text?.status === TEXT_STATUS.READY && !force) {
      summary.skipped += 1;
      continue;
    }
    await enqueueExtraction({ orgId, projectId, documentId: document.id, requestedBy, force, document });
    summary.queued += 1;
  }
  return summary;
};

const getIndexStatus = async ({ orgId, projectId }) => {
  const [groups, documentCount] = await Promise.all([
    prisma.documentText.groupBy({
      by: ["status"],
      where: { orgId, projectId },
      _count: { _all: true },
    }),
    prisma.projectDocument.count({
      where: {
        orgId,
        projectId,
        status: { in: ["available", "linked"] },
        documentType: { not: fileStorageService.DOCUMENT_TYPES.SITE_PHOTO },
      },
    }),
  ]);
  const counts = Object.fromEntries(Object.values(TEXT_STATUS).map((status) => [status, 0]));
  for (const group of groups) counts[group.status] = group._count?._all ?? group._count ?? 0;
  const indexed = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    documents: documentCount,
    indexed,
    notIndexed: Math.max(documentCount - indexed, 0),
    counts,
    embeddings: embeddingService.describe(),
  };
};

// ─── Extraction job ────────────────────────────────────────────────────────

const readDocumentBytes = async (document) => {
  const file = await fileStorageService.getProjectDocumentFile({
    orgId: document.orgId,
    projectId: document.projectId,
    key: document.id,
    documentType: document.documentType,
  });
  if (file.path) return fs.readFile(file.path);
  if (file.redirectUrl) {
    const response = await fetch(file.redirectUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new JobError(
        "DOCUMENT_DOWNLOAD_FAILED",
        `Download failed (${response.status})`,
        { retryable: response.status >= 500 || response.status === 429 },
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
  throw new JobError("DOCUMENT_FILE_UNAVAILABLE", "Stored file is unavailable", {
    retryable: false,
  });
};

const embedChunks = async ({ documentId, chunks }) => {
  if (!chunks.length) return { status: EMBEDDING_STATUS.NONE, model: null, error: null };
  if (!embeddingService.isEnabled()) {
    return { status: EMBEDDING_STATUS.DISABLED, model: null, error: null };
  }
  try {
    const vectors = await embeddingService.embedTexts(chunks.map((chunk) => chunk.text));
    for (let index = 0; index < chunks.length; index += 1) {
      const vector = vectors[index];
      if (!Array.isArray(vector) || !vector.length) continue;
      await prisma.documentChunk.update({
        where: { documentId_index: { documentId, index: chunks[index].index } },
        data: { embedding: vector },
      });
    }
    return { status: EMBEDDING_STATUS.READY, model: embeddingService.describe().model || null, error: null };
  } catch (error) {
    return {
      status: EMBEDDING_STATUS.FAILED,
      model: embeddingService.describe().model || null,
      error: String(error?.message || error).slice(0, 500),
    };
  }
};

const runDocumentExtractJob = async ({ job, payload = {}, updateProgress = async () => {} }) => {
  const document = await prisma.projectDocument.findFirst({
    where: { id: payload.documentId, orgId: job.orgId },
  });
  if (!document) {
    throw new JobError("DOCUMENT_NOT_FOUND", "Document no longer exists", { retryable: false });
  }
  const scope = { orgId: document.orgId, projectId: document.projectId, documentId: document.id };

  if (!isExtractableDocument(document)) {
    await markUnsupported({ ...scope, reason: "unsupported_type" });
    return { documentId: document.id, status: TEXT_STATUS.UNSUPPORTED, reason: "unsupported_type" };
  }

  await updateProgress({ step: "load", progress: 10 });
  const buffer = await readDocumentBytes(document);

  await updateProgress({ step: "extract", progress: 40 });
  const extracted = extractDocumentText({
    buffer,
    mimeType: document.mimeType,
    fileName: document.fileName || document.originalName,
  });

  if (extracted.status !== "ready") {
    const status = extracted.status === "failed" ? TEXT_STATUS.FAILED : TEXT_STATUS.UNSUPPORTED;
    await prisma.$transaction(async (tx) => {
      await tx.documentText.upsert({
        where: { documentId: document.id },
        create: {
          ...scope,
          status,
          extractor: extracted.extractor || null,
          error: extracted.reason || null,
          pageCount: extracted.pageCount ?? null,
          embeddingStatus: EMBEDDING_STATUS.NONE,
          extractedAt: new Date(),
        },
        update: {
          status,
          extractor: extracted.extractor || null,
          error: extracted.reason || null,
          text: null,
          excerpt: null,
          wordCount: 0,
          pageCount: extracted.pageCount ?? null,
          chunkCount: 0,
          embeddingStatus: EMBEDDING_STATUS.NONE,
          embeddingModel: null,
          embeddingError: null,
          extractedAt: new Date(),
        },
      });
      await tx.documentChunk.deleteMany({ where: { documentId: document.id } });
    });
    return { documentId: document.id, status, reason: extracted.reason || null };
  }

  const chunks = chunkText(extracted.text);
  await updateProgress({ step: "store", progress: 60 });
  const ready = {
    status: TEXT_STATUS.READY,
    extractor: extracted.extractor,
    text: extracted.text,
    excerpt: excerptOf(extracted.text),
    wordCount: extracted.wordCount,
    pageCount: extracted.pageCount ?? null,
    chunkCount: chunks.length,
    error: null,
    embeddingStatus: chunks.length ? EMBEDDING_STATUS.PENDING : EMBEDDING_STATUS.NONE,
    embeddingModel: null,
    embeddingError: null,
    extractedAt: new Date(),
  };
  const textRow = await prisma.$transaction(async (tx) => {
    const row = await tx.documentText.upsert({
      where: { documentId: document.id },
      create: { ...scope, ...ready },
      update: ready,
    });
    await tx.documentChunk.deleteMany({ where: { documentId: document.id } });
    if (chunks.length) {
      await tx.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          ...scope,
          documentTextId: row.id,
          index: chunk.index,
          text: chunk.text,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
        })),
      });
    }
    return row;
  });

  await updateProgress({ step: "embed", progress: 75 });
  const embedding = await embedChunks({ documentId: document.id, chunks });
  await prisma.documentText.update({
    where: { id: textRow.id },
    data: {
      embeddingStatus: embedding.status,
      embeddingModel: embedding.model,
      embeddingError: embedding.error,
    },
  });

  await updateProgress({ step: "done", progress: 100 });
  return {
    documentId: document.id,
    status: TEXT_STATUS.READY,
    extractor: extracted.extractor,
    wordCount: extracted.wordCount,
    pageCount: extracted.pageCount ?? null,
    chunkCount: chunks.length,
    embeddingStatus: embedding.status,
  };
};

// ─── Search ───────────────────────────────────────────────────────────────

const HEADLINE_OPTIONS =
  "MaxFragments=2, MaxWords=18, MinWords=8, StartSel=[[, StopSel=]], FragmentDelimiter= … ";

const fullTextRows = async ({ orgId, projectIds, query, take }) =>
  prisma.$queryRaw`
    SELECT dt."documentId" AS "documentId",
           dt."projectId" AS "projectId",
           ts_rank_cd(dt."searchVector", q, 32) AS "rank",
           ts_headline('english', left(coalesce(dt."text", ''), 60000), q, ${HEADLINE_OPTIONS}) AS "headline"
    FROM "DocumentText" dt, websearch_to_tsquery('english', ${query}) q
    WHERE dt."orgId" = ${orgId}
      AND dt."projectId" IN (${Prisma.join(projectIds)})
      AND dt."status" = ${TEXT_STATUS.READY}
      AND dt."searchVector" @@ q
    ORDER BY "rank" DESC
    LIMIT ${take}
  `;

const documentInclude = {
  text: {
    select: {
      status: true,
      extractor: true,
      wordCount: true,
      pageCount: true,
      excerpt: true,
      embeddingStatus: true,
    },
  },
  // every revision: each is a link to its record and the visibility rule reads
  // them all (certification L23); the first, in this order, is the hit's own
  documentRevisions: {
    orderBy: [{ isLatest: "desc" }, { issuedAt: "desc" }],
    select: {
      id: true,
      recordType: true,
      recordId: true,
      revision: true,
      status: true,
      title: true,
      documentNumber: true,
      folderPath: true,
      isLatest: true,
    },
  },
  attachments: {
    // every link — the visibility rule reads them all; ten hid an accessible one (the thirteenth pass's note on CX21-530)
    select: { recordType: true, recordId: true, role: true },
  },
  // The places a document is filed outside the Attachment table (certification
  // L24): an executed agreement, a lien waiver, a commercial record's evidence,
  // a subcontract close-out's evidence, a daily log's PDF, a task's file and a
  // signature. Each is a link to its record like an Attachment row.
  commitmentsExecuted: { select: { id: true } },
  subPayAppWaivers: { select: { id: true } },
  commercialAttachmentRefs: { select: { recordType: true, recordId: true } },
  closeoutEvidence: { select: { closeout: { select: { commitmentId: true } } } },
  dailyLogPdfs: { select: { id: true } },
  taskAttachments: { select: { taskId: true } },
  signatures: { select: { recordType: true, recordId: true } },
};

/**
 * Workflow evidence (NCR, safety, punch, RFI, submittal, drawing, transmittal
 * and correspondence references, and every document-control revision) is
 * filed in WorkflowAttachment by the document's id or storage key, not by a
 * relation; those rows are links too (certification L2, L24).
 */
const withWorkflowLinks = async (documents) => {
  const list = (documents || []).filter(Boolean);
  if (!list.length) return documents;
  const keys = [...new Set(list.flatMap((document) => [document.id, document.storageKey].filter(Boolean)))];
  const projectIds = [...new Set(list.map((document) => document.projectId).filter(Boolean))];
  const rows = keys.length && projectIds.length
    ? await prisma.workflowAttachment.findMany({
      where: { projectId: { in: projectIds }, storageKey: { in: keys } },
      select: { projectId: true, recordType: true, recordId: true, storageKey: true },
    })
    : [];
  for (const document of list) {
    document.workflowAttachments = rows.filter((row) => row.projectId === document.projectId && (row.storageKey === document.id || (document.storageKey && row.storageKey === document.storageKey)));
  }
  return documents;
};

/** Documents with every link the visibility rule reads. */
const findDocumentsWithLinks = async (where, include = documentInclude) =>
  withWorkflowLinks(await prisma.projectDocument.findMany({ where, include }));

const snippetText = (headline) => String(headline || "").replace(/\[\[|\]\]/g, "");

/**
 * A document is visible when the caller can read at least one place it is
 * linked from (document control register, or a record module through the
 * attachment table). Unlinked uploads fall under document control.
 */
/**
 * Records with a rule of their own beyond the module: routed between
 * parties (RFIs, submittals — owner, reviewer, approver party), attributed
 * to a company (timesheets, payment applications, commitments and their
 * change orders, punch items, inspections), a person's own (tasks,
 * lookaheads) or a conversation's members'. For a party-scoped viewer, an
 * attachment to such a record counts only when the record's own rule admits
 * the viewer — a subcontractor with RFI read reached, through the document,
 * the text of another subcontractor's RFI (CX21-530), and with timesheet
 * read the attachment of another company's timesheet (CX21-540). A
 * conversation's attachments are its members' for everyone.
 *
 * Each rule mirrors the record's own service; a clause whose input the
 * viewer lacks is left out, and a record with no clause left is not visible.
 *
 * `everyone` is the part of a record's own rule that binds every viewer, not
 * only a party-scoped one: a draft RFI is its author's and its manager's
 * (rfi-workflow.service withDraftVisibility), so a file filed on a
 * colleague's draft reached through /attachments/documents, /workflow/uploads
 * and the search what GET /rfi and the register hide (certification R35).
 */
const some = (field, ids) => (Array.isArray(ids) && ids.length ? { [field]: { in: ids } } : null);
const own = (field, userId) => (userId ? { [field]: userId } : null);
const routed = ({ partyIds }) => [some("ownerPartyId", partyIds), some("reviewerPartyId", partyIds), some("approverPartyId", partyIds)];
const draftOwn = ({ userId }) => (userId ? { OR: [{ status: { not: "draft" } }, { createdBy: userId }, { managerUserId: userId }] } : null);
// A person assigned to one of a submittal's review steps reads it, as the
// submittal's own detail admits them (submittal-workflow isStepReviewer,
// certification R4) — and so its files, which they are there to review.
const stepReviewer = ({ userId }) => (userId ? { steps: { some: { assignments: { some: { userId } } } } } : null);
const RECORD_RULES = Object.freeze({
  rfi: { model: "rfi", party: true, clauses: routed, everyone: draftOwn },
  submittal: { model: "submittal", party: true, clauses: (viewer) => [...routed(viewer), stepReviewer(viewer)] },
  timesheet: { model: "timesheet", party: true, clauses: ({ companyIds, userId }) => [some("companyId", companyIds), own("createdBy", userId)] },
  sub_pay_app: { model: "subPayApp", party: true, clauses: ({ companyIds, userId }) => [companyIds?.length ? { commitment: { vendorCompanyId: { in: companyIds } } } : null, own("createdBy", userId)] },
  commitment: { model: "commitment", party: true, clauses: ({ companyIds, userId }) => [some("vendorCompanyId", companyIds), own("createdBy", userId)] },
  // A subcontractor valuation is its subcontractor's: a client party holds
  // ipc:read, the valuation's module, and was given every valuation of the
  // project (certification R14). Valuations are retired — none can be made —
  // so this binds the legacy rows a deployment may still hold.
  sub_valuation: { model: "subValuation", party: true, clauses: ({ companyIds }) => [some("companyId", companyIds)] },
  commitment_change_order: { model: "commitmentChangeOrder", party: true, clauses: ({ companyIds, userId }) => [{ commitment: { OR: [...(companyIds?.length ? [{ vendorCompanyId: { in: companyIds } }] : []), ...(userId ? [{ createdBy: userId }] : [])] } }] },
  punch_item: { model: "punchItem", party: true, clauses: ({ companyIds, userId }) => [some("assigneeCompanyId", companyIds), own("createdBy", userId), own("assigneeUserId", userId)] },
  // A closeout deliverable: the responsible company and person, and its author (CLOSEOUT V1).
  closeout_deliverable: { model: "closeoutDeliverable", party: true, clauses: ({ companyIds, userId }) => [some("responsibleCompanyId", companyIds), own("createdBy", userId), own("responsibleUserId", userId)] },
  // A review cycle's response files: its consultant party's and the people the submission is addressed to (CONSULTANT V1).
  external_review_cycle: { model: "externalReviewCycle", party: true, clauses: ({ partyIds, userId }) => [some("partyId", partyIds), userId ? { submission: { recipients: { some: { userId, removedAt: null } } } } : null] },
  // A progress report: a party reads it once issued.
  progress_report: { model: "progressReport", party: true, clauses: () => [{ status: "issued" }] },
  form_instance: { model: "formInstance", party: true, clauses: ({ companyIds, userId }) => [some("assigneeCompanyId", companyIds), own("createdBy", userId), own("assigneeUserId", userId), own("inspectorUserId", userId), own("approverUserId", userId)] },
  task: { model: "task", party: true, clauses: ({ userId }) => [own("assigneeId", userId), own("createdById", userId)] },
  lookahead: { model: "lookahead", party: true, clauses: ({ userId }) => [{ status: { in: ["published", "archived"] } }, own("createdBy", userId)] },
  conversation: { model: "conversation", party: false, clauses: ({ userId }) => [userId ? { members: { some: { userId, leftAt: null } } } : null] },
});

/** Whether this viewer is judged by a record's own rule: a party-scoped viewer by all of them, anyone by the ones (or the part) that bind everyone. */
const ruleApplies = (rule, viewer) =>
  Boolean(rule) && (Array.isArray(viewer?.partyIds) || !rule.party || Boolean(rule.everyone?.(viewer || {})));

/** The records of one rule this viewer may see, as a where: the party clauses (any one) for whom they bind, and the part that binds everyone; null when nothing is left to admit. */
const ruleWhere = (rule, viewer) => {
  const parts = [];
  if (Array.isArray(viewer?.partyIds) || !rule.party) {
    const clauses = rule.clauses(viewer).filter(Boolean);
    if (!clauses.length) return null;
    parts.push({ OR: clauses });
  }
  const always = rule.everyone?.(viewer || {}) || null;
  if (always) parts.push(always);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { AND: parts };
};

/** The module each linked record is read under: the attachment table's, and the commercial records' evidence types. */
const LINK_MODULES = Object.freeze({ ...RECORD_TYPE_MODULES, eot_claim: "eot", ipc_item: "ipc" });
const linkModule = (recordType) => LINK_MODULES[recordType] || "document_control";

/**
 * Every place a document is linked from, each `{ recordType, recordId,
 * modules }` — the modules a reader needs, all of them, besides the record's
 * own rule. An Attachment row, a WorkflowAttachment row, a commercial
 * evidence reference, an executed agreement, a lien waiver, a close-out's
 * evidence, a daily log's PDF, a task's file and a signature are read under
 * their record's module; a document-control revision under document control
 * and its record's module, so a revision of an RFI follows the RFI's routing
 * (certification L23). The document's own pointer to what it was filed for
 * (linkedEntityType / linkedEntityId) is the only link of some files — a
 * photo on a daily report — and counts when no table above names the same
 * record (certification L24).
 *
 * Filing a revision also writes a WorkflowAttachment row for the same record
 * and file (doc-control.service uploadDocumentRevision). That row is the
 * revision, not evidence of its own: it is read under the revision's modules,
 * or a reader with RFI read and no document-control read got through
 * /attachments/documents and /workflow/uploads the revision file that
 * /doc-control/revisions/:id/download refuses them (certification R34).
 */
const revisionModules = (recordType) => [...new Set(["document_control", linkModule(recordType)])];
const documentLinks = (document) => {
  const links = [];
  const add = (recordType, recordId, modules) => {
    if (recordType && recordId) links.push({ recordType, recordId, modules });
  };
  const revisionOf = new Set((document?.documentRevisions || []).map((row) => `${row.recordType}:${row.recordId}`));
  for (const row of document?.attachments || []) add(row.recordType, row.recordId, [linkModule(row.recordType)]);
  for (const row of document?.documentRevisions || []) add(row.recordType, row.recordId, revisionModules(row.recordType));
  for (const row of document?.workflowAttachments || []) add(row.recordType, row.recordId, revisionOf.has(`${row.recordType}:${row.recordId}`) ? revisionModules(row.recordType) : [linkModule(row.recordType)]);
  for (const row of document?.commercialAttachmentRefs || []) add(row.recordType, row.recordId, [linkModule(row.recordType)]);
  for (const row of document?.commitmentsExecuted || []) add("commitment", row.id, [linkModule("commitment")]);
  for (const row of document?.subPayAppWaivers || []) add("sub_pay_app", row.id, [linkModule("sub_pay_app")]);
  for (const row of document?.closeoutEvidence || []) add("commitment", row.closeout?.commitmentId, [linkModule("commitment")]);
  for (const row of document?.dailyLogPdfs || []) add("daily_log", row.id, [linkModule("daily_log")]);
  for (const row of document?.taskAttachments || []) add("task", row.taskId, [linkModule("task")]);
  for (const row of document?.signatures || []) add(row.recordType, row.recordId, [linkModule(row.recordType)]);
  const pointer = { recordType: document?.linkedEntityType, recordId: document?.linkedEntityId };
  if (pointer.recordType && pointer.recordId && !links.some((link) => link.recordType === pointer.recordType && link.recordId === pointer.recordId)) {
    add(pointer.recordType, pointer.recordId, [linkModule(pointer.recordType)]);
  }
  return links;
};

/**
 * A file uploaded for a tool of its own is that tool's whatever it is linked
 * to: the bill of quantities needs BOQ read (routes/boq.js), a schedule
 * generation's source the schedule and the BOQ (routes/schedule.js), a
 * schedule or progress import the schedule (routes/import.js), a model BIM
 * (routes/bim.js) — under document control a member whose template withholds
 * the BOQ read the uploaded bill (certification L24).
 */
const DOCUMENT_TYPE_TOOLS = Object.freeze({
  boq_upload: ["boq"],
  schedule_generation_source: ["schedule", "boq"],
  schedule_import: ["schedule"],
  progress_import: ["schedule"],
  bim_model: ["bim"],
});

/** The ruled records among these documents' links that the viewer may see; null when there is no viewer. */
const recordRuleVisibleIds = async ({ documents, viewer }) => {
  if (!viewer) return null;
  const wanted = {};
  for (const document of documents) {
    for (const link of documentLinks(document)) {
      if (!ruleApplies(RECORD_RULES[link.recordType], viewer)) continue;
      (wanted[link.recordType] ||= new Set()).add(link.recordId);
    }
  }
  const visible = new Set();
  for (const [recordType, ids] of Object.entries(wanted)) {
    const rule = RECORD_RULES[recordType];
    const where = ruleWhere(rule, viewer);
    if (!ids.size || !where || !prisma[rule.model]?.findMany) continue;
    const rows = await prisma[rule.model].findMany({ where: { id: { in: [...ids] }, ...where }, select: { id: true } });
    for (const row of rows) visible.add(`${recordType}:${row.id}`);
  }
  return visible;
};

/**
 * A document is visible through at least one place it is linked from: that
 * link's modules readable and — for a viewer a record's rule binds — the
 * record admitted by its rule. A file of a tool of its own follows that tool
 * (DOCUMENT_TYPE_TOOLS). Only a document linked from nowhere falls under
 * document control; one linked only to records the viewer may not open is
 * not visible.
 */
const documentVisible = (document, viewer, ruled = null) => {
  if (!viewer?.canRead) return true;
  const tools = DOCUMENT_TYPE_TOOLS[document.documentType];
  if (tools) return tools.every((moduleName) => viewer.canRead(moduleName));
  const links = documentLinks(document);
  if (!links.length) return viewer.canRead("document_control");
  return links.some((link) => {
    if (ruled && ruleApplies(RECORD_RULES[link.recordType], viewer) && !ruled.has(`${link.recordType}:${link.recordId}`)) return false;
    return link.modules.every((moduleName) => viewer.canRead(moduleName));
  });
};

const recordModuleName = (recordType) => RECORD_TYPE_MODULES[recordType] || "document_control";

/** Whether one attachment link is one this viewer may see: its module readable, and — for a viewer a party rule binds — its own rule. */
const attachmentVisible = (attachment, viewer, ruled) => {
  if (!viewer) return true;
  const rule = RECORD_RULES[attachment.recordType];
  if (ruled && ruleApplies(rule, viewer) && !ruled.has(`${attachment.recordType}:${attachment.recordId}`)) return false;
  return !viewer.canRead || viewer.canRead(recordModuleName(attachment.recordType));
};

/** Whether a viewer may see one record: its module read, and — for a viewer a party rule binds — its own rule (CX21-551, CX21-555). */
const recordVisibleToViewer = async ({ recordType, recordId, viewer }) => {
  if (!viewer) return true;
  if (viewer.canRead && !viewer.canRead(recordModuleName(recordType))) return false;
  const rule = RECORD_RULES[recordType];
  if (!ruleApplies(rule, viewer)) return true;
  const ruled = await recordRuleVisibleIds({ documents: [{ attachments: [{ recordType, recordId }] }], viewer });
  return ruled.has(`${recordType}:${recordId}`);
};

/** The ids among these documents of one project that a viewer may read, each judged as documentReadableToViewer judges one. */
const readableDocumentIds = async ({ orgId, projectId, documentIds, viewer }) => {
  const ids = [...new Set((documentIds || []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) return new Set();
  const documents = await findDocumentsWithLinks({ id: { in: ids }, orgId, projectId });
  if (!viewer) return new Set(documents.map((document) => document.id));
  const ruled = await recordRuleVisibleIds({ documents, viewer });
  return new Set(documents.filter((document) => documentVisible(document, viewer, ruled)).map((document) => document.id));
};

/** Whether a viewer may read a document's bytes: it must be visible through a place it is linked from (CX21-551, the download path). */
const documentReadableToViewer = async ({ orgId, projectId, documentId, viewer }) => {
  if (!viewer) return true;
  return (await readableDocumentIds({ orgId, projectId, documentIds: [documentId], viewer })).has(documentId);
};

/**
 * The viewer a request reads documents as: `canRead(module)` is the caller's
 * own permission decision (role, project template, API-key scopes); a
 * party-scoped person also carries its parties and companies, which the
 * records' own rules read. Every door to a document builds it the same way.
 */
const documentViewer = ({ userId, projectAccess, canRead }) => {
  const { isPartyScopedAccess } = require("./company-party.service");
  const partyScoped = isPartyScopedAccess(projectAccess || {});
  const parties = projectAccess?.partyAccess || [];
  return {
    id: userId,
    userId,
    canRead,
    partyIds: partyScoped ? parties.map((party) => party.projectPartyId).filter(Boolean) : null,
    companyIds: partyScoped ? [...new Set(parties.map((party) => party.companyId).filter(Boolean))] : null,
  };
};

// ─── Who may link a document ─────────────────────────────────────────────

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The viewer a writer reads documents as, rebuilt from who they are, for a
 * service that writes a link to a document but is not handed the request:
 * the person's membership as it stands now, their access to this project
 * and its permission template — the request requestForProject builds for a
 * route, so `canRead(module)` and `mayApprove` (document.revision.approve)
 * decide here as they decide on the project's own routes. An API key is not
 * known here: its owner's decision stands in for the key's narrower scopes.
 * A person with no standing in the project gets a viewer that reads nothing.
 */
const documentWriterViewer = async ({ orgId = null, projectId, userId }) => {
  if (!userId || !projectId) return null;
  const { resolveRequestPrincipal } = require("./membership.service");
  const { requestForProject } = require("../middleware/project-access");
  const { hasPermission } = require("../middleware/rbac");
  const scopeOrgId =
    orgId || (await prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true } }))?.orgId || null;
  const principal = scopeOrgId ? await resolveRequestPrincipal({ tx: prisma, userId, orgId: scopeOrgId }) : null;
  const view = principal
    ? await requestForProject({ user: { ...principal, id: userId, orgId: scopeOrgId } }, projectId)
    : { user: null };
  return {
    ...documentViewer({
      userId,
      projectAccess: view.projectAccess || {},
      canRead: (moduleName) => hasPermission(view, moduleName, "read"),
    }),
    mayApprove: hasPermission(view, "document_control", "approve", { transition: "document.revision.approve" }),
  };
};

/**
 * Refuses a write that would link a document its writer may not read
 * (certification R29). Every place a document is linked from is a read grant
 * (documentLinks), so writing one is granting the file to every reader of
 * the record: the rule POST /attachments applies to documentIds — the writer
 * must be able to read the document already — holds on every path that
 * writes a link: a workflow record's attachment references, a revision named
 * in a record's payload, a lien waiver, an executed agreement, a commercial
 * record's evidence and a close-out's evidence. A subcontractor named another
 * vendor's lien waiver on its own punch item, then read it.
 *
 * `keys` are the document ids or storage keys the write names; `unchanged`
 * the ones the record already names in the place being written, which keep
 * their link as they are. The writer is `viewer` (a route's own decision) or
 * is rebuilt from `userId` (`unchanged` and `userId` may be functions, asked
 * only when a document key is named); a file the writer uploaded that is linked from
 * nowhere yet is theirs to link — the upload-then-attach of every form. When
 * nobody can say who writes (a create whose caller passes no user), only a
 * file linked from nowhere may be named. A key that names no document of the
 * project is refused as a document the writer may not read is (`refuse`, the
 * path's own "not found"), unless it is not a document key at all — a legacy
 * file name or URL, which grants nothing.
 */
const assertDocumentsLinkable = async ({ orgId = null, projectId, keys = [], unchanged = [], viewer = null, userId = null, refuse }) => {
  const asked = [
    ...new Set((keys || []).filter((key) => typeof key === "string" && key.trim()).map((key) => key.trim())),
  ].filter((key) => UUID_KEY.test(key));
  if (!asked.length) return;
  const kept = new Set(((typeof unchanged === "function" ? await unchanged() : unchanged) || []).filter(Boolean).map((key) => String(key).trim()));
  const named = asked.filter((key) => !kept.has(key));
  if (!named.length) return;
  const writerId = typeof userId === "function" ? await userId() : userId;
  const documents = await findDocumentsWithLinks({
    projectId,
    ...(orgId ? { orgId } : {}),
    OR: [{ id: { in: named } }, { storageKey: { in: named } }],
  });
  const byKey = new Map();
  for (const document of documents) {
    byKey.set(document.id, document);
    if (document.storageKey) byKey.set(document.storageKey, document);
  }
  const writer = viewer?.canRead ? viewer : await documentWriterViewer({ orgId, projectId, userId: writerId });
  const ruled = writer ? await recordRuleVisibleIds({ documents, viewer: writer }) : null;
  for (const key of named) {
    const document = byKey.get(key);
    if (!document) throw refuse();
    if (writer && documentVisible(document, writer, ruled)) continue;
    const linkedFromNowhere = documentLinks(document).length === 0;
    if (linkedFromNowhere && (!writer || (document.uploadedBy && document.uploadedBy === writer.userId))) continue;
    throw refuse();
  }
};

/**
 * The document a background job works on, as it names it in its payload: a
 * text extraction its document, a photo job its photo's, a drawing-set job
 * its set's source file.
 */
const DOCUMENT_JOB_TYPES = Object.freeze({
  [jobService.JOB_TYPES?.DOCUMENT_EXTRACT || "document.extract"]: "document",
  [jobService.JOB_TYPES?.PHOTO_THUMBNAIL || "photo.thumbnail"]: "photo",
  [jobService.JOB_TYPES?.PHOTO_ANALYZE || "photo.analyze"]: "photo",
  [jobService.JOB_TYPES?.DRAWING_SET_PROCESS || "drawing.set_process"]: "drawing_set",
});
const JOB_DOCUMENT_WITHHELD = "The job's document is not one you may read";

/**
 * Jobs as this viewer may receive them: a job on a document the viewer may
 * not read comes without its payload and result — the jobs list gave every
 * document-control reader the ids, and the outcome, of other parties' and
 * other tools' files (certification L2). Other jobs are returned unchanged.
 */
const withheldDocumentJobs = async ({ orgId, projectId, jobs, viewer }) => {
  const list = jobs || [];
  const kinds = list.map((job) => DOCUMENT_JOB_TYPES[job?.type] || null);
  if (!viewer || !kinds.some(Boolean)) return list;
  const idOf = (job, key) => (typeof job?.payload?.[key] === "string" ? job.payload[key] : null);
  const photoIds = [...new Set(list.filter((job, index) => kinds[index] === "photo").map((job) => idOf(job, "photoId")).filter(Boolean))];
  const setIds = [...new Set(list.filter((job, index) => kinds[index] === "drawing_set").map((job) => idOf(job, "setId")).filter(Boolean))];
  const [photos, sets] = await Promise.all([
    photoIds.length ? prisma.photo.findMany({ where: { id: { in: photoIds }, orgId, projectId }, select: { id: true, documentId: true } }) : [],
    setIds.length ? prisma.drawingSet.findMany({ where: { id: { in: setIds }, projectId }, select: { id: true, sourceDocumentId: true } }) : [],
  ]);
  const photoDocument = new Map(photos.map((row) => [row.id, row.documentId]));
  const setDocument = new Map(sets.map((row) => [row.id, row.sourceDocumentId]));
  const documentOf = (job, kind) => {
    if (kind === "document") return idOf(job, "documentId");
    if (kind === "photo") return photoDocument.get(idOf(job, "photoId")) || null;
    if (kind === "drawing_set") return setDocument.get(idOf(job, "setId")) || null;
    return null;
  };
  const documentIds = list.map((job, index) => (kinds[index] ? documentOf(job, kinds[index]) : null));
  const readable = await readableDocumentIds({ orgId, projectId, documentIds, viewer });
  return list.map((job, index) => {
    if (!kinds[index] || (documentIds[index] && readable.has(documentIds[index]))) return job;
    return {
      ...job,
      payload: {},
      result: null,
      error: job.error ? { ...job.error, details: null } : job.error,
      payloadWithheld: { keys: Object.keys(job.payload || {}), reason: JOB_DOCUMENT_WITHHELD },
      resultWithheld: { reason: JOB_DOCUMENT_WITHHELD },
    };
  });
};

/**
 * Whether one revision link is one this viewer may see: document control and
 * its record's module, and — where the record's own rule binds the viewer —
 * that rule. A hit admitted through one link described the first revision
 * whatever its record — an RFI routed to other parties, its id, title,
 * number and path (certification R38).
 */
const revisionVisible = (revision, viewer, ruled) => {
  if (!viewer) return true;
  if (ruled && ruleApplies(RECORD_RULES[revision.recordType], viewer) && !ruled.has(`${revision.recordType}:${revision.recordId}`)) return false;
  return !viewer.canRead || revisionModules(revision.recordType).every((moduleName) => viewer.canRead(moduleName));
};

const serializeHit = ({ document, rank = 0, headline = null, semanticScore = null, matchedChunk = null, viewer = null, ruled = null }) => {
  const projectId = document.projectId;
  // the first revision, in documentInclude's order, among those the viewer may see (R38)
  const revision = (document.documentRevisions || []).find((row) => revisionVisible(row, viewer, ruled)) || null;
  // Only the links this viewer may see are surfaced; an inaccessible record's
  // id and path are not disclosed, and an accessible link beyond the first
  // ten is not lost (Phase 21D, the note on CX21-530).
  const records = (document.attachments || [])
    .filter((attachment) => attachmentVisible(attachment, viewer, ruled))
    .slice(0, 10)
    .map((attachment) => ({
      recordType: attachment.recordType,
      recordId: attachment.recordId,
      role: attachment.role,
      path: recordWorkspacePath({ projectId, recordType: attachment.recordType, recordId: attachment.recordId }),
    }));
  const path = revision
    ? recordWorkspacePath({ projectId, recordType: revision.recordType, recordId: revision.recordId })
    : records[0]?.path || null;
  const title =
    trimOrNull(revision?.title) ||
    trimOrNull(document.title) ||
    document.originalName ||
    document.fileName;
  return {
    documentId: document.id,
    projectId,
    title,
    fileName: document.fileName,
    originalName: document.originalName,
    documentNumber: revision?.documentNumber || document.documentNumber || null,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    documentType: document.documentType,
    folderPath: revision?.folderPath || document.folderPath || null,
    uploadedAt: toIso(document.uploadedAt),
    rank: Number(rank) || 0,
    semanticScore: semanticScore === null ? null : Number(semanticScore.toFixed(4)),
    snippet: headline || matchedChunk || document.text?.excerpt || null,
    snippetText: snippetText(headline || matchedChunk || document.text?.excerpt || ""),
    matchedChunk,
    text: document.text
      ? {
          status: document.text.status,
          extractor: document.text.extractor,
          wordCount: document.text.wordCount,
          pageCount: document.text.pageCount ?? null,
          embeddingStatus: document.text.embeddingStatus,
        }
      : null,
    revision: revision
      ? {
          id: revision.id,
          recordType: revision.recordType,
          recordId: revision.recordId,
          revision: revision.revision,
          status: revision.status,
          isLatest: revision.isLatest,
        }
      : null,
    records,
    path,
    // Same shape as attachment rows so the UI opens it the same way.
    fileUrl: `/api/v1/projects/${projectId}/attachments/documents/${document.id}`,
  };
};

const semanticMatches = async ({ orgId, projectId, query, take }) => {
  if (!embeddingService.isEnabled() || !prisma.documentChunk?.findMany) return new Map();
  const queryVector = await embeddingService.embedQuery(query);
  if (!queryVector) return new Map();
  const chunks = await prisma.documentChunk.findMany({
    where: { orgId, projectId, NOT: { embedding: { isEmpty: true } } },
    select: { documentId: true, index: true, text: true, embedding: true },
  });
  const best = new Map();
  for (const chunk of chunks) {
    const score = embeddingService.cosineSimilarity(queryVector, chunk.embedding);
    if (score < SEMANTIC_MIN_SCORE) continue;
    const current = best.get(chunk.documentId);
    if (!current || score > current.score) {
      best.set(chunk.documentId, { score, text: excerptOf(chunk.text) });
    }
  }
  return new Map(
    [...best.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, take),
  );
};

/**
 * Project-scoped content search: Postgres full-text ranking with headline
 * snippets, merged with embedding similarity when `semantic` is requested
 * and a provider is configured.
 */
const searchDocuments = async ({
  orgId,
  projectId,
  q,
  limit = DEFAULT_SEARCH_LIMIT,
  viewer = null,
  semantic = false,
}) => {
  const query = trimOrNull(q);
  const take = clampLimit(limit);
  const embeddings = embeddingService.describe();
  if (!query) {
    return { query: null, items: [], meta: { limit: take, total: 0, mode: "text", embeddings } };
  }

  const [rows, semanticHits] = await Promise.all([
    fullTextRows({ orgId, projectIds: [projectId], query, take: take * 2 }),
    semantic ? semanticMatches({ orgId, projectId, query, take: take * 2 }) : new Map(),
  ]);

  const rankById = new Map(rows.map((row) => [row.documentId, row]));
  const ids = [...new Set([...rankById.keys(), ...semanticHits.keys()])];
  if (!ids.length) {
    return {
      query,
      items: [],
      meta: { limit: take, total: 0, mode: semanticHits.size || semantic ? "hybrid" : "text", embeddings },
    };
  }

  const documents = await findDocumentsWithLinks({ id: { in: ids }, orgId, projectId });
  const byId = new Map(documents.map((document) => [document.id, document]));
  const maxRank = Math.max(...rows.map((row) => Number(row.rank) || 0), 0.000001);

  const partyVisible = await recordRuleVisibleIds({ documents, viewer }); // the records with a rule of their own, for this viewer (CX21-530, CX21-540)
  const items = ids
    .map((id) => byId.get(id))
    .filter((document) => document && documentVisible(document, viewer, partyVisible))
    .map((document) => {
      const ranked = rankById.get(document.id);
      const hit = semanticHits.get(document.id) || null;
      const textScore = ranked ? (Number(ranked.rank) || 0) / maxRank : 0;
      const semanticScore = hit ? hit.score : null;
      return {
        ...serializeHit({
          document,
          rank: ranked?.rank || 0,
          headline: ranked?.headline || null,
          semanticScore,
          matchedChunk: hit?.text || null,
          viewer,
          ruled: partyVisible,
        }),
        score: Number(Math.max(textScore, semanticScore || 0).toFixed(4)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, take);

  return {
    query,
    items,
    meta: {
      limit: take,
      total: items.length,
      mode: semanticHits.size ? "hybrid" : "text",
      embeddings,
    },
  };
};

/** Cross-project content hits for the global search palette. */
/**
 * `viewerFor(projectId)` gives the viewer whose `canRead(module)` decides each
 * hit, as `getDocumentText` decides one document: a document attached only
 * to a record whose module the viewer may not read is not surfaced, headline
 * and all — the cross-project search checked document control once per
 * project and then served every matching document (Phase 21D, CX21-522).
 */
const searchDocumentContent = async ({ orgId, projectIds, q, limit = 10, viewerFor = null }) => {
  const query = trimOrNull(q);
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  if (!query || !ids.length || !prisma.$queryRaw) return [];
  const rows = await fullTextRows({ orgId, projectIds: ids, query, take: clampLimit(limit, 10) });
  if (!rows.length) return [];
  const documents = await findDocumentsWithLinks({ id: { in: rows.map((row) => row.documentId) }, orgId });
  const byId = new Map(documents.map((document) => [document.id, document]));
  // each project's ruled records for its viewer (CX21-530, CX21-540)
  const partyVisibleByProject = new Map();
  if (viewerFor) {
    for (const document of documents) {
      if (partyVisibleByProject.has(document.projectId)) continue;
      const viewer = viewerFor(document.projectId);
      partyVisibleByProject.set(document.projectId, await recordRuleVisibleIds({ documents: documents.filter((row) => row.projectId === document.projectId), viewer }));
    }
  }
  return rows
    .map((row) => {
      const document = byId.get(row.documentId);
      if (!document) return null;
      const viewer = viewerFor ? viewerFor(document.projectId) : null;
      if (viewer && !documentVisible(document, viewer, partyVisibleByProject.get(document.projectId))) return null;
      return serializeHit({ document, rank: row.rank, headline: row.headline, viewer, ruled: partyVisibleByProject.get(document.projectId) });
    })
    .filter(Boolean);
};

const getDocumentText = async ({ orgId, projectId, documentId, viewer = null, maxChars }) => {
  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, orgId, projectId },
    include: { ...documentInclude, text: true },
  });
  if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found");
  await withWorkflowLinks([document]);
  const partyVisible = await recordRuleVisibleIds({ documents: [document], viewer });
  if (!documentVisible(document, viewer, partyVisible)) {
    throw new HttpError(403, "FORBIDDEN", "You do not have permission to view this document");
  }
  return {
    // the links this viewer may see only — every Attachment link's record id and path were listed (R38)
    document: serializeHit({ document, viewer, ruled: partyVisible }),
    text: serializeTextRow(document.text, { includeText: true, maxChars: maxChars || MAX_TEXT_RESPONSE_CHARS }),
    extractable: isExtractableDocument(document),
  };
};

module.exports = {
  EMBEDDING_STATUS,
  TEXT_STATUS,
  assertDocumentsLinkable,
  documentVisible,
  documentLinks,
  documentViewer,
  documentWriterViewer,
  recordRuleVisibleIds,
  recordVisibleToViewer,
  documentReadableToViewer,
  readableDocumentIds,
  withheldDocumentJobs,
  attachmentVisible,
  RECORD_RULES,
  DOCUMENT_TYPE_TOOLS,
  enqueueExtraction,
  getDocumentText,
  getIndexStatus,
  isExtractableDocument,
  readDocumentBytes,
  reindexProject,
  runDocumentExtractJob,
  searchDocumentContent,
  searchDocuments,
  serializeHit,
  serializeTextRow,
};
