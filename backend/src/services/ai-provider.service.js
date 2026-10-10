const { HttpError } = require("../utils/http-error");
const providers = require("./ai/providers");
const gateway = require("./ai/gateway");
const aiContext = require("./ai/context");
const usage = require("./ai/usage");

/**
 * Compatibility surface for the AI features (OCTA-AI-ASSIST-028), now a thin shim over the AI
 * gateway (services/ai/gateway.js, AI-1). `complete()` goes through the gateway, so every call
 * is attributed (organisation, project, user), recorded in the AiRun ledger and degrades with
 * 503 AI_NOT_CONFIGURED / AI_UNAVAILABLE. Callers pass `feature` to name themselves.
 *
 *   AI_PROVIDER=mock | disabled | anthropic | openai | gemini   (see services/ai/providers.js)
 *   AI_MODEL              overrides the provider's default model
 */

const { DEFAULT_MODELS, resolveProvider, providerContent } = providers;
const env = (name) => process.env[name] || null;

const isEnabled = () => Boolean(resolveProvider());

const TRANSCRIPTION_MODEL = "whisper-1";
const transcriptionEnabled = () => Boolean(env("OPENAI_API_KEY")) && (env("AI_TRANSCRIPTION") || "").toLowerCase() !== "off";

const describe = () => {
  const resolved = resolveProvider();
  return {
    enabled: Boolean(resolved),
    provider: resolved?.provider || null,
    model: resolved?.model || null,
    // Every live provider reads images; the mock does not, and AI_VISION=off keeps prompts text-only.
    vision: Boolean(resolved) && resolved.provider !== "mock" && (env("AI_VISION") || "").toLowerCase() !== "off",
    transcription: transcriptionEnabled(),
    transcriptionModel: transcriptionEnabled() ? env("AI_TRANSCRIPTION_MODEL") || TRANSCRIPTION_MODEL : null,
  };
};

/** One completion through the AI gateway (see gateway.complete). */
const complete = (options) => gateway.complete(options);

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

/**
 * Speech to text for voice notes (OCTA-AI-DAILY-030) through OpenAI's
 * transcription endpoint (`OPENAI_API_KEY`, `AI_TRANSCRIPTION_MODEL`,
 * `AI_TRANSCRIPTION=off` disables). `fetchImpl` is injectable for tests.
 * Recorded in the AiRun ledger as feature "daily_log.transcribe".
 */
const transcribeAudio = async ({ buffer, mimeType = "audio/webm", fileName = "audio.webm", language = null, fetchImpl = null }) => {
  if (!transcriptionEnabled()) throw new HttpError(503, "AI_TRANSCRIPTION_NOT_CONFIGURED", "Voice transcription is not configured on this server (set OPENAI_API_KEY)");
  if (!buffer || !buffer.length) throw new HttpError(400, "AI_TRANSCRIPTION_EMPTY", "The recording is empty");
  const model = env("AI_TRANSCRIPTION_MODEL") || TRANSCRIPTION_MODEL;
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);
  form.append("model", model);
  if (language) form.append("language", language);
  const send = fetchImpl || fetch;
  const started = Date.now();
  const who = aiContext.current();
  const response = await send("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${env("OPENAI_API_KEY")}` }, body: form });
  const json = await providers.readJson(response);
  if (!response.ok) {
    console.error(`[ai] transcription failed (${response.status}): ${json?.error?.message || "no message"}`);
    await usage.record({ ...who, feature: "daily_log.transcribe", provider: "openai", model, status: "failed", errorClass: gateway.errorClassOf({ status: response.status }), latencyMs: Date.now() - started });
    const failed = new HttpError(503, "AI_TRANSCRIPTION_FAILED", "Transcription failed. Try again shortly.");
    failed.retryable = [429, 500, 502, 503].includes(Number(response.status));
    throw failed;
  }
  await usage.record({ ...who, feature: "daily_log.transcribe", provider: "openai", model, status: "ok", latencyMs: Date.now() - started });
  return { text: String(json.text || "").trim(), provider: "openai", model };
};

module.exports = { DEFAULT_MODELS, resolveProvider, isEnabled, describe, complete, parseJsonAnswer, providerContent, transcribeAudio };
