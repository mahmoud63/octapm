const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { toMoneyNumber } = require('../utils/money');
const auditService = require('./audit.service');
const { idsOf } = require('./tenant-references.service');

const PROGRESS_METHODS = [
  'percent',
  'quantity',
  'weighted_milestone',
  'inspection',
  'manual',
];

const SUBMISSION_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];
const APPROVABLE_STATUSES = ['draft', 'submitted'];
const PROGRESS_ASSIGNMENT_OVERRIDE_ROLES = new Set(['pm', 'planning_eng']);
// PC-6: a quantity entry a submission may bundle, and the submission
// statuses that keep the entries they bundle (an entry belongs to at most
// one open submission).
const BUNDLEABLE_ENTRY_STATUSES = ['draft', 'submitted'];
const OPEN_SUBMISSION_STATUSES = ['draft', 'submitted'];
const QUANTITY_ENTRY_ENTITY_TYPE = 'quantity_progress_entry';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/;
const BUNDLED_ENTRY_SELECT = {
  id: true,
  projectId: true,
  activityId: true,
  boqItemId: true,
  allocationId: true,
  locationId: true,
  quantity: true,
  unitCode: true,
  date: true,
  source: true,
  status: true,
  submissionId: true,
  dailyLogId: true,
  dailyLogQuantityId: true,
  note: true,
  clientRequestId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  approvedBy: true,
  approvedAt: true,
  rejectedBy: true,
  rejectedAt: true,
  rejectionReason: true,
  submission: { select: { id: true, status: true, source: true, pctComplete: true } },
  boqItem: { select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true } },
  location: { select: { id: true, name: true, code: true } },
};

// quantity-progress.service requires this file (the assignment rule); the
// planned and installed figures are read from it lazily for the same reason
// form.service is.
const quantityProgressService = () => require('./quantity-progress.service');
const uomService = () => require('./uom.service');

const METHOD_ALIASES = {
  percent_complete: 'percent',
  physical_percent: 'percent',
  duration: 'percent',
  milestone: 'weighted_milestone',
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clampPercent = (value) => Math.max(0, Math.min(100, toNumber(value)));

const parseDate = (value, field = 'date') => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `${field} is invalid`);
  }
  return date;
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const normalizeMethod = (method) => {
  const key = String(method || 'percent').trim().toLowerCase();
  const normalized = METHOD_ALIASES[key] || key;
  if (!PROGRESS_METHODS.includes(normalized)) {
    throw new HttpError(
      400,
      'INVALID_PROGRESS_METHOD',
      `Progress method must be one of: ${PROGRESS_METHODS.join(', ')}`,
    );
  }
  return normalized;
};

/** The evidence a submission names, as it was sent: its evidenceJson, else its evidence, else the fallback photos. */
const evidenceSource = (payload = {}, fallbackPhotos = null) =>
  payload.evidenceJson ??
  payload.evidence ??
  (fallbackPhotos ? { photos: fallbackPhotos } : null);

const evidenceOf = (evidence) => {
  if (!evidence) return null;
  if (Array.isArray(evidence)) return { photos: evidence };
  if (typeof evidence === 'object') return evidence;
  return { notes: String(evidence) };
};

const hasEvidence = (evidence) => {
  if (!evidence) return false;
  if (Array.isArray(evidence)) return evidence.length > 0;
  if (Array.isArray(evidence.photos)) return evidence.photos.length > 0;
  return Object.keys(evidence).length > 0;
};

/**
 * Photo evidence names documents of the submission's own project only, in the
 * one shape the product's clients send (certification CERT-2).
 *
 * A key was stored as given, so a submission — made directly, in a bulk batch
 * or through a daily report — could name another company's document, and
 * approving it copied the reference onto the activity's official progress. A
 * photo names its document by `key`, and the product's own upload answer
 * repeats the id as `documentId` and `storageKey`; each is matched by the
 * document's id or its storage key, as a daily report's own photos are. A key
 * naming another company's document and one naming nothing get the same 400
 * INVALID_SITE_PHOTO_REFERENCE — the refusal a daily report's photos get —
 * before anything is written; so does a document field that is not one text.
 *
 * Only that check ran, and only on photos[] as a list of objects: a document
 * named in any other shape — photos as an object, a list inside the list, a
 * bare id as a photo, a `documents` list, a key beside photos[], an unknown
 * photo field — was skipped and stored as given (the second CERT-2 shapes
 * round). The accepted shape is what the clients send: the site-reporting form
 * sends the upload's own answer as photos[] (file-storage.service
 * serializeUploadedDocument), the progress tab a typed link
 * (`{ photos: [{ url }] }`), a daily report and a site diary their photos
 * (normalizePhotos), the UAT runner its attachment description
 * (e2e/uat/run-uat-regression.mjs evidenceAttachment: fileName, fileUrl,
 * mimeType, sizeBytes, description), the certification drivers notes beside
 * them:
 *
 *   { photos: [ <photo> | "<link>" … ], <word>: <text | number | flag | null> … }
 *
 * where a photo is an object of EVIDENCE_PHOTO_FIELDS, each a text, number,
 * flag or null. Anything else is invalid input (400 VALIDATION_ERROR) whoever's
 * id it carries, before any lookup: photos that is not a list, a photo that is
 * neither an object nor a link, a field a photo does not have, a value that is
 * a list or an object, a document field or uploadedBy outside photos[], a name
 * that is not a plain word, and an identifier standing alone where a link or a
 * description belongs (an id goes only where it is checked). A link the
 * product itself serves as a stored file (FILE_LINK) names a file of this
 * project only — a document, a photo or a document revision, checked as a
 * document field is. Any other link is the caller's text and is stored as
 * given: an Autodesk Construction Cloud folder, a page of this product (an
 * RFI, an activity). The third CERT-2 round had taken every link holding
 * /projects/<id> on any host for the product's, and every other identifier in
 * it for a document, so such evidence was refused (400
 * INVALID_SITE_PHOTO_REFERENCE) — and the UAT runner's photo, whose
 * `description` was not a photo field, too (400 VALIDATION_ERROR). A photo's
 * `uploadedBy` is the uploader of the document it names, read from the
 * document; a photo naming none carries no uploader. So no identifier the
 * caller sends reaches evidenceJson unchecked where the product resolves it.
 */
const EVIDENCE_DOCUMENT_FIELDS = ['key', 'documentId', 'storageKey'];
const EVIDENCE_PHOTO_FIELDS = new Set([
  ...EVIDENCE_DOCUMENT_FIELDS,
  'url', 'fileUrl', 'downloadUrl',
  'filename', 'fileName', 'originalName', 'name', 'type', 'mimeType',
  'size', 'sizeBytes', 'storage', 'scanStatus', 'retentionExpiresAt',
  'uploadedBy', 'uploadedAt', 'caption', 'takenAt', 'description',
]);
const EVIDENCE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const IDENTIFIER = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IDENTIFIER_ALONE = new RegExp(`^${IDENTIFIER}$`, 'i');
/**
 * A link the product serves as a stored file: its download routes —
 * site-reporting.js, workflow-uploads.js (mounted at /workflow), boq.js,
 * import.js and schedule.js `/uploads/:key`; attachments.js
 * `/documents/:documentId`; photos.js `/:photoId/file` and `/thumbnail`;
 * doc-control.js `/revisions/:revisionId/download` and `/preview`; the
 * bidder portal's `/public/bids/:token/documents/:documentId` (bid-portal.js:
 * a document of the bid package's project, named without the project) — and
 * the doc-control/uploads link the upload answer gives (file-storage.service
 * uploadDocumentControlFile). With or without the /api/v1 base (the mobile
 * client keeps paths below it: photoFilePath), on whatever host it is written
 * (a client may make it absolute). Captures, each as written: the project, an
 * upload or document key, a photo id, a revision id, a bidder portal
 * document.
 *
 * Express matches the literal segments as sent, without case, and decodes
 * each parameter (decodeURIComponent) before the route reads it: a project, a
 * photo or a revision written with escapes ('/projects/%63e2c…/') reaches the
 * route as the plain id. So every capture is a run of URL characters, escapes
 * included, decoded (fileKey) before it is compared or looked up; matched
 * only in its plain form, an escaped project named no file here (CERT-2
 * evidence-lines-5).
 */
const FILE_SEGMENT = '[A-Za-z0-9._~%-]+';
const FILE_LINK = new RegExp(
  `(?:/api/v1)?/projects/(${FILE_SEGMENT})/(?:` +
    `(?:site-reporting|workflow|doc-control|boq|import|schedule)/uploads/(${FILE_SEGMENT})` +
    `|attachments/documents/(${FILE_SEGMENT})` +
    `|photos/(${FILE_SEGMENT})/(?:file|thumbnail)` +
    `|doc-control/revisions/(${FILE_SEGMENT})/(?:download|preview)` +
    ')' +
    `|(?:/api/v1)?/public/bids/[^/?#\\s]+/documents/(${FILE_SEGMENT})`,
  'gi',
);
/**
 * A capture as the route reads it: decoded, without a sentence's closing
 * dots. The dots are counted from the end: /\.+$/ tried every run of dots to
 * its end, so a key of 100,000 dots and a letter took 3.5 s, inside the
 * request's transaction (CERT-2 evidence-6).
 */
const fileKey = (written) => {
  let end = written.length;
  while (end > 0 && written.charCodeAt(end - 1) === 46) end -= 1;
  const key = written.slice(0, end);
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};
/**
 * A document's id and its storage key are UUIDs (file-storage.service
 * uploadProjectDocument). A key with any other character names no document
 * and is missing without a lookup: a decoded '%00' is a NUL, which Postgres
 * refuses in a text value, and the lookup answered 500 (22021) on every path
 * evidence takes (CERT-2 evidence-lines-5).
 */
const DOCUMENT_KEY = /^[A-Za-z0-9._~-]+$/;
/**
 * Each link a text holds, read as written and as a client resolves it.
 * Browsers, fetch and axios read a link with the WHATWG URL parser, which
 * drops tab and newline anywhere in it, reads a backslash as a slash and
 * resolves dot segments ('.', '..', '%2e'):
 * '/projects/<id>/site-reporting/./uploads/<key>', the same link written with
 * backslashes and 'site-re<TAB>porting' each fetch the stored file, and
 * matched only as written they named none, so another company's file was
 * stored as a link (CERT-2 evidence-lines-5).
 *
 * A field the clients use as a link — a photo's url, fileUrl or downloadUrl,
 * a photo that is a link — is one link, its tabs and line breaks dropped as
 * the parser drops them. Free text is a link per whitespace-separated token:
 * it is not joined across its line breaks, so a link that ends a line is the
 * link up to it, and a note's own link followed by a line of text stays the
 * own link.
 *
 * A link the parser resolves to a file link is that link: it is judged by its
 * path, query and fragment as resolved, and of its text as written only by
 * the identifiers it names in a file link (a project, a document, a photo, a
 * revision), so no identifier the caller writes there goes unchecked. A key
 * as written that is no identifier is not the link's: the fifth round judged
 * every key the text held, and the caller's own file written
 * '…/uploads/x/../<own>' was refused for the key 'x', a link field with a tab
 * or a line break inside the own key for the part before it (CERT-2
 * evidence-6). A link that resolves to no file link is judged as written.
 *
 * A link that does not hold, as written, where a file link's route begins —
 * 'projects' followed by a slash or a backslash, or 'bids' between two
 * (FILE_ROUTE_AT) —, one of the route's names (FILE_ROUTE_NAME: 'site-reporting',
 * 'workflow', 'doc-control', 'boq', 'import', 'schedule', 'attachments',
 * 'photos', 'public') and one of 'uploads', 'documents', 'photos',
 * 'revisions' names no stored file as written or resolved: every FILE_LINK
 * holds them, and the parser makes none of them — the segments of the path it
 * resolves are the segments written, split at a slash or a backslash (it
 * drops dot segments, tab and newline, and escapes a character; it never
 * unescapes one, and makes no letter), and Express matches the literal
 * segments as sent ('%70rojects' is served nothing). It is not read. Free
 * text is searched for where a route begins and only the tokens around it
 * are looked at. The sixth round read every token holding 'projects' or
 * 'bids' and a leaf word: 8.5 MB of distinct 'projects<i>uploads' tokens held
 * the event loop 2.2 s, where HEAD's one pass over the text took 8 ms (CERT-2
 * availability-7).
 *
 * A link the parser takes as written (plainForm) — no dot, no '%2e', no
 * backslash, no character it escapes, no scheme and no host — resolves to
 * itself under '/': it is judged as that path, query and fragment, matched
 * once, and no URL is built for it. Only a link that needs normalising is
 * parsed. Each distinct link of an evidence value is read once (CERT-2
 * availability-7).
 *
 * A link in free text is read without the quotes, brackets and closing
 * punctuation a writer puts around it ('see "<link>".', '<<link>>',
 * '“<link>”'), as a reader follows it: the parser escapes a closing '"', '>'
 * or '”' into the link's last segment, and since the fifth round the own
 * file quoted in a note was refused for the key '<own>"' (HEAD took it).
 * The fifth round parsed every token of a text and compared each path with
 * every other (forms.includes): 50,000 short tokens in a note held the
 * request and its transaction for seconds, and the transaction expired (500
 * P2028) (CERT-2 evidence-6). The reading is now linear in the text, and it
 * is made before the transaction (scanEvidence).
 */
