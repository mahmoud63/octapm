/**
 * Preloaded (NODE_OPTIONS --require) into an API a live test spawns: the
 * OpenAI chat endpoint answers from here instead of the network, and the
 * "model" repeats its prompt back as the narrative — the worst a real model
 * could do with what it is sent. So whatever the prompt carried is in the
 * answer the caller receives, and a test of the answer is a test of the
 * prompt. Every other request goes to the real fetch.
 */
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  if (String(url) !== "https://api.openai.com/v1/chat/completions") return realFetch(url, init);
  const request = JSON.parse(init.body);
  const prompt = request.messages
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
    .join("\n");
  const answer = { headline: "Echo of the prompt", narrative: prompt, actions: [] };
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};
