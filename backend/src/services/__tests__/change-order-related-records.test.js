/**
 * A change order's related records (PC-7b, owner decision R5-5): one row per
 * activity, its strongest relation first, the BOQ items its allocation links
 * name — and, for a member who may not read the BOQ, no BOQ item and no
 * allocation-derived activity, with a marker instead of an empty list.
 *
 * The composition is pure (the order already carries its links), so these
 * check the rule itself; pc-7b-change-order-links.live.test.js drives the API.
 */
jest.mock("../../config/db", () => ({ prisma: {} }));

const { buildRelatedRecords, RELATION_RANK } = require("../change-order.service");
const {
  withheldAllocationLinks,
  RELATED_RECORDS_WITHHELD,
} = require("../../utils/boq-figures");

const link = (recordType, recordId) => `/o/ws/projects/p1/${recordType}?recordId=${recordId}`;

const act = (id, extra = {}) => ({ id, name: `Activity ${id}`, activityCode: `C-${id}`, ...extra });
const item = (id) => ({ id, code: `B-${id}`, ref: null, description: `Row ${id}`, unit: "m3", unitCode: "M3" });
const allocationLink = (activity, boqItem) => ({
  id: `l-${activity.id}-${boqItem.id}`,
  allocationId: `a-${activity.id}-${boqItem.id}`,
  boqItemId: boqItem.id,
  boqItem,
  allocation: { id: `a-${activity.id}-${boqItem.id}`, activity, boqItem },
  quantity: 2,
  amount: 20,
});

describe("buildRelatedRecords", () => {
  test("a direct activity and an allocation link to the SAME activity are one row, 'direct'", () => {
    const x = act("x");
    const related = buildRelatedRecords(
      { activityId: "x", activity: x, activityLinks: [], allocationLinks: [allocationLink(x, item("i1"))] },
      link,
    );
    expect(related.activities).toEqual([
      { id: "x", code: "C-x", name: "Activity x", relation: "direct", href: link("activity", "x") },
    ]);
    expect(related.boqItems).toEqual([
      { id: "i1", code: "B-i1", description: "Row i1", unitCode: "M3", relation: "allocation_link", href: link("boq_item", "i1") },
    ]);
  });

  test("the strongest relation wins whatever the order the links arrive in, and rows run direct, activity_link, via_allocation", () => {
    const [x, y, z] = [act("x"), act("y"), act("z")];
    const related = buildRelatedRecords(
      {
        activityId: "y",
        activity: y,
        // y also through two activity-link rows (relation types differ): still one row.
        activityLinks: [
          { activityId: "x", activity: x, scheduleImpactDays: 2 },
          { activityId: "y", activity: y, relationType: "affected", scheduleImpactDays: 3 },
          { activityId: "y", activity: y, relationType: "delay", scheduleImpactDays: 5 },
        ],
        allocationLinks: [allocationLink(z, item("i1")), allocationLink(x, item("i1")), allocationLink(z, item("i2"))],
      },
      link,
    );
    expect(related.activities.map((row) => [row.id, row.relation, row.impactDays])).toEqual([
      ["y", "direct", 5],
      ["x", "activity_link", 2],
      ["z", "via_allocation", undefined],
    ]);
    expect(new Set(related.activities.map((row) => row.id)).size).toBe(related.activities.length);
    // One BOQ item row per item, however many links name it.
    expect(related.boqItems.map((row) => row.id)).toEqual(["i1", "i2"]);
    expect(Object.keys(RELATION_RANK)).toEqual(["direct", "activity_link", "via_allocation"]);
  });

  test("an order reaching an activity only through an allocation names it via_allocation; truly none is empty", () => {
    const z = act("z", { activityCode: null, p6ActivityId: "P6-Z" });
    const reached = buildRelatedRecords({ activityId: null, activityLinks: [], allocationLinks: [allocationLink(z, item("i9"))] }, link);
    expect(reached.activities).toEqual([
      { id: "z", code: "P6-Z", name: "Activity z", relation: "via_allocation", href: link("activity", "z") },
    ]);
    expect(buildRelatedRecords({ activityId: null, activityLinks: [], allocationLinks: [] }, link)).toEqual({ activities: [], boqItems: [] });
  });

  test("a link naming only a BOQ item gives the item and no activity", () => {
    const related = buildRelatedRecords(
      { activityId: null, activityLinks: [], allocationLinks: [{ id: "l1", allocationId: null, boqItemId: "i3", boqItem: item("i3"), allocation: null }] },
      link,
    );
    expect(related.activities).toEqual([]);
    expect(related.boqItems.map((row) => row.id)).toEqual(["i3"]);
  });
});

describe("withheldAllocationLinks on related records (utils/boq-figures)", () => {
  const x = act("x");
  const z = act("z");
  const order = {
    id: "co-1",
    activityId: "x",
    activity: x,
    activityLinks: [],
    allocationLinks: [allocationLink(x, item("i1")), allocationLink(z, item("i2"))],
  };
  order.relatedRecords = buildRelatedRecords(order, link);

  test("a BOQ reader gets the order untouched", () => {
    expect(withheldAllocationLinks(order, { boq: true, budget: true })).toBe(order);
  });

  test("anyone else: no boqItems, no via_allocation row, the marker with its reason; the direct row stays", () => {
    const shown = withheldAllocationLinks(order, { boq: false, budget: true });
    expect(shown.relatedRecords).not.toHaveProperty("boqItems");
    expect(shown.relatedRecords.activities.map((row) => [row.id, row.relation])).toEqual([["x", "direct"]]);
    expect(shown.relatedRecords.boqWithheld).toEqual({ keys: ["boqItems", "activities.via_allocation"], reason: RELATED_RECORDS_WITHHELD });
    expect(JSON.stringify(shown.relatedRecords)).not.toMatch(/"z"|i1|i2|B-i/);
  });

  test("the marker is on every order for such a member, even one with no allocation link", () => {
    const plain = { id: "co-2", activityId: null, activityLinks: [], allocationLinks: [] };
    plain.relatedRecords = buildRelatedRecords(plain, link);
    const shown = withheldAllocationLinks(plain, { boq: false, budget: false });
    expect(shown.relatedRecords.activities).toEqual([]);
    expect(shown.relatedRecords.boqWithheld.reason).toBe(RELATED_RECORDS_WITHHELD);
  });
});