const LINK_FIELDS = new Set(['url', 'fileUrl', 'downloadUrl']);
const FILE_ROUTE_AT = /projects[\/\\]|[\/\\]bids[\/\\]/i;
const FILE_ROUTE_NAME = /site-reporting|workflow|doc-control|boq|import|schedule|attachments|photos|public/i;
const FILE_LEAF_WORD = /uploads|documents|photos|revisions/i;
const LINK_BASE = 'http://link.invalid/';
const fileLinksIn = (form) => [...form.matchAll(FILE_LINK)];
/** Whether a form holds a file link at all: one test, nothing collected. */
const HAS_FILE_LINK = new RegExp(FILE_LINK.source, 'i');
/** JavaScript's \s, by code unit: what splits free text into tokens (split(/\s+/)). */
const isSpace = (code) =>
  code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) ||
  code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
const mayNameFile = (link) => FILE_ROUTE_AT.test(link) && FILE_LEAF_WORD.test(link) && FILE_ROUTE_NAME.test(link);
// What a writer puts around a link in text: quotes, brackets, closing punctuation (none is a character of a key).
const LINK_OPENERS = /^["'<([{\u201c\u2018\u00ab\u2039\u300c\u300e]+/;
const LINK_CLOSERS = /["'>)\]}\u201d\u2019\u00bb\u203a\u300d\u300f.,;:!?]+$/;
const unwrap = (token) => {
  let end = token.length;
  while (end > 0 && LINK_CLOSERS.test(token[end - 1])) end -= 1;
  return token.slice(0, end).replace(LINK_OPENERS, '');
};
/**
 * The links of a text that may name a stored file: a link field whole, its
 * tabs and line breaks dropped; in free text, each whitespace-separated token
 * that holds where a route begins (FILE_ROUTE_AT), found from there (the text
 * before it is stepped over once). Given one at a time, as they are found:
 * the reading stops at the first refusal (a file past MAX_EVIDENCE_FILES)
 * without reading the rest of the text. A token written twice is given twice;
 * the reader reads each once.
 */
function* linksOf(text, isLink) {
  if (isLink) {
    const link = text.replace(/[\t\n\r]/g, '');
    if (mayNameFile(link)) yield link;
    return;
  }
  const word = new RegExp(FILE_ROUTE_AT.source, 'gi');
  const space = /\s/g;
  let end = 0;
  for (let found = word.exec(text); found; found = word.exec(text)) {
    let start = found.index;
    while (start > end && !isSpace(text.charCodeAt(start - 1))) start -= 1;
    space.lastIndex = word.lastIndex;
    const after = space.exec(text);
    end = after ? after.index : text.length;
    const link = unwrap(text.slice(start, end));
    if (FILE_LEAF_WORD.test(link) && FILE_ROUTE_NAME.test(link)) yield link;
    word.lastIndex = end;
  }
}
/**
 * A link the parser takes as it is written: only characters it leaves alone
 * in a path, a query and a fragment (no dot — a dot segment —, no '%2e', no
 * backslash; no space, control, quote, angle bracket, brace, caret, backtick
 * or character outside ASCII, each of which it escapes), no scheme and not
 * '//' first (a host). Resolved against LINK_BASE it is itself under '/': a
 * relative link is given the slash, and its path, query and fragment are the
 * parts as written. No file link spans a '?' or a '#', so the one form
 * matches as the three parts do; as written it matches nothing more. Answers
 * that form, or null for a link that needs normalising (formsOf). new URL()
 * for each of 400,000 distinct tokens held the event loop seconds (CERT-2
 * availability-7).
 */
const PLAIN_LINK = /^[A-Za-z0-9\-_~!$&()*+,;=:@\/?#%[\]|]*$/;
const LINK_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const DOT_ESCAPE = /%2e/i;
const plainForm = (link) => {
  if (!PLAIN_LINK.test(link) || DOT_ESCAPE.test(link) || LINK_SCHEME.test(link) || link.startsWith('//')) return null;
  return link.startsWith('/') ? link : `/${link}`;
};
/** One link's forms: as the parser resolves it (its path, query and fragment), and as written (also with its backslashes read as slashes). */
const formsOf = (link) => {
  const slashes = link.replace(/\\/g, '/');
  let resolved = [];
  try {
    const { pathname, search, hash } = new URL(slashes, LINK_BASE);
    resolved = [pathname, search, hash].filter(Boolean);
  } catch {
    // Not a link a client can resolve: it is judged as written.
  }
  return { resolved, written: slashes === link ? [link] : [link, slashes] };
};
const EVIDENCE_REFERENCE_MESSAGE = 'Photo evidence must reference documents uploaded to this project';
/**
 * How many files one evidence value may name — documents, photos and
 * revisions, each counted once. They are looked up together, a document by
 * its id or its storage key (two bind variables a key), and Postgres takes at
 * most 32,767 in one statement: 16,384 distinct keys answered 500 ("too many
 * bind variables"), and 280,000 bidder-portal keys a RangeError before the
 * lookup (CERT-2 availability-7). No client names more than a few dozen. The
 * reading stops at the first file past the cap: 400 VALIDATION_ERROR naming
 * the evidence, whoever's files they are.
 */
const MAX_EVIDENCE_FILES = 1000;
const tooManyFiles = (field) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', [
    { field, message: `Evidence names more than ${MAX_EVIDENCE_FILES} files`, location: 'body' },
  ]);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value) =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

const evidenceShapeError = (field) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', [
    {
      field,
      message: 'Evidence is { photos: [an uploaded document of this project named by key, documentId or storageKey, or a link], notes and other descriptions as text }',
      location: 'body',
    },
  ]);

/**
 * The accepted shape, checked before any lookup. Answers the files the
 * evidence names — document keys (its document fields and the documents its
 * file links name), photo ids and revision ids (its file links) — and whether
 * a file link names another project.
 */
const readEvidenceShape = (evidence, projectId, base) => {
  const at = (rest) => (base ? `${base}.${rest}` : rest);
  const refuse = (field) => {
    throw evidenceShapeError(field);
  };
  const keys = [];
  const photoIds = [];
  const revisionIds = [];
  let otherProject = false;
  // Each file named once in its list; past MAX_EVIDENCE_FILES in all, refused.
  const named = new Map([[keys, new Set()], [photoIds, new Set()], [revisionIds, new Set()]]);
  let count = 0;
  const nameFile = (list, value) => {
    const seen = named.get(list);
    if (seen.has(value)) return;
    seen.add(value);
    list.push(value);
    count += 1;
    if (count > MAX_EVIDENCE_FILES) throw tooManyFiles(base || 'photos');
  };
  // identifiersOnly: a key that is no identifier is not counted (the text as written of a link that resolves to a file link).
  const seenLinks = new Set();
  const judge = (matches, identifiersOnly) => {
    for (const [link, projectWritten, uploadKey, documentKey, photoWritten, revisionWritten, bidDocument] of matches) {
      // The same file link, written again, names the same files: judged once.
      const seen = `${identifiersOnly ? 'w' : 'r'}${link}`;
      if (seenLinks.has(seen)) continue;
      seenLinks.add(seen);
      if (projectWritten !== undefined) {
        // A project that does not decode to an id names none: its routes serve nothing.
        const project = fileKey(projectWritten);
        if (!IDENTIFIER_ALONE.test(project)) continue;
        if (project.toLowerCase() !== String(projectId).toLowerCase()) {
          otherProject = true;
          continue;
        }
      }
      const documentWritten = uploadKey || documentKey || bidDocument;
      if (documentWritten) {
        const key = fileKey(documentWritten);
        if (!identifiersOnly || IDENTIFIER_ALONE.test(key)) nameFile(keys, key);
      }
      // The photo and revision routes take an id only (isUUID): anything else is served nothing.
      for (const [written, list] of [[photoWritten, photoIds], [revisionWritten, revisionIds]]) {
        const id = written ? fileKey(written) : null;
        if (id && IDENTIFIER_ALONE.test(id)) nameFile(list, id);
      }
    }
  };
  // Each form is judged once: many spellings of one link (a long note of them) resolve to the same path.
  const judged = new Map();
  const judgeForm = (form, identifiersOnly) => {
    const seen = `${identifiersOnly ? 'w' : 'r'}${form}`;
    if (judged.has(seen)) return judged.get(seen);
    const matches = fileLinksIn(form);
    judge(matches, identifiersOnly);
    judged.set(seen, matches.length > 0);
    return matches.length > 0;
  };
  // Each distinct link that names a file, or is parsed, is read once wherever it is written: it names the same files.
  const read = new Set();
  const readOnce = (link) => {
    if (read.has(link)) return false;
    read.add(link);
    return true;
  };
  const text = (value, field, isLink = false) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (IDENTIFIER_ALONE.test(trimmed)) refuse(field);
    for (const link of linksOf(trimmed, isLink)) {
      // A link the parser takes as written: judged as it resolves, no URL
      // built — one test for a link that names no file.
      const plain = plainForm(link);
      if (plain !== null) {
        if (HAS_FILE_LINK.test(plain) && readOnce(link)) judge(fileLinksIn(plain), false);
        continue;
      }
      if (!readOnce(link)) continue;
      const { resolved, written } = formsOf(link);
      let resolves = false;
      for (const form of resolved) if (judgeForm(form, false)) resolves = true;
      for (const form of written) judgeForm(form, resolves);
    }
  };

  for (const [name, value] of Object.entries(evidence)) {
    if (!EVIDENCE_NAME.test(name)) refuse(base || 'evidence');
    if (name === 'photos') {
      if (!Array.isArray(value)) refuse(at('photos'));
      value.forEach((photo, index) => {
        const field = at(`photos[${index}]`);
        if (typeof photo === 'string') {
          text(photo, field, true);
          return;
        }
        if (!isPlainObject(photo)) refuse(field);
        for (const [key, entry] of Object.entries(photo)) {
          if (!EVIDENCE_PHOTO_FIELDS.has(key)) refuse(field);
          if (EVIDENCE_DOCUMENT_FIELDS.includes(key)) {
            if (entry === null) continue;
            if (typeof entry !== 'string') throw new HttpError(400, 'INVALID_SITE_PHOTO_REFERENCE', EVIDENCE_REFERENCE_MESSAGE);
            if (entry.trim()) nameFile(keys, entry.trim());
            continue;
          }
          if (!isScalar(entry)) refuse(`${field}.${key}`);
          if (key !== 'uploadedBy') text(entry, `${field}.${key}`, LINK_FIELDS.has(key));
        }
      });
      continue;
    }
    if (EVIDENCE_DOCUMENT_FIELDS.includes(name) || name === 'uploadedBy') refuse(at(name));
    if (!isScalar(value)) refuse(at(name));
    text(value, at(name));
  }
  return { keys: idsOf(keys), photoIds: idsOf(photoIds), revisionIds: idsOf(revisionIds), otherProject };
};

/**
 * The reading of one evidence value (readEvidenceShape): its shape and the
 * files it names, or the refusal it gets. It reads the request alone — no
 * database — in time linear in the text, so it is made before the transaction
 * that looks the files up: read inside it, a long note held the transaction
 * open until it expired (CERT-2 evidence-6). prepareEvidence takes the reading
 * made for the same evidence, project and field and throws its refusal where
 * it read the evidence before, so every request is answered as it was.
 */
const scanEvidence = ({ projectId, evidence, field = 'evidence' }) => {
  const reading = { evidence, projectId, field, shape: null, error: null };
  if (!isPlainObject(evidence)) return reading;
  try {
    reading.shape = readEvidenceShape(evidence, projectId, field);
  } catch (error) {
    reading.error = error;
  }
  return reading;
};

