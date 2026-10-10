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
  const model = resolved?.model || "test";
  const send = transport || providers.TRANSPORTS[provider];
  const args = { apiKey: resolved?.apiKey || null, model, system, messages, maxTokens, temperature };
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

module.exports = { complete, capabilities, errorClassOf };
