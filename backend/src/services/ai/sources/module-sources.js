/**
 * The deterministic results of the screen Ask OctaPM is opened over (AI-7):
 * one builder per module, or per module sub-tab ("schedule:progress"), each
 * deciding the caller's access itself and returning [] when they may not
 * read it. Screens without a builder fall back to the record, search and
 * project digest sources.
 */
const { scheduleSources } = require("./schedule-snapshot");
const { progressSources } = require("./progress-snapshot");
const { boqSources } = require("./boq-snapshot");
const cost = require("./cost-snapshot");

const BUILDERS = Object.freeze({
  schedule: scheduleSources,
  "schedule:progress": progressSources,
  "schedule:forecast": cost.forecastSources,
  boq: boqSources,
  cost: cost.costSources,
  "commercial:commitments": cost.commitmentSources,
  "commercial:cash-flow": cost.cashFlowSources,
});

const moduleSources = async ({ view, projectId, moduleKey, child = null }) => {
  const build = (child && BUILDERS[`${moduleKey}:${child}`]) || BUILDERS[moduleKey];
  return build ? build({ view, projectId }) : [];
};

module.exports = { moduleSources, BUILDERS };
