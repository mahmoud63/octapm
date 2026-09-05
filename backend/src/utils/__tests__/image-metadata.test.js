const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const {
  parseExifDate,
  readImageMetadata,
  readImageMetadataFromBuffer,
} = require("../image-metadata");

/**
 * Builds a minimal JPEG: SOI, an APP1 EXIF segment (big-endian TIFF with IFD0,
 * Exif IFD and GPS IFD), a SOF0 frame header and EOI.
 */
const buildExifJpeg = () => {
  const be16 = (value) => Buffer.from([(value >> 8) & 0xff, value & 0xff]);
  const be32 = (value) =>
    Buffer.from([(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  const rational = (num, den) => Buffer.concat([be32(num), be32(den)]);
  const entry = (tag, type, count, valueOrOffset) =>
    Buffer.concat([be16(tag), be16(type), be32(count), valueOrOffset]);
  const inline = (buffer) => Buffer.concat([buffer, Buffer.alloc(4 - buffer.length)]);

  // Layout (offsets relative to TIFF header start):
  //   0   header (8)
  //   8   IFD0: count(2) + 5 entries (60) + next(4) = 66  → ends at 74
  //   74  Make "Acme\0" (5) → pad to 80
  //   80  Model "SiteCam\0" (8) → 88
  //   88  Exif IFD: count(2) + 3 entries (36) + next(4) = 42 → 130
  //   130 DateTimeOriginal "2026:09:05 08:15:30\0" (20) → 150
  //   150 GPS IFD: count(2) + 5 entries (60) + next(4) = 66 → 216
  //   216 lat rationals (24) → 240
  //   240 lon rationals (24) → 264
  //   264 alt rational (8) → 272
  const make = Buffer.from("Acme\0", "latin1");
  const model = Buffer.from("SiteCam\0", "latin1");
  const dateTime = Buffer.from("2026:09:05 08:15:30\0", "latin1");

  const ifd0 = Buffer.concat([
    be16(5),
    entry(0x010f, 2, make.length, be32(74)),
    entry(0x0110, 2, model.length, be32(80)),
    entry(0x0112, 3, 1, inline(be16(6))),
    entry(0x8769, 4, 1, be32(88)),
    entry(0x8825, 4, 1, be32(150)),
    be32(0),
  ]);
  const exifIfd = Buffer.concat([
    be16(3),
    entry(0x9003, 2, dateTime.length, be32(130)),
    entry(0xa002, 4, 1, be32(4032)),
    entry(0xa003, 4, 1, be32(3024)),
    be32(0),
  ]);
  const gpsIfd = Buffer.concat([
    be16(5),
    entry(0x0001, 2, 2, inline(Buffer.from("N\0", "latin1"))),
    entry(0x0002, 5, 3, be32(216)),
    entry(0x0003, 2, 2, inline(Buffer.from("E\0", "latin1"))),
    entry(0x0004, 5, 3, be32(240)),
    entry(0x0006, 5, 1, be32(264)),
    be32(0),
  ]);
  const lat = Buffer.concat([rational(25, 1), rational(12, 1), rational(30, 1)]); // 25°12'30" N
  const lon = Buffer.concat([rational(55, 1), rational(16, 1), rational(0, 1)]); // 55°16'00" E
  const alt = rational(125, 10);

  const tiff = Buffer.concat([
    Buffer.from("MM", "latin1"),
    be16(42),
    be32(8),
    ifd0,
    make,
    Buffer.alloc(1),
    model,
    exifIfd,
    dateTime,
    gpsIfd,
    lat,
    lon,
    alt,
  ]);
  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), be16(exifPayload.length + 2), exifPayload]);
  const sof0 = Buffer.concat([
    Buffer.from([0xff, 0xc0]),
    be16(11),
    Buffer.from([8]),
    be16(3024),
    be16(4032),
    Buffer.from([1, 1, 0x11, 0]),
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof0, Buffer.from([0xff, 0xd9])]);
};

describe("image metadata", () => {
  it("parses EXIF capture time, camera, orientation, GPS and dimensions from a JPEG", async () => {
    const jpeg = buildExifJpeg();
    const meta = readImageMetadataFromBuffer(jpeg);

    expect(meta.raw.format).toBe("jpeg");
    expect(meta.cameraMake).toBe("Acme");
    expect(meta.cameraModel).toBe("SiteCam");
    expect(meta.orientation).toBe(6);
    expect(meta.takenAt).toEqual(new Date(2026, 8, 5, 8, 15, 30));
    expect(meta.latitude).toBeCloseTo(25 + 12 / 60 + 30 / 3600, 6);
    expect(meta.longitude).toBeCloseTo(55 + 16 / 60, 6);
    expect(meta.altitude).toBeCloseTo(12.5, 6);
    expect(meta.width).toBe(4032);
    expect(meta.height).toBe(3024);

    const file = path.join(os.tmpdir(), `octapm-exif-${Date.now()}.jpg`);
    await fs.writeFile(file, jpeg);
    try {
      const fromFile = await readImageMetadata(file);
      expect(fromFile.cameraModel).toBe("SiteCam");
      expect(fromFile.latitude).toBeCloseTo(meta.latitude, 6);
    } finally {
      await fs.unlink(file);
    }
  });

  it("reads PNG and WebP dimensions and tolerates garbage", () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]),
      Buffer.from("IHDR", "latin1"),
      Buffer.from([0, 0, 0x03, 0x20, 0, 0, 0x02, 0x58, 8, 6, 0, 0, 0]),
    ]);
    expect(readImageMetadataFromBuffer(png)).toMatchObject({ width: 800, height: 600 });

    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "latin1");
    webp.write("WEBP", 8, "latin1");
    webp.write("VP8X", 12, "latin1");
    webp.writeUIntLE(1279, 24, 3);
    webp.writeUIntLE(719, 27, 3);
    expect(readImageMetadataFromBuffer(webp)).toMatchObject({ width: 1280, height: 720 });

    const junk = readImageMetadataFromBuffer(Buffer.from("not an image at all"));
    expect(junk.width).toBeNull();
    expect(junk.takenAt).toBeNull();
    expect(readImageMetadataFromBuffer(Buffer.from([0xff, 0xd8, 0xff]))).toMatchObject({
      width: null,
    });
  });

  it("parses EXIF timestamps and rejects malformed ones", () => {
    expect(parseExifDate("2026:01:31 23:59:01")).toEqual(new Date(2026, 0, 31, 23, 59, 1));
    expect(parseExifDate("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDate("yesterday")).toBeNull();
    expect(parseExifDate(null)).toBeNull();
  });

  it("returns empty metadata for a missing file", async () => {
    const meta = await readImageMetadata(path.join(os.tmpdir(), "does-not-exist.jpg"));
    expect(meta).toMatchObject({ width: null, latitude: null, cameraMake: null });
  });
});
