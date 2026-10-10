'use strict';

/**
 * Helpers shared by the WP-9 builders 087-EXC and 087-HLT (build/087-exc.js,
 * build/087-hlt.js). Not a builder: run-all.js never runs it, and it opens no
 * build of its own. Every function works inside a step (s) of a build (b) of
 * lib.js, so every request it sends is named, asserted and recorded there.
 *
 * Request shapes are the ones the population drivers and the phase-21 stages
 * already send (scripts/cert/drivers/*.js, scripts/phase21/stage*.js), checked
 * against the routes' validators (backend/src/routes/*.js).
 *
 * Builders' adjudication (2026-10-09) rules applied here:
 *   G6  records are selected by identity (a description, a title, a file name, a
 *       user id) and exactly one may match: only() / exactlyOne() / findRow().
 *   G7  dates are placed with the answer book's own five-day calendar
 *       (answers/field-controls.js rules.addWorkingDays), never with the product's
 *       cpm.service.
 *   G4  an interrupted upload is adopted by its file name where the product lists
 *       it (attach), and otherwise never sent again (workflowUpload fails closed).
 */

const zlib = require('zlib');
const FC = require('../answers/field-controls');

// ── files ────────────────────────────────────────────────────────────────────
/** A minimal one-page PDF with `text` on the page (drivers/quality-field.js pdf). */
const pdf = (text) => {
  const stream = `BT /F1 11 Tf 40 780 Td (${String(text).replace(/[()\\]/g, ' ')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
/** A valid 1x1 PNG carrying `text` (drivers/quality-field.js png). */
const png = (text) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  const seed = crc32(Buffer.from(text, 'latin1'));
  const pixel = Buffer.from([0, seed & 0xff, (seed >>> 8) & 0xff, (seed >>> 16) & 0xff]);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')),
    pngChunk('IDAT', zlib.deflateSync(pixel)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const pdfFile = (b, label) => ({ filename: b.file(`${label}.pdf`), body: pdf(`${b.ref(label)} ${label}`), contentType: 'application/pdf' });

// ── lists ────────────────────────────────────────────────────────────────────
const LIST_KEYS = ['items', 'rows', 'orders', 'activities', 'boqItems', 'allocations', 'lines', 'periods', 'risks', 'records', 'certificates', 'data', 'results', 'instances', 'templates', 'drawings', 'incidents', 'ncrs', 'itps', 'members', 'team', 'costLoadings', 'loadings', 'revisions', 'entries', 'submissions'];
/** The rows of a list answer, whatever key it uses. */
const rows = (data) => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const key of LIST_KEYS) if (Array.isArray(data[key])) return data[key];
  return [];
};

// ── identity (G6) ────────────────────────────────────────────────────────────
/** The one row of `list` that `pred` accepts, or null when none does; two or more is a duplicate (BuildError). */
const only = (s, list, pred, what) => {
  const hits = (list || []).filter(pred);
  s.assert(hits.length <= 1, `${what}: at most one record may match by identity, ${hits.length} do (a duplicate: resolve it by hand)`);
  return hits.length === 1 ? hits[0] : null;
};
/** The one row of `list` that `pred` accepts; none or several is a BuildError. */
const exactlyOne = (s, list, pred, what) => {
  const hits = (list || []).filter(pred);
  s.assert(hits.length === 1, `${what}: exactly one record must match by identity, ${hits.length} do`);
  return hits[0];
};
/** The one row of `route` (read as `persona`) that `pred` accepts, or null; two or more is a BuildError. */
const findRow = async (s, persona, route, pred, what = `GET ${route}`) => only(s, rows(await s.get(persona, route)), pred, what);
/** An id list of a live list: true, or what is missing (a verify's answer). */
const holds = (list, checks) => {
  for (const [label, pred] of Object.entries(checks)) {
    if (!(list || []).some(pred)) return `${label} no longer holds`;
  }
  return true;
};

// ── dates (G7: the answer book's own calendar) ───────────────────────────────
const DAY_MS = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const isWorkingDay = (iso) => weekday(iso) !== 0 && weekday(iso) !== 6;
const day = (value) => (value ? String(value).slice(0, 10) : null);

/**
 * The date of working day `n` (0 = the start) on the five-day calendar of the answer book
 * (field-controls.js rules.addWorkingDays: n working days after the start, exclusive finish).
 * The start must be a working day.
 */
const dateOfWorkingDay = (startIso, n) => {
  if (!isWorkingDay(startIso)) throw new Error(`dateOfWorkingDay: the start ${startIso} is not a working day`);
  if (!Number.isInteger(n) || n < 0) throw new Error(`dateOfWorkingDay: ${n} is not a whole number of working days`);
  return FC.rules.addWorkingDays(startIso, n);
};

/**
 * The working-day index of `iso` from `startIso` on the same calendar: the n whose
 * dateOfWorkingDay(start, n) is `iso`. A Saturday or Sunday has no index on the answer
 * book's five-day calendar, so it is refused (round 2, R2-F: fail closed). Mapping it to
 * the next Monday would rest on how the product snaps a non-working data date, which is
 * product knowledge, not a book rule; the WP9.T3 slip of 7 is defined for a weekday run date.
 */
const workingDayOf = (startIso, iso) => {
  if (!isWorkingDay(startIso)) throw new Error(`workingDayOf: the start ${startIso} is not a working day`);
  if (!isWorkingDay(iso)) throw new Error(`workingDayOf: ${iso} is a Saturday or Sunday, which has no working-day index on the answer book's five-day calendar (fail closed: build on a weekday)`);
  if (iso < startIso) throw new Error(`workingDayOf: ${iso} is before the start ${startIso}`);
  let n = 0;
  while (FC.rules.addWorkingDays(startIso, n) < iso) n += 1;
  if (FC.rules.addWorkingDays(startIso, n) !== iso) throw new Error(`workingDayOf: ${iso} is not a working date of the calendar from ${startIso}`);
  return n;
};

