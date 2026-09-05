const zlib = require("zlib");
const path = require("path");
const { isZip, listZipEntries, readZipEntries } = require("./zip-reader");

/**
 * Dependency-free document text extraction (OCTA-DOC-TEXT-010).
 *
 * Supported: plain text / Markdown / CSV / JSON / XML / HTML, Excel (via the
 * already-bundled @e965/xlsx), Word (docx), PowerPoint (pptx), OpenDocument
 * (odt/odp/ods) and PDF text layers (literal and hex strings, Flate streams,
 * object streams, ToUnicode CMaps). Scanned PDFs and images have no text
 * layer and are reported as `unsupported` with a reason, so the UI can say
 * why a file is not searchable.
 */

const MAX_TEXT_CHARS = 800_000;
const MAX_PDF_OBJECTS = 200_000;

const EXTRACTORS = Object.freeze({
  TEXT: "text",
  HTML: "html",
  SPREADSHEET: "spreadsheet",
  DOCX: "docx",
  PPTX: "pptx",
  ODF: "odf",
  PDF: "pdf",
});

const TEXT_MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/xml",
  "text/xml",
  "application/rtf",
  "text/rtf",
]);
const HTML_MIME = new Set(["text/html", "application/xhtml+xml"]);
const SPREADSHEET_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
]);
const DOCX_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const PPTX_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const ODF_MIME = new Set([
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.presentation",
]);
const PDF_MIME = new Set(["application/pdf", "application/x-pdf"]);

const EXTENSION_KIND = Object.freeze({
  ".txt": EXTRACTORS.TEXT,
  ".md": EXTRACTORS.TEXT,
  ".markdown": EXTRACTORS.TEXT,
  ".csv": EXTRACTORS.TEXT,
  ".tsv": EXTRACTORS.TEXT,
  ".json": EXTRACTORS.TEXT,
  ".xml": EXTRACTORS.TEXT,
  ".rtf": EXTRACTORS.TEXT,
  ".log": EXTRACTORS.TEXT,
  ".htm": EXTRACTORS.HTML,
  ".html": EXTRACTORS.HTML,
  ".xlsx": EXTRACTORS.SPREADSHEET,
  ".xlsm": EXTRACTORS.SPREADSHEET,
  ".xls": EXTRACTORS.SPREADSHEET,
  ".ods": EXTRACTORS.SPREADSHEET,
  ".docx": EXTRACTORS.DOCX,
  ".pptx": EXTRACTORS.PPTX,
  ".odt": EXTRACTORS.ODF,
  ".odp": EXTRACTORS.ODF,
  ".pdf": EXTRACTORS.PDF,
});

const kindFor = ({ mimeType, fileName }) => {
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (TEXT_MIME.has(mime)) return EXTRACTORS.TEXT;
  if (HTML_MIME.has(mime)) return EXTRACTORS.HTML;
  if (SPREADSHEET_MIME.has(mime)) return EXTRACTORS.SPREADSHEET;
  if (DOCX_MIME.has(mime)) return EXTRACTORS.DOCX;
  if (PPTX_MIME.has(mime)) return EXTRACTORS.PPTX;
  if (ODF_MIME.has(mime)) return EXTRACTORS.ODF;
  if (PDF_MIME.has(mime)) return EXTRACTORS.PDF;
  const extension = path.extname(String(fileName || "")).toLowerCase();
  return EXTENSION_KIND[extension] || null;
};

const isExtractableType = ({ mimeType, fileName }) => Boolean(kindFor({ mimeType, fileName }));

// ─── Text helpers ─────────────────────────────────────────────────────────

