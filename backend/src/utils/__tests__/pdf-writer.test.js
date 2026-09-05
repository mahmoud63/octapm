const { createPdf, jpegSize, textWidth, wrapText } = require("../pdf-writer");

// Minimal JPEG: SOI, SOF0 (2 components would be odd; use 3), then EOI.
const fakeJpeg = ({ width, height }) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]),
    Buffer.alloc(9),
    Buffer.from([0xff, 0xd9]),
  ]);

describe("pdf writer", () => {
  it("measures and wraps Helvetica text", () => {
    // Helvetica AFM widths: H 722, e 556, l 222, l 222, o 556
    expect(textWidth("Hello", 10)).toBeCloseTo((722 + 556 + 222 + 222 + 556) / 100, 2);
    const lines = wrapText("The quick brown fox jumps over the lazy dog", 100, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("The quick brown fox jumps over the lazy dog");
    expect(wrapText("Supercalifragilisticexpialidocious", 60, 10).length).toBeGreaterThan(1);
  });

  it("reads JPEG dimensions", () => {
    expect(jpegSize(fakeJpeg({ width: 640, height: 480 }))).toEqual({ width: 640, height: 480, components: 3 });
    expect(jpegSize(Buffer.from("not a jpeg"))).toBeNull();
  });

  it("renders headings, tables and photos across pages with numbering", () => {
    const doc = createPdf({ title: "Punch list — Tower (A)", pageSize: "A4-landscape", footer: "2026-09-06" });
    doc.heading("Punch list — Tower (A)");
    doc.paragraph("12 items · 8 open · 3 overdue", { size: 9 });
    doc.table({
      columns: [
        { key: "ref", label: "Ref", width: 52 },
        { key: "title", label: "Item", width: 0.5 },
        { key: (row) => row.status, label: "Status", width: 0.5 },
      ],
      rows: Array.from({ length: 90 }, (_, index) => ({
        ref: `PL-${String(index + 1).padStart(3, "0")}`,
        title: `Crack in render at gridline ${index} — make good and repaint to match adjacent finish`,
        status: index % 3 ? "open" : "closed",
      })),
    });
    doc.imageRow([fakeJpeg({ width: 400, height: 300 }), Buffer.from("png?")], { width: 120 });
    const buffer = doc.render();
    const text = buffer.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    const pageCount = (text.match(/\/Type \/Page\b/g) || []).length;
    expect(pageCount).toBeGreaterThanOrEqual(3);
    expect(text).toContain(`/Count ${pageCount}`);
    expect(text).toContain("Tower \\(A\\)");
    expect(text).toContain("Page 1 of");
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("startxref");
    expect(text.trim().endsWith("%%EOF")).toBe(true);
  });

  it("repeats the table header on page breaks", () => {
    const doc = createPdf({ title: "Long" });
    doc.table({
      columns: [{ key: "a", label: "HEADERTOKEN", width: 1 }],
      rows: Array.from({ length: 120 }, (_, index) => ({ a: `row ${index}` })),
    });
    const text = doc.render().toString("latin1");
    const headers = (text.match(/HEADERTOKEN/g) || []).length;
    const pages = (text.match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBeGreaterThan(1);
    expect(headers).toBe(pages);
  });
});
