/**
 * Matching one company to another by name (OCTA-ADM-DEDUPE-061).
 *
 * `Company` is unique on `(orgId, name)`, so two identical names cannot both
 * exist — but "ABC Steel LLC" and "abc steel llc" are different strings, so
 * both did. And a duplicate company is not a cosmetic problem: it carries no
 * prequalification, no performance history and no insurance, so one silently
 * defeats three of the controls built on top of the directory.
 *
 * ── What is normalised, and what deliberately is not ──────────────────────
 *
 * Case, surrounding whitespace, internal double spaces and punctuation are all
 * ways of typing the *same* name, so they are folded away:
 *
 *   "ABC Steel LLC" · "abc steel llc" · "ABC STEEL LLC" · "ABC Steel L.L.C."
 *      -> all match
 *   "Al-Rashid Trading" · "Al Rashid Trading"    -> match
 *
 * **Legal form is not folded away.** "ABC Steel LLC" and "ABC Steel Ltd" are
 * different legal entities with different liability, and merging them because
 * the trading name matches would be a guess with contractual consequences.
 * The brief is explicit: do not merge genuinely different companies on weak
 * name similarity. So:
 *
 *   "ABC Steel LLC" vs "ABC Steel Ltd"           -> do NOT match
 *
 * Nor is "&" folded to "and", nor are abbreviations expanded. Anything beyond
 * "the same characters typed differently" is a judgement, and judgements about
 * whether two companies are one company belong to a person — which is what the
 * duplicate report is for.
 */

/**
 * Punctuation that joins rather than separates. A full stop inside an
 * abbreviation is decoration — "L.L.C." is "LLC" — so these are removed
 * outright rather than turned into a gap.
 */
const JOINING = /['''`"“”‘’.]+/g;

/**
 * Punctuation that stands in for a space. "Al-Rashid" is "Al Rashid", so these
 * become one, and the collapse below tidies up.
 */
const SEPARATING = /[,()[\]{}\-–—_/\\&+]+/g;

/**
 * The key two names are compared on. Empty string for anything blank, so a
 * missing name never matches another missing name.
 */
const normalizeCompanyName = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(JOINING, "")
    .replace(SEPARATING, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/** Whether two names are the same name typed differently. */
const sameCompanyName = (a, b) => {
  const left = normalizeCompanyName(a);
  return Boolean(left) && left === normalizeCompanyName(b);
};

module.exports = { normalizeCompanyName, sameCompanyName };
