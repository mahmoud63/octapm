-- IpcItem had no createdAt, but getIpcPeriod orders items by
-- [boqItem.sortOrder, createdAt]. Prisma rejected the query, so every read of
-- an IPC period — and therefore every attempt to create one — returned 500.
--
-- Existing rows take the migration's own timestamp; within a BOQ item that
-- leaves them tied, which falls back to insertion order, and that is the order
-- they were meant to be in anyway.

-- AlterTable
ALTER TABLE "IpcItem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