const decodeEntities = (value) =>
  String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => safeFromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const safeFromCodePoint = (code) => {
  try {
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
};

const normalizeWhitespace = (text) =>
  String(text || "")
    .replace(/[\u00ad\ufeff\u200b]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const countWords = (text) => (String(text || "").match(/\S+/g) || []).length;

const clampText = (text) =>
  text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;

const looksBinary = (buffer) => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.1;
};

const decodeUtf8 = (buffer) => {
  const text = buffer.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
};

const stripTags = (xml) => xml.replace(/<[^>]+>/g, "");

const result = ({ status = "ready", extractor, text = "", pageCount = null, reason = null }) => {
  const normalized = clampText(normalizeWhitespace(text));
  if (status === "ready" && !normalized) {
    return {
      status: "unsupported",
      extractor,
      text: "",
      pageCount,
      wordCount: 0,
      reason: reason || "no_text",
    };
  }
  return {
    status,
    extractor,
    text: normalized,
    pageCount,
    wordCount: countWords(normalized),
    reason,
  };
};

// ─── Plain text / HTML ───────────────────────────────────────────────────

const extractPlainText = (buffer) => {
  if (looksBinary(buffer)) {
    return result({ status: "unsupported", extractor: EXTRACTORS.TEXT, reason: "binary" });
  }
  let text = decodeUtf8(buffer);
  if (/^\{\\rtf/.test(text)) {
    text = text
      .replace(/\\par[d]?\b/g, "\n")
      .replace(/\\'([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\[a-z]+-?\d* ?/g, "")
      .replace(/[{}]/g, "");
  }
  return result({ extractor: EXTRACTORS.TEXT, text });
};

const extractHtml = (buffer) => {
  const html = decodeUtf8(buffer)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|section|article|blockquote|pre)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t");
  return result({ extractor: EXTRACTORS.HTML, text: decodeEntities(stripTags(html)) });
};

// ─── Spreadsheets (SheetJS is already a dependency for BOQ imports) ─────

const extractSpreadsheet = (buffer) => {
  let XLSX;
  try {
    XLSX = require("@e965/xlsx");
  } catch {
    return result({ status: "unsupported", extractor: EXTRACTORS.SPREADSHEET, reason: "parser_unavailable" });
  }
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheets = workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `${name}\n${csv}`;
  });
  return result({
    extractor: EXTRACTORS.SPREADSHEET,
    text: sheets.join("\n\n"),
    pageCount: workbook.SheetNames.length,
  });
};

// ─── Office Open XML / OpenDocument ─────────────────────────────────────

const wordXmlToText = (xml) =>
  decodeEntities(
    stripTags(
      xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br\b[^>]*\/>/g, "\n")
        .replace(/<w:cr\/>/g, "\n")
        // keep each table row on one line: cell paragraphs end with a tab
        .replace(/<\/w:p>\s*<\/w:tc>/g, "\t")
        .replace(/<\/w:tc>/g, "\t")
        .replace(/<\/w:tr>/g, "\n")
        .replace(/<\/w:p>/g, "\n"),
    ),
  );

const extractDocx = (buffer) => {
  if (!isZip(buffer)) {
    return result({ status: "unsupported", extractor: EXTRACTORS.DOCX, reason: "not_a_zip" });
  }
  const names = listZipEntries(buffer)
    .map((entry) => entry.name)
    .filter((name) =>
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name),
    )
    .sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));
  const entries = readZipEntries(buffer, names);
  const main = entries.get("word/document.xml");
  if (!main) {
    return result({ status: "unsupported", extractor: EXTRACTORS.DOCX, reason: "missing_document_xml" });
  }
  const parts = [wordXmlToText(main.toString("utf8"))];
  for (const [name, data] of entries) {
    if (name !== "word/document.xml") parts.push(wordXmlToText(data.toString("utf8")));
  }
  return result({ extractor: EXTRACTORS.DOCX, text: parts.join("\n\n") });
};

const slideNumber = (name) => Number((/slide(\d+)\.xml$/.exec(name) || [])[1] || 0);

const extractPptx = (buffer) => {
  if (!isZip(buffer)) {
    return result({ status: "unsupported", extractor: EXTRACTORS.PPTX, reason: "not_a_zip" });
  }
  const names = listZipEntries(buffer)
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b) || a.localeCompare(b));
  const entries = readZipEntries(buffer, names);
  const slides = names
    .filter((name) => name.startsWith("ppt/slides/"))
    .map((name) => entries.get(name))
    .filter(Boolean)
    .map((data) =>
      decodeEntities(
        stripTags(
          data
            .toString("utf8")
            .replace(/<a:br\/>/g, "\n")
            .replace(/<a:tab\/>/g, "\t")
            .replace(/<\/a:p>/g, "\n"),
        ),
      ),
    );
  const notes = names
    .filter((name) => name.startsWith("ppt/notesSlides/"))
    .map((name) => entries.get(name))
    .filter(Boolean)
    .map((data) => decodeEntities(stripTags(data.toString("utf8").replace(/<\/a:p>/g, "\n"))));
  return result({
    extractor: EXTRACTORS.PPTX,
    text: [...slides, ...notes].join("\n\n"),
    pageCount: slides.length || null,
  });
};

