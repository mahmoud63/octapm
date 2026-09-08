/**
 * What state an activity is in.
 *
 * The rule the product states: nothing done is To do, part done is In progress,
 * all done is Complete, and past its finish date without being finished is
 * Delayed.
 *
 * Read as precedence rather than as a list, because two of them can be true at
 * once and the order decides which one a person is shown. An activity that is
 * forty per cent complete and three months past its finish date is both in
 * progress and late; the rule says it is Delayed, because that is the fact the
 * reader needs. Only being finished outranks it — work that is done is done,
 * however late it was.
 *
 * This lives on its own because it had been written four times: in the activity
 * service, the schedule service, the export and the report builder. Three of
 * them tested the percentage before the date, so a late activity with any
 * progress on it came back In progress; the report builder tested the date
 * first and called the same activity Delayed. The schedule screen and the
 * report sent to the client disagreed about the same record at the same moment.
 */
const STATUSES = Object.freeze(["todo", "in_progress", "complete", "delayed"]);

/**
 * @param {number} pctComplete approved progress, 0–100
 * @param {Date|string|null} endDate the activity's planned finish
 * @param {Date} [now] the moment to judge lateness against
 */
const deriveActivityStatus = (pctComplete, endDate, now = new Date()) => {
  const pct = Number(pctComplete) || 0;
  if (pct >= 100) return "complete";
  if (endDate && new Date(endDate) < now) return "delayed";
  if (pct > 0) return "in_progress";
  return "todo";
};

module.exports = { STATUSES, deriveActivityStatus };
