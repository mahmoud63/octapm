const crypto = require("crypto");
const { HttpError } = require("./http-error");
const { keyring } = require("./keyring");

/**
 * AES-256-GCM box for integration credentials (OCTA-INT-API-026). The key
 * comes from INTEGRATION_SECRET_KEY (any string; hashed to 32 bytes). Stored
 * form: `v1.<iv>.<tag>.<ciphertext>` in base64url.
 *
 * During a key rotation the old value goes in INTEGRATION_SECRET_KEY_PREVIOUS:
 * boxes still open under it, and every new or refreshed box is sealed with the
 * primary. There is no fallback to any other secret, in any environment.
 */

const derive = (raw) => crypto.createHash("sha256").update(String(raw)).digest();

const integrationKeys = (env = process.env) =>
  keyring({ primary: "INTEGRATION_SECRET_KEY", previous: "INTEGRATION_SECRET_KEY_PREVIOUS", env });

const keyFromEnv = (env = process.env) => {
  const { write } = integrationKeys(env);
  return write ? derive(write) : null;
};

const isConfigured = (env = process.env) => Boolean(keyFromEnv(env));

const requireKey = (env = process.env) => {
  const key = keyFromEnv(env);
  if (!key) throw new HttpError(409, "INTEGRATION_KEY_MISSING", "Set INTEGRATION_SECRET_KEY on the server before connecting an accounting system");
  return key;
};

const encrypt = (value, env = process.env) => {
  const key = requireKey(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(value ?? null), "utf8");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
};

const decrypt = (text, env = process.env) => {
  if (!text) return null;
  requireKey(env);
  const [version, iv, tag, payload] = String(text).split(".");
  if (version !== "v1" || !iv || !tag || !payload) throw new HttpError(500, "INTEGRATION_SECRET_CORRUPT", "Stored credentials are unreadable");
  // GCM authenticates, so a wrong key fails outright rather than yielding
  // garbage; each candidate is simply tried in turn.
  for (const raw of integrationKeys(env).read) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", derive(raw), Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const plain = Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]);
      return JSON.parse(plain.toString("utf8"));
    } catch {
      // Not this key; try the next.
    }
  }
  throw new HttpError(500, "INTEGRATION_SECRET_CORRUPT", "Stored credentials are unreadable with the configured keys");
};

module.exports = { encrypt, decrypt, isConfigured };
