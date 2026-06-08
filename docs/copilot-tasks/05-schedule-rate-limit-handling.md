# Task 05 — Schedule Generation: Rate Limit & API Error Handling (FR-106)

## Gap Covered
- 429 (rate limit) and 529 (overloaded) from Anthropic API cause unhandled errors
- No retry logic, no reset countdown shown to user

## BRD Refs
- FR-106: If API returns 429, display reset time and offer retry. If 529, automatic retry after 60 seconds.

## DB Schema Changes
None.

## Backend Changes

### File: `backend/src/services/schedule.service.js`

Add a retry wrapper for Anthropic API calls:

```js
/**
 * Call Anthropic API with retry on 429/529.
 * @param {Function} apiFn - async function that calls client.messages.create(...)
 * @param {Function} onRetry - called with (attempt, waitMs) so caller can update job step
 * @param {number} maxRetries
 */
async function callWithRetry(apiFn, onRetry = null, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiFn();
    } catch (err) {
      const status = err?.status || err?.statusCode || (err?.response?.status);
      const isRateLimit = status === 429;
      const isOverloaded = status === 529;

      if ((isRateLimit || isOverloaded) && attempt < maxRetries) {
        // 429: respect reset header if present; default 30s
        // 529: fixed 60s per BRD
        let waitMs = isOverloaded ? 60_000 : 30_000;

        // Check Anthropic rate-limit-reset header (seconds from now)
        const resetAfter = err?.headers?.['anthropic-ratelimit-reset-tokens']
          || err?.headers?.['retry-after'];
        if (resetAfter) {
          waitMs = Math.min((Number(resetAfter) + 2) * 1000, 120_000);
        }

        if (onRetry) onRetry(attempt, waitMs);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // Non-retryable or max retries exceeded
      throw err;
    }
  }
}
```

Wrap both AI calls in `callWithRetry`:

```js
// In runGeneratePipeline, for structureBoqRows:
boqRows = await callWithRetry(
  () => structureBoqRows(rawText),
  (attempt, waitMs) => setJob(jobId, {
    step: `Rate limited — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt})…`,
  }),
);

// For generateCpmScheduleChunked / generateCpmSchedule:
scheduleJson = await callWithRetry(
  () => generateCpmScheduleChunked(boqRows, project),
  (attempt, waitMs) => setJob(jobId, {
    step: `API overloaded — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt})…`,
  }),
);
```

Also wrap the Anthropic client creation to handle auth errors clearly:
```js
// At top of service, after creating client:
// If ANTHROPIC_API_KEY is missing, fail fast on first call with clear message
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[schedule] ANTHROPIC_API_KEY not set');
}
```

## Frontend Changes

### File: `frontend/src/features/schedule/components/schedule-upload-zone.tsx`
The `currentStep` from job polling will show the retry message automatically (e.g. "Rate limited — retrying in 30s (attempt 1)…"). No specific UI changes needed.

However, add a visual warning when step text contains "Rate limited" or "API overloaded":
```tsx
const isRateLimited = currentStep?.toLowerCase().includes('rate limit')
  || currentStep?.toLowerCase().includes('overloaded')

// In the pending state render:
{isRateLimited && (
  <p className='mt-1 text-xs text-amber-600 dark:text-amber-400'>
    Anthropic API is busy. Retrying automatically...
  </p>
)}
```

## Acceptance Criteria
- [ ] 429 response is retried up to 3 times with exponential-ish wait
- [ ] 529 response is retried after 60 seconds per BRD
- [ ] `currentStep` in job shows retry countdown message
- [ ] After 3 failed retries, job status becomes `error` with clear message
- [ ] Non-rate-limit errors (400, 401) are NOT retried
