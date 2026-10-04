/**
 * CERT-2 "wrongly shaped query parameters", every route at once.
 *
 * express-validator's standard validators (isUUID, isIn, isInt, isISO8601,
 * matches …) check an array element by element: ?x=a&x=b arrives as ["a","b"]
 * and every element is validated, so query("x").isUUID() PASSES the array and
 * it reaches a Prisma `where` as a value Prisma cannot bind — a 500. The fix
 * is query("x").isString() before the format check, so a non-string value is
 * refused on that field.
 *
 * This test walks every router in src/routes, finds each validation chain on a
 * `query` field, and runs it with the field set to an array (["x","x"], the
 * shape of a parameter sent twice). Every query field must refuse it; a chain
 * that forgets .isString() fails here by name. For a query field that checks
 * .isUUID() a plain identifier must still pass, so a legitimate scalar is not
 * broken by the guard.
 */
const fs = require("fs");
const path = require("path");
const validatorLib = require("validator");

const ID = "22222222-2222-4222-8222-222222222222";
const routesDir = path.join(__dirname, "..");

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
  if (!router?.stack) continue;
  const foreign = new Set([...routers].filter(([other, r]) => other !== file && r?.stack).map(([, r]) => r));
  const seen = new Set();
  for (const { route, chain } of chainsOf(router, foreign)) {
    const context = chain.builder.build();
    if (!context.locations.includes("query")) continue;
    const isId = context.stack.some((item) => item.validator === validatorLib.isUUID);
    for (const field of context.fields) {
      // Element sub-fields (x.*) are exercised through their parent array.
      if (field.includes("*") || field.includes("[")) continue;
      const key = `${file} ${route} ${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push([key, chain, field, isId]);
    }
  }
}

const refusedOn = async (chain, field, value) => {
  const result = await chain.run({ query: { [field]: value } });
  return result.array().some((error) => error.path === field);
};

describe("every query parameter refuses a value that is not one string (CERT-2 query shapes, all routes)", () => {
  it("finds the query fields of the routers", () => {
    expect(cases.length).toBeGreaterThan(200);
  });

  test.each(cases)("%s", async (_key, chain, field, isId) => {
    // Sent twice (an array) and sent as a nested array: both refused on the field.
    expect(await refusedOn(chain, field, [ID, ID])).toBe(true);
    expect(await refusedOn(chain, field, [[ID]])).toBe(true);
    // A legitimate scalar identifier still passes an id field.
    if (isId) expect(await refusedOn(chain, field, ID)).toBe(false);
  });
});
