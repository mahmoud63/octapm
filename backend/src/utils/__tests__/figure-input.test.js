const { body, validationResult } = require("express-validator");
const { scalarFigure, isScalarFigure } = require("../figure-input");
const { moneyBody } = require("../money");

/**
 * CERT-2: isFloat() / isInt() check an array element by element, and the
 * services read a figure with Number(x) || 0 — a transfer receipt's
 * receivedQty [1,1] booked 0 received and wrote the units off; acceptedQty
 * [1,1] stored a delivery receipt with no lines. A figure is one value.
 */
describe("figure input (CERT-2)", () => {
  it.each([0, 1, -2.5, 1e6, "3", "0.25", ""])("isScalarFigure accepts the one value %j (its format is the next check's)", (value) => {
    expect(isScalarFigure(value)).toBe(true);
    expect(scalarFigure(value)).toBe(true);
  });

  it.each([[[1, 1]], [[5]], [[]], [{ n: 1 }], [true], [null], [undefined]])("isScalarFigure refuses %j", (value) => {
    expect(isScalarFigure(value)).toBe(false);
    expect(() => scalarFigure(value)).toThrow("must be a single number");
  });

  const run = async (chain, value) => {
    const req = { body: { lines: [{ qty: value }] } };
    await chain.run(req);
    return { errors: validationResult(req).array(), body: req.body };
  };

  it("isFloat alone lets [1,1], [5] and [] through; with scalarFigure each is refused naming the field", async () => {
    for (const value of [[1, 1], [5], []]) {
      const bare = await run(body("lines.*.qty").optional().isFloat({ min: 0 }), value);
      expect(bare.errors).toEqual([]); // the hole this closes
      const guarded = await run(body("lines.*.qty").optional().custom(scalarFigure).isFloat({ min: 0 }), value);
      expect(guarded.errors.map((e) => e.path)).toEqual(["lines[0].qty"]);
    }
  });

  it("a number and a numeric string still pass, and an out-of-range one is still refused by the format check", async () => {
    const chain = () => body("lines.*.qty").optional().custom(scalarFigure).isFloat({ min: 0, max: 10 }).toFloat();
    expect((await run(chain(), 2)).errors).toEqual([]);
    const fromText = await run(chain(), "2.5");
    expect(fromText.errors).toEqual([]);
    expect(fromText.body.lines[0].qty).toBe(2.5);
    expect((await run(chain(), 11)).errors.length).toBe(1);
  });

  it("moneyBody refuses a one-element array it used to read as its element", async () => {
    const req = { body: { amount: ["5"] } };
    await moneyBody("amount").run(req);
    expect(validationResult(req).array().map((e) => e.path)).toContain("amount");
    const ok = { body: { amount: "5.25" } };
    await moneyBody("amount").run(ok);
    expect(validationResult(ok).array()).toEqual([]);
    expect(ok.body.amount).toBe(5.25);
  });
});
