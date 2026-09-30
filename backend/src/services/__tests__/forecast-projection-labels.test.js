/**
 * Owner decision R5-1: the forecast's projected finish and slip are a
 * projection, never an approved extension of time, and every surface that
 * shows them says so. A source check over those surfaces — the forecast
 * service's text builders, the web Forecast panel, and the mobile PM home,
 * general home and project screen — plus the narrative the service builds.
 * Static: no database, no browser.
 */
const fs = require("fs");
const path = require("path");
const { deterministicNarrative, forecastBlock } = require("../forecast.service");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const NOT_A_FORECAST = /extension of time|\beot\b|approved delay|granted/i;

// Each surface, and the projection wording it must carry.
const SURFACES = [
  ["backend/src/services/forecast.service.js", ["projected to finish", "projected ${s.projectedFinish"]],
  ["frontend/src/features/forecast/components/forecast-panel.tsx", ["Projected finish", ">Projected slip<", "days of projected slip"]],
  ["mobile/src/home/PmHome.tsx", ['label="Projected slip"', "Longest projected slip", "Projected finish"]],
  ["mobile/src/home/GeneralHome.tsx", ["label: 'Projected slip'"]],
  ["mobile/app/(app)/project.tsx", ['label="Projected slip"', "Longest projected slip", "Projected finish"]],
];

describe("R5-1: the forecast is labelled a projection, never an extension of time", () => {
  it.each(SURFACES)("%s says projected and never EOT, extension of time, approved delay or granted", (file, wording) => {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(source.split(/\r?\n/).filter((line) => NOT_A_FORECAST.test(line))).toEqual([]);
    for (const text of wording) expect(source).toContain(text);
    // A bare "Slip" label beside a projected figure reads as a fact.
    expect(source).not.toMatch(/label[=:]\s*['"]Slip['"]|>Slip</);
  });

  it("the narrative and the model's text call the finish projected", () => {
    const forecast = {
      asOf: "2026-09-30T00:00:00.000Z",
      schedule: { plannedFinish: "2027-04-08", projectedFinish: "2027-05-23", slipDays: 45, basis: "activities", spi: null, cpi: null, counts: { open: 5, critical: 5 }, criticalDriver: { id: "x", name: "Blockwork walls", slipDays: 60 }, topRisks: [] },
      cost: { budget: 0, eac: null, eacBasis: null, bottomUp: 0, projected: 0, overrun: 0, actual: 0, counts: { lines: 0 }, topRisks: [], budgetLines: [] },
      dataQuality: [],
      activities: [],
    };
    const narrative = deterministicNarrative(forecast);
    expect(narrative.headline).toBe("The project is projected to finish 45 days late.");
    const block = forecastBlock(forecast, "Project");
    expect(block).toContain("planned finish 2027-04-08, projected 2027-05-23 (45 days late");
    expect(`${JSON.stringify(narrative)}\n${block}`).not.toMatch(NOT_A_FORECAST);
  });
});
