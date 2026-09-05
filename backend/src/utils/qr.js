/**
 * Dependency-free QR code encoder (byte mode, error-correction level M,
 * versions 1–10 → up to 213 bytes). Enough for a sheet or record URL that
 * site staff scan to open the app. Output is a module matrix and an SVG.
 */

const EC_LEVEL_M_BITS = 0b00;

// version → [ecCodewordsPerBlock, [[blocks, dataCodewords], ...]]
const BLOCKS = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};

const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const MAX_VERSION = 10;

// ─── Galois field GF(256) with the QR primitive polynomial 0x11D ────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value;
    LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];
})();

const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

const generatorPolynomial = (degree) => {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[index]);
    }
    poly = next;
  }
  return poly;
};

const reedSolomon = (data, ecCount) => {
  const generator = generatorPolynomial(ecCount);
  const remainder = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    if (factor === 0) continue;
    for (let index = 0; index < ecCount; index += 1) {
      remainder[index] ^= gfMul(generator[index + 1], factor);
    }
  }
  return remainder;
};

// ─── Data encoding ─────────────────────────────────────────────────────
const dataCapacity = (version) =>
  BLOCKS[version][1].reduce((sum, [blocks, size]) => sum + blocks * size, 0);

const chooseVersion = (byteLength) => {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const headerBits = 4 + (version <= 9 ? 8 : 16);
    if (byteLength * 8 + headerBits <= dataCapacity(version) * 8) return version;
  }
  throw new Error(`QR payload too long (${byteLength} bytes; max ~213)`);
};

const buildCodewords = (bytes, version) => {
  const capacity = dataCapacity(version);
  const bits = [];
  const push = (value, length) => {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((value >> index) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const totalBits = capacity * 8;
  push(0, Math.min(4, totalBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | bits[index + bit];
    data.push(byte);
  }
  for (let pad = 0; data.length < capacity; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);

  const [ecCount, groups] = BLOCKS[version];
  const blocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let index = 0; index < count; index += 1) {
      const chunk = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ data: chunk, ec: reedSolomon(chunk, ecCount) });
    }
  }
  const interleaved = [];
  const maxData = Math.max(...blocks.map((block) => block.data.length));
  for (let index = 0; index < maxData; index += 1) {
    for (const block of blocks) if (index < block.data.length) interleaved.push(block.data[index]);
  }
  for (let index = 0; index < ecCount; index += 1) {
    for (const block of blocks) interleaved.push(block.ec[index]);
  }
  return interleaved;
};

// ─── Matrix ─────────────────────────────────────────────────────────────
const bch = (value, poly, bits) => {
  const degree = Math.floor(Math.log2(poly));
  let remainder = value << (degree);
  for (let index = bits + degree - 1; index >= degree; index -= 1) {
    if (remainder & (1 << index)) remainder ^= poly << (index - degree);
  }
  return remainder;
};

const formatBits = (mask) => {
  const data = (EC_LEVEL_M_BITS << 3) | mask;
  return ((data << 10) | bch(data, 0x537, 5)) ^ 0x5412;
};

const versionBits = (version) => (version << 12) | bch(version, 0x1f25, 6);

const createMatrix = (version) => {
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (row, col, dark) => {
    modules[row][col] = dark ? 1 : 0;
    reserved[row][col] = true;
  };

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const onRing = r === 0 || r === 6 || c === 0 || c === 6;
        const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const outside = r === -1 || r === 7 || c === -1 || c === 7;
        set(rr, cc, !outside && (onRing || inner));
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let index = 8; index < size - 8; index += 1) {
    if (!reserved[6][index]) set(6, index, index % 2 === 0);
    if (!reserved[index][6]) set(index, 6, index % 2 === 0);
  }

  const centers = ALIGNMENT[version];
  for (const row of centers) {
    for (const col of centers) {
      if (reserved[row][col]) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          set(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }

  set(size - 8, 8, true); // dark module

  // reserve format areas
  for (let index = 0; index < 9; index += 1) {
    if (!reserved[8][index]) set(8, index, false);
    if (!reserved[index][8]) set(index, 8, false);
  }
  for (let index = size - 8; index < size; index += 1) {
    if (!reserved[8][index]) set(8, index, false);
    if (!reserved[index][8]) set(index, 8, false);
  }
  if (version >= 7) {
    for (let index = 0; index < 6; index += 1) {
      for (let j = 0; j < 3; j += 1) {
        set(index, size - 11 + j, false);
        set(size - 11 + j, index, false);
      }
    }
  }
  return { size, modules, reserved };
};

const placeData = ({ size, modules, reserved }, codewords) => {
  const bits = [];
  for (const byte of codewords) for (let index = 7; index >= 0; index -= 1) bits.push((byte >> index) & 1);
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        modules[row][c] = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
};

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const applyMask = (matrix, mask) => {
  const { size, modules, reserved } = matrix;
  const out = modules.map((row) => row.slice());
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!reserved[r][c] && MASKS[mask](r, c)) out[r][c] ^= 1;
    }
  }
  return out;
};

