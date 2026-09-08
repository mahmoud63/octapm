-- Company name matching key (OCTA-ADM-DEDUPE-061).
--
-- Company is unique on (orgId, name), so two identical names cannot both
-- exist — but "ABC Steel LLC" and "abc steel llc" are different strings, so
-- both did. A duplicate company carries no prequalification, no performance
-- history and no insurance, so one silently defeats three of the controls
-- built on top of the directory.
--
-- Indexed, NOT unique, deliberately: an existing directory may already hold
-- duplicates, and a unique index would make this migration fail on exactly the
-- databases that need it most. Merging existing duplicates is a person's
-- decision, served by GET /company/vendors/duplicates.

ALTER TABLE "Company" ADD COLUMN "nameKey" TEXT;

-- Backfill with the same rule the application uses: lowercase, drop the
-- punctuation that decorates an abbreviation (so "L.L.C." becomes "llc"),
-- turn separating punctuation into a space (so "Al-Rashid" becomes
-- "al rashid"), then collapse whitespace.
--
-- Legal form is deliberately left alone: "ABC Steel LLC" and "ABC Steel Ltd"
-- are different legal entities, and folding them together would be a guess
-- with contractual consequences.
UPDATE "Company"
SET "nameKey" = btrim(
  regexp_replace(
    regexp_replace(
      regexp_replace(lower("name"), '[''''`".]', '', 'g'),
      '[,()\[\]{}\-–—_/\\&+]', ' ', 'g'
    ),
    '\s+', ' ', 'g'
  )
)
WHERE "name" IS NOT NULL;

CREATE INDEX "Company_orgId_nameKey_idx" ON "Company"("orgId", "nameKey");
