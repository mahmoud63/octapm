/**
 * Small dependency-free PDF writer for reports (punch lists, registers):
 * headings, paragraphs, tables with word-wrapped cells and repeated header
 * rows, JPEG photos, automatic page breaks, page numbers. Standard
 * Helvetica fonts (no embedding), WinAnsi text.
 */

const PAGE_SIZES = {
  A4: [595.28, 841.89],
  "A4-landscape": [841.89, 595.28],
  Letter: [612, 792],
  "Letter-landscape": [792, 612],
};

// Helvetica advance widths (per 1000 em) for ASCII 32..126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
  722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const textWidth = (text, size, bold = false) => {
  let width = 0;
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    const base = code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556;
    width += base * (bold ? 1.06 : 1);
  }
  return (width * size) / 1000;
};

const escapePdfText = (text) =>
  String(text)
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const wrapText = (text, width, size, bold = false) => {
  const lines = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= width || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
      // Break words longer than the column.
      while (textWidth(line, size, bold) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && textWidth(line.slice(0, cut), size, bold) > width) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
};

const jpegSize = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        components: buffer[offset + 9],
      };
    }
    const length = buffer.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  return null;
};

const formatDate = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
};

class PdfDocument {
  constructor({ title = "Report", author = "OctaPM", pageSize = "A4", margin = 40, footer = null } = {}) {
    this.title = title;
    this.author = author;
    [this.pageWidth, this.pageHeight] = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
    this.margin = margin;
    this.footerText = footer;
    this.pages = [];
    this.images = [];
    this.fontSize = 10;
    this.lineHeight = 13;
    this.newPage();
  }

  get contentWidth() {
    return this.pageWidth - this.margin * 2;
  }

  newPage() {
    this.pages.push({ ops: [], images: [] });
    this.y = this.pageHeight - this.margin;
    if (this.pages.length > 1 && this.repeatHeader) this.repeatHeader();
    return this;
  }

  ensureSpace(height) {
    if (this.y - height < this.margin + 24) this.newPage();
  }

  get page() {
    return this.pages[this.pages.length - 1];
  }

