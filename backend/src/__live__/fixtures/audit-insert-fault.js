/**
 * A forced audit-insert failure, for one live test's own spawned API only.
 *
 *   NODE_OPTIONS=--require "<this file>"
 *   LIVE_AUDIT_FAULT_PROJECT_ID=<a project of a throwaway LiveTest organisation>
 *   LIVE_AUDIT_FAULT_DUPLICATE_ID=<the id of an audit event that already exists>
 *
 * A contract.manage audit event for that one project is inserted with the id
 * of an existing audit event, so Postgres refuses the insert (a real unique
 * violation, on whatever client the caller wrote with). Every other audit
 * event, and every other project, is written exactly as usual. Nothing is
 * changed in the database by the fault itself: the refused insert writes
 * nothing. Only __live__/contract-confirmation-audit.live.test.js loads it.
 */
const projectId = process.env.LIVE_AUDIT_FAULT_PROJECT_ID;
const duplicateId = process.env.LIVE_AUDIT_FAULT_DUPLICATE_ID;
if (!projectId || !duplicateId) {
  throw new Error("audit-insert-fault: LIVE_AUDIT_FAULT_PROJECT_ID and LIVE_AUDIT_FAULT_DUPLICATE_ID are required");
}

const { prisma } = require("../../config/db");
const auditService = require("../../services/audit.service");

const recordEvent = auditService.recordEvent;

// The caller's client (its transaction, or the base client when it passes
// none), except that auditEvent.create reuses an existing id.
const faulty = (client) =>
  new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop !== "auditEvent") return typeof value === "function" ? value.bind(target) : value;
      return new Proxy(value, {
        get(delegate, key) {
          if (key === "create") {
            return (query) => delegate.create({ ...query, data: { ...query.data, id: duplicateId } });
          }
          const member = Reflect.get(delegate, key);
          return typeof member === "function" ? member.bind(delegate) : member;
        },
      });
    },
  });

auditService.recordEvent = (args = {}) => {
  if (args.projectId !== projectId || args.summary?.transition !== "contract.manage") {
    return recordEvent(args);
  }
  return recordEvent({ ...args, tx: faulty(args.tx || prisma) });
};
