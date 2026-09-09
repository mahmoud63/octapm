-- One counter per reference family per scope (OCTA-API-REFNUM-111).
--
-- Registers numbered themselves `count + 1`, which collides the moment a row
-- is deleted. `MAX + 1` closes the gap but not the race: two creates reading
-- the same maximum still produce the same reference. This table is advanced by
-- a single atomic statement instead, so concurrent callers cannot be handed
-- the same number whether or not either sits in a transaction.
--
-- Seeded lazily, from the highest reference already issued the first time a
-- scope is used, so every reference that exists today keeps its number.
CREATE TABLE IF NOT EXISTS "ReferenceCounter" (
    "scope" TEXT NOT NULL,
    "next" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceCounter_pkey" PRIMARY KEY ("scope")
);
