const crypto = require("crypto");

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP) with no
 * dependencies: base32 secrets, 6 digits, 30-second steps, SHA-1 — what
 * Google Authenticator, Microsoft Authenticator, 1Password and Authy expect.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

const base32Decode = (text) => {
  const clean = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

const generateSecret = (bytes = 20) => base32Encode(crypto.randomBytes(bytes));

const hotp = (secret, counter, digits = 6) => {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
};

const counterFor = (time, step) => Math.floor(time / 1000 / step);

const totp = (secret, { time = Date.now(), step = 30, digits = 6 } = {}) => hotp(secret, counterFor(time, step), digits);

/**
 * The time step `code` matches — the current one or one either side (clock
 * drift) — or null when it matches none. A match alone does not make a code
 * good: the caller must also refuse a step it has already accepted a code for
 * (RFC 6238 §5.2), which is why the step is returned rather than a boolean.
 * Compare with `!== null`, not truthiness: 0 is a step.
 */
const verifyTotp = (secret, code, { time = Date.now(), step = 30, digits = 6, window = 1 } = {}) => {
  const clean = String(code || "").replace(/[\s-]/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return null;
  const counter = counterFor(time, step);
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = hotp(secret, counter + drift, digits);
    if (expected.length === clean.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return counter + drift;
  }
  return null;
};

const otpauthUrl = ({ issuer, account, secret, digits = 6, period = 30 }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${digits}&period=${period}`;

module.exports = { base32Encode, base32Decode, generateSecret, hotp, totp, verifyTotp, otpauthUrl };
