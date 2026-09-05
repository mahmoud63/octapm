const crypto = require("crypto");
const { HttpError } = require("./http-error");

/**
 * AES-256-GCM box for integration credentials (OCTA-INT-API-026). The key
 * comes from INTEGRATION_SECRET_KEY (any string; hashed to 32 bytes). Stored
 * form: `v1.<iv>.<tag>.<ciphertext>` in base64url.
 */

const keyFromEnv = (env = process.env) => {
  const raw = env.INTEGRATION_SECRET_KEY;
  if (!raw) return null;
  return crypto.createHash("sha256").update(String(raw)).digest();
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
  const key = requireKey(env);
  const [version, iv, tag, payload] = String(text).split(".");
  if (version !== "v1" || !iv || !tag || !payload) throw new HttpError(500, "INTEGRATION_SECRET_CORRUPT", "Stored credentials are unreadable");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
};

module.exports = { encrypt, decrypt, isConfigured };
