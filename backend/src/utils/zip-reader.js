const zlib = require("zlib");

/**
 * Minimal ZIP reader (central directory + stored/deflate entries) built on
 * core zlib. Enough for Office Open XML (docx/pptx/xlsx) and OpenDocument
 * containers without a native or third-party dependency.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_ENTRIES = 5000;

const findEndOfCentralDirectory = (buffer) => {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === SIG_EOCD) return offset;
  }
  return -1;
};

/**
 * Lists the entries of a ZIP buffer. Returns [] when the buffer is not a ZIP.
 */
const listZipEntries = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return [];
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) return [];

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let cursor = centralOffset;

  for (let index = 0; index < Math.min(entryCount, MAX_ENTRIES); index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== SIG_CENTRAL) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const readZipEntry = (buffer, entry) => {
  const { localOffset } = entry;
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
    return null;
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return data;
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(data);
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Reads the named entries (or all entries when `names` is omitted) into a
 * Map of name → Buffer. Unsupported compression methods are skipped.
 */
const readZipEntries = (buffer, names = null) => {
  const wanted = names ? new Set(names) : null;
  const result = new Map();
  for (const entry of listZipEntries(buffer)) {
    if (wanted && !wanted.has(entry.name)) continue;
    const data = readZipEntry(buffer, entry);
    if (data) result.set(entry.name, data);
  }
  return result;
};

const isZip = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.readUInt32LE(0) === SIG_LOCAL;

module.exports = { isZip, listZipEntries, readZipEntries, readZipEntry };
