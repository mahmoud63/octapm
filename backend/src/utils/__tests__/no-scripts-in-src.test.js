const fs = require("fs");
const path = require("path");

/**
 * Nothing under src may require backend/scripts.
 *
 * The container image ships src and prisma/seed.js and not backend/scripts,
 * so a require from a service into scripts/ resolves on a developer machine
 * and fails in the image. The one that existed (sign-up reaching for the slug
 * helper in scripts/enterprise/lib.js) swallowed the failure and created
 * workspaces with no URL handle — which nothing local ever saw.
 */
const SRC = path.resolve(__dirname, "..", "..");
const SKIP = new Set(["__tests__", "__live__", "node_modules"]);

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
};

describe("src never reaches into backend/scripts", () => {
  it("has no require of a scripts/ path", () => {
    const offenders = walk(SRC).filter((file) =>
      /require\(\s*["'][^"']*\/scripts\//.test(fs.readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });
});
