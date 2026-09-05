# RFI drafting and response assistant (OCTA-AI-RFI-029)

Three helpers around the RFI workflow, all **draft-then-approve**: the form or
the reply box is filled, and nothing is created or posted until the person
submits it. Retrieval is the caller's own (`retrieval.service`, see
`docs/qa/assistant.md`): only specifications, drawings, prior RFIs, submittals
and change orders the caller could open by hand are shown to the model.

## Where

- **New RFI** dialog → *Draft with AI* (collapsible at the top): describe the
  issue in your own words → *Draft the RFI* → a proposed subject, question
  (citing the documents as `[n]`), discipline, spec section, priority and
  cost / schedule flags, plus *May already be answered* when a prior RFI or a
  document settles the point. *Use this draft* fills the form (the question
  is inserted with the citations spelled out); every field stays editable.
- **New RFI** dialog → under *Subject*: *Possibly asked before* appears while
  typing (≥ 6 characters, debounced) with prior RFIs across every project the
  person can open, this project first. Search only — no model call, works
  without a provider.
- **RFI workspace** → *Assistant* block above the reply box: *Summarise
  thread* (anyone who can read the RFI) and *Draft a response* (anyone who
  can respond, with an optional instruction line). The draft comes with a
  confidence badge, *The sources disagree* when the documents conflict,
  *Still needed to answer fully*, *Based on*, impact hints, sources and prior
  RFIs. *Use this draft* places the plain-text version in the reply box.

## API (tag "Assistant")

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `POST /projects/{id}/rfi/ai/draft` `{ prompt, specSection?, discipline?, activityId?, locationId? }` | `rfi.create` + `assistant.read` | `{ degraded, draft, similar, citations, message }`; 400 `RFI_AI_PROMPT_REQUIRED`. |
| `GET /projects/{id}/rfi/ai/similar?q=&limit=&excludeRfiId=` | `rfi.read` + `assistant.read` | Prior RFIs org-wide, `sameProject` first. |
| `POST /projects/{id}/rfi/{rfiId}/ai/response` `{ instructions? }` | `rfi.submit` + `assistant.read` | `{ degraded, suggestion: { response, responsePlain, confidence, basis, conflicts, openPoints, impacts, citations }, similar, message }`; 409 `RFI_ALREADY_CLOSED`. The RFI itself is excluded from the sources; the thread is always in the prompt. |
| `POST /projects/{id}/rfi/{rfiId}/ai/summary` | `rfi.read` + `assistant.read` | `{ degraded, summary: { summary, decisions, openPoints, suggestedNextStep, suggestedStatus }, message }`; without a provider a factual summary is built from the record. |

Drafts respect draft visibility (`rfi-workflow.getRfi` with the caller as
viewer) and API keys need the `assistant:read` scope on top of the RFI scope.

## Storage and feedback

Every run is stored as an `AssistantConversation` of `kind` `rfi_draft`,
`rfi_response` or `rfi_summary` (`recordType = rfi`, `recordId`) with the
prompt that was sent, the answer, citations, the sources shown to the model,
token usage, provider and model — the same audit trail as Ask OctaPM, but
these runs are **not listed** in the Ask OctaPM sheet (`kind = chat` only).
`message.id` in the response feeds the thumbs up / down
(`POST …/assistant/messages/{id}/feedback`).

## Degraded mode

Without a provider key: *Draft with AI* explains itself and stays closed to
model calls, *Possibly asked before* still works, *Draft a response* is
hidden and *Summarise thread* returns the factual summary. A provider outage
returns `degraded: true` with the reason and the sources that were found.

## Walkthrough

1. New RFI → *Draft with AI* → "lap at slab edge grid C looks short vs spec",
   spec section 03 30 00 → the draft cites the structural specification [1]
   and lists RFI-007 under *May already be answered*; *Use this draft* fills
   subject, question, discipline, spec, priority and the schedule flag.
2. Type "Pile cap" in Subject → *Possibly asked before* shows RFI-007
   (answered) — open it in a new tab, the form is kept.
3. Open RFI-020 as an assignee → *Draft a response* → medium confidence,
   *The sources disagree* (drawing 40d vs specification 50d), open point
   "confirm S-310 rev C" → *Use this draft* → the reply box holds the text
   with "(Document SPEC-S-01)" references → edit → *Answer officially*.
4. As the manager → *Summarise thread* → decisions / open points / suggested
   status; rate the summary.
5. Unset the provider keys → summaries come from the record, drafting is
   explained as not configured, similar RFIs still appear.

## Tests

`backend/src/services/__tests__/rfi-assistant.service.test.js` (draft with
references, already-answered mapping and similar RFIs; degraded mode; response
suggestion excluding the RFI itself, keeping the thread and instructions,
conflicts / open points / plain text, feedback on the stored run, 409 on
closed, provider outage; deterministic and model summaries; similar RFIs
across projects) and `frontend/scripts/rfi-assistant-ui.test.mjs`.
