/**
 * A drop-in for the `client.messages.create(...)` calls the BOQ and schedule pipelines were
 * written against (AI-1). Every call goes through the AI gateway, so it uses the configured
 * provider and model, is attributed and recorded in the AiRun ledger, and fails with the
 * gateway's 503 when AI is off, instead of each module holding its own provider SDK client,
 * key and hard-coded model (AI-0 audit: boq.service, schedule.service).
 *
 * Returns the SDK's answer shape that those callers read: { content: [{ type: "text", text }], usage }.
 */
const gateway = require("./gateway");

const messagesClient = (defaultFeature) => ({
  messages: {
    create: async ({ feature, system, messages, max_tokens: maxTokens = 4000, temperature = 0 }) => {
      const result = await gateway.complete({ feature: feature || defaultFeature, system: system || "", messages, maxTokens, temperature });
      return {
        content: [{ type: "text", text: result.text || "" }],
        usage: { input_tokens: result.usage?.inputTokens ?? null, output_tokens: result.usage?.outputTokens ?? null },
        stop_reason: result.stopReason || null,
      };
    },
  },
});

module.exports = { messagesClient };
