/**
 * Which secrets may seal a value, and which may open one.
 *
 * A key that protects stored data (MFA seeds, integration credentials, the
 * signature on a reply-to address already sitting in someone's inbox) cannot
 * simply be replaced: everything sealed under the old key would stop opening.
 * So every such key has a `*_PREVIOUS` companion. During a rotation the new
 * value goes in the primary variable and the old one in PREVIOUS; values are
 * sealed with the primary and opened with whichever key works, and once
 * everything has been re-sealed PREVIOUS is removed.
 *
 * `legacy` names the variables a key used to fall back to before it had its
 * own (JWT_SECRET, mostly). They are honoured only outside production: local
 * databases hold data sealed under them, while production is greenfield and
 * must never quietly derive a storage key from a token-signing secret — the
 * coupling that made rotating JWT_SECRET break every MFA enrolment.
 */

const clean = (value, trim) => {
  if (value === undefined || value === null) return null;
  const text = String(value);
  if (!text.trim()) return null;
  return trim ? text.trim() : text;
};

/**
 * @returns {{ write: string|null, read: string[] }}
 *   `write` is the key new values are sealed with (null when none is set);
 *   `read` lists every key worth trying, in order, without duplicates. A value
 *   that only opens with a key other than `write` should be re-sealed.
 */
const keyring = ({ primary, previous = null, legacy = [], env = process.env, trim = false }) => {
  const fallbacks = env.NODE_ENV === "production" ? [] : legacy;
  const primaryValue = clean(env[primary], trim);
  const legacyValues = fallbacks.map((name) => clean(env[name], trim)).filter(Boolean);
  const write = primaryValue || legacyValues[0] || null;
  const read = [];
  for (const value of [primaryValue, previous ? clean(env[previous], trim) : null, ...legacyValues]) {
    if (value && !read.includes(value)) read.push(value);
  }
  return { write, read };
};

module.exports = { keyring };
