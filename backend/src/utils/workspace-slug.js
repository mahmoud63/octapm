/**
 * A workspace's URL handle.
 *
 * One spelling for every path that names a workspace — sign-up, the seed and
 * the backfill of rows that predate the column — so "ABC Construction" is
 * `abc-construction` wherever it was made. The helpers live under src because
 * the container image ships src and prisma/seed.js but not backend/scripts:
 * a require from a service into scripts/ resolved on a developer machine and
 * failed in the image, and sign-up swallowed the failure and created
 * workspaces with no handle at all.
 */

/**
 * ASCII letters and digits, hyphens between words, at most 48 characters,
 * never empty. Diacritics are folded ("Société" → "societe") so an accent does
 * not become a hyphen. Uniqueness is the caller's job — a workspace name is
 * not unique, so `nextFreeSlug` appends a number when the base is taken.
 */
const slugifyName = (name) => {
  const base = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return base || "workspace";
};

/** The first free slug for a base, given the ones already taken. */
const nextFreeSlug = (base, taken) => {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/** Every slug the platform holds right now. */
const takenSlugs = async (prisma) =>
  new Set(
    (await prisma.organisation.findMany({ where: { slug: { not: null } }, select: { slug: true } })).map(
      (row) => row.slug,
    ),
  );

/** A free slug for a new workspace with this name. */
const allocateSlug = async (prisma, name) => nextFreeSlug(slugifyName(name), await takenSlugs(prisma));

module.exports = { allocateSlug, nextFreeSlug, slugifyName, takenSlugs };
