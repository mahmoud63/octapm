/**
 * Trigger 1 of the exception engine (OCTAPM_CHANGE_INTELLIGENCE.md §6): the
 * domain events after which a project's exceptions may have changed ask for a
 * debounced 'exceptions.evaluate' job for THAT project
 * (exception-engine.service enqueueEvaluation). Nothing is evaluated in the
 * request: the job does it, later, once per burst.
 *
 * The events, as the product publishes them today:
 *
 *   record.changed (audit.service recordEvent → bus buildRecordEvent)
 *     progress_submission       approved            progress approved
 *     quantity_progress_entry   approved            quantity entry approved
 *     change_order              approved / → approved
 *     commitment                → executed, closed, void   committed cost moved
 *     commitment_change_order   approved
 *     ipc_certificate           certified / → certified, paid
 *     sub_pay_app, direct_cost  approved, certified, status_changed   ledger posted / reversed
 *     boq_item                  created, updated, deleted, archived   BOQ item edited
 *     boq_revision, schedule_revision, budget_line, budget_snapshot   any action
 *   approval.decided (approval-workflow.service recordTransition)
 *     activity_boq_allocation   any decision (approved, rejected, superseded)
 *     progress_submission, change_order   → approved
 *
 * The cost ledger publishes nothing of its own; its posters (IPC, pay
 * applications, direct costs) are listed above, and the nightly tick catches
 * anything else. Behind EXCEPTIONS_ENGINE_ENABLED (default true): with
 * "false" nothing is subscribed.
 */
const domainEvents = require("./bus");

const APPROVED = ["approved"];
const RECORD_RULES = Object.freeze({
  progress_submission: { actions: APPROVED, statuses: APPROVED },
  quantity_progress_entry: { actions: APPROVED, statuses: APPROVED },
  change_order: { actions: APPROVED, statuses: APPROVED },
  commitment: { statuses: ["executed", "closed", "void", "voided"] },
  commitment_change_order: { actions: APPROVED, statuses: APPROVED },
  ipc_certificate: { actions: ["certified"], statuses: ["certified", "paid"] },
  sub_pay_app: { actions: ["approved", "certified", "status_changed"] },
  direct_cost: { actions: ["approved", "status_changed"] },
  boq_item: { actions: ["created", "updated", "deleted", "archived", "imported"] },
  boq_revision: { any: true },
  schedule_revision: { any: true },
  budget_line: { any: true },
  budget_snapshot: { any: true },
});
const APPROVAL_RULES = Object.freeze({
  activity_boq_allocation: { any: true },
  progress_submission: { statuses: APPROVED },
  change_order: { statuses: APPROVED },
});

const matches = (rule, { action, status }) =>
  Boolean(rule) && (rule.any === true || (rule.actions || []).includes(action) || (Boolean(status) && (rule.statuses || []).includes(status)));

/** Whether an event may change a project's exceptions (a pure function of the event). */
const isRelevantEvent = (event) => {
  if (!event || !event.orgId || !event.projectId || !event.entityType) return false;
  const action = event.action || null;
  if (event.type === domainEvents.EVENT_TYPES.RECORD_CHANGED) {
    return matches(RECORD_RULES[event.entityType], { action, status: event.payload?.newStatus || null });
  }
  if (event.type === domainEvents.EVENT_TYPES.APPROVAL_DECIDED) {
    return matches(APPROVAL_RULES[event.entityType], { action, status: event.payload?.toStatus || null });
  }
  return false;
};

let unsubscribe = null;

/**
 * Subscribes the trigger (once per process). `enqueue` defaults to the
 * engine's debounced enqueueEvaluation. Returns the unsubscribe function, or
 * null when the engine is disabled.
 */
const registerExceptionTriggers = ({ env = process.env, enqueue = null, logger = console } = {}) => {
  const engine = require("../services/exception-engine.service");
  if (!engine.engineEnabled(env)) {
    logger.log("[exception-triggers] disabled by EXCEPTIONS_ENGINE_ENABLED=false");
    return null;
  }
  if (unsubscribe) return unsubscribe;
  const ask = enqueue || engine.enqueueEvaluation;
  const off = domainEvents.subscribe((event) => {
    if (!isRelevantEvent(event)) return;
    Promise.resolve()
      .then(() => ask({ orgId: event.orgId, projectId: event.projectId, trigger: "event", reason: `${event.type}:${event.entityType}:${event.action || event.payload?.newStatus || event.payload?.toStatus || ""}` }))
      .catch((error) => logger.error("[exception-triggers] enqueue failed", error?.message || error));
  });
  unsubscribe = () => {
    off();
    unsubscribe = null;
  };
  return unsubscribe;
};

module.exports = { APPROVAL_RULES, RECORD_RULES, isRelevantEvent, registerExceptionTriggers };
