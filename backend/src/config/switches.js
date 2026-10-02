/**
 * The on/off switches of everything that writes without being asked to by a
 * request: the job worker, scheduler leadership, each scheduler, the weather
 * feed and the Expo push sender (certification finding C0-2).
 *
 * One rule for all of them: a writer runs only when its variable is exactly
 * "true" (any case, surrounding space ignored). Missing, empty, "false" and
 * anything else — "1", "yes", "on", a typo — leave it OFF. A deployment that
 * says nothing starts nothing: before this, every one of them started when
 * its variable was missing, and several acted at once on every organisation
 * in the database.
 *
 * Ordinary request handling is not behind any of these switches.
 */

const isSwitchOn = (name, env = process.env) => String(env?.[name] ?? "").trim().toLowerCase() === "true";

/** The line a writer logs when it stands down. */
const offMessage = (label, name) => `[${label}] disabled: ${name} is not true`;

/** Every switch, for the start-up report and the tests. */
const WRITER_SWITCHES = Object.freeze([
  { name: "JOB_WORKER_ENABLED", what: "the job worker: claims and runs queued jobs, recovers stale ones, prunes finished ones" },
  { name: "SCHEDULERS_ENABLED", what: "scheduler leadership: this process may run the schedulers below (one leader at a time)" },
  { name: "BILLING_SCHEDULER_ENABLED", what: "expires lapsed trials and cancelled subscriptions; sends trial reminders" },
  { name: "NOTIFICATION_SCHEDULER_ENABLED", what: "delivers pending notification e-mail and push; the daily due-date scan" },
  { name: "DAILY_LOG_SCHEDULER_ENABLED", what: "weather fill and daily-log distribution jobs" },
  { name: "REPORT_SCHEDULER_ENABLED", what: "scheduled report runs and portfolio refresh jobs" },
  { name: "WORKFLOW_SCHEDULER_ENABLED", what: "workflow step escalation" },
  { name: "ACCOUNTING_SCHEDULER_ENABLED", what: "accounting payment polling jobs" },
  { name: "EXCEPTIONS_ENGINE_ENABLED", what: "the project exception engine (event trigger, evaluation, notifier)" },
  { name: "EXCEPTIONS_SCHEDULER_ENABLED", what: "the nightly exception re-evaluation tick (needs the engine too)" },
  { name: "WEATHER_FEED_ENABLED", what: "calls to the weather provider" },
  { name: "EXPO_PUSH_ENABLED", what: "push delivery through the Expo push service" },
]);

/** "on: A, B | off: C, D" — what this process will and will not do on its own. */
const describeSwitches = (env = process.env) => {
  const on = WRITER_SWITCHES.filter((s) => isSwitchOn(s.name, env)).map((s) => s.name);
  const off = WRITER_SWITCHES.filter((s) => !isSwitchOn(s.name, env)).map((s) => s.name);
  return `on: ${on.join(", ") || "(none)"} | off: ${off.join(", ") || "(none)"}`;
};

module.exports = { WRITER_SWITCHES, describeSwitches, isSwitchOn, offMessage };
