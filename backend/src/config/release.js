/**
 * Which build is answering.
 *
 * One image is promoted from staging to production, so the image carries its
 * commit and build time (RELEASE_GIT_SHA / RELEASE_BUILD_TIME, baked in from
 * Dockerfile build args) and the task definition says where it runs (APP_ENV).
 * The health routes report this and every response carries it in
 * X-OctaPM-Release, so a deploy can be verified by asking any task which
 * commit it is running — and a load balancer mixing two releases during a
 * rolling deploy is visible from the outside.
 *
 * Nothing here names a host, a database or a dependency: this is served to
 * anyone who asks, and identity is all it should give away.
 */
const { version } = require("../../package.json");

const RELEASE_HEADER = "X-OctaPM-Release";

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const getRelease = (env = process.env) =>
  Object.freeze({
    version,
    sha: trimOrNull(env.RELEASE_GIT_SHA),
    builtAt: trimOrNull(env.RELEASE_BUILD_TIME),
    environment: trimOrNull(env.APP_ENV) || trimOrNull(env.NODE_ENV) || "development",
  });

// Locally there is no commit baked in, so the header falls back to the
// package version rather than disappearing.
const releaseHeaderValue = (release) => release.sha || release.version;

module.exports = { RELEASE_HEADER, getRelease, releaseHeaderValue };
