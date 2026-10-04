/**
 * CERT-2 (bodies-4): what the route validators refuse at the door.
 *
 * DATES. isISO8601() (like isUUID()) checks an array element by element, so
 * [] — no element to fail — passed every body date check that had no
 * .isString() before it, and the services' new Date([]) reached Prisma as a
 * 500 (82 answers of the date sweep: projects, RFIs, submittals, NCRs, ITPs,
 * safety, drawings, correspondence, change orders, weather delays, EOT
 * links, prime contract, budget revisions, purchase orders, burn rate,
 * weekly reports, material tests, contract notices, photo AI filters). Every
 * body date chain of the routers below is walked: [] and ["2026-10-01"] are
 * refused on the field, "2026-10-01" passes. A new date chain in these files
 * that forgets .isString() fails here by name.
 *
 * FIGURES. A unit cost of 1e15 overflowed the item's Decimal(18,4) price
 * columns (500), a quantity of 1e15 was stored, an order of 1e15 at 100.00
 * overflowed the order's value (500), an hourly rate of 1e20 overflowed the
 * worker's Decimal(18,2) (500): each is refused at the door, the largest the
 * columns hold is not.
 *
 * SHAPES. A bid package's boqSections were String()-ed into text ([["x"]],
 * {"not":"x"}, 5, null); a transfer receipt's line id ["<id>"] was matched to
 * nothing and the line booked in full.
 */
const fs = require("fs");
const path = require("path");
const validatorLib = require("validator");
const { QUANTITY_MAX, UNIT_COST_MAX } = require("../../utils/stock-figures");
const { RATE_MAX } = require("../../services/timesheet.service");

const routesDir = path.join(__dirname, "..");
const files = fs.readdirSync(routesDir).filter((file) => file.endsWith(".js"));
const routers = new Map(files.map((file) => [file, require(path.join(routesDir, file))]));

const chainsOf = (router, foreign) => {
  const out = [];
  for (const layer of router.stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]).join(",").toUpperCase();
      for (const sub of layer.route.stack) if (sub.handle?.builder) out.push({ route: `${methods} ${layer.route.path}`, chain: sub.handle });
    } else if (layer.handle?.stack && !foreign.has(layer.handle)) {
      out.push(...chainsOf(layer.handle, foreign));
    } else if (layer.handle?.builder) {
      out.push({ route: "router.use", chain: layer.handle });
    }
  }
  return out;
};
const chainsOfFile = (file) => {
  const foreign = new Set([...routers].filter(([other, r]) => other !== file && r?.stack).map(([, r]) => r));
  return chainsOf(routers.get(file), foreign);
};
const bodyOf = (field, value) => {
  const parts = field.split(".");
  const root = {};
  let node = root;
  parts.forEach((part, i) => {
    const next = i === parts.length - 1 ? value : parts[i + 1] === "*" ? [] : {};
    if (part === "*") node.push(next);
    else node[part] = next;
    node = next;
  });
  return root;
};
const errorPath = (field) => field.replace(/\.\*/g, "[0]");
const refusedOn = async (chain, field, value) => {
  const result = await chain.run({ body: bodyOf(field, JSON.parse(JSON.stringify(value))) });
  return result.array().some((error) => error.path === errorPath(field));
};
/** The chain of `file` on `route` ("POST /stock/receive") that checks `field`. */
const chainFor = (file, route, field) => {
  const found = chainsOfFile(file).find((c) => c.route === route && c.chain.builder.build().fields.includes(field));
  if (!found) throw new Error(`no chain for ${file} ${route} ${field}`);
  return found.chain;
};

// ── dates ─────────────────────────────────────────────────────────────────
const DATE_FILES = [
  "activities.js", "bids.js", "budget-revisions.js", "change-orders.js", "contract.js", "correspondence.js", "cost.js",
  "defects.js", "drawings.js", "eot.js", "inventory.js", "itp.js", "material-tests.js", "ncr.js", "photo-assistant.js",
  "prime-contract.js", "procurement.js", "project-emails.js", "projects.js", "purchase-orders.js", "rfi.js", "safety.js",
  "submittals.js", "weather-delays.js", "weekly-reports.js",
];
const isDateCheck = (item) =>
  [validatorLib.isISO8601, validatorLib.isDate, validatorLib.isRFC3339].includes(item.validator) ||
  item.sanitizer === validatorLib.toDate ||
  (item.validator === validatorLib.matches && /\\d\{4\}/.test(String(item.options?.[0])));
