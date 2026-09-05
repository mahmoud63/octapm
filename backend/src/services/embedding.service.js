/**
 * Optional text embeddings for semantic document search (OCTA-DOC-TEXT-010).
 *
 * Provider-agnostic and SDK-free (Node's global fetch). Configure one of:
 *   EMBEDDINGS_PROVIDER=openai  + OPENAI_API_KEY   (text-embedding-3-small)
 *   EMBEDDINGS_PROVIDER=voyage  + VOYAGE_API_KEY   (voyage-3)
 *   EMBEDDINGS_PROVIDER=gemini  + GEMINI_API_KEY   (text-embedding-004)
 * With no provider configured, extraction still runs and search falls back
 * to Postgres full-text ranking; `isEnabled()` reports the state so the UI
 * can explain it.
 */

const BATCH_SIZE = 64;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_INPUT_CHARS = 6000;

const PROVIDERS = Object.freeze({
  openai: {
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "text-embedding-3-small",
    request: ({ apiKey, model, inputs }) => ({
      url: "https://api.openai.com/v1/embeddings",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: { model, input: inputs },
      parse: (json) => (json.data || []).map((row) => row.embedding),
    }),
  },
  voyage: {
    keyEnv: "VOYAGE_API_KEY",
    defaultModel: "voyage-3",
    request: ({ apiKey, model, inputs, inputType }) => ({
      url: "https://api.voyageai.com/v1/embeddings",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: { model, input: inputs, input_type: inputType },
      parse: (json) => (json.data || []).map((row) => row.embedding),
    }),
  },
  gemini: {
    keyEnv: "GEMINI_API_KEY",
    defaultModel: "text-embedding-004",
    request: ({ apiKey, model, inputs, inputType }) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`,
      headers: { "Content-Type": "application/json" },
      body: {
        requests: inputs.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType: inputType === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        })),
      },
      parse: (json) => (json.embeddings || []).map((row) => row.values),
    }),
  },
});

const resolveProvider = (env = process.env) => {
  const requested = String(env.EMBEDDINGS_PROVIDER || "").trim().toLowerCase();
  if (["none", "off", "false", "disabled"].includes(requested)) return null;
  const candidates = requested && PROVIDERS[requested] ? [requested] : Object.keys(PROVIDERS);
  for (const name of candidates) {
    const definition = PROVIDERS[name];
    if (env[definition.keyEnv]) {
      return {
        name,
        apiKey: env[definition.keyEnv],
        model: env.EMBEDDINGS_MODEL || definition.defaultModel,
        definition,
      };
    }
  }
  return null;
};

const isEnabled = () => Boolean(resolveProvider());

const describe = () => {
  const provider = resolveProvider();
  return provider ? { enabled: true, provider: provider.name, model: provider.model } : { enabled: false };
};

const fetchImpl = (...args) => {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available in this runtime");
  }
  return fetch(...args);
};

const embedBatch = async ({ provider, inputs, inputType }) => {
  const spec = provider.definition.request({
    apiKey: provider.apiKey,
    model: provider.model,
    inputs: inputs.map((text) => String(text || "").slice(0, MAX_INPUT_CHARS)),
    inputType,
  });
  const response = await fetchImpl(spec.url, {
    method: "POST",
    headers: spec.headers,
    body: JSON.stringify(spec.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`Embedding request failed (${response.status}) ${detail.slice(0, 200)}`);
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  const json = await response.json();
  const vectors = spec.parse(json);
  if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
    throw new Error("Embedding provider returned an unexpected number of vectors");
  }
  return vectors.map((vector) => (Array.isArray(vector) ? vector.map(Number) : []));
};

/** Embeds document chunks; returns [] when no provider is configured. */
const embedTexts = async (texts, { inputType = "document" } = {}) => {
  const provider = resolveProvider();
  if (!provider || !texts.length) return [];
  const vectors = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    vectors.push(...(await embedBatch({ provider, inputs: batch, inputType })));
  }
  return vectors;
};

const embedQuery = async (text) => {
  const [vector] = await embedTexts([text], { inputType: "query" });
  return vector || null;
};

const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

module.exports = {
  BATCH_SIZE,
  PROVIDERS,
  cosineSimilarity,
  describe,
  embedQuery,
  embedTexts,
  isEnabled,
  resolveProvider,
};