const extractOdf = (buffer) => {
  if (!isZip(buffer)) {
    return result({ status: "unsupported", extractor: EXTRACTORS.ODF, reason: "not_a_zip" });
  }
  const content = readZipEntries(buffer, ["content.xml"]).get("content.xml");
  if (!content) {
    return result({ status: "unsupported", extractor: EXTRACTORS.ODF, reason: "missing_content_xml" });
  }
  const xml = content
    .toString("utf8")
    .replace(/<text:tab\/>/g, "\t")
    .replace(/<text:line-break\/>/g, "\n")
    .replace(/<text:s(?:\s+text:c="(\d+)")?\/>/g, (_m, count) => " ".repeat(Number(count) || 1))
    .replace(/<\/text:(p|h)>/g, "\n")
    .replace(/<\/table:table-cell>/g, "\t");
  return result({ extractor: EXTRACTORS.ODF, text: decodeEntities(stripTags(xml)) });
};

// ─── PDF ─────────────────────────────────────────────────────────────────

const WINANSI_HIGH = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

const byteToChar = (byte) => {
  if (byte >= 32 && byte <= 126) return String.fromCharCode(byte);
  if (byte >= 0xa0) return String.fromCharCode(byte);
  if (WINANSI_HIGH[byte]) return WINANSI_HIGH[byte];
  if (byte === 9 || byte === 10 || byte === 13) return " ";
  return "";
};

const hexToUtf16 = (hex) => {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  if (!clean.length) return "";
  if (clean.length <= 2) return byteToChar(parseInt(clean, 16));
  const bytes = Buffer.from(clean.length % 4 === 0 ? clean : clean.padStart(clean.length + 2, "0"), "hex");
  const swapped = Buffer.from(bytes);
  swapped.swap16();
  return swapped.toString("utf16le").replace(/\ufeff/g, "");
};

/** Undo PNG predictors (used by object/xref streams). */
const applyPngPredictor = (data, columns) => {
  const rowLength = columns + 1;
  const rows = Math.floor(data.length / rowLength);
  const out = Buffer.alloc(rows * columns);
  let previous = Buffer.alloc(columns);
  for (let row = 0; row < rows; row += 1) {
    const filter = data[row * rowLength];
    const line = Buffer.from(data.subarray(row * rowLength + 1, row * rowLength + rowLength));
    for (let i = 0; i < columns; i += 1) {
      const left = i > 0 ? line[i - 1] : 0;
      const up = previous[i];
      const upLeft = i > 0 ? previous[i - 1] : 0;
      if (filter === 1) line[i] = (line[i] + left) & 0xff;
      else if (filter === 2) line[i] = (line[i] + up) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        line[i] = (line[i] + predictor) & 0xff;
      }
    }
    line.copy(out, row * columns);
    previous = line;
  }
  return out;
};

