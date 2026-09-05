const { HttpError } = require("../utils/http-error");

/**
 * Provider-agnostic chat completion for the AI features (OCTA-AI-ASSIST-028).
 *
 *   AI_PROVIDER=anthropic (default when ANTHROPIC_API_KEY is set)
 *   AI_PROVIDER=openai    + OPENAI_API_KEY
 *   AI_PROVIDER=gemini    + GEMINI_API_KEY
 *   AI_MODEL              overrides the provider's default model
 *
 * `complete()` takes a system prompt and a message list and returns plain
 * text plus usage. Tests inject `transport` so nothing touches the network.
 */

const DEFAULT_MODELS = Object.freeze({ anthropic: "claude-sonnet-4-6", openai: "gpt-4o-mini", gemini: "gemini-1.5-flash" });
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 3;

const env = (name) => process.env[name] || null;

const resolveProvider = () => {
  const wanted = (env("AI_PROVIDER") || "").toLowerCase();
  const keys = { anthropic: env("ANTHROPIC_API_KEY"), openai: env("OPENAI_API_KEY"), gemini: env("GEMINI_API_KEY") };
  if (wanted && keys[wanted]) return { provider: wanted, apiKey: keys[wanted], model: env("AI_MODEL") || DEFAULT_MODELS[wanted] };
  for (const provider of ["anthropic", "openai", "gemini"]) if (keys[provider]) return { provider, apiKey: keys[provider], model: env("AI_MODEL") || DEFAULT_MODELS[provider] };
  return null;
};

const isEnabled = () => Boolean(resolveProvider());

const describe = () => {
  const resolved = resolveProvider();
  return { enabled: Boolean(resolved), provider: resolved?.provider || null, model: resolved?.model || null };
};

const statusOf = (error) => Number(error?.status || error?.statusCode || error?.response?.status || 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (response) => {
  const text = await response.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
};

const anthropicTransport = async ({ apiKey, model, system, messages, maxTokens, temperature }) => {
  let Anthropic;
  try {
    Anthropic = require("@anthropic-ai/sdk");
  } catch {
    Anthropic = null;
  }
  if (Anthropic) {
    const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    const result = await client.messages.create({ model, max_tokens: maxTokens, temperature, system, messages: messages.map((message) => ({ role: message.role, content: message.content })) });
    return { text: (result.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n"), usage: { inputTokens: result.usage?.input_tokens ?? null, outputTokens: result.usage?.output_tokens ?? null }, stopReason: result.stop_reason || null };
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages }) });
  const json = await readJson(response);
  if (!response.ok) throw Object.assign(new Error(json?.error?.message || `Anthropic answered ${response.status}`), { status: response.status });
  return { text: (json.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n"), usage: { inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null }, stopReason: json.stop_reason || null };
};

const openaiTransport = async ({ apiKey, model, system, messages, maxTokens, temperature }) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages: [{ role: "system", content: system }, ...messages] }) });
  const json = await readJson(response);
  if (!response.ok) throw Object.assign(new Error(json?.error?.message || `OpenAI answered ${response.status}`), { status: response.status });
  return { text: json.choices?.[0]?.message?.content || "", usage: { inputTokens: json.usage?.prompt_tokens ?? null, outputTokens: json.usage?.completion_tokens ?? null }, stopReason: json.choices?.[0]?.finish_reason || null };
};

const geminiTransport = async ({ apiKey, model, system, messages, maxTokens, temperature }) => {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })), generationConfig: { maxOutputTokens: maxTokens, temperature } }),
  });
  const json = await readJson(response);
  if (!response.ok) throw Object.assign(new Error(json?.error?.message || `Gemini answered ${response.status}`), { status: response.status });
  return { text: (json.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("\n"), usage: { inputTokens: json.usageMetadata?.promptTokenCount ?? null, outputTokens: json.usageMetadata?.candidatesTokenCount ?? null }, stopReason: json.candidates?.[0]?.finishReason || null };
};

const TRANSPORTS = Object.freeze({ anthropic: anthropicTransport, openai: openaiTransport, gemini: geminiTransport });

/**
 * One completion. `messages` = [{ role: "user" | "assistant", content }].
 * Retries rate limits / overloads with backoff; other failures surface as
 * 503 AI_UNAVAILABLE so callers can degrade gracefully.
 */
const complete = async ({ system, messages, maxTokens = 1500, temperature = 0.2, transport = null, retries = MAX_RETRIES }) => {
  const resolved = resolveProvider();
  if (!resolved && !transport) throw new HttpError(503, "AI_NOT_CONFIGURED", "No AI provider is configured on this server (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY)");
  const send = transport || TRANSPORTS[resolved.provider];
  const args = { apiKey: resolved?.apiKey || null, model: resolved?.model || "test", system, messages, maxTokens, temperature };
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const result = await send(args);
      return { ...result, provider: resolved?.provider || "test", model: args.model };
    } catch (error) {
      lastError = error;
      const status = statusOf(error);
      if ((status === 429 || status === 529 || status === 503) && attempt < retries) {
        const base = Number(process.env.AI_RETRY_BASE_MS || 1_000);
        await sleep(Math.min(30_000, base * 2 ** attempt));
        continue;
      }
      break;
    }
  }
  const wrapped = new HttpError(503, "AI_UNAVAILABLE", `The AI provider did not answer: ${lastError?.message || "unknown error"}`);
  wrapped.retryable = true;
  throw wrapped;
};

/** Pulls the first JSON object out of a model answer (code fences and prose tolerated). */
const parseJsonAnswer = (text) => {
  if (!text) return null;
  const cleaned = String(text).replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
};

module.exports = { DEFAULT_MODELS, resolveProvider, isEnabled, describe, complete, parseJsonAnswer };
