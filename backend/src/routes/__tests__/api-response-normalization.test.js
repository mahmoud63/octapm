const fs = require("fs");
const path = require("path");

const routesDir = path.resolve(__dirname, "..");

const routeFiles = fs
  .readdirSync(routesDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(routesDir, name));

describe("route response normalization", () => {
  it("does not hand-roll success envelopes in production route files", () => {
    const offenders = routeFiles.flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /res\.(status\([^)]*\)\.)?json\(\{ success/.test(source)
        ? [path.relative(routesDir, file)]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  it("uses asyncHandler instead of route-level try/catch forwarding", () => {
    const offenders = routeFiles.flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /return next\(error\);/.test(source)
        ? [path.relative(routesDir, file)]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
