const fs = require("fs");
const os = require("os");
const path = require("path");
const { inspectPrismaClient, isInside } = require("../prisma-client-guard");

// A fake checkout: <root>/backend/package.json and <root>/node_modules/...
const makeCheckout = (base, name) => {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, "backend"), { recursive: true });
  fs.writeFileSync(path.join(root, "backend", "package.json"), "{}");
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  return root;
};
const makeClientPackage = (nodeModules) => {
  const pkg = path.join(nodeModules, "@prisma", "client");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@prisma/client", main: "index.js" }));
  fs.writeFileSync(path.join(pkg, "index.js"), "module.exports = {};");
  fs.mkdirSync(path.join(nodeModules, ".prisma", "client"), { recursive: true });
};
const link = (target, at) => fs.symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");

describe("prisma-client-guard", () => {
  let base;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "prisma-guard-"));
  });
  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  test("isInside", () => {
    expect(isInside(path.join("a", "b"), "a")).toBe(true);
    expect(isInside("a", "a")).toBe(true);
    expect(isInside("b", "a")).toBe(false);
  });

  test("a checkout with its own @prisma/client and .prisma passes", () => {
    const root = makeCheckout(base, "wt");
    makeClientPackage(path.join(root, "node_modules"));
    const result = inspectPrismaClient(path.join(root, "backend"));
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("a node_modules linked to another checkout is refused (the 2026-10-04 incident)", () => {
    const shared = makeCheckout(base, "shared");
    makeClientPackage(path.join(shared, "node_modules"));
    const root = makeCheckout(base, "wt");
    fs.rmdirSync(path.join(root, "node_modules"));
    link(path.join(shared, "node_modules"), path.join(root, "node_modules"));
    const result = inspectPrismaClient(path.join(root, "backend"));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/outside this checkout/);
  });

  test("a private @prisma/client whose .prisma is linked elsewhere is refused", () => {
    const shared = makeCheckout(base, "shared");
    fs.mkdirSync(path.join(shared, "node_modules", ".prisma", "client"), { recursive: true });
    const root = makeCheckout(base, "wt");
    makeClientPackage(path.join(root, "node_modules"));
    fs.rmSync(path.join(root, "node_modules", ".prisma"), { recursive: true });
    link(path.join(shared, "node_modules", ".prisma"), path.join(root, "node_modules", ".prisma"));
    const result = inspectPrismaClient(path.join(root, "backend"));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/generated client folder/);
  });

  test("an unresolvable @prisma/client is refused (Prisma would npm install over the folder)", () => {
    const root = makeCheckout(base, "wt");
    const result = inspectPrismaClient(path.join(root, "backend"));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/does not resolve/);
  });
});
