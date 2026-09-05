/**
 * Title-block detection from a sheet's text layer (OCTA-DWG-CORE-011).
 *
 * Works on the text extracted per page by utils/document-text.js. Title
 * blocks sit bottom-right, so their text tends to come last in the content
 * stream; keyword forms ("DWG NO", "SHEET TITLE", "REV") are preferred and
 * scored higher than bare pattern matches. Every field comes back with a
 * confidence so the review grid can highlight what needs a human.
 */

const NUMBER_KEYWORD =
  /\b(?:SHEET|SHT|DWG|DRG|DRAWING)\.?\s*(?:NO|NUMBER|NUM|#|№)\.?\s*[:.\-]?\s*/i;
const NUMBER_TOKEN = /\b([A-Z]{1,4}(?:[-\s]?\d{1,4})(?:[.\-]\d{1,4}){0,3}[A-Z]?)\b/;
const NUMBER_LINE = /^[A-Z]{1,4}-?\d{1,4}(?:[.\-]\d{1,4}){0,3}[A-Z]?$/;
const REVISION_KEYWORD =
  /\b(?:REV(?:ISION)?|ISSUE)\.?\s*[:.\-]?\s*(?:NO\.?\s*)?([A-Z]{1,2}\d{0,2}|P\d{1,2}|C\d{1,2}|T\d{1,2}|\d{1,3})\b/i;
const TITLE_KEYWORD = /\b(?:SHEET|DRAWING|DRG|DWG)?\s*TITLE\s*[:.\-]?\s*(.*)$/i;
const DATE_LIKE = /\b\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}\b/;
const SCALE_LIKE = /\b\d+\s*:\s*\d+\b|\bN\.?T\.?S\.?\b|\bNTS\b/i;
const PAPER_SIZE = /^(?:A|B|ANSI\s?)[0-4]$/i;
const STOP_WORDS =
  /\b(?:SCALE|DATE|DRAWN|CHECKED|CHK|APPROVED|APPD|DESIGNED|PROJECT|CLIENT|CONSULTANT|CONTRACTOR|ARCHITECT|ENGINEER|REV(?:ISION)?|SHEET|DWG|DRAWING|NO\.?|NUMBER|TITLE|STATUS|ISSUED?|FOR|COPYRIGHT|LTD|LLC|INC|PLC|GMBH|TEL|FAX|EMAIL|WWW|HTTP|PAGE|OF)\b/i;

const DISCIPLINES = Object.freeze({
  A: "Architectural",
  AR: "Architectural",
  S: "Structural",
  ST: "Structural",
  C: "Civil",
  CV: "Civil",
  M: "Mechanical",
  ME: "Mechanical",
  E: "Electrical",
  EL: "Electrical",
  P: "Plumbing",
  PL: "Plumbing",
  FP: "Fire Protection",
  FS: "Fire Protection",
  L: "Landscape",
  LA: "Landscape",
  T: "Telecommunications",
  TC: "Telecommunications",
  G: "General",
  GN: "General",
  I: "Interiors",
  ID: "Interiors",
  H: "HVAC",
  HV: "HVAC",
  Q: "Equipment",
  X: "Existing conditions",
  D: "Demolition",
  U: "Utilities",
});

const collapse = (value) => String(value || "").replace(/\s+/g, " ").trim();

const normalizeNumber = (value) => collapse(value).toUpperCase().replace(/\s+/g, "");

const isPlausibleNumber = (value) => {
  const candidate = normalizeNumber(value);
  if (!candidate || candidate.length < 2 || candidate.length > 24) return false;
  if (PAPER_SIZE.test(candidate)) return false;
  if (/^(?:ISO|BS|EN|ASTM|DIN|ANSI|AS)\d/.test(candidate)) return false;
  if (!/\d/.test(candidate)) return false;
  return true;
};

const lettersRatio = (line) => {
  const letters = (line.match(/[A-Za-z]/g) || []).length;
  return letters / Math.max(line.replace(/\s+/g, "").length, 1);
};

const upperRatio = (line) => {
  const letters = line.match(/[A-Za-z]/g) || [];
  if (!letters.length) return 0;
  return letters.filter((ch) => ch === ch.toUpperCase()).length / letters.length;
};

/**
 * Natural sort key: digit runs zero-padded so A-101 < A-102 < A-1001.
 */
const sortKeyFor = (number) =>
  normalizeNumber(number)
    .toLowerCase()
    .replace(/\d+/g, (digits) => digits.padStart(6, "0"));

const disciplineFor = (number) => {
  const match = /^([A-Z]{1,2})/.exec(normalizeNumber(number));
  if (!match) return null;
  return DISCIPLINES[match[1]] || DISCIPLINES[match[1][0]] || null;
};