const decodeStream = (dict, raw) => {
  if (!/\/FlateDecode\b/.test(dict)) {
    return /\/Filter\b/.test(dict) ? null : raw;
  }
  let data = null;
  try {
    data = zlib.inflateSync(raw);
  } catch {
    try {
      data = zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch {
      return null;
    }
  }
  const predictor = Number((/\/Predictor\s+(\d+)/.exec(dict) || [])[1] || 1);
  if (predictor >= 10) {
    const columns = Number((/\/Columns\s+(\d+)/.exec(dict) || [])[1] || 1);
    data = applyPngPredictor(data, columns);
  }
  return data;
};

const parsePdfObjects = (buffer) => {
  const latin = buffer.toString("latin1");
  const objects = new Map();
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  let seen = 0;
  while ((match = pattern.exec(latin)) && seen < MAX_PDF_OBJECTS) {
    seen += 1;
    const number = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const endIndex = latin.indexOf("endobj", bodyStart);
    const body = latin.slice(bodyStart, endIndex < 0 ? undefined : endIndex);
    const streamMatch = /stream\r?\n/.exec(body);
    if (!streamMatch) {
      objects.set(number, { dict: body.trim(), stream: null, raw: null });
      continue;
    }
    const dict = body.slice(0, streamMatch.index).trim();
    const dataStart = bodyStart + streamMatch.index + streamMatch[0].length;
    const declared = Number((/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict) || [])[1]);
    let dataEnd = -1;
    if (Number.isFinite(declared) && declared >= 0) {
      const candidate = dataStart + declared;
      const tail = latin.slice(candidate, candidate + 12);
      if (/^\s*endstream/.test(tail)) dataEnd = candidate;
    }
    if (dataEnd < 0) {
      const endStream = latin.indexOf("endstream", dataStart);
      dataEnd = endStream < 0 ? latin.length : endStream;
      while (dataEnd > dataStart && (latin[dataEnd - 1] === "\n" || latin[dataEnd - 1] === "\r")) {
        dataEnd -= 1;
      }
    }
    objects.set(number, {
      dict,
      raw: buffer.subarray(dataStart, dataEnd),
      stream: undefined, // decoded lazily
    });
    pattern.lastIndex = Math.max(pattern.lastIndex, dataEnd);
  }
  return { objects, latin };
};

const streamOf = (object) => {
  if (!object) return null;
  if (object.stream !== undefined) return object.stream;
  object.stream = object.raw ? decodeStream(object.dict, object.raw) : null;
  return object.stream;
};

const expandObjectStreams = (objects) => {
  for (const [, object] of [...objects]) {
    if (!/\/Type\s*\/ObjStm\b/.test(object.dict)) continue;
    const data = streamOf(object);
    if (!data) continue;
    const count = Number((/\/N\s+(\d+)/.exec(object.dict) || [])[1] || 0);
    const first = Number((/\/First\s+(\d+)/.exec(object.dict) || [])[1] || 0);
    const header = data.subarray(0, first).toString("latin1").trim().split(/\s+/).map(Number);
    const text = data.toString("latin1");
    for (let index = 0; index < count; index += 1) {
      const number = header[index * 2];
      const offset = header[index * 2 + 1];
      const nextOffset = index + 1 < count ? header[index * 2 + 3] : undefined;
      if (!Number.isFinite(number) || !Number.isFinite(offset)) continue;
      const body = text.slice(first + offset, nextOffset === undefined ? undefined : first + nextOffset);
      if (!objects.has(number)) objects.set(number, { dict: body.trim(), stream: null, raw: null });
    }
  }
};

const refOf = (dict, key) => {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict || "");
  return match ? Number(match[1]) : null;
};