/**
 * A submission's evidence, read ahead (scanEvidence), with what it was read
 * from (`source`: the submission's evidenceJson, evidence or fallback photos —
 * the same object, or the same text). A caller that opens the transaction
 * itself — a bulk batch, a daily report — reads each submission's evidence
 * before it and hands the reading to createProgressSubmission, which reads
 * the evidence itself when it is handed none for that source.
 */
const scanSubmissionEvidence = ({ projectId, payload, fallbackPhotos = null }) => {
  let source;
  try {
    source = evidenceSource(payload, fallbackPhotos);
  } catch (error) {
    return { source: undefined, evidence: null, projectId, field: 'evidence', shape: null, error };
  }
  return { source, ...scanEvidence({ projectId, evidence: evidenceOf(source) }) };
};

/**
 * The evidence as it is stored: the accepted shape (else 400
 * VALIDATION_ERROR), naming documents of this project only (else 400
 * INVALID_SITE_PHOTO_REFERENCE, another company's document and one that exists
 * nowhere alike), each photo's uploader read from its document. `field` is
 * where the evidence sits in the request (a daily report's own photos pass
 * null); `scanned` its reading made before the transaction (scanEvidence).
 * Exported for the daily report's photos.
 */
const prepareEvidence = async ({ orgId = null, projectId, evidence, field = 'evidence', scanned = null }, tx = prisma) => {
  if (evidence === null || evidence === undefined) return null;
  if (!isPlainObject(evidence)) throw evidenceShapeError(field || 'photos');
  const reading =
    scanned && scanned.evidence === evidence && scanned.projectId === projectId && scanned.field === field
      ? scanned
      : scanEvidence({ projectId, evidence, field });
  if (reading.error) throw reading.error;
  const { keys, photoIds, revisionIds, otherProject } = reading.shape;
  if (otherProject) throw new HttpError(400, 'INVALID_SITE_PHOTO_REFERENCE', EVIDENCE_REFERENCE_MESSAGE);
  const missing = [];
  let documents = [];
  if (keys.length) {
    // A key outside the id / storage-key characters is missing, never looked up (DOCUMENT_KEY).
    const lookup = keys.filter((key) => DOCUMENT_KEY.test(key));
    if (lookup.length) {
      documents = await tx.projectDocument.findMany({
        where: {
          projectId,
          ...(orgId ? { orgId } : {}),
          OR: [{ id: { in: lookup } }, { storageKey: { in: lookup } }],
        },
        select: { id: true, storageKey: true, uploadedBy: true },
      });
    }
    const known = new Set(documents.flatMap((document) => [document.id, document.storageKey]));
    missing.push(...keys.filter((key) => !known.has(key)));
  }
  // A photo link and a revision link name a photo and a revision of this
  // project, as photos.js and doc-control.js resolve them.
  if (photoIds.length) {
    const rows = await tx.photo.findMany({
      where: { id: { in: photoIds }, projectId, ...(orgId ? { orgId } : {}) },
      select: { id: true },
    });
    const known = new Set(rows.map((row) => row.id));
    missing.push(...photoIds.filter((id) => !known.has(id)));
  }
  if (revisionIds.length) {
    const rows = await tx.documentRevision.findMany({
      where: { id: { in: revisionIds }, projectId },
      select: { id: true },
    });
    const known = new Set(rows.map((row) => row.id));
    missing.push(...revisionIds.filter((id) => !known.has(id)));
  }
  if (missing.length) {
    throw new HttpError(400, 'INVALID_SITE_PHOTO_REFERENCE', EVIDENCE_REFERENCE_MESSAGE, { missing });
  }
  const photos = Array.isArray(evidence.photos) ? evidence.photos : [];
  if (!photos.some((photo) => isPlainObject(photo) && photo.uploadedBy !== undefined)) return evidence;
  const byKey = new Map();
  for (const document of documents) {
    byKey.set(document.id, document);
    if (document.storageKey) byKey.set(document.storageKey, document);
  }
  return {
    ...evidence,
    photos: photos.map((photo) => {
      if (!isPlainObject(photo) || photo.uploadedBy === undefined) return photo;
      const document = EVIDENCE_DOCUMENT_FIELDS.map((key) => (typeof photo[key] === 'string' ? byKey.get(photo[key].trim()) : null)).find(Boolean);
      return { ...photo, uploadedBy: document?.uploadedBy ?? null };
    }),
  };
};

const getEvidenceAttachments = (evidence) => {
  if (!evidence) return [];
  const photos = Array.isArray(evidence)
    ? evidence
    : Array.isArray(evidence.photos)
      ? evidence.photos
      : [];

  return photos.slice(0, 10).map((photo) => {
    if (typeof photo === 'string') return { url: photo };
    return {
      url: photo?.url || null,
      name: photo?.name || photo?.filename || null,
      type: photo?.type || 'photo',
    };
  });
};

const normalizeMilestones = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.milestones)) return value.milestones;

  return Object.entries(value).map(([key, raw]) => {
    if (typeof raw === 'object' && raw !== null) {
      return { id: key, ...raw };
    }
    return { id: key, pctComplete: raw };
  });
};

// With configured milestones, the figure is worked over EVERY configured
// milestone with its configured weight (PC-6: the activity's method is
// respected): a milestone the submission does not mention is not complete,
// and a weight the client sends never replaces the configured one — so a
// partial list ({ m1 complete } of m1 40 / m2 60) is 40 %, never 100 %.
// Without a configuration the stated rows are weighed as they come.
const mergeMilestoneWeights = (configured, submitted) => {
  const submittedRows = normalizeMilestones(submitted);
  const configuredRows = normalizeMilestones(configured);
  if (!submittedRows.length) return configuredRows;
  if (!configuredRows.length) {
    return submittedRows.map((row) => ({ ...row, weight: row.weight ?? 0 }));
  }

  const keyOf = (row, index) => String(row.id || row.name || index);
  const stated = new Map(submittedRows.map((row, index) => [keyOf(row, index), row]));
  return configuredRows.map((config, index) => {
    const row = stated.get(keyOf(config, index));
    const weight = config.weight ?? 0;
    return row
      ? { ...config, ...row, weight }
      : { ...config, complete: false, completed: false, pctComplete: 0, weight };
  });
};

const calculateProgressPercent = ({
  method,
  methodConfig = null,
  payload = {},
}) => {
  const normalizedMethod = normalizeMethod(method || methodConfig?.method);

  if (normalizedMethod === 'quantity') {
    const planned = toNumber(
      payload.quantityPlanned ?? methodConfig?.plannedQuantity,
    );
    const complete = toNumber(payload.quantityComplete);
    if (planned <= 0) {
      throw new HttpError(
        400,
        'PLANNED_QUANTITY_REQUIRED',
        'Quantity progress requires a planned quantity greater than zero',
      );
    }
    return clampPercent((complete / planned) * 100);
  }

  if (normalizedMethod === 'weighted_milestone') {
    const rows = mergeMilestoneWeights(
      methodConfig?.milestoneWeightsJson,
      payload.milestoneProgressJson ?? payload.milestones,
    );
    const totalWeight = rows.reduce((sum, row) => sum + toNumber(row.weight), 0);
    if (rows.length && totalWeight > 0) {
      const earned = rows.reduce((sum, row) => {
        const pct =
          row.pctComplete !== undefined
            ? clampPercent(row.pctComplete)
            : row.complete || row.completed
              ? 100
              : 0;
        return sum + toNumber(row.weight) * pct;
      }, 0);
      return clampPercent(earned / totalWeight);
    }
    return clampPercent(payload.pctComplete);
  }

  if (normalizedMethod === 'inspection') {
    const inspectionStatus = String(payload.inspectionStatus || '').toLowerCase();
    if (['passed', 'approved', 'accepted'].includes(inspectionStatus)) {
      return payload.pctComplete !== undefined
        ? clampPercent(payload.pctComplete)
        : 100;
    }
    if (['failed', 'rejected'].includes(inspectionStatus)) return 0;
    return clampPercent(payload.pctComplete);
  }

  return clampPercent(payload.pctComplete);
};

const serializeMethodConfig = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.projectId,
        activityId: row.activityId,
        method: row.method,
        plannedQuantity: row.plannedQuantity,
        quantityUnit: row.quantityUnit,
        milestoneWeights: row.milestoneWeightsJson || [],
        inspectionRequired: Boolean(row.inspectionRequired),
        evidenceRequired: Boolean(row.evidenceRequired),
        notes: row.notes || null,
        updatedAt: toIso(row.updatedAt),
      }
    : null;

/**
 * PROGRESS SOURCE provenance (PC-6, owner rule): where a figure came from,
 * who put it forward, who made it official and when, the daily log or import
 * it came through, and how many quantity entries it bundles. One shape for an
 * official figure (an ActivityProgress row, with its submission when the
 * link survives) and for a pending one (a submission). importDocumentId is
 * carried for the shape: no column links a submission to the import
 * document it came from (the import names itself in `source` and `notes`).
 */
const buildProgressSource = ({ submission = null, progress = null }) => {
  const entries = Array.isArray(submission?.quantityEntries) ? submission.quantityEntries : [];
  const dailyLogId = entries.find((entry) => entry?.dailyLogId)?.dailyLogId || null;
  // The day(s) of the daily log(s) the figure came through: an entry minted
  // from a daily log is dated the log's day.
  const dailyLogDates = [
    ...new Set(
      entries
        .filter((entry) => entry?.dailyLogId && entry.date)
        .map((entry) => new Date(entry.date).toISOString().slice(0, 10)),
    ),
  ].sort();
  const approved = progress || (submission?.status === 'approved' ? submission : null);
  // How a quantity figure's installed quantity was arrived at: Σ entries, a
  // typed figure (the legacy shape — minted into one entry at approval), or
  // Σ entries over the legacy typed floor (the official row's own note says
  // so; the note carries no figure). null for the other methods.
  const method = progress?.progressMethod ?? submission?.method ?? null;
  let installedBasis = null;
  if (method === 'quantity') {
    if (String(progress?.notes || '').includes(LEGACY_FLOOR_NOTE)) installedBasis = LEGACY_FLOOR_BASIS;
    else if (!entries.length || entries.every((entry) => entry?.source === MINTED_ENTRY_SOURCE)) installedBasis = 'client';
    else installedBasis = 'approved_entries';
  }
  return {
    source: progress?.source ?? submission?.source ?? null,
    installedBasis,
    legacyFloor: installedBasis === LEGACY_FLOOR_BASIS,
    submissionId: progress?.submissionId ?? submission?.id ?? null,
    dailyLogId,
    dailyLogDate: dailyLogDates.length ? dailyLogDates[dailyLogDates.length - 1] : null,
    dailyLogDates,
    dailyReportId: submission?.dailyReportId || null,
    importDocumentId: null,
    submittedBy: submission?.submittedBy || null,
    submittedAt: toIso(submission?.submittedAt),
    approvedBy: progress?.approvedBy ?? (approved ? approved.reviewedBy ?? submission?.reviewedBy ?? null : null),
    approvedAt: toIso(progress?.approvedAt ?? (approved ? approved.reviewedAt ?? submission?.reviewedAt ?? null : null)),
    entries: entries.length,
    entryCount: entries.length,
  };
};

/**
 * The entries a submission bundles, as the ledger serialises them, when the
 * rows were read whole (the queue and the activity's pending submission) —
 * so the approver sees what they are approving: the item, the quantity in
 * its unit, the day and where it came from. The route withholds each from a
 * member who may not read the BOQ (utils/boq-figures).
 */
const serializeBundledEntries = (entries) => {
  if (!Array.isArray(entries) || !entries.length) return [];
  if (!entries.every((entry) => entry && entry.quantity !== undefined && entry.boqItemId !== undefined)) return undefined;
  return entries.map((entry) => quantityProgressService().serializeEntry(entry));
};

/** The activity payload's structured provenance of its official figure (additive beside approvedProgressSource). */
const serializeProgressSource = (progress) =>
  progress ? buildProgressSource({ progress, submission: progress.submission || null }) : null;

