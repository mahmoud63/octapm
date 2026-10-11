jest.mock("../../../config/db", () => ({ prisma: {} }));

const { detectSpikes } = require("../platform-health.service");

const NOW = new Date("2026-10-14T12:00:00Z");
const day = (iso) => new Date(`${iso}T00:00:00Z`);

describe("detectSpikes (pre-merge review CX-6)", () => {
  test("one bad day among thirteen quiet ones is a spike (quiet days count as zero)", () => {
    expect(detectSpikes([{ day: day("2026-10-10"), n: 100 }], { days: 14, now: NOW })).toEqual(["2026-10-10"]);
  });

  test("a steady level is not a spike", () => {
    const daily = Array.from({ length: 14 }, (_, i) => ({ day: day(`2026-10-${String(i + 1).padStart(2, "0")}`), n: 50 }));
    expect(detectSpikes(daily, { days: 14, now: NOW })).toEqual([]);
  });

  test("fewer than ten errors is never a spike", () => {
    expect(detectSpikes([{ day: day("2026-10-12"), n: 9 }], { days: 14, now: NOW })).toEqual([]);
  });

  test("days outside the window are ignored; string days are accepted", () => {
    expect(detectSpikes([{ day: "2026-09-01T00:00:00.000Z", n: 500 }, { day: "2026-10-14T00:00:00.000Z", n: 40 }], { days: 14, now: NOW })).toEqual(["2026-10-14"]);
  });
});
