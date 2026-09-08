const { getAllowedRoles, normalizeRoleId } = require("../config/permissions");

/**
 * Whose move it is.
 *
 * Every UX phase of this programme has turned up the same complaint: a record
 * says "Submitted" and nothing says who it is now waiting on. People then ask
 * each other in a WhatsApp group, which is the thing the product is supposed to
 * replace.
 *
 * The answer is derived, never typed. A record in a given state is waiting for
 * a particular transition; `shared/permissions.json` already says which roles
 * may make that transition; and the record itself often names the person or the
 * company concerned. Those three facts are enough, and using them means the
 * answer cannot drift away from what the system will actually let somebody do
 * (OCTA-UX-BALLINCOURT-087).
 *
 * What this deliberately does not do:
 *
 *   - It does not store anything. A stored "next action" goes stale the moment
 *     somebody transitions the record by another route.
 *   - It does not decide permissions. `can()` remains the only authority on
 *     that; this describes what the state implies, and the UI still asks
 *     whether *this* viewer may act.
 *   - It does not show permission codes. "po.approve" is our word, not the
 *     buyer's; they see "Awaiting PM approval".
 */

/** Who ends up holding a record, in words a person on a site would use. */
const PARTY = Object.freeze({
  PM: { kind: "role", role: "pm", label: "the project manager" },
  PROCUREMENT: { kind: "role", role: "procurement", label: "procurement" },
  WAREHOUSE: { kind: "role", role: "warehouse", label: "the warehouse" },
  FINANCE: { kind: "role", role: "finance", label: "finance" },
  QS: { kind: "role", role: "qs", label: "the QS" },
  PLANNING: { kind: "role", role: "planning_eng", label: "planning" },
  SUPPLIER: { kind: "external", label: "the supplier" },
  SUBCONTRACTOR: { kind: "external", label: "the subcontractor" },
  CONSULTANT: { kind: "external", label: "the consultant" },
});

const NOBODY = Object.freeze({ kind: "none", label: null });

/**
 * What each record is waiting for, by the state it is in.
 *
 * `transition` names the move the record is waiting on, so the roles come from
 * the permission policy rather than being repeated here. Where a record is
 * finished or dead, `party` is NOBODY and there is nothing to chase.
 */
const WAITING = Object.freeze({
  purchase_order: {
    planned: { party: PARTY.PROCUREMENT, transition: "po.submit", verb: "to be sent for approval" },
    draft: { party: PARTY.PROCUREMENT, transition: "po.submit", verb: "to be sent for approval" },
    pending_approval: { party: PARTY.PM, transition: "po.approve", verb: "approval" },
    approved: { party: PARTY.PROCUREMENT, transition: "po.issue", verb: "to be issued to the supplier" },
    issued: { party: PARTY.SUPPLIER, transition: null, verb: "the supplier to acknowledge" },
    acknowledged: { party: PARTY.WAREHOUSE, transition: "receipt.post", verb: "delivery" },
    partial: { party: PARTY.WAREHOUSE, transition: "receipt.post", verb: "the rest of the delivery" },
    received: { party: PARTY.FINANCE, transition: null, verb: "the supplier's invoice" },
    closed: { party: NOBODY, transition: null, verb: null },
    cancelled: { party: NOBODY, transition: null, verb: null },
  },

  sub_pay_app: {
    draft: { party: PARTY.SUBCONTRACTOR, transition: null, verb: "the claim to be submitted" },
    submitted: { party: PARTY.QS, transition: "sub_pay_app.approve", verb: "certification" },
    under_review: { party: PARTY.QS, transition: "sub_pay_app.approve", verb: "certification" },
    approved: { party: PARTY.FINANCE, transition: "sub_pay_app.pay", verb: "payment" },
    paid: { party: NOBODY, transition: null, verb: null },
    rejected: { party: PARTY.SUBCONTRACTOR, transition: null, verb: "a corrected claim" },
    void: { party: NOBODY, transition: null, verb: null },
  },

  bid_package: {
    draft: { party: PARTY.PROCUREMENT, transition: "bid.publish", verb: "to be sent to bidders" },
    open: { party: PARTY.SUPPLIER, transition: null, verb: "prices from the bidders" },
    closed: { party: PARTY.PM, transition: "bid.award", verb: "a decision on the winner" },
    awarded: { party: NOBODY, transition: null, verb: null },
    cancelled: { party: NOBODY, transition: null, verb: null },
  },

  commitment: {
    draft: { party: PARTY.QS, transition: "commitment.submit", verb: "to be sent for approval" },
    pending: { party: PARTY.PM, transition: "commitment.approve", verb: "approval" },
    approved: { party: PARTY.QS, transition: "commitment.execute", verb: "the signed agreement" },
    executed: { party: NOBODY, transition: null, verb: null },
    closed: { party: NOBODY, transition: null, verb: null },
    void: { party: NOBODY, transition: null, verb: null },
  },

  direct_cost: {
    draft: { party: PARTY.FINANCE, transition: "direct_cost.submit", verb: "to be sent for approval" },
    pending: { party: PARTY.PM, transition: "direct_cost.approve", verb: "approval" },
    approved: { party: PARTY.FINANCE, transition: "direct_cost.pay", verb: "payment" },
    paid: { party: NOBODY, transition: null, verb: null },
    void: { party: NOBODY, transition: null, verb: null },
  },

  long_lead_item: {
    not_ordered: { party: PARTY.PROCUREMENT, transition: "po.submit", verb: "an order to be raised" },
    ordered: { party: PARTY.SUPPLIER, transition: null, verb: "delivery" },
    delivered: { party: NOBODY, transition: null, verb: null },
  },
});

