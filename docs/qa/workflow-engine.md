# Configurable workflow engine (OCTA-PLAT-WF-024)

## Where

- **Company › Workflows** (`/company/workflows`): the company library — one route per tool applies on every project; **Add starters** seeds one default per tool that mirrors the built-in approval plus a worked example (*Change orders above 50,000* with a finance branch at 250,000).
- **Project** routes: `GET/POST /projects/{id}/workflows/templates` (PM) — project routes win over company ones.
- **On the record**: change orders (register, selected row), commitments and pay applications (workspace side column) show the **Workflow** panel: the running route with its steps, who is waiting, your response buttons, *Decide on behalf* and *Cancel* for managers, a manual **Start workflow** when none is running, and earlier runs on request.
- **Dashboard › Decisions waiting on you**: every step assigned to you across projects, answerable in place; **Open** goes to the record.

## Tools

`change_order`, `commitment`, `sub_pay_app`, `ipc_certificate`, `budget_revision`, `submittal`, `correspondence`, `document_revision`. Each adapter (`backend/src/services/workflow-tools.js`) declares the **context fields** a template may test (amount, type, category, retention %, discipline…), the **trigger status** that starts a run automatically (change order *pending*, commitment *pending*, pay app *submitted*, certificate *submitted*, budget revision *submitted*; submittals, correspondence and drawings start by hand), and how to **apply** the outcome through the record's own service (`approveChangeOrder`, `approveCommitment` / `returnCommitment`, `approvePayApp` / `rejectPayApp`, `certifyIpc` / `rejectIpc`, budget-revision approve / reject, submittal approve / return, correspondence close, drawing publish / return) with `viaWorkflow: true`.

## Templates

A template belongs to the company (`projectId: null`) or one project and has:

- **Rules** — all must hold on the record's context for the template to be picked (`amount ≥ 50000`, `type in [subcontract]`…). Without rules the template is a **default** for its tool. Selection: project templates first, then company ones, highest priority first; the first rule-bearing match wins, else the default.
- **Steps** (max 30), the first one starts the run:
  - **Decision** — assignees (a person, everyone with a project role, everyone in a party role, everyone on a permission template), *days allowed* (SLA), *everyone must agree* (`requireAll`), escalation roles, and **responses** — each with a label, a tone (positive / negative / neutral), *comment required*, and a target: another step, *Finish – approved* or *Finish – not approved*.
  - **Branch** — one condition on the context, *when true* / *when false* targets.
  - **Notify** — roles (and users) to notify with a message, then a target.
- Templates are validated on save: unique step keys, at least one assignee per decision, every target exists, the start step exists (400 `WORKFLOW_TEMPLATE_*`).

## Runs

- **Automatic start**: when a record reaches its trigger status the service calls `maybeStart` after its transaction commits — no template, no run (records keep their built-in approval).
- **Manual start**: `POST /projects/{id}/workflows/instances { tool, recordId, templateId? }` (PM); one running instance per record (409 `WORKFLOW_ALREADY_RUNNING`).
- A run walks branches and notifications until a decision step, resolves the assignees (project assignments, org users with the role, active party members, project users on the permission template), creates one **assignment** per user with a due date, notifies them (`workflow.step_assigned`, high priority) and records `workflow.started` / `workflow.step_started` in the approval-event log (`workflowType = workflow_engine`). A step nobody can answer fails the start with 409 `WORKFLOW_STEP_UNASSIGNED`.
- **Responding** (`POST …/instances/{instanceId}/respond { response, comment }`, transition `workflow.respond` — every role and party): only a pending assignee of the current step, or a manager (`workflow.manage`) *on behalf* (recorded as an override that decides the step outright). A negative response ends the step at once; with *everyone must agree* the step waits for every positive response, otherwise the first response decides and the rest are skipped. Reaching an end sets `outcome` and **applies it to the record** in the same transaction; if the record's own rule refuses (e.g. a change order without proof) the run still completes with `applyStatus = failed` and the PM is told (`workflow.apply_failed`) — the panel shows the error so the decision can be applied from the record.
- **Lock**: while a run is deciding a record, its own approve / reject (and status edits that would approve or reject) answer 409 `WORKFLOW_RUNNING` with the instance id — respond to the workflow or cancel it. The engine's own writes pass `viaWorkflow` and are never blocked.
- **Cancel** (`POST …/cancel { reason }`, PM): skips pending assignments, unlocks the record.
- **Escalation**: `jobs/workflow-scheduler.js` scans hourly (`WORKFLOW_SCHEDULER_ENABLED`); an overdue pending assignment is marked escalated once, the instance's `escalationLevel` grows, the assignee is reminded (`workflow.step_overdue`) and the step's escalation roles are notified (`workflow.escalated`, default PM).
- **Inbox**: `GET /workflows/my-steps` (all projects) and `GET /projects/{id}/workflows/my-steps` list the pending assignments on current steps with their responses.

## Permissions

`workflow` module: read and submit for every role and party; create / update / delete / approve for PM; transitions `workflow.respond` (all) and `workflow.manage` (PM). Company templates: company admins. Party templates (owner, consultant, contractor, subcontractor) read and respond.

## Walkthrough

1. Company › Workflows → **Add starters** → open *Change orders above 50,000*: rule `Value at least 50,000`; steps *PM approval* (decision) → *Check amount* (branch ≥ 250,000) → *Finance sign-off* (decision, finance role) → approved.
2. Commercial › Change orders → submit a 300,000 change order: the Workflow panel shows the run on *PM approval* with the PM assigned and a due date; the PM's own **Approve** button on the row answers `WORKFLOW_RUNNING`.
3. As the PM: Dashboard › *Decisions waiting on you* → **Approve** → the run moves to *Finance sign-off*; as finance → **Approve** with a comment → run *Completed*, change order *approved*, budget updated.
4. Submit a 12,000 change order → the default *PM approval* route runs; **Reject** without a comment is refused; with a reason the run ends *not approved* and the change order is *rejected* with that reason.
5. Cancel a run → the record's own approve works again. Leave a step past its days → the hourly scan flags it *escalated* and notifies the PM.

## Tests

`backend/src/services/__tests__/workflow-engine.service.test.js` (validation, rule selection, start + assignments, branch routing to finance, small amounts skip finance, rejection applies to the record, requireAll + override, apply failure, cancel unlocks, escalation scan, seeding) and `frontend/scripts/workflow-engine-ui.test.mjs`.
