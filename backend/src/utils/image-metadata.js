const fs = require("fs/promises");

/**
 * Dependency-free image metadata reader: dimensions for JPEG / PNG / WebP and
 * the EXIF fields construction photos care about (capture time, GPS, camera,
 * orientation). Reads only the first 512 KB; anything unparseable yields nulls.
 */

const HEAD_BYTES = 512 * 1024;

const TAGS = Object.freeze({
  MAKE: 0x010f,
  MODEL: 0x0110,
  ORIENTATION: 0x0112,
  EXIF_IFD: 0x8769,
  GPS_IFD: 0x8825,
  DATE_TIME_ORIGINAL: 0x9003,
  DATE_TIME_DIGITIZED: 0x9004,
  PIXEL_X: 0xa002,
  PIXEL_Y: 0xa003,
  GPS_LAT_REF: 0x0001,
  GPS_LAT: 0x0002,
  GPS_LON_REF: 0x0003,
  GPS_LON: 0x0004,
  GPS_ALT_REF: 0x0005,
  GPS_ALT: 0x0006,
});

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

const empty = () => ({
  width: null,
  height: null,
  takenAt: null,
  latitude: null,
  longitude: null,
  altitude: null,
  cameraMake: null,
  cameraModel: null,
  orientation: null,
  raw: {},
});

const readHead = async (filePath, bytes = HEAD_BYTES) => {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(bytes, stat.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
};

const parseExifDate = (value) => {
  // "YYYY:MM:DD HH:MM:SS" (local time, no zone).
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    String(value || "").trim(),
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  if (!y || !mo || !d) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
};

const readRationals = (buffer, offset, count, littleEndian) => {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const at = offset + index * 8;
    if (at + 8 > buffer.length) break;
    const numerator = littleEndian ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at);
    const denominator = littleEndian
      ? buffer.readUInt32LE(at + 4)
      : buffer.readUInt32BE(at + 4);
    values.push(denominator ? numerator / denominator : 0);
  }
  return values;
};

const dmsToDecimal = (parts, ref) => {
  if (!parts || parts.length < 2) return null;
  const [deg = 0, min = 0, sec = 0] = parts;
  const value = deg + min / 60 + sec / 3600;
  if (!Number.isFinite(value)) return null;
  return ref === "S" || ref === "W" ? -value : value;
};

/** Parses one IFD into a map of tag → { type, count, value|offset }. */
const readIfd = (tiff, ifdOffset, littleEndian) => {
  const entries = new Map();
  if (ifdOffset + 2 > tiff.length) return entries;
  const count = littleEndian
    ? tiff.readUInt16LE(ifdOffset)
    : tiff.readUInt16BE(ifdOffset);
  for (let index = 0; index < count; index += 1) {
    const at = ifdOffset + 2 + index * 12;
    if (at + 12 > tiff.length) break;
    const tag = littleEndian ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at);
    const type = littleEndian ? tiff.readUInt16LE(at + 2) : tiff.readUInt16BE(at + 2);
    const valueCount = littleEndian
      ? tiff.readUInt32LE(at + 4)
      : tiff.readUInt32BE(at + 4);
    const size = (TYPE_SIZES[type] || 1) * valueCount;
    const valueOffset =
      size <= 4
        ? at + 8
        : littleEndian
          ? tiff.readUInt32LE(at + 8)
          : tiff.readUInt32BE(at + 8);
    entries.set(tag, { type, count: valueCount, offset: valueOffset });
  }
  return entries;
};

const readString = (tiff, entry) => {
  if (!entry || entry.offset + entry.count > tiff.length) return null;
  return tiff
    .toString("latin1", entry.offset, entry.offset + entry.count)
    .replace(/\0+$/, "")
    .trim() || null;
};

const readShortOrLong = (tiff, entry, littleEndian) => {
  if (!entry) return null;
  if (entry.type === 3) {
    return littleEndian ? tiff.readUInt16LE(entry.offset) : tiff.readUInt16BE(entry.offset);
  }
  if (entry.type === 4) {
    return littleEndian ? tiff.readUInt32LE(entry.offset) : tiff.readUInt32BE(entry.offset);
  }
  return null;
};