const serializeSubmission = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.projectId,
        activityId: row.activityId,
        dailyReportId: row.dailyReportId || null,
        method: row.method,
        source: row.source,
        pctComplete: row.pctComplete,
        quantityComplete: row.quantityComplete,
        quantityPlanned: row.quantityPlanned,
        quantityUnit: row.quantityUnit,
        milestoneProgress: row.milestoneProgressJson || null,
        inspectionStatus: row.inspectionStatus || null,
        actualCost: row.actualCost,
        actualStart: toIso(row.actualStart),
        actualFinish: toIso(row.actualFinish),
        notes: row.notes || null,
        evidence: row.evidenceJson || null,
        status: row.status,
        submittedBy: row.submittedBy || null,
        submittedAt: toIso(row.submittedAt),
        reviewedBy: row.reviewedBy || null,
        reviewedAt: toIso(row.reviewedAt),
        rejectionReason: row.rejectionReason || null,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
        // PC-6: the quantity entries this submission bundles (ids and their
        // state), and the structured PROGRESS SOURCE beside the string fields.
        quantityEntryIds: Array.isArray(row.quantityEntries) ? row.quantityEntries.map((entry) => entry.id) : [],
        quantityEntries: serializeBundledEntries(row.quantityEntries),
        progressSource: buildProgressSource({ submission: row }),
        activity: row.activity
          ? {
              id: row.activity.id,
              name: row.activity.name,
              wbsCode: row.activity.wbsCode,
              p6ActivityId: row.activity.p6ActivityId,
            }
          : undefined,
      }
    : null;

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  return project;
};

const ensureActivity = async ({ projectId, activityId }, tx = prisma) => {
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId, isActive: true },
  });
  if (!activity) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }
  return activity;
};

const canOverrideProgressAssignment = (userRole) =>
  PROGRESS_ASSIGNMENT_OVERRIDE_ROLES.has(String(userRole || '').toLowerCase());

const assertProgressSubmitAllowed = async ({
  projectId,
  activityIds,
  userId,
  userRole,
  tx = prisma,
}) => {
  const uniqueActivityIds = [...new Set((activityIds || []).filter(Boolean))];
  if (!uniqueActivityIds.length || canOverrideProgressAssignment(userRole)) {
    return;
  }

  if (!userId) {
    throw new HttpError(
      403,
      'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED',
      'Progress can only be submitted by assigned activity users or PM/planning overrides',
      { activityIds: uniqueActivityIds },
    );
  }

  const assignments = await tx.activityAssignment.findMany({
    where: {
      userId,
      activityId: { in: uniqueActivityIds },
      activity: { projectId },
    },
    select: { activityId: true },
  });
  const assignedIds = new Set(assignments.map((row) => row.activityId));
  const missing = uniqueActivityIds.filter(
    (activityId) => !assignedIds.has(activityId),
  );

  if (missing.length) {
    throw new HttpError(
      403,
      'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED',
      'Progress can only be submitted by assigned activity users or PM/planning overrides',
      { activityIds: missing },
    );
  }
};

const getMethodConfigRow = async ({ projectId, activityId }, tx = prisma) =>
  tx.activityProgressMethod.findFirst({
    where: { projectId, activityId },
  });

const resolveMethodConfig = async ({ projectId, activityId }, tx = prisma) => {
  const row = await getMethodConfigRow({ projectId, activityId }, tx);
  return (
    row || {
      projectId,
      activityId,
      method: 'percent',
      plannedQuantity: null,
      quantityUnit: null,
      milestoneWeightsJson: null,
      inspectionRequired: false,
      evidenceRequired: false,
      notes: null,
    }
  );
};

const getProgressMethod = async ({ orgId, projectId, activityId }) => {
  await ensureProject({ orgId, projectId });
  await ensureActivity({ projectId, activityId });
  return serializeMethodConfig(
    await resolveMethodConfig({ projectId, activityId }),
  );
};

/**
 * The method an activity's progress is measured by today: its configured
 * method, else the method its latest official figure was approved under,
 * else percent (what resolveMethodConfig answers without a row).
 */
const effectiveMethodFor = async ({ projectId, activityId }, tx = prisma) => {
  const config = await getMethodConfigRow({ projectId, activityId }, tx);
  if (config) return { method: normalizeMethod(config.method), basis: 'method_config' };
  const latest = await tx.activityProgress.findFirst({
    where: { activityId, status: 'approved' },
    orderBy: { updatedAt: 'desc' },
    select: { progressMethod: true },
  });
  if (latest) {
    try {
      return { method: normalizeMethod(latest.progressMethod), basis: 'approved_progress' };
    } catch {
      return { method: 'percent', basis: 'approved_progress' };
    }
  }
  return { method: 'percent', basis: 'default' };
};

/**
 * PC-6 §2: a method change on an activity with approved progress is refused —
 * the frozen pctComplete history is source data, and a percentage approved
 * under one method does not read under another. Writing a row that names
 * the method the activity is already measured by is not a change (the
 * readiness engine counts configured methods, and an activity whose official
 * figures were approved under the default needs its row to clear
 * PROGRESS_METHODS_INCOMPLETE).
 */
const assertMethodChangeAllowed = async ({ projectId, activityId, method }, tx = prisma) => {
  const approvedProgressCount = await tx.activityProgress.count({
    where: { activityId, status: 'approved' },
  });
  if (!approvedProgressCount) return;
  const effective = await effectiveMethodFor({ projectId, activityId }, tx);
  if (effective.method === method) return;
  throw new HttpError(
    409,
    'PROGRESS_METHOD_LOCKED',
    `This activity has ${approvedProgressCount} approved progress record${approvedProgressCount === 1 ? '' : 's'} measured by ${effective.method}; its method is not changed to ${method}`,
    { activityId, effectiveMethod: effective.method, effectiveMethodBasis: effective.basis, requestedMethod: method, approvedProgressCount },
  );
};

const upsertProgressMethod = async ({
  orgId,
  projectId,
  activityId,
  userId,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    await ensureActivity({ projectId, activityId }, tx);

    const method = normalizeMethod(payload.method);
    await assertMethodChangeAllowed({ projectId, activityId, method }, tx);
    const row = await tx.activityProgressMethod.upsert({
      where: { activityId },
      create: {
        projectId,
        activityId,
        method,
        plannedQuantity:
          payload.plannedQuantity !== undefined
            ? toNumber(payload.plannedQuantity)
            : null,
        quantityUnit: payload.quantityUnit?.trim() || null,
        milestoneWeightsJson: payload.milestoneWeights ?? null,
        inspectionRequired: Boolean(payload.inspectionRequired),
        evidenceRequired: Boolean(payload.evidenceRequired),
        notes: payload.notes?.trim() || null,
        createdBy: userId || null,
        updatedBy: userId || null,
      },
      update: {
        method,
        plannedQuantity:
          payload.plannedQuantity !== undefined
            ? toNumber(payload.plannedQuantity)
            : null,
        quantityUnit: payload.quantityUnit?.trim() || null,
        milestoneWeightsJson: payload.milestoneWeights ?? null,
        inspectionRequired: Boolean(payload.inspectionRequired),
        evidenceRequired: Boolean(payload.evidenceRequired),
        notes: payload.notes?.trim() || null,
        updatedBy: userId || null,
      },
    });

    return serializeMethodConfig(row);
  });

// ─── PC-6: quantity bundles ────────────────────────────────────────────────

const uniqueIds = (value) =>
  Array.isArray(value)
    ? [...new Set(value.map((id) => (id === null || id === undefined ? '' : String(id).trim())).filter(Boolean))]
    : [];

const isOpenlyBundled = (entry) =>
  Boolean(entry.submissionId && entry.submission && OPEN_SUBMISSION_STATUSES.includes(entry.submission.status));

/**
 * The quantity entries a quantity-method submission bundles: the ones named
 * (`entryIds`, each on this activity, draft or submitted, in no other open
 * submission) and/or every submitted entry of the activity dated on or before
 * `bundleSubmittedThrough` that no open submission holds. null when the
 * payload bundles nothing (a submission typed the old way).
 */