const dateCases = [];
for (const file of DATE_FILES) {
  const seen = new Set();
  for (const { route, chain } of chainsOfFile(file)) {
    const context = chain.builder.build();
    if (!context.locations.includes("body") || !context.stack.some(isDateCheck)) continue;
    for (const field of context.fields) {
      const key = `${file} ${route} ${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dateCases.push([key, chain, field]);
    }
  }
}

describe("every body date field of these routers is one string that is a date (CERT-2 bodies-4)", () => {
  it("finds the date fields", () => {
    expect(dateCases.length).toBeGreaterThan(120);
  });

  test.each(dateCases)("%s", async (_key, chain, field) => {
    expect(await refusedOn(chain, field, [])).toBe(true);
    expect(await refusedOn(chain, field, ["2026-10-01"])).toBe(true);
    expect(await refusedOn(chain, field, "x")).toBe(true);
    expect(await refusedOn(chain, field, "2026-10-01")).toBe(false);
  });
});

// ── figures ───────────────────────────────────────────────────────────────
describe("a figure no larger than its column holds is accepted, a larger one refused at the door (CERT-2 bodies-4)", () => {
  test.each([
    ["inventory.js", "POST /stock/receive", "unitCost", 1e15, UNIT_COST_MAX],
    ["inventory.js", "POST /stock/receive", "quantity", 1e15, QUANTITY_MAX],
    ["inventory.js", "POST /stock/receive", "damagedQty", 1e15, QUANTITY_MAX],
    ["inventory.js", "POST /stock/adjust", "quantity", -1e15, -QUANTITY_MAX],
    ["inventory.js", "POST /stock/issue", "quantity", 1e15, QUANTITY_MAX],
    ["inventory.js", "POST /stock/reserve", "quantity", 1e15, QUANTITY_MAX],
    ["inventory.js", "POST /items", "unitCost", 1e15, UNIT_COST_MAX],
    ["inventory.js", "POST /transfers", "lines.*.quantity", 1e15, QUANTITY_MAX],
    ["inventory.js", "POST /transfers/:transferId/receive", "lines.*.receivedQty", 1e15, QUANTITY_MAX],
    ["inventory.js", "POST /goods-receipt", "lines.*.unitCost", 1e15, UNIT_COST_MAX],
    ["inventory.js", "POST /goods-receipt", "lines.*.acceptedQty", 1e15, QUANTITY_MAX],
    ["procurement.js", "POST /purchase-orders/:orderId/receipts", "lines.*.unitCost", 1e15, UNIT_COST_MAX],
    ["procurement.js", "POST /purchase-orders/:orderId/receipts", "lines.*.acceptedQty", 1e15, QUANTITY_MAX],
    ["procurement.js", "POST /purchase-orders", "lines.*.orderedQty", 1e15, QUANTITY_MAX],
    ["timesheets.js", "POST /workers", "hourlyRate", 1e20, RATE_MAX],
    ["timesheets.js", "PATCH /workers/:workerId", "hourlyRate", 1e20, RATE_MAX],
  ])("%s %s %s: %d refused, %d accepted", async (file, route, field, tooLarge, largest) => {
    const chain = chainFor(file, route, field);
    expect(await refusedOn(chain, field, tooLarge)).toBe(true);
    expect(await refusedOn(chain, field, largest)).toBe(false);
  });
});

// ── shapes ────────────────────────────────────────────────────────────────
describe("a bid package's BOQ sections are names (CERT-2 bodies-4)", () => {
  test.each([
    ["bids.js", "POST /"],
    ["bids.js", "PATCH /:packageId"],
    ["procurement.js", "POST /packages/:packageId/quotes"],
  ])("%s %s boqSections.*: [\"x\"], {\"not\":\"x\"}, 5 and null refused; a name and the no-section key accepted", async (file, route) => {
    const chain = chainFor(file, route, "boqSections.*");
    for (const value of [["x"], { not: "x" }, 5, null]) expect(await refusedOn(chain, "boqSections.*", value)).toBe(true);
    for (const value of ["02 Substructure", ""]) expect(await refusedOn(chain, "boqSections.*", value)).toBe(false);
  });
});

describe("a transfer receipt's line names one line, as one string (CERT-2 bodies-4)", () => {
  it("lines.*.id: [\"<id>\"], [[\"<id>\"]], 12345 and a missing id are refused; the id is accepted", async () => {
    const chain = chainFor("inventory.js", "POST /transfers/:transferId/receive", "lines.*.id");
    const id = "22222222-2222-4222-8222-222222222222";
    for (const value of [[id], [[id]], 12345]) expect(await refusedOn(chain, "lines.*.id", value)).toBe(true);
    const missing = await chain.run({ body: { lines: [{ receivedQty: 1 }] } });
    expect(missing.array().some((error) => error.path === "lines[0].id")).toBe(true);
    expect(await refusedOn(chain, "lines.*.id", id)).toBe(false);
  });
});
