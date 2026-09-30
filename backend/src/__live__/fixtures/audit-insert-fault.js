/**
 * Forced audit-write failures, for one live test's own spawned API only.
 *
 *   NODE_OPTIONS=--require "<this file>"
 *   LIVE_AUDIT_FAULT_PROJECT_ID=<a project of a throwaway LiveTest organisation>
 *   LIVE_AUDIT_FAULT_DUPLICATE_ID=<the id of an audit event that already exists>
 *   LIVE_OUTBOUND_FAULT_PROJECT_ID=<another project of that organisation> (optional)
 *   LIVE_OUTBOUND_FAULT_DUPLICATE_ID=<the id of an outbound event that already exists> (optional)
 *
 * The audit fault: a contract.manage audit event for the first project is
 * inserted with the id of an existing audit event, so Postgres refuses the
 * insert (a real unique violation, on whatever client the caller wrote with).
 *
 * The outbound fault: for the second project the contract.manage audit event
 * and its history snapshot are written as usual, and the domain event that
 * audit.service then writes to the outbound log (OutboundEvent, best-effort)
 * is inserted with the id of an existing outbound event — refused by Postgres
 * the same way, inside the caller's transaction.
 *
 * Every other audit event, and every other project, is written exactly as
 * usual. Nothing is changed in the database by a fault itself: a refused
 * insert writes nothing. Only __live__/contract-confirmation-audit.live.test.js
 * loads it.
 */
const projectId = process.env.LIVE_AUDIT_FAULT_PROJECT_ID;
const duplicateId = process.env.LIVE_AUDIT_FAULT_DUPLICATE_ID;
if (!projectId || !duplicateId) {
  throw new Error("audit-insert-fault: LIVE_AUDIT_FAULT_PROJECT_ID and LIVE_AUDIT_FAULT_DUPLICATE_ID are required");
}
const outboundProjectId = process.env.LIVE_OUTBOUND_FAULT_PROJECT_ID || null;
const outboundDuplicateId = process.env.LIVE_OUTBOUND_FAULT_DUPLICATE_ID || null;
if (Boolean(outboundProjectId) !== Boolean(outboundDuplicateId)) {
  throw new Error("audit-insert-fault: LIVE_OUTBOUND_FAULT_PROJECT_ID and LIVE_OUTBOUND_FAULT_DUPLICATE_ID go together");
}

const { prisma } = require("../../config/db");
const auditService = require("../../services/audit.service");

const recordEvent = auditService.recordEvent;

// The caller's client (its transaction, or the base client when it passes
// none), except that <model>.create reuses an existing id. Every other
// member — raw SQL included — is the caller's own, bound to it.
const faulty = (client, model, reusedId) =>
  new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop !== model) return typeof value === "function" ? value.bind(target) : value;
      return new Proxy(value, {
        get(delegate, key) {
          if (key === "create") {
            return (query) => delegate.create({ ...query, data: { ...query.data, id: reusedId } });
          }
          const member = Reflect.get(delegate, key);
          return typeof member === "function" ? member.bind(delegate) : member;
        },
      });
    },
  });

auditService.recordEvent = (args = {}) => {
  if (args.summary?.transition === "contract.manage") {
    if (args.projectId === projectId) {
      return recordEvent({ ...args, tx: faulty(args.tx || prisma, "auditEvent", duplicateId) });
    }
    if (outboundProjectId && args.projectId === outboundProjectId) {
      return recordEvent({ ...args, tx: faulty(args.tx || prisma, "outboundEvent", outboundDuplicateId) });
    }
  }
  return recordEvent(args);
};
