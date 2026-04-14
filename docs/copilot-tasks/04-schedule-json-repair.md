# Task 04 — Schedule Generation: JSON Repair on Truncated AI Response (FR-105)

## Gap Covered
- If AI response is truncated (stop_reason = max_tokens), attempt to repair the JSON before failing
- Currently: truncated responses throw `JSON.parse` error and the job fails

## BRD Refs
- FR-105: If AI response is truncated (stop_reason=max_tokens), repair JSON by closing unmatched brackets, fixing unterminated strings, removing trailing commas

## DB Schema Changes
None.

## Backend Changes

### File: `backend/src/services/schedule.service.js`

Add a `repairJson` utility function:

```js
/**
 * Attempt to repair truncated JSON from AI.
 * Handles: unclosed strings, trailing commas, missing closing brackets/braces.
 */
function repairJson(raw) {
  let s = raw.trim();

  // Remove trailing commas before closing brackets
  s = s.replace(/,\s*([\]}])/g, '$1');

  // Count open/close braces and brackets
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  // If we're mid-string, close it
  if (inString) s += '"';

  // Remove trailing commas again after potential string close
  s = s.replace(/,\s*$/, '');

  // Close open arrays and objects
  s += ']'.repeat(Math.max(0, brackets));
  s += '}'.repeat(Math.max(0, braces));

  return s;
}
```

Wrap `JSON.parse` calls in both `structureBoqRows` and `generateCpmSchedule` / `generateCpmScheduleBatch`:

```js
// In structureBoqRows:
try {
  return JSON.parse(cleaned);
} catch {
  // Attempt repair
  const repaired = repairJson(cleaned);
  try {
    const parsed = JSON.parse(repaired);
    console.warn('[schedule] JSON repaired for BOQ parsing');
    return parsed;
  } catch {
    throw new Error('AI returned invalid JSON for BOQ parsing (repair failed)');
  }
}

// In generateCpmSchedule / generateCpmScheduleBatch:
try {
  return JSON.parse(cleaned);
} catch {
  const repaired = repairJson(cleaned);
  try {
    const parsed = JSON.parse(repaired);
    console.warn('[schedule] JSON repaired for schedule generation');
    return parsed;
  } catch {
    throw new Error('AI returned invalid JSON for schedule generation (repair failed)');
  }
}
```

Also check `stop_reason` on the Anthropic response and log a warning:
```js
const msg = await client.messages.create({ ... });
if (msg.stop_reason === 'max_tokens') {
  console.warn('[schedule] AI response hit max_tokens — attempting JSON repair');
}
const raw = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
```

## Frontend Changes
None — errors propagate via job status automatically. If repair succeeds, the user sees no difference.

## Acceptance Criteria
- [ ] Truncated AI response with unclosed JSON array is repaired and produces valid activities
- [ ] Truncated response with trailing comma is cleaned before parse
- [ ] If repair fails, error message says "repair failed" rather than raw `SyntaxError`
- [ ] `stop_reason === 'max_tokens'` logged as warning in backend console
