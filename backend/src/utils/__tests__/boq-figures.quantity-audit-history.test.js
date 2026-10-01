/**
 * PC-6 (verification finding): GET /audit handed a member without boq:read
 * the per-BOQ-item installed quantities the ledger withholds — a quantity
 * entry's events carry its BOQ item, quantity and unit (the mint from a
 * typed submission also the typed figure and the official figure before
 * it), a progress submission's events the installed and planned quantity,
 * the legacy floor of a floored approval and the figures a skipped mint
 * compared. withheldAuditHistory leaves them out for such a caller and says
 * so; a BOQ reader's history is untouched. The live proof is
 * services/__live__/pc-6-method-authority.live.test.js.
 */
jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { withheldAuditHistory } = require("../boq-figures");

const BOQ = { boq: true, budget: true };
const COST = { boq: false, budget: true };
const NONE = { boq: false, budget: false };

const entrySummary = (status) => ({ activityId: "a-1", boqItemId: "item-1", quantity: 12.375, unitCode: "m3", date: "2026-09-01", source: "daily_log", status });
const event = (id, entityType, parts) => ({ id, source: "audit", entityType, recordType: entityType, entityId: `${entityType}-${id}`, actorId: "u-1", occurredAt: "2026-09-02T10:00:00.000Z", attachments: [], metadata: {}, ...parts });

const entryApproved = () =>
  event("e-approve", "quantity_progress_entry", {
    action: "approved",
    oldStatus: "submitted",
    newStatus: "approved",
    oldSummary: { ...entrySummary("submitted"), submissionId: "s-1" },
    newSummary: { ...entrySummary("approved"), submissionId: "s-1" },
    summary: { transition: "quantity_entry.approve", ...entrySummary("approved"), submissionId: "s-1" },
  });
const entryMinted = () =>
  event("e-mint", "quantity_progress_entry", {
    action: "created",
    oldStatus: null,
    newStatus: "approved",
    oldSummary: null,
    newSummary: { activityId: "a-1", boqItemId: "item-1", quantity: 12.375, unitCode: "m3", source: "submission", status: "approved", submissionId: "s-2", typed: 72.375, officialBefore: 60 },
    summary: { transition: "quantity_entry.mint_from_typed_submission", activityId: "a-1", boqItemId: "item-1", quantity: 12.375, unitCode: "m3", source: "submission", status: "approved", submissionId: "s-2", typed: 72.375, officialBefore: 60 },
  });
const entrySynced = () =>
  event("e-sync", "quantity_progress_entry", {
    action: "updated",
    oldSummary: entrySummary("submitted"),
    newSummary: { ...entrySummary("submitted"), quantity: 14.5, allocationId: "al-1" },
    summary: { transition: "quantity_entry.daily_log_sync", dailyLogId: "log-1", dailyLogQuantityId: "row-1", ...entrySummary("submitted"), quantity: 14.5 },
  });
const submissionSubmitted = () =>
  event("s-submit", "progress_submission", {
    action: "created",
    newStatus: "submitted",
    oldSummary: null,
    newSummary: { activityId: "a-1", status: "submitted", pctComplete: 37.5, method: "quantity", source: "manual", quantityInstalled: 51.625, quantityPlanned: 137.625, quantityUnit: "m3", plannedBasis: "approved_allocations", installedBasis: "approved_entries", quantityEntries: 2, clientQuantityPlannedIgnored: false },
    summary: { transition: "submission.submit", activityId: "a-1", pctComplete: 37.5, method: "quantity", source: "manual", quantityInstalled: 51.625, quantityPlanned: 137.625, quantityUnit: "m3", plannedBasis: "approved_allocations", installedBasis: "approved_entries", quantityEntries: 2, clientQuantityPlannedIgnored: false },
  });
