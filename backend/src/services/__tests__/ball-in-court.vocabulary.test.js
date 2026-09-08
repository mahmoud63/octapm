/**
 * The ball-in-court tables have to agree with the services they describe.
 *
 * A status the table does not know returns `state: "none"`, which renders as
 * no badge at all — so getting one wrong looks exactly like a record that
 * genuinely has nobody waiting on it. Two of the six tables were wrong when
 * this was written (a pay app under review, and every commitment, which is
 * `pending`/`void` and not `pending_approval`/`cancelled`), and nothing
 * failed. This holds each table against the vocabulary its own service
 * publishes, so the next divergence is a red test rather than a blank cell
 * (OCTA-UX-BIC-094).
 */

const { WAITING } = require("../ball-in-court.service");

/**
 * Where each record type's statuses actually come from. Read at require time
 * from the services themselves — a list copied into this file would rot in
 * exactly the same way as the one it is checking.
 */
const VOCABULARY = {
  sub_pay_app: () => require("../sub-pay-app.service").STATUSES,
  commitment: () => require("../commitment.service").STATUSES,
  bid_package: () => Object.values(require("../bid.service").STATUS),
  direct_cost: () => Object.values(require("../direct-cost.service").STATUS),
  // These two have no exported enum; the route validator is the vocabulary.
  purchase_order: () => require("../purchase-order.service").STATUSES,
  long_lead_item: () => ["not_ordered", "ordered", "delivered"],
};

describe("ball-in-court tables describe the real workflow states", () => {
  it("covers every record type the service claims to support", () => {
    expect(Object.keys(WAITING).sort()).toEqual(Object.keys(VOCABULARY).sort());
  });

  for (const [recordType, statuses] of Object.entries(VOCABULARY)) {
    describe(recordType, () => {
      it("names every status the service can be in", () => {
        const missing = statuses().filter((status) => !(status in WAITING[recordType]));
        expect(missing).toEqual([]);
      });

      it("names no status the service cannot be in", () => {
        const known = new Set(statuses());
        const invented = Object.keys(WAITING[recordType]).filter((s) => !known.has(s));
        expect(invented).toEqual([]);
      });
    });
  }
});