const resolveQuantityBundle = async ({ orgId, projectId, activityId, payload }, tx) => {
  const entryIds = uniqueIds(payload.entryIds);
  const through = payload.bundleSubmittedThrough ?? payload.bundleThrough ?? null;
  if (!entryIds.length && !through) return null;

  const bundled = new Map();
  if (entryIds.length) {
    const rows = await tx.quantityProgressEntry.findMany({
      where: { id: { in: entryIds }, projectId, orgId },
      select: BUNDLED_ENTRY_SELECT,
    });
    const found = new Set(rows.map((row) => row.id));
    const missing = entryIds.filter((id) => !found.has(id));
    if (missing.length) {
      throw new HttpError(404, 'QUANTITY_ENTRY_NOT_FOUND', 'Quantity entry not found', { entryIds: missing });
    }
    for (const row of rows) {
      if (row.activityId !== activityId) {
        throw new HttpError(
          400,
          'QUANTITY_ENTRY_ACTIVITY_MISMATCH',
          'A submission bundles entries of its own activity only',
          { entryId: row.id, entryActivityId: row.activityId, activityId },
        );
      }
      if (!BUNDLEABLE_ENTRY_STATUSES.includes(row.status)) {
        throw new HttpError(
          409,
          'QUANTITY_ENTRY_LOCKED',
          `A ${row.status} quantity entry is not bundled again; record a correction as a new entry`,
          { entryId: row.id, status: row.status },
        );
      }
      if (isOpenlyBundled(row)) {
        throw new HttpError(
          409,
          'QUANTITY_ENTRY_BUNDLED',
          'This entry is part of a progress submission awaiting approval; reject the submission first',
          { entryId: row.id, submissionId: row.submissionId, submissionStatus: row.submission.status },
        );
      }
      bundled.set(row.id, row);
    }
  }
  if (through) {
    const text = String(through).trim();
    if (!DATE_ONLY.test(text)) throw new HttpError(400, 'INVALID_DATE', 'bundleSubmittedThrough is invalid');
    const date = parseDate(`${text.slice(0, 10)}T00:00:00.000Z`, 'bundleSubmittedThrough');
    const rows = await tx.quantityProgressEntry.findMany({
      where: { projectId, orgId, activityId, status: 'submitted', date: { lte: date } },
      select: BUNDLED_ENTRY_SELECT,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    for (const row of rows) {
      if (!isOpenlyBundled(row)) bundled.set(row.id, row);
    }
  }
  if (!bundled.size) {
    throw new HttpError(
      400,
      'QUANTITY_NO_ENTRIES_TO_BUNDLE',
      'No submitted quantity entry of this activity is free to bundle',
      { activityId, entryIds, bundleSubmittedThrough: through || null },
    );
  }
  return [...bundled.values()];
};

// PC-6 integration: the legacy typed-quantity floor. Carried on the official
// row's notes (no figure in it — a note is progress data every reader sees)
// so PROGRESS SOURCE can say the floor applied.
const LEGACY_FLOOR_BASIS = 'legacy_typed_floor';
const LEGACY_FLOOR_NOTE = 'Legacy typed quantity carried as the floor of the installed figure (PC-6)';
const MINTED_ENTRY_SOURCE = 'submission';

/**
 * A typed quantityComplete (the legacy shape, still what the mobile
 * ProgressSheet sends) is accepted only while the activity has no quantity
 * entry at all. Once entries exist they are the one truth of installed
 * quantity, per BOQ item; an activity-level typed figure cannot be
 * attributed to an item and would be a second truth — 409
 * QUANTITY_ENTRIES_REQUIRED says so.
 */
const assertTypedQuantityAllowed = async ({ orgId, projectId, activityId, payload }, tx) => {
  if (payload.quantityComplete === undefined || payload.quantityComplete === null) return;
  const entries = await tx.quantityProgressEntry.count({ where: { projectId, orgId, activityId } });
  if (!entries) return;
  throw new HttpError(
    409,
    'QUANTITY_ENTRIES_REQUIRED',
    `This activity's installed quantity is recorded as quantity entries per BOQ item (${entries} so far); a typed quantity is not a second truth. Record an entry and bundle it`,
    { activityId, entries },
  );
};

/**
 * A quantity submission states a quantity (verification finding). One that
 * bundles no entry and types no quantityComplete — { pctComplete: 90 } on an
 * activity measured by quantity, with or without the method named — used to
 * be recorded as a quantity submission at 0% (the client's percentage
 * silently replaced), and its approval wrote an official 0% row with nothing
 * behind it: 25% → 0%. It is refused instead, where it is made and — for one
 * already in the queue — where it would become official: 409
 * QUANTITY_ENTRIES_REQUIRED once the activity has entries (they are the
 * truth; bundle them), else 400 QUANTITY_NO_ENTRIES_TO_BUNDLE.
 */
const assertQuantityFigureStated = async ({ orgId, projectId, activityId, quantityComplete, submissionId = null }, tx) => {
  if (quantityComplete !== undefined && quantityComplete !== null && quantityComplete !== '') return;
  const entries = await tx.quantityProgressEntry.count({ where: { projectId, ...(orgId ? { orgId } : {}), activityId } });
  const named = submissionId ? { submissionId } : {};
  const outcome = submissionId ? 'approved; reject it' : 'recorded';
  if (entries) {
    throw new HttpError(
      409,
      'QUANTITY_ENTRIES_REQUIRED',
      `This activity's installed quantity is recorded as quantity entries per BOQ item (${entries} so far); a submission that bundles none of them states no quantity and is not ${outcome}. Bundle the entries (entryIds or bundleSubmittedThrough)`,
      { activityId, entries, ...named },
    );
  }
  throw new HttpError(
    400,
    'QUANTITY_NO_ENTRIES_TO_BUNDLE',
    `This activity is measured by quantity: a submission bundles quantity entries (entryIds or bundleSubmittedThrough) or states a typed quantityComplete. This one does neither — a percentage is not a quantity — and is not ${outcome}`,
    { activityId, entryIds: [], bundleSubmittedThrough: null, ...named },
  );
};

/**
 * A typed quantity states work installed (integration decision, 2026-10-01,
 * for consistency with the entries rule "record nothing for no work"). A
 * typed quantityComplete of 0 on a quantity-measured activity with no
 * entries was accepted, and approving it wrote an official 0% row. It is
 * refused — 400 QUANTITY_INVALID { field: 'quantityComplete' } — where the
 * submission is made and, for one already in the queue, in the writer. The
 * figure is read at the entries' scale (three places), so 0.0004 is zero.
 * The route validators keep "zero or more" (a negative or a non-number is a
 * VALIDATION_ERROR there), exactly as the entries' routes do; the service is
 * the one place that says zero is no figure, on every path (the activity
 * route, bulk-progress, the daily report's linked progress).
 */
const TYPED_ZERO_MESSAGE =
  'A typed quantityComplete must be greater than zero: a typed 0 is not an installed quantity — record nothing for no work';

const assertTypedQuantityPositive = ({ activityId, quantityComplete, submissionId = null }) => {
  if (quantityComplete === undefined || quantityComplete === null || quantityComplete === '') return;
  const typed = quantityProgressService().quantityDecimal(quantityComplete, 'quantityComplete');
  if (typed && typed.greaterThan(0)) return;
  throw new HttpError(
    400,
    'QUANTITY_INVALID',
    submissionId ? `${TYPED_ZERO_MESSAGE}. This submission is not approved; reject it` : TYPED_ZERO_MESSAGE,
    { field: 'quantityComplete', activityId, ...(submissionId ? { submissionId } : {}) },
  );
};

/**
 * A typed figure above zero but below the activity's official installed
 * figure stays allowed — approving it is an approver's explicit approval of
 * a lower figure, written as a new official row (no earlier row changes) —
 * but it is never silent: the submission's answer and the approval's answer
 * carry warnings: [{ code: 'QUANTITY_BELOW_OFFICIAL', officialInstalled,
 * typed, message }] (withheld from a member who may not read the BOQ like
 * the figures themselves; utils/boq-figures.js). The official installed
 * figure is the one the writer's floor reads: max(Σ approved entries, the
 * latest official typed figure in the same unit).
 */
const QUANTITY_BELOW_OFFICIAL = 'QUANTITY_BELOW_OFFICIAL';
const belowOfficialWarning = ({ typed, official }) => {
  const qp = quantityProgressService();
  const typedNumber = qp.quantityNumber(typed);
  const officialNumber = qp.quantityNumber(official);
  return {
    code: QUANTITY_BELOW_OFFICIAL,
    officialInstalled: officialNumber,
    typed: typedNumber,
    message: `The typed installed quantity (${typedNumber}) is below the official installed figure (${officialNumber}); approving it lowers the official installed figure to the typed one`,
  };
};

/** The official installed figure a typed quantity is compared with: Σ approved entries, or the floor above it. */
const officialInstalledFor = async ({ orgId, projectId, activityId, unitCode }, tx) => {
  const qp = quantityProgressService();
  const approvedRows = await tx.quantityProgressEntry.findMany({
    where: { projectId, ...(orgId ? { orgId } : {}), activityId, status: 'approved' },
    select: { quantity: true },
  });
  const approvedBefore = qp.sumQuantities((approvedRows || []).map((row) => row.quantity));
  const { floor } = await legacyInstalledFloor({ activityId, approvedBefore, expectedUnit: unitCode }, tx);
  return floor ? floor.quantity : approvedBefore;
};

const typedBelowOfficial = async ({ orgId, projectId, activityId, quantityComplete, unitCode }, tx) => {
  const typed = quantityProgressService().quantityDecimal(quantityComplete, 'quantityComplete');
  if (!typed) return null;
  const official = await officialInstalledFor({ orgId, projectId, activityId, unitCode }, tx);
  return typed.lessThan(official) ? belowOfficialWarning({ typed, official }) : null;
};

/**
 * A milestone submission states its milestones (integration decision under
 * the owner rule "the activity's progress method is respected", 2026-10-01).
 * On an activity configured weighted_milestone with weighted milestones, a
 * submission carrying no milestone state — { pctComplete: 60 }, with or
 * without the method named — was recorded as a milestone submission whose
 * percentage was worked from the configured milestones alone (0% when none
 * is marked complete), the client's percentage silently replaced, and its
 * approval made that official. It is refused instead, where it is made (a
 * draft too) and — for one already in the queue — in the writer: 400
 * MILESTONES_REQUIRED naming the configured milestones (id and name). A
 * configuration with no weighted milestone keeps taking the percentage as
 * before; so does an activity with no configured method.
 */
const configuredMilestonesOf = (methodConfig) => {
  const rows = normalizeMilestones(methodConfig?.milestoneWeightsJson);
  const totalWeight = rows.reduce((sum, row) => sum + toNumber(row.weight), 0);
  return rows.length && totalWeight > 0 ? rows : [];
};

/**
 * The stated rows are merged onto the configured ones exactly as the figure
 * is worked (mergeMilestoneWeights keys a row by id, else name, else index).
 * A stated milestone the activity does not configure has weight 0, and rows
 * that together carry no weight leave the figure to the client's pctComplete
 * — { pctComplete: 60, milestones: [{ id: 'bogus' }] } was a bare percentage
 * recorded, and approved, under weighted_milestone. Both are refused like no
 * milestone state: 400 MILESTONES_REQUIRED, unknownMilestones naming the ids
 * that are not configured.
 */
const milestoneKey = (row, index) => String(row?.id || row?.name || index);

const assertMilestoneStateStated = ({ activityId, methodConfig, milestones, submissionId = null }) => {
  const configured = configuredMilestonesOf(methodConfig);
  if (!configured.length) return;
  const stated = normalizeMilestones(milestones);
  const configuredKeys = new Set(configured.map(milestoneKey));
  const unknownMilestones = stated.map(milestoneKey).filter((key) => !configuredKeys.has(key));
  // The configured weight of the milestones THIS submission states (a stated
  // row never brings its own weight): zero means it states nothing that counts.
  const configuredWeight = new Map(configured.map((row, index) => [milestoneKey(row, index), toNumber(row.weight)]));
  const statedWeight = stated.length && !unknownMilestones.length
    ? stated.reduce((sum, row, index) => sum + (configuredWeight.get(milestoneKey(row, index)) || 0), 0)
    : 0;
  if (statedWeight > 0) return;
  const outcome = submissionId ? 'approved; reject it and submit the milestones' : 'recorded';
  const why = !stated.length
    ? 'This one states none — a percentage is not a milestone state'
    : unknownMilestones.length
      ? `This one names milestones the activity does not configure (${unknownMilestones.join(', ')}) — a percentage beside them is not a milestone state`
      : 'The milestones it states carry no configured weight — a percentage beside them is not a milestone state';
  throw new HttpError(
    400,
    'MILESTONES_REQUIRED',
    `This activity is measured by weighted milestones (${configured.length} configured); a submission states which milestones are complete (milestones). ${why} — and is not ${outcome}`,
    {
      activityId,
      method: 'weighted_milestone',
      milestones: configured.map((row, index) => ({ id: String(row.id ?? row.name ?? index), name: row.name ?? row.label ?? null })),
      ...(unknownMilestones.length ? { unknownMilestones } : {}),
      ...(submissionId ? { submissionId } : {}),
    },
  );
};

/**
 * The latest official installed figure of the activity when it stands above
 * Σ approved entries: a quantityComplete approved the legacy way (typed, no
 * entries behind it), or a row that itself carried the floor. Installed is
 * then max(Σ approved entries, that figure) + the bundle, so an official
 * figure never regresses by the act of deriving. A legacy row in another
 * unit cannot be a floor (nothing is converted) and is reported as skipped.
 */
const legacyInstalledFloor = async ({ activityId, approvedBefore, expectedUnit }, tx) => {
  const qp = quantityProgressService();
  const latest = await tx.activityProgress.findFirst({
    where: { activityId, status: 'approved', quantityComplete: { not: null } },
    orderBy: [{ approvedAt: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, quantityComplete: true, quantityUnit: true, approvedAt: true },
  });
  if (!latest) return { floor: null, skipped: null };
  const official = qp.quantityDecimal(latest.quantityComplete);
  if (!official || !official.greaterThan(approvedBefore)) return { floor: null, skipped: null };
  const unitKey = uomService().unitKey;
  const unit = latest.quantityUnit?.trim() || null;
  if (unit && expectedUnit && unitKey(unit) !== unitKey(expectedUnit)) {
    return {
      floor: null,
      skipped: {
        progressId: latest.id,
        quantity: qp.quantityNumber(official),
        unitCode: unit,
        reason: `The latest official installed figure is in "${unit}", the entries in "${expectedUnit}"; no conversion is made, so it is not carried as the floor`,
      },
    };
  }
  return { floor: { quantity: official, unitCode: unit || expectedUnit || null, progressId: latest.id, approvedAt: latest.approvedAt }, skipped: null };
};

/**
 * The figures of a quantity-method submission (PC-6 §2, §3):
 *
 * - planned: the typed method-configuration figure when there is one (basis
 *   method_config), else Σ approved, active allocation quantity of the
 *   activity (basis approved_allocations) — quantity-progress.service
 *   plannedQuantityFor. A client-sent quantityPlanned never overrides either;
 *   it counts only when neither exists (basis client — an activity measured
 *   by quantity with nothing mapped and nothing typed, the pre-PC-6 shape),
 *   and without it the submission is refused as before. At approval, when
 *   still nothing is typed and nothing mapped, the figure the submission
 *   was put forward with (its frozen quantityPlanned — `frozen`) is the
 *   planned quantity (basis submission): the bundle a client planned is
 *   approvable, not stuck between an approval that cannot derive and an
 *   edit the bundle refuses.
 * - installed: when the submission bundles entries, Σ the bundled entries +
 *   Σ entries already approved on the activity (basis approved_entries), in
 *   one unit — the planned figure's when it has one; otherwise the client's
 *   typed quantityComplete (basis client), the pre-PC-6 shape.
 * - pctComplete = installed ÷ planned, clamped to 0..100.
 */
const deriveQuantityFigures = async ({ orgId, projectId, activityId, payload, bundled, methodConfig, frozen = null }, tx) => {
  const qp = quantityProgressService();
  const planned = await qp.plannedQuantityFor({ orgId, projectId, activityId, tx });
  const clientPlanned = payload.quantityPlanned !== undefined && payload.quantityPlanned !== null ? toNumber(payload.quantityPlanned) : null;
  const frozenPlanned = frozen && frozen.planned !== undefined && frozen.planned !== null ? toNumber(frozen.planned) : null;
  const figures = {
    planned: planned.planned,
    plannedBasis: planned.basis,
    unitCode: planned.unitCode || null,
    installed: null,
    installedBasis: 'client',
    approvedBefore: null,
    bundledEntries: 0,
    clientQuantityPlannedIgnored: false,
  };
  if (planned.basis === 'none') {
    if (clientPlanned !== null && clientPlanned > 0) {
      figures.planned = clientPlanned;
      figures.plannedBasis = 'client';
    } else if (frozenPlanned !== null && frozenPlanned > 0) {
      figures.planned = frozenPlanned;
      figures.plannedBasis = 'submission';
    } else {
      figures.planned = null;
      figures.plannedBasis = 'none';
    }
    figures.unitCode =
      payload.quantityUnit?.trim() || (figures.plannedBasis === 'submission' ? frozen.unitCode?.trim() : null) || methodConfig.quantityUnit || null;
    figures.plannedReason = planned.reason || null;
  } else if (clientPlanned !== null && clientPlanned !== figures.planned) {
    figures.clientQuantityPlannedIgnored = true;
  }

  if (bundled) {
    const approvedRows = await tx.quantityProgressEntry.findMany({
      where: { projectId, orgId, activityId, status: 'approved' },
      select: { id: true, quantity: true, unitCode: true },
    });
    const unitKey = uomService().unitKey;
    const units = [...new Set([...bundled, ...approvedRows].map((row) => row.unitCode))];
    const expectedUnit = figures.unitCode;
    const foreign = expectedUnit ? units.filter((unit) => unitKey(unit) !== unitKey(expectedUnit)) : units.length > 1 ? units : [];
    if (foreign.length) {
      throw new HttpError(
        400,
        'QUANTITY_UNIT_MISMATCH',
        expectedUnit
          ? `The entries are in "${foreign.join('", "')}" but the activity's planned quantity is in "${expectedUnit}"; no conversion is made`
          : `The entries are in more than one unit (${units.join(', ')}); nothing is summed across units`,
        { units, plannedUnit: expectedUnit, activityId },
      );
    }
    const approvedBefore = qp.sumQuantities(approvedRows.map((row) => row.quantity));
    // The floor: an official figure never goes backwards by the act of
    // deriving (owner rule). An activity approved the legacy way — a typed
    // quantityComplete with no entries behind it — stands at that figure, and
    // the first bundle after PC-6 adds to it rather than discarding it.
    const { floor, skipped } = await legacyInstalledFloor({ activityId, approvedBefore, expectedUnit: expectedUnit || units[0] || null }, tx);
    const base = floor ? floor.quantity : approvedBefore;
    const installed = base.plus(qp.sumQuantities(bundled.map((row) => row.quantity)));
    figures.installed = qp.quantityNumber(installed);
    figures.installedBasis = floor ? LEGACY_FLOOR_BASIS : 'approved_entries';
    figures.approvedBefore = qp.quantityNumber(approvedBefore);
    figures.approvedEntries = approvedRows.length;
    figures.bundledEntries = bundled.length;
    figures.unitCode = expectedUnit || units[0] || null;
    if (floor) {
      figures.legacyFloor = { quantity: qp.quantityNumber(floor.quantity), unitCode: floor.unitCode, progressId: floor.progressId, approvedAt: toIso(floor.approvedAt), note: LEGACY_FLOOR_NOTE };
    } else if (skipped) {
      figures.legacyFloorSkipped = skipped;
    }
  } else {
    figures.installed = payload.quantityComplete !== undefined && payload.quantityComplete !== null ? toNumber(payload.quantityComplete) : null;
  }
  if (!figures.unitCode) figures.unitCode = payload.quantityUnit?.trim() || methodConfig.quantityUnit || null;
  figures.pctComplete = calculateProgressPercent({
    method: 'quantity',
    methodConfig,
    payload: { quantityComplete: figures.installed ?? 0, quantityPlanned: figures.planned },
  });
  return figures;
};

/**
 * The method a submission is measured by is the activity's, never the
 * client's (PC-6 integration, owner rule: respect the activity's progress
 * method). With a configured ActivityProgressMethod row the submission takes
 * that method; a client naming another is refused — 409
 * PROGRESS_METHOD_MISMATCH naming both — never silently coerced, so a
 * percentage typed against a quantity-measured activity cannot bypass the
 * derivation and reach the approver as a figure with no entries behind it.
 * Without a configured row the client's method is accepted as before (the
 * default is percent).
 */
const resolveSubmissionMethod = ({ activityId, payload, configRow }) => {
  const requested = payload.method ?? payload.progressMethod ?? null;
  if (!configRow) return normalizeMethod(requested || 'percent');
  const effectiveMethod = normalizeMethod(configRow.method);
  if (requested === null || requested === undefined || String(requested).trim() === '') return effectiveMethod;
  const requestedMethod = normalizeMethod(requested);
  if (requestedMethod === effectiveMethod) return effectiveMethod;
  throw new HttpError(
    409,
    'PROGRESS_METHOD_MISMATCH',
    `This activity is measured by ${effectiveMethod}; a ${requestedMethod} submission is not recorded against it. The submission's method is the activity's — record ${effectiveMethod === 'quantity' ? 'quantity entries and bundle them' : `${effectiveMethod} progress`} instead`,
    { activityId, effectiveMethod, effectiveMethodBasis: 'method_config', requestedMethod },
  );
};

/**
 * The same rule in the one writer (verification finding: the bypass by
 * ordering). The rule above is asked when a submission is made; a percent
 * submission put forward while the activity was unconfigured — or one
 * already pending when the rule shipped — would otherwise stay approvable
 * after the planner configures the activity as quantity (the method lock
 * reads approved progress only), and the approver would make a percentage
 * with no entries behind it official; the first bundle afterwards would
 * then derive from its entries and the official figure would regress. So
 * approval asks again: a submission whose method is not the activity's
 * configured method is 409 PROGRESS_METHOD_MISMATCH, naming both and the
 * submission. The approver rejects it and the site records it the
 * activity's way. Without a configured row nothing is asked, as before.
 */
const assertSubmissionMethodStands = ({ submission, configRow }) => {
  if (!configRow) return;
  const effectiveMethod = normalizeMethod(configRow.method);
  let submittedMethod;
  try {
    submittedMethod = normalizeMethod(submission.method);
  } catch {
    submittedMethod = String(submission.method || '').trim() || null;
  }
  if (submittedMethod === effectiveMethod) return;
  throw new HttpError(
    409,
    'PROGRESS_METHOD_MISMATCH',
    `This activity is measured by ${effectiveMethod}; a ${submittedMethod} submission is not approved against it. Reject it and record ${effectiveMethod === 'quantity' ? 'quantity entries and bundle them' : `${effectiveMethod} progress`} instead`,
    { activityId: submission.activityId, effectiveMethod, effectiveMethodBasis: 'method_config', requestedMethod: submittedMethod, submissionId: submission.id },
  );
};

const buildSubmissionData = async ({
  orgId = null,
  projectId,
  activityId,
  userId,
  payload,
  dailyReportId = null,
  fallbackPhotos = null,
  evidenceScan = null,
  tx = prisma,
}) => {
  const configRow = await getMethodConfigRow({ projectId, activityId }, tx);
  const methodConfig = configRow || (await resolveMethodConfig({ projectId, activityId }, tx));
  const method = resolveSubmissionMethod({ activityId, payload, configRow });
  const status = payload.status || 'submitted';
  if (!SUBMISSION_STATUSES.includes(status)) {
    throw new HttpError(
      400,
      'INVALID_PROGRESS_STATUS',
      `Progress status must be one of: ${SUBMISSION_STATUSES.join(', ')}`,
    );
  }

  const evidenceRead = evidenceScan || scanSubmissionEvidence({ projectId, payload, fallbackPhotos });
  if (evidenceRead.error && evidenceRead.evidence === null) throw evidenceRead.error;
  const evidence = await prepareEvidence({ orgId, projectId, evidence: evidenceRead.evidence, scanned: evidenceRead }, tx);
  if (
    status !== 'draft' &&
    methodConfig.evidenceRequired &&
    !hasEvidence(evidence)
  ) {
    throw new HttpError(
      400,
      'PROGRESS_EVIDENCE_REQUIRED',
      'This activity requires evidence before progress can be submitted',
    );
  }

  // PC-6: a quantity submission's figures are derived, never typed over
  // what the planner mapped; the other methods are untouched.
  let bundled = null;
  let quantity = null;
  const warnings = [];
  if (method === 'quantity') {
    bundled = await resolveQuantityBundle({ orgId, projectId, activityId, payload }, tx);
    if (!bundled) {
      await assertTypedQuantityAllowed({ orgId, projectId, activityId, payload }, tx);
      await assertQuantityFigureStated({ orgId, projectId, activityId, quantityComplete: payload.quantityComplete }, tx);
      assertTypedQuantityPositive({ activityId, quantityComplete: payload.quantityComplete });
    }
    quantity = await deriveQuantityFigures({ orgId, projectId, activityId, payload, bundled, methodConfig }, tx);
    if (!bundled) {
      const below = await typedBelowOfficial({ orgId, projectId, activityId, quantityComplete: quantity.installed, unitCode: quantity.unitCode }, tx);
      if (below) warnings.push(below);
    }
  } else if (uniqueIds(payload.entryIds).length || payload.bundleSubmittedThrough || payload.bundleThrough) {
    throw new HttpError(
      400,
      'QUANTITY_BUNDLE_METHOD_MISMATCH',
      `Quantity entries are bundled by a quantity-method submission; this one is measured by ${method}`,
      { method },
    );
  }
  // The milestone method is respected like quantity: a submission against
  // configured weighted milestones states their state, never a bare percentage.
  if (method === 'weighted_milestone' && configRow) {
    assertMilestoneStateStated({ activityId, methodConfig: configRow, milestones: payload.milestoneProgressJson ?? payload.milestones });
  }

  const pctComplete = quantity
    ? quantity.pctComplete
    : calculateProgressPercent({
        method,
        methodConfig,
        payload,
      });
  const now = new Date();

  return {
    bundled,
    quantity,
    warnings,
    data: {
    projectId,
    activityId,
    dailyReportId,
    method,
    source: payload.source || (dailyReportId ? 'daily_report' : 'manual'),
    pctComplete,
    quantityComplete: quantity
      ? quantity.installed
      : payload.quantityComplete !== undefined
        ? toNumber(payload.quantityComplete)
        : null,
    quantityPlanned: quantity
      ? quantity.planned
      : payload.quantityPlanned !== undefined
        ? toNumber(payload.quantityPlanned)
        : methodConfig.plannedQuantity,
    quantityUnit: quantity
      ? quantity.unitCode
      : payload.quantityUnit?.trim() || methodConfig.quantityUnit || null,
    milestoneProgressJson:
      payload.milestoneProgressJson ?? payload.milestones ?? null,
    inspectionStatus: payload.inspectionStatus?.trim() || null,
    actualCost:
      payload.actualCost !== undefined && payload.actualCost !== null
        ? toMoneyNumber(payload.actualCost)
        : null,
    actualStart:
      payload.actualStart !== undefined
        ? parseDate(payload.actualStart, 'actualStart')
        : null,
    actualFinish:
      payload.actualFinish !== undefined
        ? parseDate(payload.actualFinish, 'actualFinish')
        : null,
    notes: payload.notes?.trim() || null,
    evidenceJson: evidence,
    status,
    submittedBy: status === 'draft' ? null : userId || null,
    submittedAt: status === 'draft' ? null : now,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdBy: userId || null,
    updatedBy: userId || null,
    },
  };
};

/** The submission's entries as they stand after some were settled. */
const withSettledEntries = (entries, settled) => {
  const byId = new Map((settled || []).map((entry) => [entry.id, entry]));
  const known = new Set((entries || []).map((entry) => entry.id));
  // A settled entry the submission did not list before (the one minted from
  // a typed figure at approval) is its entry from now on.
  return [...(entries || []).map((entry) => byId.get(entry.id) || entry), ...(settled || []).filter((entry) => !known.has(entry.id))];
};

/** Marks a bundled entry approved or rejected, with its own audit trail. */
const settleBundledEntries = async ({ tx, orgId, projectId, submission, entries, outcome, userId, now, reason = null }) => {
  if (!entries.length) return [];
  const data =
    outcome === 'approved'
      ? { status: 'approved', approvedBy: userId || null, approvedAt: now, submissionId: submission.id }
      : { status: 'rejected', rejectedBy: userId || null, rejectedAt: now, rejectionReason: reason, submissionId: submission.id };
  await tx.quantityProgressEntry.updateMany({ where: { id: { in: entries.map((entry) => entry.id) } }, data });
  const summaryOf = (entry, status) => ({
    activityId: entry.activityId,
    boqItemId: entry.boqItemId,
    quantity: quantityProgressService().quantityNumber(entry.quantity),
    unitCode: entry.unitCode,
    source: entry.source,
    status,
    submissionId: submission.id,
  });
  for (const entry of entries) {
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: QUANTITY_ENTRY_ENTITY_TYPE,
      entityId: entry.id,
      action: outcome === 'approved' ? auditService.ACTIONS.APPROVED : auditService.ACTIONS.REJECTED,
      actorId: userId,
      occurredAt: now,
      oldStatus: entry.status,
      newStatus: outcome,
      reason: reason || undefined,
      oldSummary: summaryOf(entry, entry.status),
      newSummary: summaryOf(entry, outcome),
      summary: { transition: outcome === 'approved' ? 'quantity_entry.approve' : 'quantity_entry.reject', ...summaryOf(entry, outcome) },
    });
  }
  return entries.map((entry) => ({ ...entry, ...data }));
};

/**
 * A typed quantityComplete approved (the legacy shape; what the mobile
 * ProgressSheet sends) mints ONE approved QuantityProgressEntry (source
 * 'submission') carrying the typed figure as a delta over the previous
 * official installed figure — max(Σ approved entries, the latest official
 * installed figure), the floor — so the activity has one truth of installed
 * quantity from then on and the next bundle adds to it. Nothing is minted
 * when the delta is zero or negative (no derivation lowers a figure; the
 * approved row stands as approved — and when negative that row IS lower than
 * the official figure before it, an approver's explicit approval of a lower
 * figure, which the answer warns of: QUANTITY_BELOW_OFFICIAL), when the
 * activity has no single allocated BOQ item (an entry names an item; an
 * activity-level figure on several items cannot be attributed to one — the
 * answer says so, and such an activity is served by entries from then on,
 * 409 QUANTITY_ENTRIES_REQUIRED on the next typed figure) or when the typed
 * unit is not the item's. Replay-safe by clientRequestId 'submission:<id>'.
 */
const mintTypedQuantityEntry = async ({ tx, orgId, projectId, submission, userId, now }) => {
  const qp = quantityProgressService();
  const activityId = submission.activityId;
  const typedUnit = submission.quantityUnit?.trim() || null;
  const answer = { installed: toNumber(submission.quantityComplete), planned: submission.quantityPlanned ?? null, unitCode: typedUnit, plannedBasis: 'submission', installedBasis: 'client', mintedEntry: null, mintSkipped: null };
  const result = { installed: answer.installed, planned: answer.planned, unitCode: typedUnit, entry: null, skipped: null, answer };
  const skip = (reason, extra = {}) => {
    result.skipped = { reason, ...extra };
    answer.mintSkipped = result.skipped;
    return result;
  };
  const typed = qp.quantityDecimal(submission.quantityComplete);
  const approvedRows = await tx.quantityProgressEntry.findMany({ where: { projectId, orgId, activityId, status: 'approved' }, select: { quantity: true } });
  const approvedBefore = qp.sumQuantities(approvedRows.map((row) => row.quantity));
  const { floor } = await legacyInstalledFloor({ activityId, approvedBefore, expectedUnit: typedUnit }, tx);
  const base = floor ? floor.quantity : approvedBefore;
  const delta = typed.minus(base);
  if (!delta.greaterThan(0)) {
    // The approval writes the typed figure as the new official row whatever
    // happens here: equal, it changes nothing; below, it LOWERS the official
    // installed figure (an approver's explicit approval of a lower figure),
    // and the answer warns. Nothing is minted either way — a negative delta
    // is no entry, and the entries already approved stay as they are.
    if (delta.isZero()) {
      return skip('The typed figure equals the official installed figure; nothing is minted and the official figure is unchanged', { typed: qp.quantityNumber(typed), officialBefore: qp.quantityNumber(base) });
    }
    result.warning = belowOfficialWarning({ typed, official: base });
    return skip('The typed figure is below the official installed figure; nothing is minted, and this approval lowers the official installed figure to the typed one (a new official row; no earlier row or entry is changed)', { typed: qp.quantityNumber(typed), officialBefore: qp.quantityNumber(base) });
  }
  const allocations = await tx.activityBoqAllocation.findMany({
    where: { projectId, activityId, status: 'approved', isActive: true },
    select: { id: true, boqItemId: true, boqItem: { select: { id: true, unit: true, unitCode: true } } },
  });
  const items = [...new Set(allocations.map((row) => row.boqItemId))];
  if (items.length !== 1) {
    return skip(
      items.length
        ? `The activity has ${items.length} allocated BOQ items; a typed activity-level figure cannot be attributed to one, so no entry is minted (the floor rule carries the figure)`
        : 'The activity has no approved allocation; an entry names a BOQ item, so none is minted (the floor rule carries the figure)',
      { items: items.length },
    );
  }
  const item = allocations[0].boqItem || {};
  const boqItemId = items[0];
  const unitKey = uomService().unitKey;
  const itemUnit = item.unitCode?.trim() || item.unit?.trim() || null;
  if (typedUnit && itemUnit && unitKey(typedUnit) !== unitKey(itemUnit)) {
    return skip(`The typed figure is in "${typedUnit}", the allocated item in "${itemUnit}"; no conversion is made, so no entry is minted`, { itemUnit });
  }
  const when = submission.submittedAt || now;
  const row = await tx.quantityProgressEntry.create({
    data: {
      orgId,
      projectId,
      activityId,
      boqItemId,
      allocationId: allocations.length === 1 ? allocations[0].id : null,
      unitCode: itemUnit || typedUnit,
      quantity: delta,
      date: new Date(`${toIso(when).slice(0, 10)}T00:00:00.000Z`),
      source: MINTED_ENTRY_SOURCE,
      status: 'approved',
      submissionId: submission.id,
      approvedBy: userId || null,
      approvedAt: now,
      createdBy: submission.submittedBy || userId || null,
      clientRequestId: `submission:${submission.id}`,
      note: 'Minted from a typed quantity submission: the typed figure as a delta over the previous official installed figure',
    },
  });
  const summary = { activityId, boqItemId, quantity: qp.quantityNumber(delta), unitCode: row.unitCode, source: row.source, status: row.status, submissionId: submission.id, typed: qp.quantityNumber(typed), officialBefore: qp.quantityNumber(base) };
  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: QUANTITY_ENTRY_ENTITY_TYPE,
    entityId: row.id,
    action: auditService.ACTIONS.CREATED,
    actorId: userId,
    occurredAt: now,
    newStatus: 'approved',
    newSummary: summary,
    summary: { transition: 'quantity_entry.mint_from_typed_submission', ...summary },
  });
  result.entry = { ...row, submission: { id: submission.id, status: 'approved' } };
  answer.mintedEntry = { id: row.id, boqItemId, quantity: summary.quantity, unitCode: row.unitCode, officialBefore: summary.officialBefore };
  return result;
};

