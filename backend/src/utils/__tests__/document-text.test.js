const zlib = require("zlib");
const XLSX = require("@e965/xlsx");
const {
  chunkText,
  extractDocumentText,
  isExtractableType,
  kindFor,
  parseCMap,
  tokenize,
} = require("../document-text");
const { listZipEntries, readZipEntries } = require("../zip-reader");

// ── Fixture builders ────────────────────────────────────────────────────

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** Minimal ZIP writer (stored or deflated entries) for Office fixtures. */
const buildZip = (entries, { deflate = false } = {}) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(header, nameBuffer, data);
    centrals.push(central, nameBuffer);
    offset += header.length + nameBuffer.length + data.length;
  }
  const centralStart = offset;
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
};

/** Assembles a PDF from `{ number: body }` objects (streams as { dict, data }). */
const buildPdf = (objects, { trailerExtra = "" } = {}) => {
  const parts = [Buffer.from("%PDF-1.5\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  for (const [number, body] of Object.entries(objects)) {
    if (typeof body === "string") {
      parts.push(Buffer.from(`${number} 0 obj\n${body}\nendobj\n`, "latin1"));
      continue;
    }
    const data = Buffer.isBuffer(body.data) ? body.data : Buffer.from(body.data, "latin1");
    parts.push(Buffer.from(`${number} 0 obj\n${body.dict.replace(">>", ` /Length ${data.length} >>`)}\nstream\n`, "latin1"));
    parts.push(data);
    parts.push(Buffer.from("\nendstream\nendobj\n", "latin1"));
  }
  parts.push(Buffer.from(`trailer\n<< /Root 1 0 R ${trailerExtra} >>\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
};

const simplePdf = ({ content, compress = false, extraObjects = {} }) => {
  const stream = compress ? zlib.deflateSync(Buffer.from(content, "latin1")) : content;
  return buildPdf({
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    5: { dict: compress ? "<< /Filter /FlateDecode >>" : "<< >>", data: stream },
    ...extraObjects,
  });
};

// ── Tests ───────────────────────────────────────────────────────────────

describe("document text extraction", () => {
  it("detects extractable types by mime or extension", () => {
    expect(kindFor({ mimeType: "application/pdf" })).toBe("pdf");
    expect(kindFor({ mimeType: "application/octet-stream", fileName: "spec.docx" })).toBe("docx");
    expect(isExtractableType({ mimeType: "image/jpeg", fileName: "site.jpg" })).toBe(false);
    expect(isExtractableType({ mimeType: "text/csv" })).toBe(true);
  });

  it("reads plain text, HTML and RTF", () => {
    const plain = extractDocumentText({
      buffer: Buffer.from("﻿Method statement\r\n\r\nPour   concrete\ton level 3"),
      mimeType: "text/plain",
    });
    expect(plain).toMatchObject({ status: "ready", extractor: "text", wordCount: 7 });
    expect(plain.text).toBe("Method statement\n\nPour concrete on level 3");

    const html = extractDocumentText({
      buffer: Buffer.from("<html><style>p{}</style><body><h1>RFI &amp; response</h1><p>Rebar &#64; 200mm</p><script>x()</script></body></html>"),
      mimeType: "text/html",
    });
    expect(html.text).toBe("RFI & response\nRebar @ 200mm");

    const binary = extractDocumentText({ buffer: Buffer.from([0, 1, 2, 0, 5]), mimeType: "text/plain" });
    expect(binary).toMatchObject({ status: "unsupported", reason: "binary" });
  });

  it("reads spreadsheets sheet by sheet", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["Item", "Qty"], ["Excavation", 120]]),
      "BOQ",
    );
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Notes"], ["Rock allowance"]]), "Notes");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const result = extractDocumentText({
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(result.status).toBe("ready");
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("BOQ\nItem,Qty\nExcavation,120");
    expect(result.text).toContain("Notes\nNotes\nRock allowance");
  });

  it("reads Word documents including headers, with the zip reader handling deflate", () => {
    const docx = buildZip(
      {
        "[Content_Types].xml": "<Types/>",
        "word/document.xml":
          '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Section 3 </w:t></w:r><w:r><w:t>Concrete works</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Grade</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>C40</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Cover &amp; spacing<w:br/>per drawing</w:t></w:r></w:p></w:body></w:document>',
        "word/header1.xml": "<w:hdr><w:p><w:r><w:t>Project Alpha</w:t></w:r></w:p></w:hdr>",
      },
      { deflate: true },
    );
    expect(listZipEntries(docx).map((entry) => entry.name)).toContain("word/document.xml");
    expect(readZipEntries(docx, ["word/header1.xml"]).get("word/header1.xml").toString()).toContain("Project Alpha");

    const result = extractDocumentText({ buffer: docx, mimeType: "application/octet-stream", fileName: "spec.docx" });
    expect(result.status).toBe("ready");
    expect(result.extractor).toBe("docx");
    expect(result.text).toContain("Section 3 Concrete works");
    // table cells stay on one row (tabs are normalised to single spaces)
    expect(result.text).toContain("Grade C40");
    expect(result.text).toContain("Cover & spacing\nper drawing");
    expect(result.text).toContain("Project Alpha");
  });

  it("reads PowerPoint slides in order and OpenDocument text", () => {
    const pptx = buildZip({
      "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Tenth slide</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Kick-off</a:t></a:r></a:p><a:p><a:r><a:t>Agenda</a:t></a:r></a:p></p:sld>",
    });
    const deck = extractDocumentText({
      buffer: pptx,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(deck.pageCount).toBe(3);
    expect(deck.text.indexOf("Kick-off")).toBeLessThan(deck.text.indexOf("Second slide"));
    expect(deck.text.indexOf("Second slide")).toBeLessThan(deck.text.indexOf("Tenth slide"));

    const odt = buildZip({
      "content.xml": "<office:document-content><text:h>Scope</text:h><text:p>Piling<text:tab/>works</text:p></office:document-content>",
    });
    expect(extractDocumentText({ buffer: odt, mimeType: "application/vnd.oasis.opendocument.text" }).text).toBe(
      "Scope\nPiling works",
    );
  });

  it("reads PDF text layers from plain and Flate-compressed content streams", () => {
    const content =
      "BT /F1 12 Tf 72 700 Td (Rebar spacing) Tj 0 -14 Td [(shall) -250 (be) -1200 (200mm)] TJ T* (Level 3 \\(east\\)) Tj ET";
    const plain = extractDocumentText({ buffer: simplePdf({ content }), mimeType: "application/pdf" });
    expect(plain).toMatchObject({ status: "ready", extractor: "pdf", pageCount: 1 });
    expect(plain.text).toBe("Rebar spacing\nshall be 200mm\nLevel 3 (east)");

    const compressed = extractDocumentText({
      buffer: simplePdf({ content, compress: true }),
      mimeType: "application/pdf",
    });
    expect(compressed.text).toBe("Rebar spacing\nshall be 200mm\nLevel 3 (east)");
  });

  it("maps CID font codes through ToUnicode CMaps and reads object streams", () => {
    const cmap = `
/CIDInit /ProcSet findresource begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar
<0001> <0048>
<0002> <0069>
endbfchar
1 beginbfrange
<0010> <0012> <0041>
endbfrange
endcmap`;
    expect([...parseCMap(cmap).map.entries()]).toEqual([
      [1, "H"],
      [2, "i"],
      [16, "A"],
      [17, "B"],
      [18, "C"],
    ]);

    // Page + font dictionaries live inside a compressed object stream (PDF 1.5).
    const objStmBody = "<< /Type /Page /Parent 2 0 R /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>";
    const fontBody = "<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Calibri /Encoding /Identity-H /ToUnicode 6 0 R >>";
    const header = `3 0 4 ${objStmBody.length + 1} `;
    const objStm = Buffer.from(`${header}${objStmBody} ${fontBody}`, "latin1");
    const pdf = buildPdf({
      1: "<< /Type /Catalog /Pages 2 0 R >>",
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      7: {
        dict: `<< /Type /ObjStm /N 2 /First ${header.length} /Filter /FlateDecode >>`,
        data: zlib.deflateSync(objStm),
      },
      5: { dict: "<< >>", data: "BT /F1 10 Tf <00010002> Tj [<0010> -300 <0011>] TJ ET" },
      6: { dict: "<< >>", data: cmap },
    });
    const result = extractDocumentText({ buffer: pdf, mimeType: "application/pdf" });
    expect(result.status).toBe("ready");
    expect(result.text).toBe("HiA B");
  });

  it("reports scanned and encrypted PDFs as unsupported with a reason", () => {
    const scanned = extractDocumentText({
      buffer: simplePdf({ content: "q 1 0 0 1 0 0 cm /Im0 Do Q" }),
      mimeType: "application/pdf",
    });
    expect(scanned).toMatchObject({ status: "unsupported", reason: "no_text_layer", pageCount: 1 });

    const encrypted = extractDocumentText({
      buffer: buildPdf(
        { 1: "<< /Type /Catalog >>", 9: "<< /Filter /Standard /V 2 >>" },
        { trailerExtra: "/Encrypt 9 0 R" },
      ),
      mimeType: "application/pdf",
    });
    expect(encrypted).toMatchObject({ status: "unsupported", reason: "encrypted" });
  });

  it("skips inline image data in content streams", () => {
    const tokens = tokenize("BT (before) Tj ET BI /W 2 /H 2 ID \x00\xff(\x01 EI BT (after) Tj ET");
    const strings = tokens.filter((token) => token.type === "string").map((token) => token.bytes.toString());
    expect(strings).toEqual(["before", "after"]);
  });

  it("chunks text on paragraph boundaries with overlap", () => {
    const paragraph = "Concrete shall be cured for seven days. ".repeat(20);
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunkText(text, { size: 900, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].charStart).toBeLessThan(chunks[0].charEnd);
    expect(chunks.every((chunk) => chunk.text.length <= 900)).toBe(true);
    expect(chunkText("   ")).toEqual([]);
  });
});
