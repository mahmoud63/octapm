# Project knowledge assistant with citations (OCTA-AI-ASSIST-028)

## Where

- **Ask OctaPM** (sparkle button in the top bar): a slide-over with your conversations on the left and the thread on the right. Inside a project it answers from that project; anywhere else from every project you can open.
- API: `POST /projects/{id}/assistant/ask` and `POST /assistant/ask` (`{ question, conversationId?, projectId? }`), conversations (`GET/DELETE …/conversations[/{id}]`), `POST …/messages/{id}/feedback`, `POST /projects/{id}/assistant/actions`, `GET …/status`.

## How an answer is built

1. **Retrieval as the caller** (`retrieval.service.js`): the question goes through the global search — projects the caller can open, modules readable by role / permission template / party, register-level party visibility — plus, inside a project, the document content search (Postgres full text, embeddings when `EMBEDDINGS_PROVIDER` is set). The best hits become numbered sources; record bodies (RFI question and answer, submittal remarks, correspondence body, change-order description, NCR, punch item, task, meeting minutes, risk, activity dates / progress, commitment) are loaded so the model can quote them. Nothing is retrieved that the caller could not open by hand.
2. **Answer** (`ai-provider.service.js`): the model receives a strict system prompt (answer only from the numbered sources, cite `[n]`, say when the sources do not contain the answer, never invent), the project context, the sources and the last six turns of the conversation, and returns JSON — `answer` (markdown with `[n]`), `citations`, up to three `actions` (`create_rfi`, `create_task`, `open`). Provider: `AI_PROVIDER` = anthropic (default when `ANTHROPIC_API_KEY` is set), openai (`OPENAI_API_KEY`) or gemini (`GEMINI_API_KEY`); `AI_MODEL` overrides the model. Rate limits and overloads retry with backoff.
3. **Storage**: every question and answer is kept on an `AssistantConversation` (per user, optionally per project) with the citations, the suggested actions, the sources that were shown to the model, token usage, provider and model — so an answer can be audited later. Answers can be rated up / down.
4. **Degraded mode**: without a provider (or when it is down) the reply lists the matching sources instead of an answer and says so; the UI explains it.

## Citations and actions

- `[n]` in the answer is a chip that opens the record (workspace deep link) or document; the sources list repeats them with type, ref and project.
- **Suggested actions**: *Raise an RFI* (creates a **draft** RFI with the suggested subject and question), *Create a task*, *Open …*. Actions run through the record's own service and need `rfi.create` / `task.create` on the project; they are only available inside a project.

## Permissions

`assistant` module: read for every role and every party template. Retrieval is filtered per caller, so two people asking the same question can get different sources.

## Walkthrough

1. Open a project → sparkle button → *What did the specification say about pile cap links?* → the answer cites the spec document [1] and the RFI that resolved it [2]; click [2] to open the RFI.
2. Ask *Which RFIs are waiting on the consultant this week?* → the answer lists them with citations and suggests *Create a task* to chase them → the task is created and opens.
3. As a subcontractor party user, ask the same first question → only documents and records visible to that party are cited.
4. Unset the provider keys → answers become source lists with the "not configured" note.

## Tests

`backend/src/services/__tests__/assistant.service.test.js` (retrieval through the search layer with record bodies and numbered sources; model answer parsed into citations and actions with history; degraded mode when no provider or the provider fails; actions create draft RFIs and tasks; JSON parsing and provider resolution) and `frontend/scripts/assistant-ui.test.mjs`.