const createProgressSubmission = async ({
  orgId,
  projectId,
  activityId,
  userId,
  userRole,
  payload,
  dailyReportId = null,
  fallbackPhotos = null,
  tx = null,
  evidenceScan = null,
}) => {
  // The evidence is read before the transaction (scanEvidence): by the caller
  // that opened it (bulk progress, a daily report), else here.
  let evidenceRead = null;
  try {
    if (evidenceScan && evidenceScan.projectId === projectId && evidenceScan.source === evidenceSource(payload, fallbackPhotos)) evidenceRead = evidenceScan;
  } catch {
    // The payload is read again below, and refused where it was.
  }
  evidenceRead = evidenceRead || scanSubmissionEvidence({ projectId, payload, fallbackPhotos });
  const runner = async (client) => {
    await ensureProject({ orgId, projectId }, client);
    await ensureActivity({ projectId, activityId }, client);
    await assertProgressSubmitAllowed({
      projectId,
      activityIds: [activityId],
      userId,
      userRole,
      tx: client,
    });
    const { data, bundled, quantity, warnings } = await buildSubmissionData({
      orgId,
      projectId,
      activityId,
      userId,
      payload,
      dailyReportId,
      fallbackPhotos,
      evidenceScan: evidenceRead,
      tx: client,
    });
    const row = await client.progressSubmission.create({ data });
    if (bundled) {
      // The entries are the submission's figure from here on: one open
      // submission each (quantity-progress.service refuses to edit them
      // under it), submitted with it, approved or rejected with it.
      const submitted = row.status === 'draft' ? {} : { status: 'submitted' };
      await client.quantityProgressEntry.updateMany({
        where: { id: { in: bundled.map((entry) => entry.id) } },
        data: { submissionId: row.id, ...submitted },
      });
      row.quantityEntries = bundled.map((entry) => ({ ...entry, submissionId: row.id, ...submitted }));
    }
    const quantitySummary = quantity
      ? {
          quantityInstalled: quantity.installed,
          quantityPlanned: quantity.planned,
          quantityUnit: quantity.unitCode,
          plannedBasis: quantity.plannedBasis,
          installedBasis: quantity.installedBasis,
          quantityEntries: bundled ? bundled.length : 0,
          clientQuantityPlannedIgnored: quantity.clientQuantityPlannedIgnored,
        }
      : {};
    await auditService.recordEvent({
      tx: client,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.PROGRESS_SUBMISSION,
      entityId: row.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      newStatus: row.status,
      newSummary: {
        activityId: row.activityId,
        status: row.status,
        pctComplete: row.pctComplete,
        method: row.method,
        source: row.source,
        ...quantitySummary,
      },
      summary: {
        transition:
          row.status === 'draft'
            ? 'submission.create_draft'
            : 'submission.submit',
        activityId: row.activityId,
        pctComplete: row.pctComplete,
        method: row.method,
        source: row.source,
        ...quantitySummary,
      },
      attachments: getEvidenceAttachments(row.evidenceJson),
    });
    const serialized = serializeSubmission(row);
    // The answer's basis: where the planned and installed figures came from
    // (a transient block; the columns above are the frozen values) — and
    // the warnings a typed figure below the official one carries.
    const warned = warnings && warnings.length ? { warnings } : {};
    return quantity ? { ...serialized, quantity, ...warned } : serialized;
  };

  return tx ? runner(tx) : prisma.$transaction(runner);
};