/** The module a transition belongs to, so its roles can be looked up. */
const MODULE_OF = Object.freeze({
  purchase_order: "procurement",
  long_lead_item: "procurement",
  sub_pay_app: "sub_pay_app",
  bid_package: "bid",
  commitment: "commitment",
  direct_cost: "cost",
});

const titleCase = (text) =>
  String(text || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The sentence a person reads.
 *
 * "Awaiting PM approval", not "pending_approval"; "With the supplier", not
 * "issued". Where the record names an actual company or person, that name is
 * better than the role and is used instead.
 */
const describe = ({ party, verb, namedParty }) => {
  if (party.kind === "none") return null;
  // A named company stands in for the *external* party and nothing else.
  // Using it whenever a caller happened to know one told a QS that an
  // approved claim was "Awaiting E2E Concrete — payment" when it was waiting
  // on finance, and told a buyer that a draft commitment was waiting on the
  // vendor when it was waiting on the QS to send it (OCTA-UX-BIC-096). The
  // guard lives here rather than at each call site because every caller has
  // a company to hand and no reason to know when it is the wrong answer.
  if (party.kind === "external") {
    if (namedParty) return `Awaiting ${namedParty}${verb ? ` — ${verb}` : ""}`;
    return verb ? `Awaiting ${verb}` : `With ${party.label}`;
  }
  return `Awaiting ${party.label}${verb ? ` — ${verb}` : ""}`;
};

/**
 * Whose move it is on one record.
 *
 * @param {string} recordType  one of the keys of WAITING
 * @param {object} record      the record, as the service serialises it
 * @param {object} [viewer]    { role, id } — so the answer can say "you"
 * @param {object} [named]     { name, kind } an actual company or person, when
 *                             the record knows one (a supplier, an assignee)
 */
const ballInCourt = (recordType, record, viewer = null, named = null) => {
  const table = WAITING[recordType];
  const status = String(record?.status || "").toLowerCase();
  const waiting = table?.[status];

  if (!table || !waiting || waiting.party.kind === "none") {
    return {
      state: "none",
      label: null,
      party: null,
      isYou: false,
      canAct: false,
      action: null,
    };
  }

  const { party, transition, verb } = waiting;
  const roles =
    party.kind === "role" && transition
      ? getAllowedRoles({ module: MODULE_OF[recordType], transition }) || [party.role]
      : party.kind === "role"
        ? [party.role]
        : [];

  const viewerRole = normalizeRoleId(viewer?.role);
  // Two different questions, and conflating them made the answer useless.
  //
  // "Can I act?" is the permission policy: a PM is allowed to make nearly
  // every transition in the system, so deriving "yours" from that put "Your
  // action" on every row of every register a PM opened — six of six
  // commitments, six of six orders, six of six bid packages. A prompt that
  // fires on everything is not a prompt (OCTA-UX-BIC-097).
  //
  // "Is it my move?" is the workflow: the party the record is *waiting on*.
  // A draft commitment waits on the QS. A PM can submit it, and may well
  // want to, but it is not their turn — so they get "Awaiting the QS" and
  // `canAct`, which is what an action button should be hung on.
  const isYou = Boolean(viewerRole && party.kind === "role" && viewerRole === party.role);
  const canAct = Boolean(viewerRole && roles.includes(viewerRole));

  const namedParty = named?.name || null;

  return {
    state: isYou ? "yours" : "awaiting",
    label: isYou ? "Your action" : describe({ party, verb, namedParty }),
    // Who is being waited on, for a person who wants to go and ask them.
    party: {
      kind: party.kind,
      label: (party.kind === "external" && namedParty) || titleCase(party.label),
      role: party.kind === "role" ? party.role : null,
    },
    isYou,
    // Whether this viewer is *permitted* to make the move, whoever's turn it
    // is. The UI hangs the action button on this, not on isYou.
    canAct,
    // The move the record is waiting for. The UI uses it to decide which
    // button to offer; it is never shown as text.
    action: transition ? { transition, roles } : null,
  };
};

/** The record types this understands, for callers that want to check first. */
const SUPPORTED = Object.freeze(Object.keys(WAITING));

module.exports = { ballInCourt, PARTY, SUPPORTED, WAITING };
