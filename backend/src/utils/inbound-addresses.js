const crypto = require("crypto");
const { keyring } = require("./keyring");

/**
 * Inbound email addresses (OCTA-COMM-CONV-042). Dependency-free so both the
 * notification delivery (Reply-To) and the inbound webhook can use it.
 *
 *   p-<token>@<domain>                      → a project's inbox
 *   r-<recordType>-<recordId>-<sig>@<domain> → a reply on a record (comment)
 *   c-<conversationId>-<sig>@<domain>        → a reply in a conversation
 *
 * `sig` is the first 12 hex chars of HMAC-SHA256(INBOUND_EMAIL_SECRET, kind:id),
 * so nobody can post to a record by guessing its id.
 */

const SIG_LENGTH = 12;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RECORD_RE = new RegExp(`^r-([a-z][a-z0-9_]*)-(${UUID})-([0-9a-f]{${SIG_LENGTH}})$`, "i");
const CONVERSATION_RE = new RegExp(`^c-(${UUID})-([0-9a-f]{${SIG_LENGTH}})$`, "i");
const PROJECT_RE = /^p-([a-z0-9]{6,40})$/i;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const inboundDomain = () => trimOrNull(process.env.INBOUND_EMAIL_DOMAIN)?.toLowerCase() || null;
// A reply-to address lives on in mail threads long after it was sent, so the
// key that signed it must keep verifying after a rotation: the old value goes
// in INBOUND_EMAIL_SECRET_PREVIOUS. The JWT_SECRET fallback is honoured only
// outside production, where local data was signed with it.
const inboundKeys = () => keyring({ primary: "INBOUND_EMAIL_SECRET", previous: "INBOUND_EMAIL_SECRET_PREVIOUS", legacy: ["JWT_SECRET"], trim: true });
const inboundSecret = () => inboundKeys().write;
const isInboundConfigured = () => Boolean(inboundDomain() && inboundSecret());

const hmac = (secret, value) => crypto.createHmac("sha256", secret).update(String(value)).digest("hex").slice(0, SIG_LENGTH);

const sign = (value) => {
  const secret = inboundSecret();
  if (!secret) return null;
  return hmac(secret, value);
};

/** True when `sig` is the signature of `value` under any key still accepted. */
const signatureMatches = (value, sig) => inboundKeys().read.some((secret) => safeEqual(hmac(secret, value), sig));

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const projectAddress = (project) => (isInboundConfigured() && project?.inboundEmailToken ? `p-${project.inboundEmailToken}@${inboundDomain()}` : null);
const recordReplyAddress = ({ recordType, recordId }) => (isInboundConfigured() && recordType && recordId ? `r-${recordType}-${recordId}-${sign(`r:${recordType}:${recordId}`)}@${inboundDomain()}` : null);
const conversationReplyAddress = (conversationId) => (isInboundConfigured() && conversationId ? `c-${conversationId}-${sign(`c:${conversationId}`)}@${inboundDomain()}` : null);

/** `"Name" <a@b.c>` / `a@b.c` → { email, name }. */
const parseAddress = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return null;
  const angle = text.match(/^(.*?)<\s*([^>]+?)\s*>$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"|"$/g, "").trim() || null;
    return { email: angle[2].trim().toLowerCase(), name };
  }
  const plain = text.match(/[^\s,;<>]+@[^\s,;<>]+/);
  return plain ? { email: plain[0].toLowerCase(), name: null } : null;
};

const splitAddresses = (raw) => {
  if (Array.isArray(raw)) return raw.map((item) => (typeof item === "string" ? parseAddress(item) : item?.email ? { email: String(item.email).toLowerCase(), name: item.name || null } : null)).filter(Boolean);
  return String(raw || "")
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map(parseAddress)
    .filter(Boolean);
};

/** What an address on our domain points at, or null when it is not ours. */
const parseTarget = (email) => {
  const address = parseAddress(email);
  const domain = inboundDomain();
  if (!address || !domain) return null;
  const at = address.email.lastIndexOf("@");
  if (at < 0 || address.email.slice(at + 1) !== domain) return null;
  const local = address.email.slice(0, at);
  let match = local.match(RECORD_RE);
  if (match) return { kind: "record", recordType: match[1].toLowerCase(), recordId: match[2].toLowerCase(), sig: match[3].toLowerCase(), address: address.email };
  match = local.match(CONVERSATION_RE);
  if (match) return { kind: "conversation", conversationId: match[1].toLowerCase(), sig: match[2].toLowerCase(), address: address.email };
  match = local.match(PROJECT_RE);
  if (match) return { kind: "project", token: match[1].toLowerCase(), address: address.email };
  return null;
};

const verifyTargetSignature = (target) => {
  if (!target) return false;
  if (target.kind === "record") return signatureMatches(`r:${target.recordType}:${target.recordId}`, target.sig);
  if (target.kind === "conversation") return signatureMatches(`c:${target.conversationId}`, target.sig);
  return true;
};

const newProjectToken = () => crypto.randomBytes(6).toString("hex");

module.exports = {
  SIG_LENGTH,
  inboundDomain,
  inboundSecret,
  isInboundConfigured,
  sign,
  safeEqual,
  projectAddress,
  recordReplyAddress,
  conversationReplyAddress,
  parseAddress,
  splitAddresses,
  parseTarget,
  verifyTargetSignature,
  newProjectToken,
};