const detectNumber = (lines) => {
  // 1. keyword form on the same line or the following line
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const keyword = NUMBER_KEYWORD.exec(line);
    if (!keyword) continue;
    const rest = line.slice(keyword.index + keyword[0].length);
    const candidate = NUMBER_TOKEN.exec(rest.toUpperCase()) || NUMBER_TOKEN.exec(String(lines[index + 1] || "").toUpperCase());
    if (candidate && isPlausibleNumber(candidate[1])) {
      return { value: normalizeNumber(candidate[1]), confidence: 0.92, source: "keyword" };
    }
  }
  // 2. a line that is only a drawing number, nearest the end of the page
  const tail = lines.slice(-80);
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const line = normalizeNumber(tail[index]);
    if (NUMBER_LINE.test(line) && isPlausibleNumber(line)) {
      return { value: line, confidence: 0.6, source: "standalone" };
    }
  }
  // 3. any drawing-number-shaped token in the tail
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const line = tail[index];
    if (DATE_LIKE.test(line) || SCALE_LIKE.test(line)) continue;
    const candidate = NUMBER_TOKEN.exec(line.toUpperCase());
    if (candidate && isPlausibleNumber(candidate[1]) && !/^REV/i.test(candidate[1])) {
      return { value: normalizeNumber(candidate[1]), confidence: 0.4, source: "pattern" };
    }
  }
  return { value: null, confidence: 0, source: null };
};

const detectRevision = (lines) => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = REVISION_KEYWORD.exec(lines[index]);
    if (match) return { value: match[1].toUpperCase(), confidence: 0.85, source: "keyword" };
  }
  return { value: null, confidence: 0, source: null };
};

const cleanTitle = (value) =>
  collapse(value)
    .replace(/^[:.\-–—\s]+/, "")
    .replace(/[:.\-–—\s]+$/, "")
    .slice(0, 160);

const MINOR_WORDS = new Set(["of", "and", "to", "the", "for", "at", "in", "on", "with", "a", "an"]);

// Title blocks are set in capitals or Title Case; running lowercase prose is
// body text, not a sheet title.
const isTitleCase = (text) =>
  text
    .split(/\s+/)
    .every((word, index) => /^[^a-z]/.test(word) || (index > 0 && MINOR_WORDS.has(word.toLowerCase())));

const looksLikeTitle = (line, number) => {
  const text = collapse(line);
  if (text.length < 6 || text.length > 90) return false;
  if (text.split(/\s+/).length < 2) return false;
  if (lettersRatio(text) < 0.6) return false;
  if (DATE_LIKE.test(text) || SCALE_LIKE.test(text)) return false;
  if (STOP_WORDS.test(text)) return false;
  if (number && normalizeNumber(text).includes(number)) return false;
  if (upperRatio(text) < 0.5 && !isTitleCase(text)) return false;
  return true;
};

const detectTitle = (lines, number) => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = TITLE_KEYWORD.exec(lines[index]);
    if (!match) continue;
    const inline = cleanTitle(match[1]);
    if (inline.length >= 3 && !STOP_WORDS.test(inline.split(/\s+/)[0])) {
      return { value: inline, confidence: 0.85, source: "keyword" };
    }
    const next = cleanTitle(lines[index + 1] || "");
    if (next.length >= 3 && !NUMBER_LINE.test(normalizeNumber(next))) {
      return { value: next, confidence: 0.8, source: "keyword_next_line" };
    }
  }
  const tail = lines.slice(-60).filter((line) => looksLikeTitle(line, number));
  if (tail.length) {
    // Prefer uppercase, then longer lines — title blocks shout.
    const best = [...tail].sort(
      (a, b) => upperRatio(b) - upperRatio(a) || b.length - a.length,
    )[0];
    return { value: cleanTitle(best), confidence: upperRatio(best) >= 0.8 ? 0.5 : 0.35, source: "heuristic" };
  }
  return { value: null, confidence: 0, source: null };
};

/**
 * @param {string} text page text (already whitespace-normalised)
 * @param {{ pageNumber?: number, fallbackDiscipline?: string|null }} options
 */
const detectSheetMetadata = (text, { pageNumber = 1, fallbackDiscipline = null } = {}) => {
  const lines = String(text || "")
    .split("\n")
    .map(collapse)
    .filter(Boolean);
  if (!lines.length) {
    return {
      number: null,
      title: `Page ${pageNumber}`,
      revision: null,
      discipline: fallbackDiscipline || null,
      confidence: 0,
      textStatus: "no_text",
      fields: {
        number: { confidence: 0, source: null },
        title: { confidence: 0, source: null },
        revision: { confidence: 0, source: null },
        discipline: { confidence: fallbackDiscipline ? 0.3 : 0, source: fallbackDiscipline ? "set" : null },
      },
    };
  }

  const number = detectNumber(lines);
  const revision = detectRevision(lines);
  const title = detectTitle(lines, number.value);
  const mapped = number.value ? disciplineFor(number.value) : null;
  const discipline = mapped
    ? { value: mapped, confidence: 0.7, source: "number_prefix" }
    : { value: fallbackDiscipline || null, confidence: fallbackDiscipline ? 0.3 : 0, source: fallbackDiscipline ? "set" : null };

  return {
    number: number.value,
    title: title.value || (number.value ? `Sheet ${number.value}` : `Page ${pageNumber}`),
    revision: revision.value,
    discipline: discipline.value,
    confidence: Number(((number.confidence + title.confidence) / 2).toFixed(2)),
    textStatus: "ready",
    fields: {
      number: { confidence: number.confidence, source: number.source },
      title: { confidence: title.confidence, source: title.source },
      revision: { confidence: revision.confidence, source: revision.source },
      discipline: { confidence: discipline.confidence, source: discipline.source },
    },
  };
};

module.exports = {
  DISCIPLINES,
  detectSheetMetadata,
  disciplineFor,
  normalizeNumber,
  sortKeyFor,
};
