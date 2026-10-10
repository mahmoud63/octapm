/**
 * Estimated model cost (AI-1). USD per one million tokens, input and output. Estimates only:
 * the provider's invoice is the record. A model missing here records no cost (null), never a
 * guess. AI_PRICE_OVERRIDES='{"model-id":[inputUsdPerMTok,outputUsdPerMTok]}' adds or replaces
 * entries without a code change.
 */
const BASE = Object.freeze({
  "octapm-mock-1": [0, 0],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gemini-1.5-flash": [0.075, 0.3],
});

const table = () => {
  let overrides = {};
  try {
    overrides = process.env.AI_PRICE_OVERRIDES ? JSON.parse(process.env.AI_PRICE_OVERRIDES) : {};
  } catch {
    overrides = {};
  }
  return { ...BASE, ...overrides };
};

/** Estimated cost in micro-USD (integer), or null when the model or the token counts are unknown. */
const estimateCostMicros = ({ model, inputTokens, outputTokens }) => {
  const price = table()[model];
  if (!price || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const [inPerM, outPerM] = price;
  return Math.round(inputTokens * inPerM + outputTokens * outPerM);
};

module.exports = { estimateCostMicros };
