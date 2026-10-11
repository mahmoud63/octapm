/**
 * Deterministic mock model for development (AI_PROVIDER=mock). No network, no key, no cost.
 *
 * It never invents anything: it only restates what the prompt already gives it, which are
 * the numbered OctaPM sources (`[n] Type Ref - Title (Project, status)`) or "FACT:" lines a
 * feature built from deterministic services, and it labels its answer as a mock. When the
 * system prompt asks for the assistant's JSON shape ({"answer", "citations", "actions"}) it
 * answers in that shape, so features parse it exactly as they would a real model's answer.
 */
const MOCK_MODEL = "octapm-mock-1";
const MAX_ITEMS = 8;

const textOf = (content) => (Array.isArray(content) ? content.filter((block) => block?.type !== "image").map((block) => String(block?.text ?? "")).join("\n") : String(content ?? ""));
const estimateTokens = (text) => Math.max(1, Math.ceil(String(text || "").length / 4));

/** `[n] ...` header lines of the numbered sources block (retrieval.formatSources). */
const sourcesIn = (text) => {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\[(\d{1,3})\]\s+(.+)$/.exec(line.trim());
    if (match) out.push({ n: Number(match[1]), head: match[2].trim() });
  }
  return out;
};

/** "FACT: ..." lines a feature passes from deterministic OctaPM services. */
const factsIn = (text) =>
  String(text)
    .split(/\r?\n/)
    .map((line) => /^\s*FACT:\s*(.+)$/i.exec(line))
    .filter(Boolean)
    .map((match) => match[1].trim());

const questionIn = (text) => {
  const match = /(?:^|\n)\s*(?:Question|QUESTION|Ask|Request)\s*:\s*(.+)/.exec(String(text));
  if (match) return match[1].trim();
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 200) : "";
};

const compose = ({ question, sources, facts }) => {
  const lines = [];
  lines.push("_Development mock answer: no AI model is connected, so this restates the OctaPM records found for the question without interpreting them._");
  if (question) lines.push("", `**Question:** ${question}`);
  if (facts.length) {
    lines.push("", "**From OctaPM records:**");
    for (const fact of facts.slice(0, MAX_ITEMS)) lines.push(`- ${fact}`);
  }
  if (sources.length) {
    lines.push("", "**Matching records:**");
    for (const source of sources.slice(0, MAX_ITEMS)) lines.push(`- ${source.head} [${source.n}]`);
  }
  if (!facts.length && !sources.length) lines.push("", "I could not find OctaPM records that answer this. Try naming a project, a record reference or a module.");
  return lines.join("\n");
};

const mockTransport = async ({ system, messages }) => {
  const lastUser = [...(messages || [])].reverse().find((message) => message.role === "user");
  const userText = textOf(lastUser?.content);
  const sources = sourcesIn(userText);
  const facts = factsIn(userText);
  const answer = compose({ question: questionIn(userText), sources, facts });
  const wantsAssistantJson = /"answer"\s*:/.test(String(system || "")) && /"citations"/.test(String(system || ""));
  const wantsJson = !wantsAssistantJson && /return only a json/i.test(String(system || ""));
  let text = answer;
  // A feature that also asks for recommendations (AI reporting) gets one
  // "review this record" line per listed record after the first (the
  // project facts), so the section renders; it states nothing new.
  const recommendations = /"recommendations"/.test(String(system || ""))
    ? sources.slice(1, 4).map((source) => ({ text: `Mock: review ${source.head} [${source.n}]`, citations: [source.n] }))
    : undefined;
  if (wantsAssistantJson) text = JSON.stringify({ answer, citations: sources.slice(0, MAX_ITEMS).map((source) => source.n), actions: [], ...(recommendations ? { recommendations } : {}) });
  else if (wantsJson) text = JSON.stringify({ mock: true, summary: answer });
  const promptText = `${system || ""}\n${(messages || []).map((message) => textOf(message.content)).join("\n")}`;
  return { text, usage: { inputTokens: estimateTokens(promptText), outputTokens: estimateTokens(text) }, stopReason: "end_turn" };
};

module.exports = { MOCK_MODEL, mockTransport, sourcesIn, factsIn };
