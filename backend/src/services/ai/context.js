/**
 * Who an AI call is made for (AI-1). One AsyncLocalStorage per request (app-level middleware)
 * or per background job (the worker), read by the gateway at call time, so every model call is
 * recorded against its organisation, project, user or API client without threading those
 * through each feature. Reading happens at call time, so req.user and req.params are the
 * values the authenticated handler sees.
 *
 * This is for attribution and usage only. Authorisation is decided before a feature retrieves
 * anything (see requireAiAccess and the feature context builders); it is never inferred here.
 */
const { AsyncLocalStorage } = require("async_hooks");
const { HttpError } = require("../../utils/http-error");

const store = new AsyncLocalStorage();

/** Express middleware: one context per request. */
const middleware = (req, _res, next) => store.run({ req }, next);

/** Runs `fn` with a background job's context (worker). */
const runForJob = (job, fn) => store.run({ job }, fn);

/** Runs `fn` with an explicit context (scripts, tests). */
const runWith = (context, fn) => store.run({ explicit: context }, fn);

const routeOf = (req) => `${req.method} ${req.baseUrl || ""}${req.route?.path || ""}`.trim();

/** The current call's attribution: { orgId, projectId, userId, apiClientId, jobId, actorKind, requestId, route }. */
const current = () => {
  const s = store.getStore();
  if (!s) return { actorKind: "system" };
  if (s.explicit) return { actorKind: "system", ...s.explicit };
  if (s.job) {
    return { orgId: s.job.orgId || null, projectId: s.job.projectId || null, userId: s.job.requestedBy || null, jobId: s.job.id || null, actorKind: "job", route: `job ${s.job.type || ""}`.trim() };
  }
  const req = s.req;
  return {
    orgId: req.user?.orgId || null,
    projectId: req.params?.projectId || req.aiProjectId || null,
    userId: req.user?.id || null,
    apiClientId: req.apiClient?.id || null,
    actorKind: req.apiClient ? "api_key" : req.user ? "human" : "anonymous",
    requestId: req.id || req.requestId || null,
    route: routeOf(req),
  };
};

/**
 * Hard fail when a feature reaches retrieval or a model without the caller's authorisation
 * context (AI-0 audit R5: helpers that default to FULL_ACCESS or a null viewer fail open).
 * `access` is whatever the feature's context builder resolved (a project view, BOQ access);
 * undefined or null means it was never resolved, which is a bug, not "full access".
 */
const requireAiAccess = ({ orgId, userId, access }) => {
  if (!orgId || !userId || access === undefined || access === null) {
    const error = new HttpError(500, "AI_CONTEXT_MISSING", "The AI request was made without the caller's authorisation context");
    error.details = { orgId: Boolean(orgId), userId: Boolean(userId), access: access !== undefined && access !== null };
    throw error;
  }
  return true;
};

module.exports = { middleware, runForJob, runWith, current, requireAiAccess };
