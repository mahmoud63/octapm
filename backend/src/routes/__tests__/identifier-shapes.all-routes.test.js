/**
 * CERT-2 "wrongly shaped identifiers", every route at once: express-validator's
 * standard validators check an array element by element, so a field checked
 * with `isUUID()` alone accepts `["<id>"]` and `[["<id>"]]` (and, for a `.*`
 * element field, `[["<id>"]]` as an element). Such a value reached the
 * services, where Prisma threw (500) or a check that skipped non-strings let
 * another company's identifier through.
 *
 * This test walks every router in src/routes, finds each validation chain on
 * a body field that carries `isUUID()`, and runs that chain on the field set
 * to `["<id>"]`, `[["<id>"]]` and the plain identifier: the first two must be
 * refused on that field, the plain identifier must pass it. A new chain that
 * forgets `.isString()` before `.isUUID()` fails here by name.
 *
 * Routers of the groups that own them in this certification round are left
 * to their own tests (OTHER_GROUPS).
 */
const fs = require("fs");
const path = require("path");
const validatorLib = require("validator");

// Owned by other certification groups (daily reports, timesheets): their
// identifier shapes are fixed and pinned there. Inventory, procurement and
// activities are pinned here since their last body chains (lines.*.id,
// lines.*.boqItemId …, dependencies.*.predecessorId, entryIds.*) took
// .isString() (CERT-2 bodies-4).
const OTHER_GROUPS = new Set(["daily-reports.js", "timesheets.js"]);
const ID = "22222222-2222-4222-8222-222222222222";
const routesDir = path.join(__dirname, "..");

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

// Every validation chain of a router (its own routes and router-level chains,
// and the routers it nests that are not another route file's export).
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

const files = fs.readdirSync(routesDir).filter((file) => file.endsWith(".js"));
const routers = new Map(files.map((file) => [file, require(path.join(routesDir, file))]));
const cases = [];
for (const [file, router] of routers) {
  if (OTHER_GROUPS.has(file) || !router?.stack) continue;
  const foreign = new Set([...routers].filter(([other, r]) => other !== file && r?.stack).map(([, r]) => r));
  const seen = new Set();
  for (const { route, chain } of chainsOf(router, foreign)) {
    const context = chain.builder.build();
    if (!context.locations.includes("body") || !context.stack.some((item) => item.validator === validatorLib.isUUID)) continue;
    for (const field of context.fields) {
      const key = `${file} ${route} ${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push([key, chain, field]);
    }
  }
}

const refusedOn = async (chain, field, value) => {
  const result = await chain.run({ body: bodyOf(field, JSON.parse(JSON.stringify(value))) });
  return result.array().some((error) => error.path === errorPath(field));
};

describe("every body identifier field refuses a value that is not one string (CERT-2 shapes, all routes)", () => {
  it("finds the identifier fields of the routers", () => {
    // Several hundred chains across the routers; a walk that finds none is broken.
    expect(cases.length).toBeGreaterThan(400);
  });

  test.each(cases)("%s", async (_key, chain, field) => {
    expect(await refusedOn(chain, field, [ID])).toBe(true);
    expect(await refusedOn(chain, field, [[ID]])).toBe(true);
    expect(await refusedOn(chain, field, ID)).toBe(false);
  });
});