const writeFormat = (grid, size, mask, version) => {
  const bits = formatBits(mask);
  const bit = (index) => (bits >> index) & 1;
  for (let index = 0; index < 6; index += 1) grid[8][index] = bit(14 - index);
  grid[8][7] = bit(8);
  grid[8][8] = bit(7);
  grid[7][8] = bit(6);
  for (let index = 9; index < 15; index += 1) grid[14 - index][8] = bit(14 - index);
  for (let index = 0; index < 8; index += 1) grid[size - 1 - index][8] = bit(index);
  for (let index = 8; index < 15; index += 1) grid[8][size - 15 + index] = bit(index);
  grid[size - 8][8] = 1;
  if (version >= 7) {
    const info = versionBits(version);
    for (let index = 0; index < 18; index += 1) {
      const value = (info >> index) & 1;
      const row = Math.floor(index / 3);
      const col = size - 11 + (index % 3);
      grid[row][col] = value;
      grid[col][row] = value;
    }
  }
};

const penalty = (grid) => {
  const size = grid.length;
  let score = 0;
  const runs = (get) => {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (get(a, b) === get(a, b - 1)) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  };
  runs((a, b) => grid[a][b]);
  runs((a, b) => grid[b][a]);
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  const pattern1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pattern2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (get, a, start) => {
    let m1 = true;
    let m2 = true;
    for (let index = 0; index < 11; index += 1) {
      const value = get(a, start + index);
      if (value !== pattern1[index]) m1 = false;
      if (value !== pattern2[index]) m2 = false;
    }
    return m1 || m2;
  };
  for (let a = 0; a < size; a += 1) {
    for (let start = 0; start <= size - 11; start += 1) {
      if (matches((x, y) => grid[x][y], a, start)) score += 40;
      if (matches((x, y) => grid[y][x], a, start)) score += 40;
    }
  }
  let dark = 0;
  for (const row of grid) for (const value of row) dark += value;
  const percent = (dark * 100) / (size * size);
  const previous = Math.floor(percent / 5) * 5;
  score += Math.min(Math.abs(previous - 50) / 5, Math.abs(previous + 5 - 50) / 5) * 10;
  return score;
};

/**
 * Encodes text (UTF-8) into a QR matrix: `{ version, size, modules }` where
 * modules is a 2-D array of 0/1.
 */
const encodeQr = (text) => {
  const bytes = [...Buffer.from(String(text), "utf8")];
  const version = chooseVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);
  const matrix = createMatrix(version);
  placeData(matrix, codewords);
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = applyMask(matrix, mask);
    writeFormat(grid, matrix.size, mask, version);
    const score = penalty(grid);
    if (!best || score < best.score) best = { mask, grid, score };
  }
  return { version, size: matrix.size, mask: best.mask, modules: best.grid };
};

/** SVG string for a QR matrix with a quiet zone, dark modules as one path. */
const qrToSvg = (text, { moduleSize = 4, quietZone = 4, label = null } = {}) => {
  const { size, modules } = encodeQr(text);
  const total = (size + quietZone * 2) * moduleSize;
  const labelHeight = label ? moduleSize * 5 : 0;
  let path = "";
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!modules[r][c]) continue;
      const x = (c + quietZone) * moduleSize;
      const y = (r + quietZone) * moduleSize;
      path += `M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
    }
  }
  const escaped = label ? String(label).replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch]) : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total + labelHeight}" viewBox="0 0 ${total} ${total + labelHeight}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total + labelHeight}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/>` +
    (label
      ? `<text x="${total / 2}" y="${total + labelHeight - moduleSize * 1.5}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${moduleSize * 3}" fill="#111111">${escaped}</text>`
      : "") +
    `</svg>`
  );
};

module.exports = { MAX_VERSION, chooseVersion, encodeQr, qrToSvg };