  text(str, { x = this.margin, y = this.y, size = this.fontSize, bold = false, color = "0 0 0" } = {}) {
    this.page.ops.push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(str)}) Tj ET`,
    );
    return this;
  }

  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
    const ops = [];
    if (fill) ops.push(`${fill} rg`);
    if (stroke) ops.push(`${stroke} RG ${lineWidth} w`);
    ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    ops.push(fill && stroke ? "B" : fill ? "f" : "S");
    this.page.ops.push(ops.join(" "));
    return this;
  }

  line(x1, y1, x2, y2, { color = "0.75 0.75 0.75", width = 0.5 } = {}) {
    this.page.ops.push(`${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    return this;
  }

  spacer(height = 8) {
    this.y -= height;
    return this;
  }

  heading(str, { level = 1 } = {}) {
    const size = level === 1 ? 18 : level === 2 ? 14 : 11.5;
    this.ensureSpace(size + 10);
    this.y -= size;
    this.text(str, { size, bold: true });
    this.y -= 6;
    return this;
  }

  paragraph(str, { size = this.fontSize, bold = false, color = "0 0 0", indent = 0, width = null } = {}) {
    const lines = wrapText(str, (width ?? this.contentWidth) - indent, size, bold);
    const lineHeight = size * 1.3;
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      this.y -= lineHeight;
      this.text(line, { x: this.margin + indent, size, bold, color });
    }
    this.y -= 3;
    return this;
  }

  keyValues(pairs, { size = 9 } = {}) {
    const labelWidth = Math.min(140, Math.max(...pairs.map(([label]) => textWidth(label, size, true))) + 12);
    for (const [label, value] of pairs) {
      const lines = wrapText(value ?? "", this.contentWidth - labelWidth, size);
      const height = Math.max(lines.length, 1) * size * 1.3;
      this.ensureSpace(height);
      this.y -= size * 1.3;
      this.text(label, { size, bold: true, color: "0.3 0.3 0.3" });
      lines.forEach((line, index) => {
        if (index > 0) this.y -= size * 1.3;
        this.text(line, { x: this.margin + labelWidth, size });
      });
    }
    this.y -= 4;
    return this;
  }

  /**
   * Table with word-wrapped cells. `columns`: [{ key, label, width, align }],
   * widths in points (or fractions summing to 1). Header repeats on page
   * breaks; rows never split across pages.
   */
  table({ columns, rows, size = 8.5, zebra = true, headerFill = "0.93 0.93 0.93" }) {
    const totalFraction = columns.reduce((sum, column) => sum + (column.width <= 1 ? column.width : 0), 0);
    const fixed = columns.reduce((sum, column) => sum + (column.width > 1 ? column.width : 0), 0);
    const widths = columns.map((column) =>
      column.width > 1 ? column.width : ((this.contentWidth - fixed) * column.width) / (totalFraction || 1),
    );
    const padding = 4;
    const lineHeight = size * 1.25;

    const drawRow = (cells, { bold = false, fill = null } = {}) => {
      const wrapped = cells.map((cell, index) => wrapText(cell ?? "", widths[index] - padding * 2, size, bold));
      const height = Math.max(...wrapped.map((lines) => lines.length), 1) * lineHeight + padding * 2;
      return { wrapped, height, bold, fill };
    };

    const header = drawRow(columns.map((column) => column.label), { bold: true, fill: headerFill });
    const paint = (row) => {
      const top = this.y;
      if (row.fill) this.rect(this.margin, top - row.height, this.contentWidth, row.height, { fill: row.fill });
      let x = this.margin;
      row.wrapped.forEach((lines, index) => {
        const align = columns[index].align || "left";
        lines.forEach((line, lineIndex) => {
          const width = textWidth(line, size, row.bold);
          const tx = align === "right" ? x + widths[index] - padding - width : align === "center" ? x + (widths[index] - width) / 2 : x + padding;
          this.text(line, { x: tx, y: top - padding - lineHeight * (lineIndex + 1) + size * 0.3, size, bold: row.bold });
        });
        x += widths[index];
      });
      this.line(this.margin, top - row.height, this.margin + this.contentWidth, top - row.height);
      this.y = top - row.height;
    };

    const previousRepeat = this.repeatHeader;
    this.repeatHeader = () => paint(header);
    this.ensureSpace(header.height + lineHeight * 2);
    paint(header);
    rows.forEach((cells, rowIndex) => {
      const row = drawRow(columns.map((column) => (typeof column.key === "function" ? column.key(cells) : cells[column.key])), {
        fill: zebra && rowIndex % 2 ? "0.98 0.98 0.98" : null,
      });
      this.ensureSpace(row.height);
      paint(row);
    });
    this.repeatHeader = previousRepeat;
    this.y -= 8;
    return this;
  }

  /** JPEG only; other formats are skipped so a report never fails on a photo. */
  image(buffer, { width = 120, caption = null } = {}) {
    const info = jpegSize(buffer);
    if (!info) return this;
    const height = (width * info.height) / info.width;
    const captionHeight = caption ? 12 : 0;
    this.ensureSpace(height + captionHeight + 6);
    this.y -= height;
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, buffer, info });
    this.page.images.push(name);
    this.page.ops.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${this.margin.toFixed(2)} ${this.y.toFixed(2)} cm /${name} Do Q`);
    if (caption) {
      this.y -= 10;
      this.text(caption, { size: 8, color: "0.35 0.35 0.35" });
    }
    this.y -= 6;
    return this;
  }

  /** A row of JPEG thumbnails (skips non-JPEG buffers). */
  imageRow(buffers, { width = 110, gap = 8 } = {}) {
    const valid = buffers.map((buffer) => ({ buffer, info: jpegSize(buffer) })).filter((entry) => entry.info);
    if (!valid.length) return this;
    const perRow = Math.max(1, Math.floor((this.contentWidth + gap) / (width + gap)));
    for (let start = 0; start < valid.length; start += perRow) {
      const chunk = valid.slice(start, start + perRow);
      const height = Math.max(...chunk.map(({ info }) => (width * info.height) / info.width));
      this.ensureSpace(height + 6);
      this.y -= height;
      chunk.forEach(({ buffer, info }, index) => {
        const name = `Im${this.images.length + 1}`;
        this.images.push({ name, buffer, info });
        this.page.images.push(name);
        const h = (width * info.height) / info.width;
        const x = this.margin + index * (width + gap);
        this.page.ops.push(`q ${width.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(this.y + height - h).toFixed(2)} cm /${name} Do Q`);
      });
      this.y -= 6;
    }
    return this;
  }

  render() {
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };
    const catalogId = add(null);
    const pagesId = add(null);
    const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const boldId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imageIds = new Map();
    for (const image of this.images) {
      const colorSpace = image.info.components === 1 ? "/DeviceGray" : image.info.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      const id = add({
        dict: `<< /Type /XObject /Subtype /Image /Width ${image.info.width} /Height ${image.info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.buffer.length} >>`,
        stream: image.buffer,
      });
      imageIds.set(image.name, id);
    }
    const pageIds = [];
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const footer = `${this.footerText ? `${this.footerText}  ·  ` : ""}${this.title}  ·  Page ${index + 1} of ${total}`;
      const footerOps = `BT /F1 8 Tf 0.4 0.4 0.4 rg ${this.margin.toFixed(2)} ${(this.margin / 2).toFixed(2)} Td (${escapePdfText(footer)}) Tj ET`;
      const content = Buffer.from([...page.ops, footerOps].join("\n"), "latin1");
      const contentId = add({ dict: `<< /Length ${content.length} >>`, stream: content });
      const xobjects = page.images.map((name) => `/${name} ${imageIds.get(name)} 0 R`).join(" ");
      const pageId = add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> ${xobjects ? `/XObject << ${xobjects} >>` : ""} >> /Contents ${contentId} 0 R >>`,
      );
      pageIds.push(pageId);
    });
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const infoId = add(
      `<< /Title (${escapePdfText(this.title)}) /Author (${escapePdfText(this.author)}) /Producer (OctaPM) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`,
    );

    const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    const offsets = [];
    let length = chunks[0].length;
    objects.forEach((body, index) => {
      offsets.push(length);
      const head = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
      let parts;
      if (body && typeof body === "object") {
        parts = [head, Buffer.from(`${body.dict}\nstream\n`, "latin1"), body.stream, Buffer.from("\nendstream\nendobj\n", "latin1")];
      } else {
        parts = [head, Buffer.from(`${body}\nendobj\n`, "latin1")];
      }
      for (const part of parts) {
        chunks.push(part);
        length += part.length;
      }
    });
    const xrefOffset = length;
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
    for (const offset of offsets) xref.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
    xref.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    chunks.push(Buffer.from(xref.join(""), "latin1"));
    return Buffer.concat(chunks);
  }
}

const createPdf = (options) => new PdfDocument(options);

module.exports = { PAGE_SIZES, PdfDocument, createPdf, formatDate, jpegSize, textWidth, wrapText };