const submissionFloored = () =>
  event("s-floor", "progress_submission", {
    action: "approved",
    oldStatus: "submitted",
    newStatus: "approved",
    oldSummary: { activityId: "a-1", status: "submitted", pctComplete: 70, method: "quantity", source: "manual" },
    newSummary: { activityId: "a-1", status: "approved", pctComplete: 70, method: "quantity", source: "manual", approvedProgressId: "p-2", quantityInstalled: 70.5, quantityPlanned: 211.125, quantityUnit: "m3", plannedBasis: "approved_allocations", installedBasis: "legacy_typed_floor", quantityEntries: 1, legacyFloor: { quantity: 63.375, unitCode: "m3", progressId: "p-1", approvedAt: "2026-08-01T12:00:00.000Z", note: "Legacy typed quantity carried as the floor of the installed figure (PC-6)" } },
    summary: { transition: "submission.approve", activityId: "a-1", activityName: "Pour", pctComplete: 70, method: "quantity", source: "manual", quantityEntries: 1, plannedBasis: "approved_allocations" },
  });
const submissionTyped = (mintSkipped) =>
  event("s-typed", "progress_submission", {
    action: "approved",
    oldStatus: "submitted",
    newStatus: "approved",
    oldSummary: { activityId: "a-1", status: "submitted", pctComplete: 50, method: "quantity", source: "mobile" },
    newSummary: { activityId: "a-1", status: "approved", pctComplete: 50, method: "quantity", source: "mobile", approvedProgressId: "p-3", quantityInstalled: 50, quantityPlanned: 100, quantityUnit: "m3", installedBasis: "client", mintedEntryId: mintSkipped ? null : "e-9", mintSkipped },
    summary: { transition: "submission.approve", activityId: "a-1", activityName: "Pour", pctComplete: 50, method: "quantity", source: "mobile" },
  });
const percentApproved = () =>
  event("s-pct", "progress_submission", {
    action: "approved",
    oldStatus: "submitted",
    newStatus: "approved",
    oldSummary: { activityId: "a-2", status: "submitted", pctComplete: 40, method: "percent", source: "manual" },
    newSummary: { activityId: "a-2", status: "approved", pctComplete: 40, method: "percent", source: "manual", approvedProgressId: "p-4" },
    summary: { transition: "submission.approve", activityId: "a-2", activityName: "Blockwork", pctComplete: 40, method: "percent", source: "manual" },
  });
const dailyLogSubmitted = () =>
  event("d-1", "daily_log", { action: "status_changed", newStatus: "submitted", oldSummary: null, newSummary: null, summary: { transition: "daily_log.submit", quantityEntries: { minted: 2, synced: 0, kept: 0, retired: 0 } } });

const history = () => ({
  events: [entryApproved(), entryMinted(), entrySynced(), submissionSubmitted(), submissionFloored(), submissionTyped({ reason: "The typed figure does not exceed the official installed figure", typed: 50, officialBefore: 60 }), submissionTyped(null), percentApproved(), dailyLogSubmitted()],
  nextCursor: null,
});

const PARTS = ["oldSummary", "newSummary", "summary", "metadata"];
const ENTRY_KEYS = ["quantity", "unitCode", "boqItemId", "allocationId", "typed", "officialBefore"];
const SUBMISSION_KEYS = ["quantityInstalled", "quantityPlanned", "quantityUnit", "legacyFloor"];
const carried = (events, keys) => events.flatMap((row) => PARTS.flatMap((part) => keys.filter((key) => row[part] && Object.prototype.hasOwnProperty.call(row[part], key)).map((key) => `${row.id}:${part}.${key}`)));