const listProgressSubmissions = async ({
  orgId,
  projectId,
  activityId = null,
  status = null,
  from = null,
  to = null,
}) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId };
  if (activityId) where.activityId = activityId;
  if (status) where.status = status;
  // A daily report asks what was recorded on one day, and a day on site is a
  // local one: work recorded at eight in the evening in Baton Rouge already
  // belongs to tomorrow in UTC. So a caller that knows its own offset sends
  // instants ("2026-09-20T05:00:00.000Z") and gets exactly its day; a caller
  // that sends a bare date gets that date in UTC, which is what every reader
  // of these timestamps assumed before there was a filter at all.
  //
  // A submission is dated by when it was sent, and one not sent yet by when it
  // was made — the same pair these rows are already ordered by.
  const boundary = (value, endOfDay) =>
    String(value).includes("T")
      ? new Date(value)
      : new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (from || to) {
    const range = {};
    if (from) range.gte = boundary(from, false);
    if (to) range.lte = boundary(to, true);
    where.OR = [{ submittedAt: range }, { submittedAt: null, createdAt: range }];
  }

  const rows = await prisma.progressSubmission.findMany({
    where,
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          wbsCode: true,
          p6ActivityId: true,
        },
      },
      // The queue shows what each submission bundles: the entries, whole.
      quantityEntries: { select: BUNDLED_ENTRY_SELECT, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return rows.map(serializeSubmission);
};

const ensureSubmission = async ({ projectId, submissionId }, tx = prisma) => {
  const submission = await tx.progressSubmission.findFirst({
    where: { id: submissionId, projectId },
    include: { activity: true, quantityEntries: { select: BUNDLED_ENTRY_SELECT } },
  });
  if (!submission) {
    throw new HttpError(
      404,
      'PROGRESS_SUBMISSION_NOT_FOUND',
      'Progress submission not found',
    );
  }
  return submission;
};

