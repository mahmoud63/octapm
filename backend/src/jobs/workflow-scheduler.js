/**
 * Workflow SLA scan (OCTA-PLAT-WF-024): every hour, steps past their due
 * date notify the assignee again and escalate to the step's roles.
 */

const INTERVAL_MS = 60 * 60 * 1000;

async function runEscalationTick(now = new Date()) {
  return require("../services/workflow-engine.service").runEscalationScan({ now });
}

function startWorkflowScheduler() {
  if (String(process.env.WORKFLOW_SCHEDULER_ENABLED ?? "true").toLowerCase() === "false") {
    console.log("[workflow-scheduler] disabled by WORKFLOW_SCHEDULER_ENABLED=false");
    return null;
  }
  const safe = () => runEscalationTick().catch((error) => console.error("[workflow-scheduler] escalation", error));
  safe();
  const timer = setInterval(safe, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

module.exports = { runEscalationTick, startWorkflowScheduler };
