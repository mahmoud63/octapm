// Generates the PWA icons (an octagon mark on a dark tile) without any image
// library: pixels are rasterised here and written as PNG with zlib.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const out = resolve(import.meta.dirname, '..', 'public', 'icons')
mkdirSync(out, { recursive: true })

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const png = (size, pixel) => {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y)
      const i = y * (size * 4 + 1) + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [11, 18, 32]
const MARK = [56, 189, 248]
const INNER = [14, 24, 44]

const insideOctagon = (x, y, cx, cy, radius) => {
  // Regular octagon: |dx| + |dy| <= r * (1 + tan(22.5°)) and max(|dx|, |dy|) <= r
  const dx = Math.abs(x - cx)
  const dy = Math.abs(y - cy)
  return Math.max(dx, dy) <= radius && dx + dy <= radius * 1.4142
}
const insideRoundedSquare = (x, y, size, radius) => {
  const rx = Math.min(Math.max(x, radius), size - radius)
  const ry = Math.min(Math.max(y, radius), size - radius)
  return (x - rx) ** 2 + (y - ry) ** 2 <= radius ** 2
}

const draw = (size, { maskable }) => (x, y) => {
  const px = x + 0.5
  const py = y + 0.5
  const c = size / 2
  if (!maskable && !insideRoundedSquare(px, py, size, size * 0.2)) return [0, 0, 0, 0]
  const outer = size * (maskable ? 0.3 : 0.36)
  const inner = outer * 0.55
  if (insideOctagon(px, py, c, c, inner)) return [...INNER, 255]
  if (insideOctagon(px, py, c, c, outer)) return [...MARK, 255]
  return [...BG, 255]
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  writeFileSync(resolve(out, name), png(size, draw(size, { maskable })))
}
process.stdout.write('pwa icons written\n')
