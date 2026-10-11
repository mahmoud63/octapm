/**
 * The deterministic results of the module Ask OctaPM is opened over (AI-7):
 * one builder per module key, each deciding the caller's access itself and
 * returning [] when they may not read that module. Modules without a builder
 * fall back to the record, search and project digest sources.
 */
const { scheduleSources } = require("./schedule-snapshot");

const BUILDERS = Object.freeze({
  schedule: scheduleSources,
});

const MODULE_KEYS = Object.keys(BUILDERS);

const moduleSources = async ({ view, projectId, moduleKey }) => {
  const build = BUILDERS[moduleKey];
  return build ? build({ view, projectId }) : [];
};

module.exports = { moduleSources, MODULE_KEYS };
