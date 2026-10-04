#!/usr/bin/env node
/**
 * Refuses `prisma generate` when the generated client would land outside this
 * checkout.
 *
 * Several git worktrees on one machine share one installed node_modules
 * through directory junctions/symlinks. `prisma generate` writes the generated
 * client next to whichever `@prisma/client` it resolves — so in a worktree
 * whose `@prisma/client` is a junction, it rewrites the client every other
 * worktree (and every running certification script) loads. And when
 * `@prisma/client` cannot be resolved at all, Prisma runs `npm install` on its
 * own, which replaces a junctioned node_modules folder with a fresh partial
 * install. Both happened on 2026-10-04 (docs/platform/OCTAPM_PRISMA_CLIENT_INCIDENT_2026-10-04.md).
 *
 * The rule: `@prisma/client` and the generated `.prisma/client` must both
 * resolve, after following every link, to a folder inside this checkout.
 * A worktree that shares the rest of node_modules keeps real (unlinked) copies
 * of `node_modules/@prisma/client` and `node_modules/.prisma`.
 *
 * Usage: `npm run prisma:generate` (guard, then generate), or
 *        `node scripts/db/prisma-client-guard.js` to check only.
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const isInside = (child, parent) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const realOrNull = (target) => {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
};

/**
 * @param {string} backendDir the backend folder of the checkout being generated
 * @returns {{ ok: boolean, problems: string[], checkoutRoot: string, clientPackage: string|null, generatedClient: string|null }}
 */
const inspectPrismaClient = (backendDir) => {
  const checkoutRoot = realOrNull(path.resolve(backendDir, "..")) || path.resolve(backendDir, "..");
  const problems = [];
  let clientPackage = null;
  let generatedClient = null;
  try {
    const resolved = createRequire(path.join(backendDir, "package.json")).resolve("@prisma/client");
    clientPackage = realOrNull(path.dirname(resolved));
  } catch {
    problems.push(
      "@prisma/client does not resolve from backend/. `prisma generate` would run `npm install` on its own and replace a linked node_modules folder.",
    );
  }
  if (clientPackage) {
    if (!isInside(clientPackage, checkoutRoot)) {
      problems.push(
        `@prisma/client resolves to ${clientPackage}, outside this checkout (${checkoutRoot}); generating would rewrite the client other worktrees load.`,
      );
    }
    const generatedLink = path.join(clientPackage, "..", "..", ".prisma", "client");
    generatedClient = realOrNull(generatedLink) || path.resolve(generatedLink);
    if (!isInside(generatedClient, checkoutRoot)) {
      problems.push(`the generated client folder ${generatedClient} is outside this checkout.`);
    }
  }
  return { ok: problems.length === 0, problems, checkoutRoot, clientPackage, generatedClient };
};

if (require.main === module) {
  const result = inspectPrismaClient(path.resolve(__dirname, "..", ".."));
  if (!result.ok) {
    process.stderr.write(
      `prisma-client-guard: REFUSED\n${result.problems.map((p) => `  - ${p}`).join("\n")}\n` +
        "  Give this checkout its own copies of node_modules/@prisma/client and node_modules/.prisma " +
        "(see the header of backend/scripts/db/prisma-client-guard.js).\n",
    );
    process.exit(1);
  }
  process.stdout.write(`prisma-client-guard: ok — client generated into ${result.generatedClient}\n`);
}

module.exports = { inspectPrismaClient, isInside };
