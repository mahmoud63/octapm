/**
 * What every enterprise migration script shares: the flag parser, the slug
 * rule, and the one machine-readable line each script ends with.
 *
 * The scripts under this folder are the M2-M9 steps of the enterprise
 * programme (docs/architecture/OCTAPM_ENTERPRISE_WAVE_PLAN.md §1). Each one
 * reports by default and writes only with --apply, prints counts before and
 * after, and is idempotent: a second --apply finds nothing left to do. `--org
 * <id>` narrows a run to one organisation, which is how the live tests keep
 * their assertions inside a throwaway organisation while the other waves share
 * the same database.
 *
 * The last line a script prints is `RESULT <json>` so a test, or an operator's
 * pipeline, can read the outcome without scraping the human lines above it.
 */
const os = require("os");
const path = require("path");

const parseArgs = (argv = process.argv.slice(2)) => {
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1] ?? null;
  };
  const apply = argv.includes("--apply");
  return {
    apply,
    dryRun: !apply,
    orgId: valueOf("--org"),
    jsonPath: valueOf("--json"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
};

// The slug spelling lives in src (the image ships src, not scripts), and the
// three helpers are re-exported here so the backfill keeps its imports.
const { nextFreeSlug, slugifyName, takenSlugs } = require("../../src/utils/workspace-slug");

/**
 * Writes the planned slugs, one organisation at a time, touching only rows
 * whose slug is still NULL. Each assignment is `{ orgId, name, slug }`; on
 * return `slug` is what was written, or `skipped` is set when another process
 * filled the column meanwhile.
 *
 * Another process may also claim the planned slug between plan and write. The
 * unique index answers with P2002; the row then gets the next free suffix of
 * its own base, re-read from the database — never a suffix chained onto the
 * suffix ("other-corp-contracting-2-2"), which would be a handle no one
 * planned while the base's next number stayed unused.
 */
const writeSlugs = async (prisma, assignments) => {
  for (const row of assignments) {
    let slug = row.slug;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        // updateMany, not update: a unique-where cannot say "slug IS NULL",
        // and a count of 0 means someone filled it meanwhile — nothing to do.
        const { count: written } = await prisma.organisation.updateMany({ where: { id: row.orgId, slug: null }, data: { slug } });
        if (written) row.slug = slug;
        else row.skipped = true;
        break;
      } catch (error) {
        if (error.code !== "P2002") throw error;
        const taken = await takenSlugs(prisma);
        taken.add(slug);
        slug = nextFreeSlug(slugifyName(row.name), taken);
      }
    }
  }
  return assignments;
};

const printHeader = (title, { apply, orgId }) => {
  console.log(`${title} — ${apply ? "APPLY" : "DRY RUN (nothing is written)"}${orgId ? ` — organisation ${orgId}` : ""}\n`);
};

const printCounts = (label, counts) => {
  console.log(`${label}:`);
  for (const [key, value] of Object.entries(counts)) {
    console.log(`   ${String(key).padEnd(28)} ${typeof value === "number" ? value.toLocaleString("en-US") : value}`);
  }
};

const printResult = (result) => {
  console.log(`RESULT ${JSON.stringify(result)}`);
};

/** The RESULT line of a script's output, parsed; null when there is none. */
const parseResult = (output) => {
  const line = String(output ?? "")
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.startsWith("RESULT "));
  return line ? JSON.parse(line.slice("RESULT ".length)) : null;
};

/** Where a report lands when the operator does not say: the OS temp folder, never the repository. */
const defaultReportPath = (name) =>
  path.join(os.tmpdir(), `octapm-${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

module.exports = {
  defaultReportPath,
  nextFreeSlug,
  parseArgs,
  parseResult,
  printCounts,
  printHeader,
  printResult,
  slugifyName,
  takenSlugs,
  writeSlugs,
};
