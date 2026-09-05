const { chooseVersion, encodeQr, qrToSvg } = require("../qr");

const finderAt = (modules, row, col) => {
  const expected = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      if (modules[row + r][col + c] !== expected[r][c]) return false;
    }
  }
  return true;
};

describe("qr encoder", () => {
  it("picks the smallest version that fits", () => {
    expect(chooseVersion(10)).toBe(1);
    expect(chooseVersion(14)).toBe(1);
    expect(chooseVersion(15)).toBe(2);
    expect(chooseVersion(80)).toBe(5);
    expect(chooseVersion(213)).toBe(10);
    expect(() => chooseVersion(214)).toThrow(/too long/);
  });

  it("produces a well-formed matrix with finder, timing and dark modules", () => {
    const url = "https://octapm.example/projects/11111111-1111-4111-8111-111111111111/quality/defects?source=sheet_qr&recordId=22222222-2222-4222-8222-222222222222";
    const { version, size, modules } = encodeQr(url);
    expect(version).toBe(chooseVersion(Buffer.byteLength(url)));
    expect(size).toBe(17 + 4 * version);
    expect(modules).toHaveLength(size);
    expect(finderAt(modules, 0, 0)).toBe(true);
    expect(finderAt(modules, 0, size - 7)).toBe(true);
    expect(finderAt(modules, size - 7, 0)).toBe(true);
    // separators are light
    expect(modules[7].slice(0, 8).every((value) => value === 0)).toBe(true);
    // timing patterns alternate
    for (let index = 8; index < size - 8; index += 1) {
      expect(modules[6][index]).toBe(index % 2 === 0 ? 1 : 0);
      expect(modules[index][6]).toBe(index % 2 === 0 ? 1 : 0);
    }
    expect(modules[size - 8][8]).toBe(1);
    expect(modules.flat().every((value) => value === 0 || value === 1)).toBe(true);
  });

  it("encodes higher versions with version information and alignment patterns", () => {
    const { version, size, modules } = encodeQr("x".repeat(150));
    expect(version).toBeGreaterThanOrEqual(8);
    expect(size).toBe(17 + 4 * version);
    // alignment pattern centre for v8 is at (42, 42): dark centre, light ring, dark border
    const centre = version === 8 ? 42 : version === 9 ? 46 : 50;
    expect(modules[centre][centre]).toBe(1);
    expect(modules[centre - 1][centre]).toBe(0);
    expect(modules[centre - 2][centre]).toBe(1);
  });

  it("renders an SVG with a quiet zone and optional label", () => {
    const svg = qrToSvg("A-101", { moduleSize: 4, label: "A-101 · Ground floor" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain("A-101 · Ground floor");
    const size = 17 + 4 * 1;
    expect(svg).toContain(`width="${(size + 8) * 4}"`);
  });
});
