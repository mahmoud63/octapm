# Daily report auto-draft from records, photos and voice (OCTA-AI-DAILY-030)

The site team dictates or types a few lines, the assistant reads everything
already recorded for the day and proposes the report. Every part is a
checkbox; nothing is written until *Apply selected*, and every write goes
through the daily log's own service (audited, same permissions).

## Where

Site Reporting › **Daily Log** › the *Draft today's report* card under the
weather / summary block (people with `daily_log.update`, on a day that is
not locked).

1. **Notes**: type, or *Dictate* (browser speech recognition, no server
   round trip, Chrome / Edge / Safari) or, where the browser cannot
   dictate and the server has transcription, *Record a voice note*
   (MediaRecorder → `POST …/ai/transcribe`).
2. **Look at today's photos** (when the provider reads images): up to
   `AI_MAX_PHOTOS` (default 8) of the day's photos are sent as images
   (thumbnails when ready, ≤ 4 MB each).
3. **Draft the report** → confidence badge, evidence counts (entries,
   progress updates, inspections, items raised, incidents, photos and how
   many were looked at), then:
   - the **summary** (editable; *Set / Replace the day's summary* ticked when
     the day has none),
   - **work performed** with its sources (`P1`, `progress:<id>`, `notes`),
   - **notes to add** (kind badge), **delays to add** (type, hours lost),
   - **photo captions** with thumbnails (uncaptioned photos ticked; a ticked
     captioned photo is replaced),
   - *Still to record* hints.
4. **Apply selected** → summary via `PATCH` semantics, notes and delays as
   entries, captions on the photos; toast with what was applied.

## What the model sees

One calendar day in the **project's time zone** (`Project.timezone`, else
UTC): the daily log as logged (weather with alerts, manpower, equipment,
deliveries, visitors, delays incl. unconfirmed weather suggestions, notes),
progress submissions, inspections completed or started, punch items /
observations raised, safety incidents, the photo list (time, location,
caption, tags) and the dictated notes. Rules in the prompt: evidence only,
past tense, no invented quantities / companies / people, delays only where
work was held up, caption only uncaptioned photos, say what is missing.

## API (tag "Assistant")

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /projects/{id}/daily-logs/ai/status` | `progress.read` | `{ enabled, provider, model, vision, transcription, maxPhotos }` |
| `POST /projects/{id}/daily-logs/ai/transcribe` (multipart `audio`, optional `language`) | `assistant.read` + `daily_log.submit` | OpenAI transcription (`OPENAI_API_KEY`, `AI_TRANSCRIPTION_MODEL` default `whisper-1`, `AI_TRANSCRIPTION=off` disables); 503 `AI_TRANSCRIPTION_NOT_CONFIGURED` |
| `POST /projects/{id}/daily-logs/{date}/ai/draft` `{ notes?, includePhotos?, photoIds? }` | `assistant.read` + `daily_log.update` | `{ degraded, reason, date, draft, evidence, message }` |
| `POST /projects/{id}/daily-logs/{date}/ai/apply` `{ summary?, notes?, delays?, photoCaptions?, overwriteCaptions? }` | `assistant.read` + `daily_log.update` | `{ applied: { summary, notes, delays, captions, skippedCaptions }, log }` |

Provider layer: message content may now be blocks (`text` / `image`
base64) — mapped to Anthropic, OpenAI and Gemini wire shapes;
`describe()` reports `vision` (`AI_VISION=off` keeps prompts text-only) and
`transcription`.

## Storage and degraded mode

Each draft is stored as an `AssistantConversation` of kind
`daily_log_draft` (`recordType = daily_log`, `recordId` = the day's log)
with the evidence text that was sent, the draft, usage, provider and model;
the card's thumbs feed the usual feedback endpoint. Without a provider (or
when it does not answer) the card still returns a **factual draft built from
the records** — weather, manpower totals, equipment, deliveries, progress,
inspections, items raised, incidents, hours lost, photos, the dictated note
— marked *From the records only*; captions and delays are then empty.

## Walkthrough

1. Log manpower and a delivery, submit progress on an activity, complete
   an ITP, raise a safety observation, upload two site photos (one without
   caption). Open the day → *Dictate* "crane down one hour after lunch" →
   *Draft the report*.
2. The summary mentions the pour progress, the inspection and the crane
   stoppage; a `safety` note for the observation and an `equipment` delay
   of 1 h are proposed; the uncaptioned photo gets a caption from what is
   visible; "Visitors" is listed under *Still to record*.
3. Untick the delay, edit the summary, *Apply selected* → summary saved,
   note added, caption set; the day's totals and the photo gallery update.
4. Unset the provider keys → the card explains it and still drafts from the
   records; *Dictate* keeps working in the browser.

## Tests

`backend/src/services/__tests__/daily-log-assistant.service.test.js` (day
bounds per time zone; draft with the evidence text, one image block, the
dictated note and normalisation of notes / delays / captions; stored run;
factual fallback without a provider and on outage; apply through the daily
log and photo services with caption skipping / overwrite; transcription
through the provider with configuration flags; provider content shapes) and
`frontend/scripts/daily-log-assistant-ui.test.mjs`.
