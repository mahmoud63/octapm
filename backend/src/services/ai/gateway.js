/**
 * The OctaPM AI gateway (AI-1): the single path from any feature to a model.
 *
 *   feature -> (authorised context, built by the feature before it retrieves) -> gateway.complete
 *     -> provider adapter (mock | anthropic | openai | gemini) -> answer
 *     -> AiRun ledger row (who, feature, provider, model, tokens, estimated cost, latency, status)
 *
 * Provider failure never breaks the product: the caller gets 503 AI_NOT_CONFIGURED or
 * AI_UNAVAILABLE (a stable contract the web and mobile clients already handle) and degrades.
 * The provider's own error text goes to the server log only, never to a caller or the ledger.
 */
const { HttpError } = require("../../utils/http-error");
const providers = require("./providers");
const aiContext = require("./context");
const usage = require("./usage");
const { estimateCostMicros } = require("./pricing");

const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Spending guard for a live provider (the mock costs nothing): tokens per UTC
// day for the organisation and for one user, calls per day for one user, and
// a ceiling on any one answer's length. 0 switches a limit off.
const limit = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const LIMITS = () => ({
  orgTokens: limit("AI_DAILY_TOKEN_LIMIT_ORG", 1_000_000),
  userTokens: limit("AI_DAILY_TOKEN_LIMIT_USER", 250_000),
  userCalls: limit("AI_DAILY_REQUEST_LIMIT_USER", 150),
  maxOutput: limit("AI_MAX_OUTPUT_TOKENS", 2_000),
});
const overBudget = async (who) => {
  const limits = LIMITS();
  const totals = await usage.todayTotals({ orgId: who.orgId, userId: who.userId }).catch(() => null);
  if (!totals) return null;
  if (limits.orgTokens && totals.org && totals.org.tokens >= limits.orgTokens) return "organisation";
  if (limits.userTokens && totals.user && totals.user.tokens >= limits.userTokens) return "user";
  if (limits.userCalls && totals.user && totals.user.calls >= limits.userCalls) return "user";
  return null;
};

// Short structured tasks may use a cheaper model (AI_FAST_MODEL); everything
// else uses AI_MODEL / the provider default.
const FAST_FEATURES = new Set(["search.interpret", "search.answer"]);

const errorClassOf = (error) => {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  const status = providers.statusOf(error);
  if (status === 429) return "rate_limited";
  if (status === 529 || status === 503) return "overloaded";
  if (status === 401 || status === 403) return "auth";
  if (status >= 400 && status < 500) return "bad_request";
  if (status >= 500) return "provider_error";
  return "network";
};

/**
 * One completion. `feature` names the product feature (e.g. "assistant.ask"); `messages` =
 * [{ role: "user" | "assistant", content }]. `context` overrides the request/job attribution.
 * Tests may inject `transport`. Returns { text, usage, stopReason, provider, model, runId }.
 */
const complete = async ({ feature = "unspecified", system, messages, maxTokens = 1500, temperature = 0.2, transport = null, retries = MAX_RETRIES, context = null }) => {
  const who = { ...aiContext.current(), ...(context || {}) };
  const resolved = providers.resolveProvider();
  const started = Date.now();
  if (!resolved && !transport) {
    await usage.record({ ...who, feature, status: "disabled", errorClass: "AI_NOT_CONFIGURED", latencyMs: 0 });
    throw new HttpError(503, "AI_NOT_CONFIGURED", "No AI provider is configured on this server");
  }
  const provider = resolved?.provider || "test";
  const fastModel = providers.env("AI_FAST_MODEL");
  const model = resolved && provider !== "mock" && fastModel && FAST_FEATURES.has(feature) ? fastModel : resolved?.model || "test";
  const live = Boolean(resolved) && provider !== "mock" && !transport;
  if (live) {
    const over = await overBudget(who);
    if (over) {
      await usage.record({ ...who, feature, provider, model, status: "blocked", errorClass: "budget", latencyMs: 0 });
      // AI_UNAVAILABLE keeps every feature's degraded path: the records and facts still come back.
      const blocked = new HttpError(429, "AI_UNAVAILABLE", over === "organisation" ? "Today's AI usage limit for your company has been reached. OctaPM's records are still shown; AI answers resume tomorrow." : "Your AI usage limit for today has been reached. OctaPM's records are still shown; AI answers resume tomorrow.");
      blocked.details = { reason: "budget", scope: over };
      throw blocked;
    }
  }
  const send = transport || providers.TRANSPORTS[provider];
  const cappedTokens = live && LIMITS().maxOutput ? Math.min(maxTokens, LIMITS().maxOutput) : maxTokens;
  const args = { apiKey: resolved?.apiKey || null, model, system, messages, maxTokens: cappedTokens, temperature };
  let lastError = null;
  let attempt = 0;
  for (attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const result = await send(args);
      const inputTokens = result.usage?.inputTokens ?? null;
      const outputTokens = result.usage?.outputTokens ?? null;
      const runId = await usage.record({ ...who, feature, provider, model, status: "ok", inputTokens, outputTokens, costMicros: estimateCostMicros({ model, inputTokens, outputTokens }), latencyMs: Date.now() - started, retries: attempt - 1 });
      return { ...result, provider, model, runId };
    } catch (error) {
      lastError = error;
      const status = providers.statusOf(error);
      if ((status === 429 || status === 529 || status === 503) && attempt < retries) {
        const base = Number(process.env.AI_RETRY_BASE_MS || 1_000);
        await sleep(Math.min(30_000, base * 2 ** attempt));
        continue;
      }
      break;
    }
  }
  const errorClass = errorClassOf(lastError);
  console.error(`[ai] ${provider} did not answer (${errorClass}): ${lastError?.message || "unknown error"}`);
  await usage.record({ ...who, feature, provider, model, status: "failed", errorClass, latencyMs: Date.now() - started, retries: Math.max(0, attempt - 1) });
  const wrapped = new HttpError(503, "AI_UNAVAILABLE", "The AI provider did not answer. Try again shortly.");
  wrapped.retryable = true;
  throw wrapped;
};

/** What the server can do. Provider and model names only for `detailed` callers (company admins). */
const capabilities = ({ detailed = false } = {}) => {
  const resolved = providers.resolveProvider();
  const mode = !resolved ? "disabled" : resolved.provider === "mock" ? "mock" : "live";
  const base = {
    enabled: Boolean(resolved),
    mode,
    vision: Boolean(resolved) && resolved.provider !== "mock" && (providers.env("AI_VISION") || "").toLowerCase() !== "off",
    features: ["ask", "project_summary", "attention", "search", "reports", "documents"],
  };
  return detailed ? { ...base, provider: resolved?.provider || null, model: resolved?.model || null } : base;
};

// The configured spending limits, read by the platform console (Superadmin AI usage).
module.exports = { complete, capabilities, errorClassOf, limits: LIMITS };