const parseTiff = (tiff, result) => {
  if (tiff.length < 8) return;
  const byteOrder = tiff.toString("latin1", 0, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return;
  const ifd0Offset = littleEndian ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  const ifd0 = readIfd(tiff, ifd0Offset, littleEndian);

  result.cameraMake = readString(tiff, ifd0.get(TAGS.MAKE));
  result.cameraModel = readString(tiff, ifd0.get(TAGS.MODEL));
  result.orientation = readShortOrLong(tiff, ifd0.get(TAGS.ORIENTATION), littleEndian);

  const exifPointer = ifd0.get(TAGS.EXIF_IFD);
  if (exifPointer) {
    const exifOffset = littleEndian
      ? tiff.readUInt32LE(exifPointer.offset)
      : tiff.readUInt32BE(exifPointer.offset);
    const exif = readIfd(tiff, exifOffset, littleEndian);
    const original =
      readString(tiff, exif.get(TAGS.DATE_TIME_ORIGINAL)) ||
      readString(tiff, exif.get(TAGS.DATE_TIME_DIGITIZED));
    result.takenAt = parseExifDate(original);
    result.raw.dateTimeOriginal = original;
    const px = readShortOrLong(tiff, exif.get(TAGS.PIXEL_X), littleEndian);
    const py = readShortOrLong(tiff, exif.get(TAGS.PIXEL_Y), littleEndian);
    if (px && py) {
      result.width = result.width || px;
      result.height = result.height || py;
    }
  }

  const gpsPointer = ifd0.get(TAGS.GPS_IFD);
  if (gpsPointer) {
    const gpsOffset = littleEndian
      ? tiff.readUInt32LE(gpsPointer.offset)
      : tiff.readUInt32BE(gpsPointer.offset);
    const gps = readIfd(tiff, gpsOffset, littleEndian);
    const latRef = readString(tiff, gps.get(TAGS.GPS_LAT_REF));
    const lonRef = readString(tiff, gps.get(TAGS.GPS_LON_REF));
    const lat = gps.get(TAGS.GPS_LAT);
    const lon = gps.get(TAGS.GPS_LON);
    if (lat && lon) {
      result.latitude = dmsToDecimal(readRationals(tiff, lat.offset, 3, littleEndian), latRef);
      result.longitude = dmsToDecimal(readRationals(tiff, lon.offset, 3, littleEndian), lonRef);
    }
    const alt = gps.get(TAGS.GPS_ALT);
    if (alt) {
      const [value] = readRationals(tiff, alt.offset, 1, littleEndian);
      const altRefEntry = gps.get(TAGS.GPS_ALT_REF);
      const belowSea = altRefEntry ? tiff[altRefEntry.offset] === 1 : false;
      result.altitude = Number.isFinite(value) ? (belowSea ? -value : value) : null;
    }
  }
};

const parseJpeg = (buffer, result) => {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end / start of scan
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    const segmentStart = offset + 4;
    const segmentEnd = Math.min(offset + 2 + length, buffer.length);

    if (marker === 0xe1 && buffer.toString("latin1", segmentStart, segmentStart + 6) === "Exif\0\0") {
      parseTiff(buffer.subarray(segmentStart + 6, segmentEnd), result);
    } else if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (segmentStart + 5 <= buffer.length) {
        result.height = buffer.readUInt16BE(segmentStart + 1);
        result.width = buffer.readUInt16BE(segmentStart + 3);
      }
    }
    offset = offset + 2 + length;
  }
};

const parsePng = (buffer, result) => {
  if (buffer.length >= 24 && buffer.toString("latin1", 12, 16) === "IHDR") {
    result.width = buffer.readUInt32BE(16);
    result.height = buffer.readUInt32BE(20);
  }
};

const parseWebp = (buffer, result) => {
  if (buffer.length < 30) return;
  const chunk = buffer.toString("latin1", 12, 16);
  if (chunk === "VP8X") {
    result.width = 1 + buffer.readUIntLE(24, 3);
    result.height = 1 + buffer.readUIntLE(27, 3);
  } else if (chunk === "VP8 ") {
    result.width = buffer.readUInt16LE(26) & 0x3fff;
    result.height = buffer.readUInt16LE(28) & 0x3fff;
  } else if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    result.width = (bits & 0x3fff) + 1;
    result.height = ((bits >> 14) & 0x3fff) + 1;
  }
};

const detectFormat = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  if (buffer.length >= 8 && buffer.toString("latin1", 1, 4) === "PNG") return "png";
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
};

const readImageMetadataFromBuffer = (buffer) => {
  const result = empty();
  try {
    const format = detectFormat(buffer);
    result.raw.format = format;
    if (format === "jpeg") parseJpeg(buffer, result);
    else if (format === "png") parsePng(buffer, result);
    else if (format === "webp") parseWebp(buffer, result);
  } catch {
    // Malformed headers are not an error for the caller; fields stay null.
  }
  return result;
};

const readImageMetadata = async (filePath) => {
  if (!filePath) return empty();
  try {
    const buffer = await readHead(filePath);
    return readImageMetadataFromBuffer(buffer);
  } catch {
    return empty();
  }
};

module.exports = {
  TAGS,
  parseExifDate,
  readImageMetadata,
  readImageMetadataFromBuffer,
};
