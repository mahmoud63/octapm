/**
 * Owner decision R5-1: the forecast's projected finish and slip are a
 * projection, never an approved extension of time, and every surface that
 * shows them says so. A source check over those surfaces — the forecast
 * service's text builders, the web Forecast panel, and the mobile PM home,
 * general home and project screen — plus the narrative the service builds.
 * Static: no database, no browser. The rendered text is held elsewhere: the
 * mobile screens by mobile/src/testing/screens/home.test.tsx and
 * project.test.tsx, the web panel by
 * frontend/e2e/67-forecast-panel-dates.spec.ts.
 */
const fs = require("fs");
const path = require("path");
const { deterministicNarrative, forecastBlock } = require("../forecast.service");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const NOT_A_FORECAST = /extension of time|\beot\b|approved delay|granted/i;

// Each surface, and the projection wording it must carry.
const SURFACES = [
  ["backend/src/services/forecast.service.js", ["projected to finish", "projected ${s.projectedFinish"]],
  ["frontend/src/features/forecast/components/forecast-panel.tsx", ["Projected finish", ">Projected slip<", "days of projected slip", "+{activity.impactDays} d recorded impact", "{RECORDED_IMPACT_LEGEND}"]],
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

  it("the web panel says what the second figure under Projected slip is — never a bare (+N)", () => {
    const source = fs.readFileSync(path.join(ROOT, "frontend/src/features/forecast/components/forecast-panel.tsx"), "utf8");
    // The bare bracket read as an unexplained second slip beside "—".
    expect(source).not.toContain("(+${activity.impactDays})");
    expect(source).not.toContain("(+{activity.impactDays})");
    const legend = source.match(/const RECORDED_IMPACT_LEGEND =\s*'([^']+)'/)?.[1] || "";
    expect(legend).toContain("recorded impact");
    expect(legend).toContain("projected slip plus its recorded impact");
    expect(legend).not.toMatch(NOT_A_FORECAST);
    // Shown under the table and as the figure's tooltip.
    expect(source).toContain("title={RECORDED_IMPACT_LEGEND}");
    expect(source).toContain("data-testid='uat-forecast-slip-legend'");
    expect(source.match(/\{RECORDED_IMPACT_LEGEND\}/g)).toHaveLength(2);
  });

  it("the health card names the approved change-order schedule impact for what it is — never \"Approved delay\"", () => {
    // routes/health.js sums the approved change orders' schedule-impact days
    // (the order's own days and its activity links' approved days) into
    // approvedScheduleImpactDays. The health card labelled that sum "Approved
    // delay", which read as a granted extension of time (R5-1, residual).
    const file = "frontend/src/features/projects/components/health-dashboard.tsx";
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(source).not.toMatch(/approved delay/i);
    expect(source).toContain("approvedScheduleImpactDays: 'Approved change-order schedule impact'");
    // The unit says the days are as entered on the orders, singular and plural.
    expect(source).toMatch(/approvedScheduleImpactDays: \(value\) =>\s*`\$\{value === 1 \? 'day' : 'days'\} \(as entered\)`/);
    // The hint, and what it must say.
    const hint = source.match(/approvedScheduleImpactDays:\s*"([^"]+)",\s*\}/)?.[1] || "";
    expect(hint).toContain("sum of the approved change orders' schedule-impact days, as entered on them");
    expect(hint).toContain("not a granted extension of time");
    expect(hint).toContain("not the projected slip");
    // ... rendered under the figure and as the row's tooltip.
    expect(source).toContain("hint: METRIC_HINTS[key]");
    expect(source).toContain("data-testid={`uat-health-metric-hint-${dimensionKey}-${metric.key}`}");
    expect(source).toContain("{metric.hint}");
    expect(source).toContain("metric.reason ?? metric.hint");
    // The card's other wording never grants: a line that names an extension
    // of time, EOT or a grant only ever denies it.
    const granting = source
      .split(/\r?\n/)
      .filter((line) => NOT_A_FORECAST.test(line))
      .filter((line) => !/\b(not|never)\b/i.test(line));
    expect(granting).toEqual([]);
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