// ── recurring requests ───────────────────────────────────────────────────────
/** A project-local cost code selection (PUT replaces the selection) and the codes' ids, by company code. */
const companyCostCodes = async (s, persona, codes) => {
  const library = rows(await s.get(persona, '/company/cost-codes?includeArchived=false'));
  const out = {};
  for (const code of codes) {
    const row = exactlyOne(s, library, (c) => c.code === code, `the company cost code ${code} in the cost-code master (reused, never created by this build)`);
    out[code] = row.id;
  }
  return out;
};

/** True when `x` (an attachment row, its document, or a stored file) carries this file name. */
const carriesFile = (filename) => (x) => [x?.fileName, x?.originalName, x?.filename, x?.document?.fileName, x?.document?.originalName].includes(filename);

/**
 * Uploads a file onto a record (POST /attachments, field `files`), with a
 * clientRequestId so a resent upload answers the same attachment. Returns
 * { id, documentId }. An interrupted upload is adopted by its file name in the
 * record's attachment list (never sent again).
 */
const attach = async (b, s, name, persona, { recordType, recordId, label, kind = 'pdf', caption = null }) => {
  const file = kind === 'png'
    ? { filename: b.file(`${label}.png`), body: png(b.ref(label)), contentType: 'image/png' }
    : pdfFile(b, label);
  const listRoute = `${b.P}/attachments?recordType=${recordType}&recordId=${recordId}`;
  const isThisFile = carriesFile(file.filename);
  const data = await s.upload(name, persona, `${b.P}/attachments`, file, {
    field: 'files',
    form: { recordType, recordId, caption: caption || `${label} ${b.ref(label)}`, clientRequestId: b.ref(`att-${label}`) },
    idOf: (d) => {
      const hits = rows(d).filter(isThisFile);
      return hits.length === 1 ? hits[0].id : null;
    },
    get: () => listRoute,
    fields: {
      items: (v, d) => {
        const hits = rows(d).filter(isThisFile);
        return (hits.length === 1 && typeof hits[0].documentId === 'string' && hits[0].documentId.length > 0) || `exactly one attachment carrying ${file.filename}, with a project document id`;
      },
    },
    find: async (s2) => {
      const row = only(s2, rows(await s2.get(persona, listRoute)), isThisFile, `the attachment ${file.filename} on ${recordType} ${recordId}`);
      return row ? { items: [row] } : null;
    },
  });
  const list = rows(data);
  const row = list.length ? exactlyOne(s, list, isThisFile, `the attachment ${file.filename}`) : data;
  return { id: row.id, documentId: row.documentId || row.document?.id || null };
};

/**
 * Closeout evidence through the workflow store (POST /workflow/uploads), as the NCR and
 * safety closeouts send it. The store has no listing (GET /workflow/uploads/:key needs
 * the key the answer carries), so an interrupted upload cannot be found by its file name:
 * it is never sent again, and the lib stops for a check by hand (fail closed, R3-7). The
 * upload has no JSON read-back either (get: null): the calling step's verify reads the
 * closeout that cites it (`storageKey`) live.
 */
const workflowUpload = async (b, s, name, persona, label) => {
  const file = pdfFile(b, label);
  const isThisFile = carriesFile(file.filename);
  const data = await s.upload(name, persona, `${b.P}/workflow/uploads`, file, {
    field: 'files',
    // The answer is the list of stored files itself: [{ documentId, fileName, fileUrl, storageKey, ... }].
    idOf: (d) => {
      const hits = rows(d).filter(isThisFile);
      return hits.length === 1 ? hits[0].documentId : null;
    },
    get: null,
    fields: {
      length: (v, d) => {
        const hits = rows(d).filter(isThisFile);
        return (hits.length === 1 && typeof hits[0].documentId === 'string' && hits[0].documentId.length > 0) || `exactly one stored file named ${file.filename}, with a project document id`;
      },
    },
  });
  const item = exactlyOne(s, rows(data), isThisFile, `the stored file ${file.filename}`);
  return {
    fileName: item.fileName,
    fileUrl: item.fileUrl,
    storageKey: item.storageKey || item.documentId,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    description: `Closeout evidence ${b.ref(label)}`,
  };
};

/** True when a closeout record (NCR, safety incident) cites this evidence (its storage key) among its attachments. */
const citesEvidence = (record, evidence) => [...(record?.attachments || []), ...(record?.attachmentRefs || [])]
  .some((a) => a && (a.storageKey === evidence.storageKey || a.documentId === evidence.storageKey) && carriesFile(evidence.fileName)(a));

module.exports = {
  DAY_MS,
  addDays,
  attach,
  carriesFile,
  citesEvidence,
  companyCostCodes,
  dateOfWorkingDay,
  day,
  exactlyOne,
  findRow,
  holds,
  isWorkingDay,
  only,
  pdf,
  pdfFile,
  png,
  rows,
  weekday,
  workflowUpload,
  workingDayOf,
};