const approveProgressSubmissionWithClient = async ({
  tx = prisma,
  orgId,
  projectId,
  activityId = null,
  submissionId,
  userId,
}) => {
  await ensureProject({ orgId, projectId }, tx);
  let submission = await ensureSubmission({ projectId, submissionId }, tx);
  if (activityId && submission.activityId !== activityId) {
    throw new HttpError(
      404,
      'PROGRESS_SUBMISSION_NOT_FOUND',
      'Progress submission not found for this activity',
    );
  }

  // PC-6: approvals are serialised per activity. A quantity bundle's
  // installed figure is Σ approved entries on the activity read in this
  // transaction; two bundles approved at once would each read "approved so
  // far" before the other commits and the later official row would carry
  // less than its own source data (the lens's race). Holding the activity's
  // row makes the second wait for the first and read what it wrote; the
  // submission is read again under the lock (the same one approved twice at
  // once answers idempotently). Prisma without $queryRaw (a mocked client)
  // skips the hold — the pattern boq.service uses for the item row.
  if (typeof tx.$queryRaw === 'function') {
    await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${submission.activityId} FOR UPDATE`;
    submission = await ensureSubmission({ projectId, submissionId }, tx);
  }

  if (submission.status === 'approved') {
    return serializeSubmission(submission);
  }
  if (!APPROVABLE_STATUSES.includes(submission.status)) {
    throw new HttpError(
      400,
      'PROGRESS_NOT_APPROVABLE',
      'Only draft or submitted progress can be approved',
    );
  }

  // The method rule, asked again where a figure becomes official.
  const configRow = await getMethodConfigRow({ projectId, activityId: submission.activityId }, tx);
  assertSubmissionMethodStands({ submission, configRow });
  // A milestone submission in the queue that states no milestone (put
  // forward before the rule) is not made official at a figure worked from
  // the configuration alone.
  if (configRow && normalizeMethod(submission.method) === 'weighted_milestone') {
    assertMilestoneStateStated({ activityId: submission.activityId, methodConfig: configRow, milestones: submission.milestoneProgressJson, submissionId: submission.id });
  }
  const methodConfig = configRow || (await resolveMethodConfig(
    { projectId, activityId: submission.activityId },
    tx,
  ));
  if (methodConfig.evidenceRequired && !hasEvidence(submission.evidenceJson)) {
    throw new HttpError(
      400,
      'PROGRESS_EVIDENCE_REQUIRED',
      'This activity requires evidence before progress can be approved',
    );
  }

  // ITP hold points on the activity must pass before progress is approved
  // (OCTA-QA-TEMPLATE-014). Required lazily to avoid a service cycle.
  const holdPoints = await require('./form.service').openHoldPoints(
    { projectId, activityId: submission.activityId },
    tx,
  );
  if (holdPoints.length) {
    const first = holdPoints[0];
    throw new HttpError(
      409,
      'ITP_HOLD_POINT_OPEN',
      `${holdPoints.length} ITP hold point${holdPoints.length === 1 ? '' : 's'} on this activity ${holdPoints.length === 1 ? 'has' : 'have'} not passed (${first.ref}: ${first.label} — ${first.state})`,
      { holdPoints },
    );
  }

  const now = new Date();

  // PC-6: a quantity submission that bundles entries is approved with them,
  // in this transaction, and its figures are read again now — installed is
  // Σ approved entries on the activity, and another bundle may have been
  // approved since this one was put forward; planned may have been typed or
  // mapped since — and when still neither exists, the planned figure the
  // submission was put forward with (its frozen column) stands, so a bundle
  // a client planned is approvable. The columns are then the frozen values
  // of this approval. A quantity submission typed the old way (no entries)
  // is approved as it stands.
  const pending = (submission.quantityEntries || []).filter(
    (entry) => BUNDLEABLE_ENTRY_STATUSES.includes(entry.status) && entry.submissionId === submission.id,
  );
  let quantity = null;
  let bundledEntries = [];
  if (submission.method === 'quantity' && pending.length) {
    quantity = await deriveQuantityFigures(
      {
        orgId,
        projectId,
        activityId: submission.activityId,
        payload: {},
        bundled: pending,
        methodConfig,
        frozen: { planned: submission.quantityPlanned, unitCode: submission.quantityUnit },
      },
      tx,
    );
    bundledEntries = await settleBundledEntries({ tx, orgId, projectId, submission, entries: pending, outcome: 'approved', userId, now });
  }
  // A quantity submission with nothing behind it — no entry, no typed figure
  // (one in the queue from before the rule) — is not made official at 0%.
  if (submission.method === 'quantity' && !pending.length) {
    await assertQuantityFigureStated(
      { orgId, projectId, activityId: submission.activityId, quantityComplete: submission.quantityComplete, submissionId: submission.id },
      tx,
    );
    // ... nor at a typed 0 (one in the queue from before the zero rule).
    assertTypedQuantityPositive({ activityId: submission.activityId, quantityComplete: submission.quantityComplete, submissionId: submission.id });
  }
  // A quantity submission typed the old way (no entries): approved as it
  // stands, and ONE approved entry is minted from it so the activity has one
  // truth of installed quantity from here on (see mintTypedQuantityEntry).
  const typed =
    submission.method === 'quantity' && !pending.length && submission.quantityComplete !== null && submission.quantityComplete !== undefined
      ? await mintTypedQuantityEntry({ tx, orgId, projectId, submission, userId, now })
      : null;

  const approved = await tx.progressSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'approved',
      reviewedBy: userId || null,
      reviewedAt: now,
      rejectionReason: null,
      submittedBy: submission.submittedBy || userId || null,
      submittedAt: submission.submittedAt || now,
      updatedBy: userId || null,
      ...(quantity
        ? {
            pctComplete: quantity.pctComplete,
            quantityComplete: quantity.installed,
            quantityPlanned: quantity.planned,
            quantityUnit: quantity.unitCode,
          }
        : {}),
    },
  });
  approved.quantityEntries = withSettledEntries(submission.quantityEntries, typed?.entry ? [...bundledEntries, typed.entry] : bundledEntries);

  const approvedProgress = await tx.activityProgress.create({
    data: {
      activityId: approved.activityId,
      submissionId: approved.id,
      pctComplete: clampPercent(approved.pctComplete),
      actualCost: approved.actualCost,
      actualStart: approved.actualStart,
      actualFinish: approved.actualFinish,
      progressMethod: approved.method,
      source: approved.source,
      quantityComplete: approved.quantityComplete,
      quantityPlanned: approved.quantityPlanned,
      quantityUnit: approved.quantityUnit,
      milestoneProgressJson: approved.milestoneProgressJson,
      inspectionStatus: approved.inspectionStatus,
      evidenceJson: approved.evidenceJson,
      status: 'approved',
      approvedBy: userId || null,
      approvedAt: now,
      // The floor's trace on the official row itself: a sentence, never a figure.
      notes: quantity?.legacyFloor ? [approved.notes, LEGACY_FLOOR_NOTE].filter(Boolean).join('\n') : approved.notes,
      updatedBy: userId || null,
    },
  });

  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.PROGRESS_SUBMISSION,
    entityId: approved.id,
    action: auditService.ACTIONS.APPROVED,
    actorId: userId,
    occurredAt: now,
    oldStatus: submission.status,
    newStatus: 'approved',
    oldSummary: {
      activityId: submission.activityId,
      status: submission.status,
      pctComplete: submission.pctComplete,
      method: submission.method,
      source: submission.source,
    },
    newSummary: {
      activityId: approved.activityId,
      status: approved.status,
      pctComplete: approved.pctComplete,
      method: approved.method,
      source: approved.source,
      approvedProgressId: approvedProgress.id,
      ...(quantity
        ? {
            quantityInstalled: quantity.installed,
            quantityPlanned: quantity.planned,
            quantityUnit: quantity.unitCode,
            plannedBasis: quantity.plannedBasis,
            installedBasis: quantity.installedBasis,
            quantityEntries: bundledEntries.length,
            ...(quantity.legacyFloor ? { legacyFloor: quantity.legacyFloor } : {}),
          }
        : {}),
      ...(typed ? { quantityInstalled: typed.installed, quantityPlanned: typed.planned, quantityUnit: typed.unitCode, installedBasis: 'client', mintedEntryId: typed.entry?.id || null, mintSkipped: typed.skipped || null } : {}),
    },
    summary: {
      transition: 'submission.approve',
      activityId: approved.activityId,
      activityName: submission.activity?.name || null,
      pctComplete: approved.pctComplete,
      method: approved.method,
      source: approved.source,
      ...(quantity ? { quantityEntries: bundledEntries.length, plannedBasis: quantity.plannedBasis } : {}),
    },
    attachments: getEvidenceAttachments(approved.evidenceJson),
  });

  // PROGRESS SOURCE of the answer reads the official row just written (its
  // note says whether the legacy floor applied), as the activity payload will.
  const serialized = { ...serializeSubmission(approved), progressSource: buildProgressSource({ submission: approved, progress: approvedProgress }) };
  if (quantity) return { ...serialized, quantity, approvedProgressId: approvedProgress.id };
  if (typed) return { ...serialized, quantity: typed.answer, approvedProgressId: approvedProgress.id, ...(typed.warning ? { warnings: [typed.warning] } : {}) };
  return serialized;
};

const approveProgressSubmission = async (params) =>
  prisma.$transaction((tx) => approveProgressSubmissionWithClient({ ...params, tx }));

const rejectProgressSubmissionWithClient = async ({
  tx = prisma,
  orgId,
  projectId,
  activityId = null,
  submissionId,
  userId,
  reason,
}) => {
  await ensureProject({ orgId, projectId }, tx);
  const submission = await ensureSubmission({ projectId, submissionId }, tx);
  if (activityId && submission.activityId !== activityId) {
    throw new HttpError(
      404,
      'PROGRESS_SUBMISSION_NOT_FOUND',
      'Progress submission not found for this activity',
    );
  }

  if (submission.status === 'rejected') {
    return serializeSubmission(submission);
  }

  if (submission.status === 'approved') {
    throw new HttpError(
      400,
      'APPROVED_PROGRESS_LOCKED',
      'Approved progress cannot be rejected',
    );
  }

  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) {
    throw new HttpError(
      400,
      'REJECTION_REASON_REQUIRED',
      'A rejection reason is required',
    );
  }

  const now = new Date();
  // PC-6: the entries the submission bundles are rejected with it — their
  // trail (rejectedBy/At/Reason) is the only way an entered quantity stops
  // counting, and nothing official is written.
  const pending = (submission.quantityEntries || []).filter(
    (entry) => BUNDLEABLE_ENTRY_STATUSES.includes(entry.status) && entry.submissionId === submission.id,
  );
  const rejectedEntries = await settleBundledEntries({
    tx,
    orgId,
    projectId,
    submission,
    entries: pending,
    outcome: 'rejected',
    userId,
    now,
    reason: trimmedReason,
  });

  const row = await tx.progressSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'rejected',
      reviewedBy: userId || null,
      reviewedAt: now,
      rejectionReason: trimmedReason,
      updatedBy: userId || null,
    },
  });
  row.quantityEntries = withSettledEntries(submission.quantityEntries, rejectedEntries);

  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.PROGRESS_SUBMISSION,
    entityId: row.id,
    action: auditService.ACTIONS.REJECTED,
    actorId: userId,
    occurredAt: row.reviewedAt || new Date(),
    oldStatus: submission.status,
    newStatus: 'rejected',
    reason: trimmedReason,
    oldSummary: {
      activityId: submission.activityId,
      status: submission.status,
      pctComplete: submission.pctComplete,
      method: submission.method,
    },
    newSummary: {
      activityId: row.activityId,
      status: row.status,
      pctComplete: row.pctComplete,
      method: row.method,
    },
    summary: {
      transition: 'submission.reject',
      activityId: row.activityId,
      activityName: submission.activity?.name || null,
      ...(rejectedEntries.length ? { quantityEntries: rejectedEntries.length } : {}),
    },
  });

  return serializeSubmission(row);
};

const rejectProgressSubmission = async (params) =>
  prisma.$transaction((tx) => rejectProgressSubmissionWithClient({ ...params, tx }));

module.exports = {
  PROGRESS_METHODS,
  SUBMISSION_STATUSES,
  calculateProgressPercent,
  normalizeMethod,
  hasEvidence,
  prepareEvidence,
  scanEvidence,
  scanSubmissionEvidence,
  MAX_EVIDENCE_FILES,
  serializeMethodConfig,
  serializeSubmission,
  serializeProgressSource,
  buildProgressSource,
  BUNDLED_ENTRY_SELECT,
  effectiveMethodFor,
  resolveSubmissionMethod,
  getProgressMethod,
  upsertProgressMethod,
  createProgressSubmission,
  assertProgressSubmitAllowed,
  listProgressSubmissions,
  approveProgressSubmissionWithClient,
  approveProgressSubmission,
  rejectProgressSubmissionWithClient,
  rejectProgressSubmission,
};
