---
name: ai-service
description: Build and maintain the AI schedule generation engine for PMcopilots. Use when working on LLM API integration, multi-pass generation, BOQ chunking, prompt engineering, JSON repair, or provider-agnostic abstraction layer.
---

# AI Service Layer Skill

## Architecture
Provider-agnostic abstraction layer in `src/services/aiService.js`. Supports Claude, GPT, Gemini — switchable via env config.

```js
// src/services/aiService.js
class AIService {
  constructor() {
    this.provider = process.env.AI_PROVIDER || 'claude'; // claude | openai | gemini
  }

  async generate(systemPrompt, userPrompt, options = {}) {
    const { maxTokens = 8000, temperature = 0.3 } = options;
    
    switch (this.provider) {
      case 'claude':
        return this.callClaude(systemPrompt, userPrompt, maxTokens, temperature);
      case 'openai':
        return this.callOpenAI(systemPrompt, userPrompt, maxTokens, temperature);
      default:
        throw new Error(`Unknown AI provider: ${this.provider}`);
    }
  }

  async callClaude(system, user, maxTokens, temperature) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    const data = await res.json();
    if (data.error) throw new AIError(data.error, res.status);
    return data.content[0].text;
  }
}
```

## Multi-Pass Schedule Generation

### Pass 1: Core Schedule
**Input:** BOQ items (description, qty, rate, section)
**Output:** Activities with WBS, durations, predecessors, ES/EF/LS/LF/TF, milestones

System prompt should instruct the LLM to:
- Generate 30-45 activities from BOQ items
- Assign realistic durations based on construction knowledge
- Create predecessor network (FS, SS, FF, SF with lags)
- Identify milestones (key completion points)
- Group activities by WBS hierarchy
- Respond in strict JSON format

### Pass 2: Risks & Procurement
**Input:** Activity summary from Pass 1 + project context
**Output:** Risk register (8+ risks), assumptions, long-lead items

### Pass 3: Resources
**Input:** Phase breakdown from Pass 1
**Output:** Resource allocation matrix by phase

## BOQ Chunking (for 60+ items)

```js
async function generateWithChunking(boqItems, project) {
  const BATCH_SIZE = 60;
  
  // Group by section
  const sections = groupBy(boqItems, 'section');
  const batches = createBatches(sections, BATCH_SIZE);
  
  let allActivities = [];
  let previousBatchIds = [];
  
  for (let i = 0; i < batches.length; i++) {
    const batchPrefix = `B${i + 1}`;
    const context = previousBatchIds.length > 0
      ? `Previous batch activity IDs for cross-batch linking: ${previousBatchIds.join(', ')}`
      : '';
    
    const result = await aiService.generate(
      scheduleSystemPrompt,
      buildBatchPrompt(batches[i], project, context, batchPrefix)
    );
    
    const parsed = repairAndParse(result);
    allActivities.push(...parsed.activities);
    previousBatchIds = parsed.activities.map(a => a.id);
  }
  
  // Merge and recalculate CPM across all batches
  return mergeAndRecalculate(allActivities);
}
```

## JSON Repair
LLM responses may be truncated. Always attempt repair before failing:

```js
function repairJSON(text) {
  let json = text.trim();
  
  // Remove markdown code fences
  json = json.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '');
  
  // Remove trailing commas
  json = json.replace(/,\s*([}\]])/g, '$1');
  
  // Fix unterminated strings
  const openQuotes = (json.match(/"/g) || []).length;
  if (openQuotes % 2 !== 0) json += '"';
  
  // Close unmatched brackets
  const opens = (json.match(/\[/g) || []).length;
  const closes = (json.match(/\]/g) || []).length;
  for (let i = 0; i < opens - closes; i++) json += ']';
  
  const openBraces = (json.match(/\{/g) || []).length;
  const closeBraces = (json.match(/\}/g) || []).length;
  for (let i = 0; i < openBraces - closeBraces; i++) json += '}';
  
  return JSON.parse(json);
}
```

## Error Handling
- **429 (Rate Limit)**: Return `retry-after` header value to client. Log for monitoring.
- **529 (Overloaded)**: Auto-retry after 60 seconds, max 2 retries.
- **Truncated response** (`stop_reason: 'max_tokens'`): Attempt JSON repair. If fails, retry with higher `max_tokens`.
- **Invalid JSON**: Attempt repair. If repair fails, return structured error to client.

## Rate Limit Handling
```js
if (res.status === 429) {
  const resetTime = res.headers.get('retry-after');
  throw new AIError({ code: 'RATE_LIMITED', resetTime }, 429);
}
```

## Provider Switching
To switch providers, set `AI_PROVIDER` env var. The service layer handles API differences internally. Prompt format may need adjustment per provider — keep prompts in separate template files for each provider if needed.
