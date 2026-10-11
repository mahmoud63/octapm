/**
 * AI provider adapters (AI-1). The only place in OctaPM that talks to a model
 * provider's wire format; every feature reaches it through the AI gateway
 * (services/ai/gateway.js), never directly.
 *
 *   AI_PROVIDER=mock      deterministic local answers, no network, no key (development)
 *   AI_PROVIDER=disabled  AI switched off (every AI feature degrades)
 *   AI_PROVIDER=anthropic (default when ANTHROPIC_API_KEY is set)
 *   AI_PROVIDER=openai    + OPENAI_API_KEY
 *   AI_PROVIDER=gemini    + GEMINI_API_KEY
 *   AI_MODEL              overrides the provider's default model
 *
 * Keys are read from the server environment only and are never logged.
 */
const { mockTransport, MOCK_MODEL } = require("./mock-provider");

const DEFAULT_MODELS = Object.freeze({ anthropic: "claude-sonnet-4-6", openai: "gpt-4o-mini", gemini: "gemini-1.5-flash", mock: MOCK_MODEL });
const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || 90_000);

const env = (name) => process.env[name] || null;

/** The configured provider, or null when AI is off. `mock` needs no key. */
const resolveProvider = () => {
  const wanted = (env("AI_PROVIDER") || "").toLowerCase();
  if (wanted === "disabled" || wanted === "off" || wanted === "none") return null;
  // The mock always names itself: AI_MODEL is the live model's id, staged ahead of a key.
  if (wanted === "mock") return { provider: "mock", apiKey: null, model: DEFAULT_MODELS.mock };
  const keys = { anthropic: env("ANTHROPIC_API_KEY"), openai: env("OPENAI_API_KEY"), gemini: env("GEMINI_API_KEY") };
  if (wanted && keys[wanted]) return { provider: wanted, apiKey: keys[wanted], model: env("AI_MODEL") || DEFAULT_MODELS[wanted] };
  for (const provider of ["anthropic", "openai", "gemini"]) if (keys[provider]) return { provider, apiKey: keys[provider], model: env("AI_MODEL") || DEFAULT_MODELS[provider] };
  return null;
};

/**
 * Message content is a string or an array of blocks:
 *   { type: "text", text } | { type: "image", mediaType, data (base64) }
 * Each provider gets its own wire shape.
 */
const toBlocks = (content) => (Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }]);
const providerContent = (provider, content) => {
  if (!Array.isArray(content)) return provider === "gemini" ? [{ text: String(content ?? "") }] : content;
  if (provider === "anthropic") return content.map((block) => (block.type === "image" ? { type: "image", source: { type: "base64", media_type: block.mediaType, data: block.data } } : { type: "text", text: String(block.text ?? "") }));
  if (provider === "openai") return content.map((block) => (block.type === "image" ? { type: "image_url", image_url: { url: `data:${block.mediaType};base64,${block.data}` } } : { type: "text", text: String(block.text ?? "") }));
  return toBlocks(content).map((block) => (block.type === "image" ? { inlineData: { mimeType: block.mediaType, data: block.data } } : { text: String(block.text ?? "") }));
};

const statusOf = (error) => Number(error?.status || error?.statusCode || error?.response?.status || 0);

const readJson = async (response) => {
  const text = await response.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
};

/** fetch with the request timeout (the SDK path has its own). */
const timedFetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

const anthropicTransport = async ({ apiKey, model, system, messages, maxTokens, temperature }) => {
  let Anthropic;
  try {
    Anthropic = require("@anthropic-ai/sdk");
  } catch {
    Anthropic = null;
  }
  const wire = messages.map((message) => ({ role: message.role, content: providerContent("anthropic", message.content) }));
  if (Anthropic) {
    const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    const result = await client.messages.create({ model, max_tokens: maxTokens, temperature, system, messages: wire });
    return { text: (result.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n"), usage: { inputTokens: result.usage?.input_tokens ?? null, outputTokens: result.usage?.output_tokens ?? null }, stopReason: result.stop_reason || null };
  }
  const response = await timedFetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: wire }) });
  const json = await readJson(response);
  if (!response.ok) throw Object.assign(new Error(json?.error?.message || `Anthropic answered ${response.status}`), { status: response.status });
  return { text: (json.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n"), usage: { inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null }, stopReason: json.stop_reason || null };
};

const openaiTransport = async ({ apiKey, model, system, messages, maxTokens, temperature }) => {
  const response = await timedFetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages: [{ role: "system", content: system }, ...messages.map((message) => ({ role: message.role, content: providerContent("openai", message.content) }))] }) });
  const json = await readJson(response);
  if (!response.ok) throw Object.assign(new Error(json?.error?.message || `OpenAI answered ${response.status}`), { status: response.status });
  return { text: json.choices?.[0]?.message?.content || "", usage: { inputTokens: json.usage?.prompt_tokens ?? null, outputTokens: json.usage?.completion_tokens ?? null }, stopReason: json.choices?.[0]?.finish_reason || null };
};

// The key goes in a header, never in the URL, so proxy and access logs cannot capture it (AI-0 audit S1).
const geminiTransport = async ({ apiKey, model, system, messages, maxTokens, temperature }) => {
  const response = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: providerContent("gemini", message.content) })), generationConfig: { maxOutputTokens: maxTokens, temperature } }),
  });
  const json = await readJson(response);
  if (!response.ok) throw Object.assign(new Error(json?.error?.message || `Gemini answered ${response.status}`), { status: response.status });
  return { text: (json.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("\n"), usage: { inputTokens: json.usageMetadata?.promptTokenCount ?? null, outputTokens: json.usageMetadata?.candidatesTokenCount ?? null }, stopReason: json.candidates?.[0]?.finishReason || null };
};

const TRANSPORTS = Object.freeze({ anthropic: anthropicTransport, openai: openaiTransport, gemini: geminiTransport, mock: mockTransport });

module.exports = { DEFAULT_MODELS, REQUEST_TIMEOUT_MS, resolveProvider, providerContent, statusOf, readJson, TRANSPORTS, env };