const balancedDict = (text, start) => {
  let depth = 0;
  for (let index = start; index < text.length - 1; index += 1) {
    if (text[index] === "<" && text[index + 1] === "<") {
      depth += 1;
      index += 1;
    } else if (text[index] === ">" && text[index + 1] === ">") {
      depth -= 1;
      index += 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
};

const directDictOf = (dict, key) => {
  const match = new RegExp(`/${key}\\s*<<`).exec(dict || "");
  if (!match) return null;
  return balancedDict(dict, match.index + match[0].length - 2);
};

const resolveDict = (objects, dict, key) => {
  const direct = directDictOf(dict, key);
  if (direct) return direct;
  const ref = refOf(dict, key);
  return ref !== null ? objects.get(ref)?.dict || null : null;
};

const parseCMap = (text) => {
  const map = new Map();
  let codeBytes = 1;
  const codespace = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  let match;
  while ((match = codespace.exec(text))) {
    const hexes = match[1].match(/<([0-9a-f]+)>/gi) || [];
    for (const hex of hexes) codeBytes = Math.max(codeBytes, Math.ceil((hex.length - 2) / 2));
  }
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((match = bfchar.exec(text))) {
    const pairs = match[1].match(/<([0-9a-f]*)>\s*<([0-9a-f]*)>/gi) || [];
    for (const pair of pairs) {
      const [, src, dst] = /<([0-9a-f]*)>\s*<([0-9a-f]*)>/i.exec(pair);
      map.set(parseInt(src, 16), hexToUtf16(dst));
    }
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((match = bfrange.exec(text))) {
    const body = match[1];
    const rangePattern = /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f]*>)/gi;
    let range;
    while ((range = rangePattern.exec(body))) {
      const low = parseInt(range[1], 16);
      const high = parseInt(range[2], 16);
      if (!Number.isFinite(low) || !Number.isFinite(high) || high - low > 65_535) continue;
      if (range[3].startsWith("[")) {
        const targets = range[3].match(/<([0-9a-f]*)>/gi) || [];
        targets.forEach((target, index) => map.set(low + index, hexToUtf16(target.slice(1, -1))));
      } else {
        const base = range[3].slice(1, -1);
        const baseText = hexToUtf16(base);
        const last = baseText.codePointAt(baseText.length - 1);
        const prefix = baseText.slice(0, -1);
        for (let code = low; code <= high; code += 1) {
          map.set(code, prefix + safeFromCodePoint(last + (code - low)));
        }
      }
    }
  }
  return { map, codeBytes };
};

const buildFonts = (objects) => {
  const fonts = new Map();
  for (const [number, object] of objects) {
    const dict = object.dict || "";
    if (!/\/Type\s*\/Font\b/.test(dict) && !/\/Subtype\s*\/(Type0|Type1|TrueType|Type3|MMType1)\b/.test(dict)) {
      continue;
    }
    const font = { toUnicode: null, codeBytes: 1, identity: false };
    const toUnicodeRef = refOf(dict, "ToUnicode");
    const cmapStream = toUnicodeRef !== null ? streamOf(objects.get(toUnicodeRef)) : null;
    if (cmapStream) {
      const parsed = parseCMap(cmapStream.toString("latin1"));
      font.toUnicode = parsed.map;
      font.codeBytes = parsed.codeBytes;
    }
    if (/\/Subtype\s*\/Type0\b/.test(dict)) {
      font.codeBytes = Math.max(font.codeBytes, 2);
      font.identity = /\/Encoding\s*\/Identity-[HV]/.test(dict);
    }
    fonts.set(number, font);
  }
  return fonts;
};

const fontMapFor = (objects, pageDict) => {
  const seen = new Set();
  let current = pageDict;
  let resources = null;
  while (current && !resources) {
    resources = resolveDict(objects, current, "Resources");
    if (resources) break;
    const parentRef = refOf(current, "Parent");
    if (parentRef === null || seen.has(parentRef)) break;
    seen.add(parentRef);
    current = objects.get(parentRef)?.dict || null;
  }
  const fontDict = resources ? resolveDict(objects, resources, "Font") : null;
  const map = new Map();
  if (!fontDict) return map;
  const entry = /\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g;
  let match;
  while ((match = entry.exec(fontDict))) map.set(match[1], Number(match[2]));
  return map;
};

const contentRefsFor = (objects, pageDict) => {
  const arrayMatch = /\/Contents\s*\[([^\]]*)\]/.exec(pageDict);
  if (arrayMatch) {
    return [...arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
  }
  const ref = refOf(pageDict, "Contents");
  if (ref === null) return [];
  const target = objects.get(ref);
  if (target && target.raw === null && /^\s*\[/.test(target.dict || "")) {
    return [...target.dict.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
  }
  return [ref];
};

const orderedPages = (objects) => {
  const pageNumbers = [...objects]
    .filter(([, object]) => /\/Type\s*\/Page\b/.test(object.dict || "") && !/\/Type\s*\/Pages\b/.test(object.dict || ""))
    .map(([number]) => number);
  const byParent = new Map();
  for (const number of pageNumbers) {
    const parent = refOf(objects.get(number).dict, "Parent");
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(number);
  }
  // Walk the page tree when we can find the root; fall back to file order.
  const ordered = [];
  const visited = new Set();
  const walk = (nodeNumber, depth) => {
    if (depth > 64 || visited.has(nodeNumber)) return;
    visited.add(nodeNumber);
    const node = objects.get(nodeNumber);
    if (!node) return;
    if (/\/Type\s*\/Page\b/.test(node.dict) && !/\/Type\s*\/Pages\b/.test(node.dict)) {
      ordered.push(nodeNumber);
      return;
    }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(node.dict);
    const kidRefs = kids ? [...kids[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])) : [];
    for (const kid of kidRefs) walk(kid, depth + 1);
  };
  const roots = [...objects]
    .filter(([, object]) => /\/Type\s*\/Pages\b/.test(object.dict || "") && refOf(object.dict, "Parent") === null)
    .map(([number]) => number);
  for (const root of roots) walk(root, 0);
  for (const number of pageNumbers) if (!visited.has(number)) ordered.push(number);
  return ordered;
};

// Content-stream lexer: numbers, names, strings, arrays, dicts, operators.
const tokenize = (content) => {
  const tokens = [];
  const length = content.length;
  let index = 0;
  const isWhite = (ch) => ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f" || ch === "\0";
  const isDelim = (ch) => "()<>[]{}/%".includes(ch);
  while (index < length) {
    const ch = content[index];
    if (isWhite(ch)) {
      index += 1;
      continue;
    }
    if (ch === "%") {
      while (index < length && content[index] !== "\n" && content[index] !== "\r") index += 1;
      continue;
    }
    if (ch === "(") {
      let depth = 1;
      const bytes = [];
      index += 1;
      while (index < length && depth > 0) {
        const c = content[index];
        if (c === "\\") {
          const next = content[index + 1];
          index += 2;
          if (next === "n") bytes.push(10);
          else if (next === "r") bytes.push(13);
          else if (next === "t") bytes.push(9);
          else if (next === "b") bytes.push(8);
          else if (next === "f") bytes.push(12);
          else if (next >= "0" && next <= "7") {
            let octal = next;
            while (octal.length < 3 && content[index] >= "0" && content[index] <= "7") {
              octal += content[index];
              index += 1;
            }
            bytes.push(parseInt(octal, 8) & 0xff);
          } else if (next === "\n" || next === "\r") {
            if (next === "\r" && content[index] === "\n") index += 1;
          } else if (next !== undefined) bytes.push(next.charCodeAt(0) & 0xff);
          continue;
        }
        if (c === "(") depth += 1;
        else if (c === ")") {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
        bytes.push(c.charCodeAt(0) & 0xff);
        index += 1;
      }
      tokens.push({ type: "string", bytes: Buffer.from(bytes) });
      continue;
    }
    if (ch === "<") {
      if (content[index + 1] === "<") {
        const dict = balancedDict(content, index);
        index += dict.length;
        tokens.push({ type: "dict", value: dict });
        continue;
      }
      const end = content.indexOf(">", index + 1);
      const hex = content.slice(index + 1, end < 0 ? length : end).replace(/[^0-9a-f]/gi, "");
      index = end < 0 ? length : end + 1;
      tokens.push({ type: "string", bytes: Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex"), hex: true });
      continue;
    }
    if (ch === "[" || ch === "]" || ch === "{" || ch === "}") {
      tokens.push({ type: ch });
      index += 1;
      continue;
    }
    if (ch === "/") {
      let end = index + 1;
      while (end < length && !isWhite(content[end]) && !isDelim(content[end])) end += 1;
      tokens.push({ type: "name", value: content.slice(index + 1, end) });
      index = end;
      continue;
    }
    let end = index;
    while (end < length && !isWhite(content[end]) && !isDelim(content[end])) end += 1;
    if (end === index) {
      index += 1;
      continue;
    }
    const word = content.slice(index, end);
    index = end;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      tokens.push({ type: "number", value: Number(word) });
    } else {
      tokens.push({ type: "op", value: word });
      if (word === "ID") {
        // Inline image data: skip to the EI operator.
        const eiPattern = /[\s>]EI(?=[\s/\[<(]|$)/g;
        eiPattern.lastIndex = index;
        const ei = eiPattern.exec(content);
        index = ei ? ei.index + ei[0].length : length;
      }
    }
  }
  return tokens;
};

const decodeString = (bytes, font) => {
  if (font?.toUnicode) {
    const width = font.codeBytes;
    let out = "";
    for (let index = 0; index + width <= bytes.length; index += width) {
      let code = 0;
      for (let offset = 0; offset < width; offset += 1) code = (code << 8) | bytes[index + offset];
      const mapped = font.toUnicode.get(code);
      if (mapped !== undefined) out += mapped;
      else if (width === 1) out += byteToChar(code);
    }
    return out;
  }
  if (font?.identity || font?.codeBytes === 2) {
    return ""; // glyph ids without a ToUnicode map cannot be recovered
  }
  let out = "";
  for (const byte of bytes) out += byteToChar(byte);
  return out;
};

const extractContentText = (content, fontsByName, fonts) => {
  const tokens = tokenize(content);
  const pieces = [];
  let operands = [];
  let font = null;
  let lastY = null;
  let arrayDepth = 0;
  let array = [];
  const emit = (text) => {
    if (text) pieces.push(text);
  };
  for (const token of tokens) {
    if (token.type === "[") {
      arrayDepth += 1;
      array = [];
      continue;
    }
    if (token.type === "]") {
      arrayDepth = Math.max(0, arrayDepth - 1);
      operands.push({ type: "array", items: array });
      array = [];
      continue;
    }
    if (arrayDepth > 0) {
      array.push(token);
      continue;
    }
    if (token.type !== "op") {
      operands.push(token);
      continue;
    }
    const op = token.value;
    switch (op) {
      case "Tf": {
        const name = operands.find((item) => item.type === "name")?.value;
        font = name && fontsByName.has(name) ? fonts.get(fontsByName.get(name)) || null : null;
        break;
      }
      case "Tj": {
        const string = operands.find((item) => item.type === "string");
        if (string) emit(decodeString(string.bytes, font));
        break;
      }
      case "'":
      case '"': {
        const string = [...operands].reverse().find((item) => item.type === "string");
        emit("\n");
        if (string) emit(decodeString(string.bytes, font));
        break;
      }
      case "TJ": {
        const arr = operands.find((item) => item.type === "array");
        for (const item of arr?.items || []) {
          if (item.type === "string") emit(decodeString(item.bytes, font));
          else if (item.type === "number" && item.value < -180) emit(" ");
        }
        break;
      }
      case "Td":
      case "TD": {
        const numbers = operands.filter((item) => item.type === "number").map((item) => item.value);
        const ty = numbers[numbers.length - 1] || 0;
        const tx = numbers[numbers.length - 2] || 0;
        emit(ty !== 0 ? "\n" : tx > 0 ? " " : "");
        break;
      }
      case "T*":
        emit("\n");
        break;
      case "Tm": {
        const numbers = operands.filter((item) => item.type === "number").map((item) => item.value);
        const y = numbers[5];
        if (lastY !== null && typeof y === "number" && Math.abs(y - lastY) > 0.5) emit("\n");
        else if (lastY !== null) emit(" ");
        lastY = typeof y === "number" ? y : lastY;
        break;
      }
      case "BT":
        lastY = null;
        break;
      case "ET":
        emit("\n");
        break;
      default:
        break;
    }
    operands = [];
  }
  return pieces.join("");
};

const inheritedMatch = (objects, pageDict, pattern) => {
  const seen = new Set();
  let current = pageDict;
  while (current) {
    const match = pattern.exec(current);
    if (match) return match;
    const parentRef = refOf(current, "Parent");
    if (parentRef === null || seen.has(parentRef)) return null;
    seen.add(parentRef);
    current = objects.get(parentRef)?.dict || null;
  }
  return null;
};

const pageGeometry = (objects, pageDict) => {
  const box = inheritedMatch(
    objects,
    pageDict,
    /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/,
  );
  const rotate = inheritedMatch(objects, pageDict, /\/Rotate\s+(-?\d+)/);
  const width = box ? Math.abs(Number(box[3]) - Number(box[1])) : null;
  const height = box ? Math.abs(Number(box[4]) - Number(box[2])) : null;
  return {
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    rotation: rotate ? ((Number(rotate[1]) % 360) + 360) % 360 : 0,
  };
};

/** Parses a PDF once and returns per-page text and geometry. */
const collectPdfPages = (buffer) => {
  const { objects, latin } = parsePdfObjects(buffer);
  const encrypted = /\/Encrypt\s+\d+\s+\d+\s+R/.test(latin) || /\/Encrypt\s*<</.test(latin);
  if (encrypted) return { encrypted: true, objects, fonts: new Map(), pages: [] };
  expandObjectStreams(objects);
  const fonts = buildFonts(objects);
  const pages = orderedPages(objects).map((objectNumber, index) => {
    const pageDict = objects.get(objectNumber).dict;
    const fontsByName = fontMapFor(objects, pageDict);
    const content = contentRefsFor(objects, pageDict)
      .map((ref) => streamOf(objects.get(ref)))
      .filter(Boolean)
      .map((data) => data.toString("latin1"))
      .join("\n");
    return {
      pageNumber: index + 1,
      text: content ? normalizeWhitespace(extractContentText(content, fontsByName, fonts)) : "",
      ...pageGeometry(objects, pageDict),
    };
  });
  return { encrypted: false, objects, fonts, pages };
};

/**
 * Per-page text layer with page size (PDF points) and rotation — used by the
 * drawings tool to detect title blocks sheet by sheet.
 */
const pdfPages = (buffer) => {
  const collected = collectPdfPages(buffer);
  return {
    encrypted: collected.encrypted,
    pageCount: collected.pages.length,
    pages: collected.pages.map(({ pageNumber, text, width, height, rotation }) => ({
      pageNumber,
      text,
      width,
      height,
      rotation,
    })),
  };
};

const extractPdf = (buffer) => {
  const { encrypted, objects, fonts, pages } = collectPdfPages(buffer);
  if (encrypted) {
    return result({ status: "unsupported", extractor: EXTRACTORS.PDF, reason: "encrypted" });
  }

  let text = pages.map((page) => page.text).join("\n\n");
  if (!pages.length) {
    // No page tree found: scan every stream that carries text operators.
    const chunks = [];
    for (const [, object] of objects) {
      const data = streamOf(object);
      if (!data) continue;
      const content = data.toString("latin1");
      if (/\bBT\b[\s\S]*\bET\b/.test(content)) chunks.push(extractContentText(content, new Map(), fonts));
    }
    text = chunks.join("\n\n");
  }

  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return result({
      status: "unsupported",
      extractor: EXTRACTORS.PDF,
      pageCount: pages.length || null,
      reason: pages.length ? "no_text_layer" : "no_pages",
    });
  }
  return result({ extractor: EXTRACTORS.PDF, text: normalized, pageCount: pages.length || null });
};

// ─── Entry point ─────────────────────────────────────────────────────────

const extractDocumentText = ({ buffer, mimeType, fileName }) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return result({ status: "unsupported", extractor: null, reason: "empty" });
  }
  const kind = kindFor({ mimeType, fileName });
  try {
    switch (kind) {
      case EXTRACTORS.TEXT:
        return extractPlainText(buffer);
      case EXTRACTORS.HTML:
        return extractHtml(buffer);
      case EXTRACTORS.SPREADSHEET:
        return extractSpreadsheet(buffer);
      case EXTRACTORS.DOCX:
        return extractDocx(buffer);
      case EXTRACTORS.PPTX:
        return extractPptx(buffer);
      case EXTRACTORS.ODF:
        return extractOdf(buffer);
      case EXTRACTORS.PDF:
        return extractPdf(buffer);
      default:
        return result({ status: "unsupported", extractor: null, reason: "unsupported_type" });
    }
  } catch (error) {
    return {
      status: "failed",
      extractor: kind,
      text: "",
      pageCount: null,
      wordCount: 0,
      reason: error?.message || "extraction_failed",
    };
  }
};

/**
 * Splits text into overlapping chunks on paragraph / sentence boundaries for
 * embeddings and snippet retrieval.
 */
const chunkText = (text, { size = 1200, overlap = 150, maxChunks = 400 } = {}) => {
  const source = String(text || "");
  const chunks = [];
  if (!source.trim()) return chunks;
  let start = 0;
  while (start < source.length && chunks.length < maxChunks) {
    let end = Math.min(source.length, start + size);
    if (end < source.length) {
      const window = source.slice(start, end);
      const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
      if (breakAt > size * 0.4) end = start + breakAt + 1;
    }
    const chunk = source.slice(start, end).trim();
    if (chunk) chunks.push({ index: chunks.length, text: chunk, charStart: start, charEnd: end });
    if (end >= source.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
};

module.exports = {
  EXTRACTORS,
  MAX_TEXT_CHARS,
  chunkText,
  countWords,
  extractDocumentText,
  isExtractableType,
  kindFor,
  normalizeWhitespace,
  parseCMap,
  pdfPages,
  tokenize,
};