describe("withheldAuditHistory — the installed quantities recorded in the history (PC-6)", () => {
  it("hands a BOQ reader the history untouched: the same object", () => {
    const built = history();
    expect(withheldAuditHistory(built, BOQ)).toBe(built);
  });

  it.each([
    ["the cost module, no BOQ", COST],
    ["no BOQ, no cost", NONE],
  ])("a caller with %s keeps every event and loses every per-item figure, each event naming what was left out", (_label, access) => {
    const built = history();
    const given = withheldAuditHistory(built, access);
    expect(given.events.map((row) => row.id)).toEqual(built.events.map((row) => row.id));
    const entries = given.events.filter((row) => row.entityType === "quantity_progress_entry");
    const submissions = given.events.filter((row) => row.entityType === "progress_submission");
    expect(carried(entries, ENTRY_KEYS)).toEqual([]);
    expect(carried(submissions, SUBMISSION_KEYS)).toEqual([]);
    // No planted figure, item or allocation is left anywhere.
    expect(JSON.stringify(given)).not.toMatch(/item-1|al-1|12\.375|14\.5|72\.375|51\.625|137\.625|70\.5|211\.125|63\.375|"officialBefore":|"typed":/);

    const byId = Object.fromEntries(given.events.map((row) => [row.id, row]));
    // An entry's event: who, when, the transition, the status, the source and its links stay.
    expect(byId["e-approve"]).toMatchObject({
      action: "approved",
      actorId: "u-1",
      oldStatus: "submitted",
      newStatus: "approved",
      oldSummary: { activityId: "a-1", date: "2026-09-01", source: "daily_log", status: "submitted", submissionId: "s-1" },
      newSummary: { activityId: "a-1", status: "approved", submissionId: "s-1" },
      summary: { transition: "quantity_entry.approve", activityId: "a-1", source: "daily_log", status: "approved" },
      boqWithheld: { keys: ["quantity", "unitCode", "boqItemId"], reason: expect.stringContaining("may read the BOQ") },
    });
    expect(byId["e-mint"]).toMatchObject({ summary: { transition: "quantity_entry.mint_from_typed_submission", source: "submission", status: "approved", submissionId: "s-2" }, boqWithheld: { keys: ["quantity", "unitCode", "boqItemId", "typed", "officialBefore"] } });
    expect(byId["e-mint"].oldSummary).toBeNull();
    expect(byId["e-sync"]).toMatchObject({ summary: { transition: "quantity_entry.daily_log_sync", dailyLogId: "log-1", dailyLogQuantityId: "row-1" }, boqWithheld: { keys: ["quantity", "unitCode", "boqItemId", "allocationId"] } });
    // A submission's event: the percentage, the method, the bases, the entry count and the official row stay.
    expect(byId["s-submit"]).toMatchObject({ newSummary: { pctComplete: 37.5, method: "quantity", plannedBasis: "approved_allocations", installedBasis: "approved_entries", quantityEntries: 2, clientQuantityPlannedIgnored: false }, summary: { transition: "submission.submit" }, boqWithheld: { keys: ["quantityInstalled", "quantityPlanned", "quantityUnit"], reason: expect.stringContaining("may read the BOQ") } });
    expect(byId["s-floor"]).toMatchObject({ newSummary: { pctComplete: 70, installedBasis: "legacy_typed_floor", approvedProgressId: "p-2", quantityEntries: 1 }, summary: { transition: "submission.approve", activityName: "Pour" }, boqWithheld: { keys: ["quantityInstalled", "quantityPlanned", "quantityUnit", "legacyFloor"] } });
    expect(byId["s-floor"].oldSummary).toEqual(built.events[4].oldSummary);
  });

  it("a skipped mint is answered as withheld — that it was skipped, not the figures it compared; a mint that was not skipped stays null", () => {
    const given = withheldAuditHistory(history(), COST).events.filter((row) => row.id === "s-typed");
    expect(given[0].newSummary).toMatchObject({ mintedEntryId: null, mintSkipped: { withheld: true }, installedBasis: "client" });
    expect(given[0].boqWithheld.keys).toEqual(["quantityInstalled", "quantityPlanned", "quantityUnit", "mintSkipped"]);
    expect(given[1].newSummary).toMatchObject({ mintedEntryId: "e-9", mintSkipped: null });
    expect(given[1].boqWithheld.keys).toEqual(["quantityInstalled", "quantityPlanned", "quantityUnit"]);
  });

  it("an event that carries no such figure — a percent submission's, the daily log's — is the same object; the stored events are not changed", () => {
    const built = history();
    const frozen = JSON.stringify(built);
    const given = withheldAuditHistory(built, COST);
    expect(given.events[7]).toBe(built.events[7]);
    expect(given.events[8]).toBe(built.events[8]);
    expect(JSON.stringify(built)).toBe(frozen);
  });
});
