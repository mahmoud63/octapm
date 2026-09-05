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
  documentRevisions: {
    orderBy: [{ isLatest: "desc" }, { issuedAt: "desc" }],
    take: 1,
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
    take: 10,
    select: { recordType: true, recordId: true, role: true },
  },
};

const snippetText = (headline) => String(headline || "").replace(/\[\[|\]\]/g, "");

/**
 * A document is visible when the caller can read at least one place it is
 * linked from (document control register, or a record module through the
 * attachment table). Unlinked uploads fall under document control.
 */
const documentVisible = (document, viewer) => {
  if (!viewer?.canRead) return true;
  const modules = new Set();
  if (document.documentRevisions?.length) modules.add("document_control");
  for (const attachment of document.attachments || []) {
    modules.add(RECORD_TYPE_MODULES[attachment.recordType] || "document_control");
  }
  if (!modules.size) modules.add("document_control");
  return [...modules].some((moduleName) => viewer.canRead(moduleName));
};

const serializeHit = ({ document, rank = 0, headline = null, semanticScore = null, matchedChunk = null }) => {
  const projectId = document.projectId;
  const revision = document.documentRevisions?.[0] || null;
  const records = (document.attachments || []).map((attachment) => ({
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

  const documents = await prisma.projectDocument.findMany({
    where: { id: { in: ids }, orgId, projectId },
    include: documentInclude,
  });
  const byId = new Map(documents.map((document) => [document.id, document]));
  const maxRank = Math.max(...rows.map((row) => Number(row.rank) || 0), 0.000001);

  const items = ids
    .map((id) => byId.get(id))
    .filter((document) => document && documentVisible(document, viewer))
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
const searchDocumentContent = async ({ orgId, projectIds, q, limit = 10 }) => {
  const query = trimOrNull(q);
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  if (!query || !ids.length || !prisma.$queryRaw) return [];
  const rows = await fullTextRows({ orgId, projectIds: ids, query, take: clampLimit(limit, 10) });
  if (!rows.length) return [];
  const documents = await prisma.projectDocument.findMany({
    where: { id: { in: rows.map((row) => row.documentId) }, orgId },
    include: documentInclude,
  });
  const byId = new Map(documents.map((document) => [document.id, document]));
  return rows
    .map((row) => {
      const document = byId.get(row.documentId);
      return document ? serializeHit({ document, rank: row.rank, headline: row.headline }) : null;
    })
    .filter(Boolean);
};

const getDocumentText = async ({ orgId, projectId, documentId, viewer = null, maxChars }) => {
  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, orgId, projectId },
    include: { ...documentInclude, text: true },
  });
  if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found");
  if (!documentVisible(document, viewer)) {
    throw new HttpError(403, "FORBIDDEN", "You do not have permission to view this document");
  }
  return {
    document: serializeHit({ document }),
    text: serializeTextRow(document.text, { includeText: true, maxChars: maxChars || MAX_TEXT_RESPONSE_CHARS }),
    extractable: isExtractableDocument(document),
  };
};

module.exports = {
  EMBEDDING_STATUS,
  TEXT_STATUS,
  documentVisible,
  enqueueExtraction,
  getDocumentText,
  getIndexStatus,
  isExtractableDocument,
  reindexProject,
  runDocumentExtractJob,
  searchDocumentContent,
  searchDocuments,
  serializeHit,
  serializeTextRow,
};
