jest.mock("../../config/db", () => ({ prisma: {} }));

const { addMonths, warrantyState, _gates: gates } = require("../project-closeout.service");

describe("Project closeout (CLOSEOUT V1): deterministic rules", () => {
  test("a warranty ends its period after its start; month ends clamp", () => {
    expect(addMonths(new Date("2026-01-15T00:00:00Z"), 12).toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  test("warranty state: active, expiring within 90 days, expired, not started; other categories have none", () => {
    const now = new Date("2026-10-11T00:00:00Z");
    const warranty = (start, end) => ({ category: "warranty", warrantyStart: start && new Date(start), warrantyEnd: end && new Date(end) });
    expect(warrantyState(warranty("2026-01-01", "2027-06-01"), now).state).toBe("active");
    expect(warrantyState(warranty("2026-01-01", "2026-12-01"), now).state).toBe("expiring");
    expect(warrantyState(warranty("2025-01-01", "2026-01-01"), now).state).toBe("expired");
    expect(warrantyState(warranty("2027-01-01", "2028-01-01"), now).state).toBe("not_started");
    expect(warrantyState(warranty(null, null), now).state).toBe("not_started");
    expect(warrantyState({ category: "om_manual" }, now)).toBeNull();
  });

  test("handover needs substantial completion and every required deliverable settled; final completion needs every check clear too", () => {
    const items = [
      { ref: "TO-001", title: "As-builts", required: true, settled: true },
      { ref: "TO-002", title: "O&M manuals", required: true, settled: false },
      { ref: "TO-003", title: "Spares", required: false, settled: false },
    ];
    const checks = [
      { label: "Punch list closed", status: "open", detail: "2 punch items not closed" },
      { label: "RFIs closed", status: "waived", detail: "1 RFI not closed" },
      { label: "Inspections passed", status: "clear", detail: "ok" },
    ];
    const none = gates({ checks, items, record: null });
    expect(none.substantial_completion.ready).toBe(true);
    expect(none.handover.ready).toBe(false);
    expect(none.handover.outstanding).toEqual(["Substantial completion is not recorded", "TO-002 O&M manuals"]);

    const substantial = gates({ checks, items, record: { substantialCompletionAt: new Date() } });
    expect(substantial.handover.outstanding).toEqual(["TO-002 O&M manuals"]);

    const settled = items.map((item) => ({ ...item, settled: true }));
    const handedOver = gates({ checks, items: settled, record: { substantialCompletionAt: new Date(), handoverAt: new Date() } });
    expect(handedOver.handover.ready).toBe(true);
    // A waived check does not block; an open one does, and so does one the caller cannot read.
    expect(handedOver.final_completion.outstanding).toEqual(["Punch list closed: 2 punch items not closed"]);
    const restricted = gates({ checks: [{ label: "NCRs closed", status: "restricted", detail: "You cannot read this module on the project" }], items: settled, record: { substantialCompletionAt: new Date(), handoverAt: new Date() } });
    expect(restricted.final_completion.ready).toBe(false);
  });
});
