'use strict';

/**
 * CERT-3 WP-0: the permission probe matrix (plan §4 WP-0, "Permission probe
 * matrix"; exit criterion E8).
 *
 * Every state change (and the few reads whose gate the plan certifies) that
 * WP-1 to WP-9 drive, as data: the permission key the route enforces, the
 * route (method, path, minimal valid body), the throwaway record a real run of
 * the transition needs, and how permission-probe.js probes it without
 * changing anything it does not own.
 *
 * The expected allow / deny per role is NOT written here. It is computed when
 * this module loads, from shared/permissions.json (read with fs, so the file
 * on disk at run time is the policy that is compared), with the same rules the
 * product applies:
 *
 *   backend/src/config/permissions.js getAllowedRoles: a transition named on
 *     the route decides when the module defines it; otherwise the action's
 *     list decides (a transition the JSON does not define silently falls back
 *     to the action: validateMatrix() refuses such an entry);
 *   backend/src/middleware/rbac.js hasPermission: an API key's scopes first
 *     (not used here), then COMPANY ADMINISTRATION: a company admin (membership
 *     isAdmin || isOwner) is allowed every action of user_management and
 *     project_parties and NOTHING ELSE; then a permission template attached by
 *     requireProjectAccess (none on the throwaway projects: the driver asserts
 *     template null); then the static policy for the effective role (the
 *     project-assignment role, else the organisation role) or an active party
 *     profile (none for staff personas).
 *
 * Guards that are not the permission JSON (route-level RBAC), each modelled
 * as the code at HEAD 886c9f1 has it:
 *   roles         requireRoles(...list): in the product the hard-coded list
 *                 decides; a template is asked only when the module (rbac
 *                 moduleForRequest: the mount segment) exists in the JSON.
 *                 The EXPECTATION is still the JSON's: the natural key (that
 *                 module, the method's action), so a list that drifts from the
 *                 JSON shows up as a mismatch (ROLE_LIST_DIFFERENCES lists the
 *                 ones known at load). /projects routes map to module
 *                 'project', which the JSON does not have (the route's list is
 *                 then the only rule), and requireRoles runs there BEFORE
 *                 requireProjectAccess, so the ORGANISATION role decides,
 *                 never the project-assignment role or a template.
 *   companyAdmin  requireCompanyAdmin: isCompanyAdmin only, whatever the role.
 *   projectAccess no module check at all: anyone who reaches the project.
 *   service       no route guard; a service decides (recorded, not compared).
 *
 * Company administration and module rights (the plan's assumption, reworded
 * by the adjudication: "no JSON module rights beyond user_management and
 * project_parties"; the D2 finance persona of 052 is an administrator): see
 * COMPANY_ADMIN below. In the permission-JSON sense an administrator gains
 * user_management and project_parties only; outside the JSON it gains
 * org-wide project visibility, the requireCompanyAdmin routes and a few
 * record-level allowances. The probe asserts the first and records the rest
 * for the owner (HR-A1), never failing on them.
 *
 * Probe modes (permission-probe.js): every guard listed runs before the
 * route's validators at HEAD (checked statically for every route here), so a
 * refused role is refused before anything else is read:
 *   ghost     the record ids named in `ghost` are a fresh UUID that exists
 *             nowhere; the body is the minimal valid body. A role the policy
 *             allows passes the guard and the handler answers 404 *_NOT_FOUND
 *             (nothing written); a refused role gets 403 FORBIDDEN.
 *   invalid   the body omits a required field or carries a wrong type; an
 *             allowed role gets the route's validation refusal (400, code
 *             asserted); nothing written.
 *   badParam  a path parameter is not of its kind (a date that is not a date);
 *             allowed: 400 VALIDATION_ERROR.
 *   badQuery  a query value is not of its kind (?dryRun=maybe); allowed: 400
 *             VALIDATION_ERROR.
 *   read      a GET; allowed: 200.
 *   effect    an idempotent recomputation on the throwaway project (CPM,
 *             cash-flow rebuild); allowed: 200.
 *   scenario  probed with real throwaway records by a named SCENARIO.
 *   observe   service-decided; the answers are recorded, not compared.
 *
 * Body tokens the driver substitutes: '@ghost' (the run's ghost UUID),
 * '@project' (the throwaway project), '@user:<persona key>' (a persona's user
 * id), '@stamp' (the run stamp), '@today' (YYYY-MM-DD).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── the policy, read when this module loads ─────────────────────────────────
const POLICY_PATH = process.env.CERT_PERMISSIONS_JSON || path.join(__dirname, '..', '..', '..', '..', 'shared', 'permissions.json');
const POLICY_TEXT = fs.readFileSync(POLICY_PATH, 'utf8');
const POLICY = JSON.parse(POLICY_TEXT.replace(/^﻿/, ''));
const POLICY_SHA256 = crypto.createHash('sha256').update(POLICY_TEXT).digest('hex');
const ROLES = POLICY.roles.map((role) => role.id);
const ACTIONS = POLICY.actions;

/** rbac.js COMPANY_ADMIN_MODULES at HEAD. */
const COMPANY_ADMIN_MODULES = Object.freeze(['user_management', 'project_parties']);

/** config/permissions.js getAllowedRoles, verbatim in effect. */
const allowedRoles = (module, action, transition = null) => {
  const modulePolicy = POLICY.modules[module];
  if (!modulePolicy) return [];
  if (transition && modulePolicy.transitions && modulePolicy.transitions[transition]) return modulePolicy.transitions[transition];
  return (modulePolicy.actions && modulePolicy.actions[action]) || [];
};

/** rbac.js hasPermission for a staff persona with no template and no party profile. */
const policyAllows = ({ module, action, transition = null }, { role, isCompanyAdmin = false }) =>
  (isCompanyAdmin && COMPANY_ADMIN_MODULES.includes(module)) || allowedRoles(module, action, transition).includes(role);

// ── guard and probe builders ────────────────────────────────────────────────
const P = (module, action, transition = null, extra = {}) => ({ kind: 'permission', module, action, transition, ...extra });
/** requireRoles: `module` is rbac moduleForRequest (the mount segment), `action` ACTION_BY_METHOD. */
const R = (module, action, roles, extra = {}) => ({ kind: 'roles', module, action, roles, ...extra });
const ADMIN = Object.freeze({ kind: 'companyAdmin' });
const OPEN = Object.freeze({ kind: 'projectAccess' });
const SVC = (note) => ({ kind: 'service', note });

const NOT_FOUND = Object.freeze({ status: 404, codePattern: 'NOT_FOUND$' });
const VALIDATION = Object.freeze({ status: 400, code: 'VALIDATION_ERROR' });
const ghost = (params, extra = {}) => ({ mode: 'ghost', ghost: params, allow: NOT_FOUND, ...extra });
const invalid = (body, allow = VALIDATION, extra = {}) => ({ mode: 'invalid', body, allow, ...extra });
const badParam = (params, extra = {}) => ({ mode: 'badParam', params, allow: VALIDATION, ...extra });
const badQuery = (query, extra = {}) => ({ mode: 'badQuery', query, allow: VALIDATION, ...extra });
const read = (extra = {}) => ({ mode: 'read', allow: { status: 200 }, ...extra });
const effect = (extra = {}) => ({ mode: 'effect', allow: { status: 200 }, ...extra });
const scenario = (name) => ({ mode: 'scenario', scenario: name });
const observe = (params, extra = {}) => ({ mode: 'observe', ghost: params, ...extra });

const PRJ = '/projects/{projectId}';
const REASON = 'CERT3 WP-0 permission probe';

/** One transition. `path` is relative to /api/v1 and uses the route's own parameter names. */
const T = (id, wp, method, routePath, guard, probe, { body, needs = '', plan = '', notes = [], serviceRule = null, scope = null } = {}) => ({
  id,
  wp,
  method,
  path: routePath,
  scope: scope || (routePath.startsWith(PRJ) ? 'project' : 'org'),
  guard,
  probe,
  body: body === undefined ? {} : body,
  needs,
  plan,
  notes,
  serviceRule,
});

// ── the transitions ─────────────────────────────────────────────────────────
const TRANSITIONS = [
  // ── WP-1 schedule: import, revisions, activation, CPM, baseline ──────────
  T('WP1.import.xer', 'WP-1', 'POST', `${PRJ}/import/xer`, P('schedule', 'create'), invalid({}, { status: 400, code: 'NO_FILE' }),
    { body: { file: 'multipart field "file": XER F1 (14 activities, hours)', replaceExisting: 'false' }, needs: 'the project only; a real run stages a draft revision', plan: 'WP-1 conversion; "the site engineer gets 403"', notes: ['uploadLimiter runs before the handler (counts against RATE_LIMIT_UPLOAD_MAX per project and user)'] }),
  T('WP1.import.p6xml', 'WP-1', 'POST', `${PRJ}/import/p6xml`, P('schedule', 'create'), invalid({}, { status: 400, code: 'NO_FILE' }),
    { body: { file: 'multipart "file": F1 as P6 XML' }, needs: 'the project only', plan: 'WP-1 parity' }),
  T('WP1.import.msp', 'WP-1', 'POST', `${PRJ}/import/msp`, P('schedule', 'create'), invalid({}, { status: 400, code: 'NO_FILE' }),
    { body: { file: 'multipart "file": F1 as MSPDI' }, needs: 'the project only', plan: 'WP-1 parity; MSP negative slack' }),
  T('WP1.import.xlsx', 'WP-1', 'POST', `${PRJ}/import/xlsx`, P('schedule', 'create'), invalid({}, { status: 400, code: 'NO_FILE' }),
    { body: { file: 'multipart "file": F1 as xlsx with a calendar column' }, needs: 'the project only', plan: 'WP-1 parity; "an xlsx dry run writes nothing"' }),
  T('WP1.revision.submit', 'WP-1', 'POST', `${PRJ}/schedule/revisions/{revisionId}/submit-review`, P('schedule', 'submit', 'revision.submit_review'), ghost(['revisionId']),
    { body: {}, needs: 'a draft revision staged by an import', plan: 'WP-1 "Planner submits"' }),
  T('WP1.revision.approve', 'WP-1', 'POST', `${PRJ}/schedule/revisions/{revisionId}/approve`, P('schedule', 'approve', 'revision.approve'), ghost(['revisionId']),
    { body: {}, needs: 'a revision submitted for review', plan: 'WP-1 "Planner and site engineer approval: 403. PM approval: approved"' }),
  T('WP1.revision.reject', 'WP-1', 'POST', `${PRJ}/schedule/revisions/{revisionId}/reject`, P('schedule', 'approve', 'revision.reject'), ghost(['revisionId']),
    { body: { reason: REASON }, needs: 'a submitted revision', plan: 'WP-1 REJECTION_REASON_REQUIRED; rejecting an approved revision 409' }),
  T('WP1.revision.activate', 'WP-1', 'POST', `${PRJ}/schedule/revisions/{revisionId}/activate`, P('schedule', 'approve', 'revision.activate'), ghost(['revisionId']),
    { body: { mappings: [] }, needs: 'an approved revision; mappings for every existing activity', plan: 'WP-1 activation, mapping, retirement' }),
  T('WP1.revision.rollback', 'WP-1', 'POST', `${PRJ}/schedule/revisions/{revisionId}/rollback`, P('schedule', 'approve', 'revision.rollback'), ghost(['revisionId']),
    { body: { reason: REASON }, needs: 'an activated revision with a predecessor activation', plan: 'WP-1 supersede and roll back; WP-9 schedule history' }),
  T('WP1.revision.baseline', 'WP-1', 'POST', `${PRJ}/schedule/revisions/{revisionId}/baseline`, P('schedule', 'baseline', 'revision.baseline'), ghost(['revisionId']),
    { body: {}, needs: 'an activated revision, BOQ covered', plan: 'WP-1 baseline gates' }),
  T('WP1.baseline.lock', 'WP-1', 'POST', `${PRJ}/schedule/baseline`, P('schedule', 'baseline', 'revision.baseline'), invalid({ revisionId: 'not-a-uuid' }),
    { body: {}, needs: 'activated revision, priced BOQ fully allocated', plan: 'WP-1 "The planner gets 403"; BOQ_REQUIRED_FOR_BASELINE ...' }),
  T('WP1.cpm.recalculate', 'WP-1', 'POST', `${PRJ}/import/recalculate-cpm`, P('schedule', 'update'), effect(),
    { body: {}, needs: 'the project (idempotent recomputation)', plan: 'WP-1 "CPM runs"' }),
  T('WP1.activity.create', 'WP-1', 'POST', `${PRJ}/activities`, P('schedule', 'create'), invalid({}),
    { body: { name: 'CERT3 probe @stamp', engineerIds: ['@user:site'], startDate: '2026-01-05', endDate: '2026-01-12', duration: 5 }, needs: 'the project; engineerIds must be members of the organisation', plan: 'WP-1 "Activities and milestones are created and edited"' }),
  T('WP1.activity.update', 'WP-1', 'PATCH', `${PRJ}/activities/{id}`, P('schedule', 'update'), ghost(['id']),
    { body: { name: 'M900 Completion' }, needs: 'an activity', plan: 'WP-1 "Renaming M900 after CPM: expected 200"' }),
  T('WP1.project.update', 'WP-1', 'PATCH', '/projects/{id}', R('project', 'update', ['pm', 'planning_eng'], { orgRoleOnly: true }), invalid({ startDate: 'not-a-date' }, VALIDATION, { params: { id: '@project' } }),
    { body: { startDate: '2026-01-12' }, needs: 'the project', scope: 'project', plan: 'WP-1 "The project start date and calendar change"; WP-7 weatherAllowanceDays; HR-S6',
      notes: ['requireRoles runs before requireProjectAccess: the organisation role decides, never the project-assignment role or a template ("project" is not a JSON module)'] }),
  T('WP1.schedule.read', 'WP-1', 'GET', `${PRJ}/schedule`, P('schedule', 'read'), read(),
    { needs: 'the project', plan: 'WP-1 live statuses across /schedule' }),

  // ── WP-2 progress, hold points, quantities, daily reports ─────────────────
  T('WP2.progress.submit', 'WP-2', 'POST', `${PRJ}/activities/{id}/progress`, P('progress', 'submit', 'submission.submit'), ghost(['id']),
    { body: { pctComplete: 40 }, needs: 'an activity the submitter is assigned to (ActivityAssignment via engineerIds) unless PM or planner', plan: 'WP-2 T1/T2 "Site on A330: 403. Planner override: 200"',
      serviceRule: { code: 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED', status: 403, appliesTo: 'roles outside progress.service PROGRESS_ASSIGNMENT_OVERRIDE_ROLES {pm, planning_eng} without an assignment', scenario: 'S1-progress-submit' } }),
  T('WP2.progress.approve', 'WP-2', 'POST', `${PRJ}/activities/{id}/progress-submissions/{submissionId}/approve`, P('progress', 'approve', 'submission.approve'), ghost(['id', 'submissionId']),
    { body: {}, needs: 'a submitted progress submission', plan: 'WP-2 T1 "Site approval: 403. QS approval: official 40"', serviceRule: { scenario: 'S2-progress-approve' } }),
  T('WP2.progress.reject', 'WP-2', 'POST', `${PRJ}/activities/{id}/progress-submissions/{submissionId}/reject`, P('progress', 'approve', 'submission.reject'), ghost(['id', 'submissionId']),
    { body: { reason: REASON }, needs: 'a submitted submission', plan: 'WP-2 APPROVED_PROGRESS_LOCKED' }),
  T('WP2.progress.method', 'WP-2', 'PUT', `${PRJ}/activities/{id}/progress-method`, P('progress', 'update', 'method.configure'), ghost(['id']),
    { body: { method: 'percent' }, needs: 'an activity', plan: 'WP-2 T5 method lock' }),
  T('WP2.progress.bulk', 'WP-2', 'POST', `${PRJ}/activities/bulk-progress`, P('progress', 'submit', 'submission.submit'), ghost([]),
    { body: { updates: [{ activityId: '@ghost', pctComplete: 10 }] }, needs: 'activities', plan: 'WP-2 "A random id: 404 with its index"' }),
  T('WP2.progress.import', 'WP-2', 'POST', `${PRJ}/import/progress`, P('progress', 'submit', 'submission.submit'), badQuery({ dryRun: 'maybe' }),
    { body: { file: 'multipart "file": a progress XER' }, needs: 'the project', plan: 'WP-2 "Progress import acts under the importer\'s own authority"', notes: ['uploadLimiter runs before the query validator'] }),
  T('WP2.quantity.create', 'WP-2', 'POST', `${PRJ}/quantity-progress`, P('progress', 'submit', 'submission.submit'), invalid({}),
    { body: { activityId: '<A310>', boqItemId: '<A310 item>', quantity: 90, date: '2026-02-10', unit: 'm2', clientRequestId: 'cert3-@stamp' }, needs: 'an activity on the quantity method with an allocated BOQ item', plan: 'WP-2 quantities' }),
  T('WP2.quantity.update', 'WP-2', 'PATCH', `${PRJ}/quantity-progress/{entryId}`, P('progress', 'submit', 'submission.submit'), ghost(['entryId']),
    { body: { quantity: 90 }, needs: 'a quantity entry', plan: 'WP-2 "PATCH of an approved entry: 409"' }),
  T('WP2.quantity.submit', 'WP-2', 'POST', `${PRJ}/quantity-progress/{entryId}/submit`, P('progress', 'submit', 'submission.submit'), ghost(['entryId']),
    { body: {}, needs: 'a draft quantity entry', plan: 'WP-2 entries in every state' }),
  T('WP2.quantity.view', 'WP-2', 'GET', `${PRJ}/boq/items/{itemId}/quantities`, P('boq', 'read'), ghost(['itemId']),
    { needs: 'a BOQ item', plan: 'WP-2 the six quantity figures; QUANTITY_FIGURES_WITHHELD without boq:read' }),
  T('WP2.dailyReport.create', 'WP-2', 'POST', `${PRJ}/daily-reports`, P('progress', 'submit', 'daily_report.submit'), invalid({}),
    { body: { activityId: '<activity>', date: '@today', pctProgress: 25 }, needs: 'an activity', plan: 'WP-2 daily-report approval through the progress gates' }),
  T('WP2.dailyReport.submit', 'WP-2', 'POST', `${PRJ}/daily-reports/{reportId}/submit`, P('progress', 'submit', 'daily_report.submit'), ghost(['reportId']),
    { body: {}, needs: 'a draft daily report' }),
  T('WP2.dailyReport.approve', 'WP-2', 'POST', `${PRJ}/daily-reports/{reportId}/approve`, P('progress', 'approve', 'daily_report.approve'), ghost(['reportId']),
    { body: {}, needs: 'a submitted daily report', plan: 'WP-2 "Daily-report approval with an open hold: 409"' }),
  T('WP2.dailyReport.reject', 'WP-2', 'POST', `${PRJ}/daily-reports/{reportId}/reject`, P('progress', 'approve', 'daily_report.reject'), ghost(['reportId']),
    { body: { reason: REASON }, needs: 'a submitted daily report' }),
  T('WP2.form.create', 'WP-2', 'POST', `${PRJ}/forms`, P('inspection', 'create'), invalid({}),
    { body: { templateId: '<form ITP template>', activityId: '<A130>' }, needs: 'an active form template', plan: 'WP-2 T4 form ITP instance on A130' }),
  T('WP2.form.start', 'WP-2', 'POST', `${PRJ}/forms/{instanceId}/start`, P('inspection', 'submit', 'inspection.start'), ghost(['instanceId']),
    { body: {}, needs: 'a scheduled instance' }),
  T('WP2.form.responses', 'WP-2', 'PUT', `${PRJ}/forms/{instanceId}/responses`, P('inspection', 'submit', 'inspection.start'), ghost(['instanceId']),
    { body: { responses: [{ itemId: '@ghost', value: 'pass' }] }, needs: 'an in-progress instance', plan: 'WP-2 T4 "Answer fail and complete"' }),
  T('WP2.form.complete', 'WP-2', 'POST', `${PRJ}/forms/{instanceId}/complete`, P('inspection', 'submit', 'inspection.complete'), ghost(['instanceId']),
    { body: {}, needs: 'an in-progress instance with every required answer', plan: 'WP-2 T4; FORM_INCOMPLETE' }),
  T('WP2.form.sign', 'WP-2', 'POST', `${PRJ}/forms/{instanceId}/signatures`, P('inspection', 'submit', 'inspection.sign'), ghost(['instanceId']),
    { body: { role: 'inspector', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }, needs: 'an instance with a required inspector signature', plan: 'WP-8 form ITP with a required inspector signature' }),
  T('WP2.form.close', 'WP-2', 'POST', `${PRJ}/forms/{instanceId}/close`, P('inspection', 'approve', 'inspection.close'), ghost(['instanceId']),
    { body: {}, needs: 'a completed instance' }),
  T('WP2.form.reopen', 'WP-2', 'POST', `${PRJ}/forms/{instanceId}/reopen`, P('inspection', 'approve', 'inspection.reopen'), ghost(['instanceId']),
    { body: { reason: REASON }, needs: 'a completed or closed instance', plan: 'WP-2 T4 "The quality engineer reopens with a reason"' }),
  T('WP2.form.void', 'WP-2', 'POST', `${PRJ}/forms/{instanceId}/void`, P('inspection', 'approve', 'inspection.void'), ghost(['instanceId']),
    { body: { reason: REASON }, needs: 'an open instance', plan: 'WP-2 T4 "Void without a reason: 400 FORM_REASON_REQUIRED. Site engineer void: 403"' }),
  T('WP2.formTemplate.create', 'WP-2', 'POST', `${PRJ}/forms/templates`, P('inspection', 'update', 'inspection.template_admin'), invalid({}),
    { body: { name: 'CERT3 ITP @stamp', type: 'itp', sections: [{ title: 'Hold', items: [] }] }, needs: 'the project', plan: 'WP-2 the retroactive template edit; WP-8 2 hold points' }),
  T('WP2.formTemplate.update', 'WP-2', 'PATCH', `${PRJ}/forms/templates/{templateId}`, P('inspection', 'update', 'inspection.template_admin'), ghost(['templateId']),
    { body: { name: 'CERT3 ITP edited' }, needs: 'a project form template', plan: 'WP-2 retroactive template edit (HR-Q2)' }),
  T('WP2.holdPoints.read', 'WP-2', 'GET', `${PRJ}/forms/hold-points`, P('inspection', 'read'), read(),
    { needs: 'the project', plan: 'WP-2 T4 "/forms/hold-points shows 1 open"' }),
  T('WP2.dailyLog.entryAdd', 'WP-2', 'POST', `${PRJ}/daily-logs/{date}/entries/{section}`, P('progress', 'submit', 'daily_log.submit'), badParam({ date: 'not-a-date', section: 'quantities' }),
    { body: { activityId: '<A310>', boqItemId: '<item>', quantity: 30, unit: 'm2' }, needs: 'a daily log day (created on first write); for quantities an allocated item', plan: 'WP-2 "Daily log with 30 m2: exactly one entry"; WP-8 manpower and party entries' }),

  // ── WP-3 earned value, reporting periods, cost loading, budget revisions ──
  T('WP3.ev.read', 'WP-3', 'GET', `${PRJ}/reports/ev`, P('cost', 'read'), read(),
    { needs: 'the project', plan: 'WP-3 T1-T7' }),
  T('WP3.period.create', 'WP-3', 'POST', `${PRJ}/reports/periods`, P('cost', 'create'), invalid({}),
    { body: { code: 'CERT3-@stamp', periodStart: '2026-01-01', periodEnd: '2026-01-31', cutoffDate: '2026-01-31' }, needs: 'the project', plan: 'WP-3 periods: duplicate code 409; end before start 400' }),
  T('WP3.period.lock', 'WP-3', 'POST', `${PRJ}/reports/periods/{periodId}/lock`, P('cost', 'approve', 'reporting_period.lock'), ghost(['periodId']),
    { body: {}, needs: 'an open reporting period', plan: 'WP-3 "Lock as planner: 403. Finance while blocked: 409"' }),
  T('WP3.period.override', 'WP-3', 'POST', `${PRJ}/reports/periods/{periodId}/lock`, P('cost', 'approve', 'reporting_period.lock', { serviceTransition: 'reporting_period.override' }), scenario('S3-period-override'),
    { body: { overrideReason: REASON }, needs: 'an open period whose readiness gate is blocked', plan: 'WP-3 "Finance with an override: 403. PM with a reason: snapshot"',
      serviceRule: { code: 'REPORTING_READINESS_OVERRIDE_FORBIDDEN', status: 403, appliesTo: 'earned-value.service resolveReportingReadinessOverride: normalizeRoleId(userRole) !== "pm" (hard-coded; JSON cost.transitions.reporting_period.override is consulted nowhere)', scenario: 'S3-period-override' } }),
  T('WP3.costLoading.create', 'WP-3', 'POST', `${PRJ}/reports/cost-loading`, P('cost', 'create'), invalid({}),
    { body: { activityId: '<A110>', plannedDate: '2026-01-23', plannedValue: 60000 }, needs: 'an activity', plan: 'WP-3 approved cost loadings' }),
  T('WP3.costLoading.submit', 'WP-3', 'POST', `${PRJ}/reports/cost-loading/{id}/submit`, P('cost', 'submit'), ghost(['id']), { body: {}, needs: 'a draft cost loading' }),
  T('WP3.costLoading.approve', 'WP-3', 'POST', `${PRJ}/reports/cost-loading/{id}/approve`, P('cost', 'approve'), ghost(['id']), { body: {}, needs: 'a submitted cost loading', plan: 'WP-3 "Loadings in a locked period are refused (409)"' }),
  T('WP3.costLoading.reject', 'WP-3', 'POST', `${PRJ}/reports/cost-loading/{id}/reject`, P('cost', 'approve'), ghost(['id']), { body: { reason: REASON }, needs: 'a submitted cost loading' }),
  T('WP3.budgetRevision.create', 'WP-3', 'POST', `${PRJ}/budget-revisions`, P('cost', 'create'), invalid({}),
    { body: { title: 'CERT3 BR @stamp', changeType: 'addition', amount: 13000, effectiveDate: '2026-03-01' }, needs: 'the project', plan: 'WP-3 T5 +13,000; WP-6 B6; WP-9 VO-999 link' }),
  T('WP3.budgetRevision.update', 'WP-3', 'PATCH', `${PRJ}/budget-revisions/{revisionId}`, P('cost', 'update'), ghost(['revisionId']), { body: { notes: 'edited' }, needs: 'a budget revision', plan: 'WP-3 L112' }),
  T('WP3.budgetRevision.delete', 'WP-3', 'DELETE', `${PRJ}/budget-revisions/{revisionId}`, P('cost', 'delete'), ghost(['revisionId']), { needs: 'a budget revision', plan: 'WP-3 T5 "Deleting it (L112) is expected to be refused or audited"' }),
  T('WP3.forecast.read', 'WP-3', 'GET', `${PRJ}/forecast`, P('schedule', 'read'), read(), { needs: 'the project', plan: 'WP-3 forecast; "The site engineer sees no money fields" (withholding, not a refusal)' }),

  // ── WP-4 commercial: change events, prime COs, commitments, IPC, pay apps, cash flow
  T('WP4.changeEvent.create', 'WP-4', 'POST', `${PRJ}/change-events`, P('change_event', 'create'), invalid({}),
    { body: { title: 'CERT3 E1 @stamp', type: 'owner_change', lines: [{ description: 'Line A', romAmount: 6000 }, { description: 'Line B', romAmount: 4000 }] }, needs: 'the project', plan: 'WP-4 E1' }),
  T('WP4.changeEvent.update', 'WP-4', 'PATCH', `${PRJ}/change-events/{changeEventId}`, P('change_event', 'update'), ghost(['changeEventId']), { body: { title: 'edited' }, needs: 'an open change event', plan: 'WP-4 E1 "PATCH ... refused with their codes"' }),
  T('WP4.changeEvent.rfqSend', 'WP-4', 'POST', `${PRJ}/change-events/{changeEventId}/rfqs`, P('change_event', 'submit', 'change_event.rfq_send'), ghost(['changeEventId']),
    { body: { recipients: [{ companyName: 'CERT3-PERM-@stamp-Vendor-A', contactEmail: 'vendor-a@c087.octapm-cert.test' }] }, needs: 'an open change event with lines', plan: 'WP-4 RFQs to two vendors' }),
  T('WP4.changeEvent.quoteAccept', 'WP-4', 'POST', `${PRJ}/change-events/rfqs/{rfqId}/accept`, P('change_event', 'approve', 'change_event.quote_accept'), ghost(['rfqId']), { body: {}, needs: 'a quoted RFQ', plan: 'WP-4 E1 "A\'s RFQ is quoted 9,500 and accepted"' }),
  T('WP4.changeEvent.convert', 'WP-4', 'POST', `${PRJ}/change-events/{changeEventId}/convert`, P('change_event', 'approve', 'change_event.convert'), ghost(['changeEventId']), { body: {}, needs: 'a priced change event', plan: 'WP-4 E1, E2' }),
  T('WP4.changeEvent.close', 'WP-4', 'POST', `${PRJ}/change-events/{changeEventId}/close`, P('change_event', 'approve', 'change_event.close'), ghost(['changeEventId']), { body: {}, needs: 'a change event' }),
  T('WP4.changeEvent.void', 'WP-4', 'POST', `${PRJ}/change-events/{changeEventId}/void`, P('change_event', 'approve', 'change_event.void'), ghost(['changeEventId']), { body: { reason: REASON }, needs: 'a change event', plan: 'WP-4 E1; WP-9 "void releases the exception"' }),
  T('WP4.co.create', 'WP-4', 'POST', `${PRJ}/change-orders`, R('change_order', 'create', ['pm', 'qs']), invalid({}),
    { body: { description: 'CERT3 CO @stamp', activityId: '<activity>' }, needs: 'the project', plan: 'WP-4 prime COs "draft only at creation"' }),
  T('WP4.co.update', 'WP-4', 'PATCH', `${PRJ}/change-orders/{id}`, R('change_order', 'update', ['pm', 'qs']), ghost(['id']), { body: { description: 'edited' }, needs: 'a draft CO', plan: 'WP-4 "an approved CO is locked"' }),
  T('WP4.co.submit', 'WP-4', 'POST', `${PRJ}/change-orders/{id}/submit`, P('change_order', 'submit', 'change_order.submit'), ghost(['id']), { body: {}, needs: 'a draft CO with impact summaries, an activity and a document' }),
  T('WP4.co.approve', 'WP-4', 'POST', `${PRJ}/change-orders/{id}/approve`, P('change_order', 'approve', 'change_order.approve'), ghost(['id']), { body: {}, needs: 'a submitted CO', plan: 'WP-4 approval writes BR-<ref>' }),
  T('WP4.co.reject', 'WP-4', 'POST', `${PRJ}/change-orders/{id}/reject`, P('change_order', 'approve', 'change_order.reject'), ghost(['id']), { body: { reason: REASON }, needs: 'a submitted CO', plan: 'WP-4 E3 reject' }),
  T('WP4.co.reopen', 'WP-4', 'POST', `${PRJ}/change-orders/{id}/reopen`, P('change_order', 'submit', 'change_order.reopen'), ghost(['id']), { body: {}, needs: 'a rejected CO', plan: 'WP-4 E3 reopen' }),
  T('WP4.co.archive', 'WP-4', 'DELETE', `${PRJ}/change-orders/{id}`, R('change_order', 'delete', ['pm']), ghost(['id']), { needs: 'a pending CO', plan: 'WP-4 E3 "archiving a pending CO lowers the pending value"' }),
  T('WP4.co.fromRfi', 'WP-4', 'POST', `${PRJ}/rfi/{rfiId}/convert-to-change`, P('change_order', 'create'), ghost(['rfiId']), { body: {}, needs: 'an RFI', plan: 'WP-4 "Prime COs ... one from an RFI"' }),
  T('WP4.commitment.create', 'WP-4', 'POST', `${PRJ}/commitments`, P('commitment', 'create'), invalid({}),
    { body: { title: 'CERT3 SC-1 @stamp', type: 'subcontract', lines: [{ description: 'Scope', amount: 100000 }] }, needs: 'the project; a vendor company', plan: 'WP-4 commitments' }),
  T('WP4.commitment.lines', 'WP-4', 'PUT', `${PRJ}/commitments/{commitmentId}/lines`, P('commitment', 'update'), ghost(['commitmentId']), { body: { lines: [] }, needs: 'a draft commitment', plan: 'WP-4 "the SOV is locked after approval"' }),
  T('WP4.commitment.insurance', 'WP-4', 'PUT', `${PRJ}/commitments/{commitmentId}/insurance`, P('commitment', 'update'), ghost(['commitmentId']), { body: { insurance: [] }, needs: 'a commitment with required insurance' }),
  T('WP4.commitment.submit', 'WP-4', 'POST', `${PRJ}/commitments/{commitmentId}/submit`, P('commitment', 'submit', 'commitment.submit'), ghost(['commitmentId']), { body: {}, needs: 'a draft commitment' }),
  T('WP4.commitment.approve', 'WP-4', 'POST', `${PRJ}/commitments/{commitmentId}/approve`, P('commitment', 'approve', 'commitment.approve'), ghost(['commitmentId']), { body: {}, needs: 'a pending commitment' }),
  T('WP4.commitment.execute', 'WP-4', 'POST', `${PRJ}/commitments/{commitmentId}/execute`, P('commitment', 'approve', 'commitment.execute'), ghost(['commitmentId']),
    { body: {}, needs: 'an approved commitment with its executed agreement', plan: 'WP-4 "one executed on a PM override"', notes: ['the override flag is honoured only with canOverride = hasPermission(commitment approve, transition commitment.void) — the void transition (pm) stands in for an override key the JSON does not have'] }),
  T('WP4.commitment.close', 'WP-4', 'POST', `${PRJ}/commitments/{commitmentId}/close`, P('commitment', 'approve', 'commitment.close'), ghost(['commitmentId']), { body: {}, needs: 'an executed commitment', plan: 'WP-4 P6 final application closeout' }),
  T('WP4.commitment.void', 'WP-4', 'DELETE', `${PRJ}/commitments/{commitmentId}`, P('commitment', 'delete', 'commitment.void'), ghost(['commitmentId']), { needs: 'a commitment', plan: 'WP-4 "A commitment CO on a voided parent"' }),
  T('WP4.commitmentCo.create', 'WP-4', 'POST', `${PRJ}/commitments/{commitmentId}/change-orders`, P('commitment', 'create'), ghost(['commitmentId']), { body: { title: 'CERT3-PERM-@stamp-CCO', value: 10000 }, needs: 'a commitment', plan: 'WP-4 C2 "a CO of +10,000 counts only once approved"' }),
  T('WP4.commitmentCo.update', 'WP-4', 'PATCH', `${PRJ}/commitments/change-orders/{changeOrderId}`, P('commitment', 'update'), ghost(['changeOrderId']), { body: { title: 'edited' }, needs: 'a draft commitment CO' }),
  T('WP4.commitmentCo.submit', 'WP-4', 'POST', `${PRJ}/commitments/change-orders/{changeOrderId}/submit`, P('commitment', 'submit', 'commitment_co.submit'), ghost(['changeOrderId']), { body: {}, needs: 'a draft commitment CO', plan: 'WP-4 "commitment COs in every state"' }),
  T('WP4.commitmentCo.approve', 'WP-4', 'POST', `${PRJ}/commitments/change-orders/{changeOrderId}/approve`, P('commitment', 'approve', 'commitment_co.approve'), ghost(['changeOrderId']), { body: {}, needs: 'a pending commitment CO' }),
  T('WP4.commitmentCo.reject', 'WP-4', 'POST', `${PRJ}/commitments/change-orders/{changeOrderId}/reject`, P('commitment', 'approve', 'commitment_co.approve'), ghost(['changeOrderId']), { body: { reason: REASON }, needs: 'a pending commitment CO' }),
  T('WP4.commitmentCo.void', 'WP-4', 'POST', `${PRJ}/commitments/change-orders/{changeOrderId}/void`, P('commitment', 'update'), ghost(['changeOrderId']), { body: { reason: REASON }, needs: 'a commitment CO', notes: ['void carries no transition: commitment update (pm, qs, procurement) may void a commitment CO'] }),
  T('WP4.ipc.create', 'WP-4', 'POST', `${PRJ}/ipc`, P('ipc', 'create', 'period.create'), invalid({ period: 12345 }),
    { body: { period: '2026-09' }, needs: 'an established contract value', plan: 'WP-4 "At least four IPC periods"' }),
  T('WP4.ipc.itemUpdate', 'WP-4', 'PATCH', `${PRJ}/ipc/{period}/items/{id}`, P('ipc', 'update', 'item.update'), ghost(['period', 'id']), { body: { qty: 1 }, needs: 'a draft IPC period with items', plan: 'WP-4 I3 caps' }),
  T('WP4.ipc.adjustments', 'WP-4', 'PATCH', `${PRJ}/ipc/{period}/adjustments`, P('ipc', 'update', 'item.update'), ghost(['period']), { body: {}, needs: 'a draft IPC period', plan: 'WP-4 materials on site, deductions, tax' }),
  T('WP4.ipc.submit', 'WP-4', 'POST', `${PRJ}/ipc/{period}/submit`, P('ipc', 'submit', 'period.submit'), ghost(['period']), { body: {}, needs: 'a draft IPC period', plan: 'WP-4 I4, I11' }),
  T('WP4.ipc.certify', 'WP-4', 'POST', `${PRJ}/ipc/{period}/certify`, P('ipc', 'certify', 'period.certify'), ghost(['period']),
    { body: {}, needs: 'a submitted IPC period', plan: 'WP-4 I1, I5, I6',
      serviceRule: { code: 'IPC_PM_OVERRIDE_REQUIRED', status: 403, appliesTo: 'ipc.service: an over-certification override is honoured only when normalizedRole === "pm" (no JSON key); probed in WP-4 I6, not here' } }),
  T('WP4.ipc.invoice', 'WP-4', 'POST', `${PRJ}/ipc/{period}/invoice/issue`, P('ipc', 'approve', 'invoice.issue'), ghost(['period']), { body: {}, needs: 'a certified IPC period', plan: 'WP-4 the invoice' }),
  T('WP4.ipc.payment', 'WP-4', 'POST', `${PRJ}/ipc/{period}/payments`, P('ipc', 'approve', 'payment.record'), ghost(['period']), { body: { amount: 38000, paymentDate: '@today' }, needs: 'an invoiced IPC period', plan: 'WP-4 I12 "PM cannot record a payment (L211)"' }),
  T('WP4.ipc.retentionRelease', 'WP-4', 'POST', `${PRJ}/ipc/{period}/retention-release`, P('ipc', 'approve', 'retention.release'), ghost(['period']), { body: { amount: 2000 }, needs: 'a paid IPC period with retention held', plan: 'WP-4 "paid with retention released"' }),
  T('WP4.contract.manage', 'WP-4', 'PATCH', `${PRJ}/prime-contract`, P('ipc', 'update', 'contract.manage'), invalid({}),
    { body: { originalValueSource: 'manual', originalValue: 2000000 }, needs: 'the project', plan: 'WP-4 "Contract value established"; retention cap, tax' }),
  T('WP4.advance.record', 'WP-4', 'POST', `${PRJ}/prime-contract/advances`, P('ipc', 'create', 'advance.record'), invalid({}), { body: { amount: 50000, occurredAt: '@today' }, needs: 'the prime contract', plan: 'WP-4 "an advance with recovery"; CF2' }),
  T('WP4.receivables.read', 'WP-4', 'GET', `${PRJ}/prime-contract/receivables`, P('ipc', 'read'), read(), { needs: 'the project', plan: 'WP-4 I9 statement and receivables' }),
  T('WP4.payApp.create', 'WP-4', 'POST', `${PRJ}/pay-apps`, P('sub_pay_app', 'create'), invalid({}), { body: { commitmentId: '<executed SC>', periodLabel: '2026-09' }, needs: 'an executed subcontract', plan: 'WP-4 pay applications' }),
  T('WP4.payApp.update', 'WP-4', 'PATCH', `${PRJ}/pay-apps/{payAppId}`, P('sub_pay_app', 'update'), ghost(['payAppId']), { body: {}, needs: 'a draft pay application' }),
  T('WP4.payApp.submit', 'WP-4', 'POST', `${PRJ}/pay-apps/{payAppId}/submit`, P('sub_pay_app', 'submit', 'sub_pay_app.submit'), ghost(['payAppId']), { body: {}, needs: 'a draft pay application' }),
  T('WP4.payApp.review', 'WP-4', 'POST', `${PRJ}/pay-apps/{payAppId}/review`, P('sub_pay_app', 'submit', 'sub_pay_app.review'), ghost(['payAppId']), { body: {}, needs: 'a submitted pay application' }),
  T('WP4.payApp.approve', 'WP-4', 'POST', `${PRJ}/pay-apps/{payAppId}/approve`, P('sub_pay_app', 'approve', 'sub_pay_app.approve'), ghost(['payAppId']), { body: {}, needs: 'a pay application under review', plan: 'WP-4 P3 approval posts +50,000.00' }),
  T('WP4.payApp.reject', 'WP-4', 'POST', `${PRJ}/pay-apps/{payAppId}/reject`, P('sub_pay_app', 'submit', 'sub_pay_app.reject'), ghost(['payAppId']), { body: { reason: REASON, code: 'OTHER' }, needs: 'a submitted pay application', plan: 'WP-4 P7' }),
  T('WP4.payApp.reopen', 'WP-4', 'POST', `${PRJ}/pay-apps/{payAppId}/reopen`, P('sub_pay_app', 'update'), ghost(['payAppId']),
    { body: { reason: REASON }, needs: 'an approved (revoke) or rejected (reopen) pay application', plan: 'WP-4 P3 "a revoke by the QS gives 403"',
      serviceRule: { appliesTo: 'canRevoke = hasPermission(sub_pay_app approve, transition sub_pay_app.approve) is passed to the service: revoking an approved application needs pm; the QS passes the route guard (update) and is refused in the service (code asserted in WP-4 P3)' } }),
  T('WP4.payApp.payment', 'WP-4', 'POST', `${PRJ}/pay-apps/{payAppId}/payments`, P('sub_pay_app', 'certify', 'sub_pay_app.pay'), ghost(['payAppId']), { body: { amount: 20000, paidAt: '@today' }, needs: 'an approved pay application', plan: 'WP-4 P4 payment ceiling' }),
  T('WP4.payApp.void', 'WP-4', 'DELETE', `${PRJ}/pay-apps/{payAppId}`, P('sub_pay_app', 'delete', 'sub_pay_app.void'), ghost(['payAppId']), { needs: 'a pay application' }),
  T('WP4.cashFlow.manual', 'WP-4', 'POST', `${PRJ}/cash-flow`, P('cost', 'create'), invalid({}), { body: { period: '2026-08', outflow: 8500, note: 'CERT3 manual row' }, needs: 'the project', plan: 'WP-4 CF3 manual rows; CF5 roles' }),
  T('WP4.cashFlow.rebuild', 'WP-4', 'POST', `${PRJ}/cash-flow/rebuild`, P('cost', 'update'), effect(), { body: {}, needs: 'the project (idempotent)', plan: 'WP-4 CF4 concurrent rebuilds; CF5 roles' }),
  T('WP4.cashFlow.delete', 'WP-4', 'DELETE', `${PRJ}/cash-flow/{entryId}`, P('cost', 'delete'), ghost(['entryId']), { needs: 'a manual cash-flow row', plan: 'WP-4 CF3 "deleting a system row"' }),

  // ── WP-5 supply chain: bids, award, PO, receipts, inventory, direct costs ─
  T('WP5.bid.create', 'WP-5', 'POST', `${PRJ}/bids`, P('bid', 'create'), invalid({}), { body: { title: 'CERT3 Bid @stamp', dueAt: '2027-01-15' }, needs: 'the project', plan: 'WP-5 R1' }),
  T('WP5.bid.publish', 'WP-5', 'POST', `${PRJ}/bids/{packageId}/publish`, P('bid', 'submit', 'bid.publish'), ghost(['packageId']), { body: {}, needs: 'a draft package with lines and invitations' }),
  T('WP5.bid.close', 'WP-5', 'POST', `${PRJ}/bids/{packageId}/close`, P('bid', 'submit', 'bid.publish'), ghost(['packageId']), { body: {}, needs: 'an open package', plan: 'WP-5 "late bids refused"' }),
  T('WP5.bid.answer', 'WP-5', 'POST', `${PRJ}/bids/{packageId}/questions/{questionId}/answer`, P('bid', 'update', 'bid.answer'), ghost(['packageId', 'questionId']), { body: { answer: REASON }, needs: 'a bidder question' }),
  T('WP5.bid.award', 'WP-5', 'POST', `${PRJ}/bids/{packageId}/award`, P('bid', 'approve', 'bid.award'), ghost(['packageId']), { body: { bidId: '@ghost' }, needs: 'a closed package with bids', plan: 'WP-5 "awarded to one who is not the lowest on an override"' }),
  T('WP5.bid.awardConfirm', 'WP-5', 'POST', `${PRJ}/bids/{packageId}/award/confirm`, P('bid', 'approve', 'bid.award'), ghost(['packageId']), { body: {}, needs: 'an awarded package', plan: 'WP-5 R2 concurrent confirmations' }),
  T('WP5.order.fromPackage', 'WP-5', 'POST', `${PRJ}/procurement/packages/{packageId}/order`, P('procurement', 'create', 'po.issue'), ghost(['packageId']), { body: {}, needs: 'an awarded procurement package', plan: 'WP-5 R3 "ordering twice from one award"' }),
  T('WP5.po.create', 'WP-5', 'POST', `${PRJ}/procurement/purchase-orders`, P('procurement', 'create', 'po.issue'), invalid({}),
    { body: { item: 'CERT3 PO @stamp', supplier: 'CERT3 Supplier', lines: [{ description: 'Rebar', quantity: 100, unit: 't', unitCost: 10 }] }, needs: 'the project; a supplier', plan: 'WP-5 POs in every status' }),
  T('WP5.po.update', 'WP-5', 'PATCH', `${PRJ}/purchase-orders/{orderId}`, P('procurement', 'update', 'po.issue'), ghost(['orderId']), { body: { notes: 'edited' }, needs: 'a draft PO' }),
  T('WP5.po.submit', 'WP-5', 'POST', `${PRJ}/purchase-orders/{orderId}/submit`, P('procurement', 'submit', 'po.submit'), ghost(['orderId']), { body: {}, needs: 'a draft PO', plan: 'WP-5 O1' }),
  T('WP5.po.approve', 'WP-5', 'POST', `${PRJ}/purchase-orders/{orderId}/approve`, P('procurement', 'approve', 'po.approve'), ghost(['orderId']), { body: {}, needs: 'a submitted PO' }),
  T('WP5.po.reject', 'WP-5', 'POST', `${PRJ}/purchase-orders/{orderId}/reject`, P('procurement', 'approve', 'po.approve'), ghost(['orderId']), { body: { reason: REASON }, needs: 'a submitted PO' }),
  T('WP5.po.issue', 'WP-5', 'POST', `${PRJ}/purchase-orders/{orderId}/issue`, P('procurement', 'update', 'po.issue'), ghost(['orderId']), { body: {}, needs: 'an approved PO' }),
  T('WP5.po.acknowledge', 'WP-5', 'POST', `${PRJ}/purchase-orders/{orderId}/acknowledge`, P('procurement', 'update', 'po.acknowledge'), ghost(['orderId']), { body: { acknowledgedRef: 'ACK-1' }, needs: 'an issued PO', plan: 'WP-5 "acknowledged before delivery"' }),
  T('WP5.po.cancel', 'WP-5', 'POST', `${PRJ}/purchase-orders/{orderId}/cancel`, P('procurement', 'delete', 'po.cancel'), ghost(['orderId']), { body: { reason: REASON }, needs: 'an issued PO', plan: 'WP-5 O3 PO_CANCEL_AFTER_DELIVERY' }),
  T('WP5.po.close', 'WP-5', 'POST', `${PRJ}/purchase-orders/{orderId}/close`, P('procurement', 'update', 'po.close'), ghost(['orderId']), { body: { force: true, reason: REASON }, needs: 'a partially received PO', plan: 'WP-5 O2 close short with force and a reason' }),
  T('WP5.receipt.procurement', 'WP-5', 'POST', `${PRJ}/procurement/purchase-orders/{orderId}/receipts`, P('procurement', 'submit', 'receipt.post'), ghost(['orderId']),
    { body: { receiptNumber: 'CERT3-PERM-@stamp-GRN', lines: [{ poLineId: '@ghost', acceptedQty: 10, rejectedQty: 2 }] }, needs: 'an issued PO with lines', plan: 'WP-5 O4 "10 accepted and 2 rejected"' }),
  T('WP5.receipt.inventory', 'WP-5', 'POST', '/inventory/goods-receipt', P('inventory', 'create', 'stock.receive'), invalid({}),
    { body: { orderId: '<PO>', warehouseId: '<warehouse>', lines: [{ poLineId: '<line>', acceptedQty: 10 }] }, needs: 'an issued PO and a warehouse', plan: 'WP-5 "Goods receipt (both doors)"; O7', notes: ['company-level route: organisation role, no project assignment, no template'] }),
  T('WP5.stock.receive', 'WP-5', 'POST', '/inventory/stock/receive', P('inventory', 'create', 'stock.receive'), invalid({}), { body: { itemId: '<item>', warehouseId: '<warehouse>', quantity: 100, unitCost: 10, projectId: '@project' }, needs: 'an item and a warehouse', plan: 'WP-5 inventory' }),
  T('WP5.stock.issue', 'WP-5', 'POST', '/inventory/stock/issue', P('inventory', 'submit', 'stock.issue'), invalid({}), { body: { itemId: '<item>', warehouseId: '<warehouse>', quantity: 40, projectId: '@project', activityId: '<activity>' }, needs: 'stock on hand', plan: 'WP-5 N1 issues' }),
  T('WP5.stock.reserve', 'WP-5', 'POST', '/inventory/stock/reserve', P('inventory', 'submit', 'stock.issue'), invalid({}), { body: { itemId: '<item>', warehouseId: '<warehouse>', quantity: 50 }, needs: 'stock on hand', plan: 'WP-5 N1 "reserve 50"' }),
  T('WP5.stock.return', 'WP-5', 'POST', '/inventory/stock/return', P('inventory', 'update', 'stock.return'), invalid({}), { body: { itemId: '<item>', warehouseId: '<warehouse>', quantity: 5, projectId: '@project' }, needs: 'an issue to return against', plan: 'WP-5 N2 (L36)' }),
  T('WP5.stock.adjust', 'WP-5', 'POST', '/inventory/stock/adjust', P('inventory', 'update', 'stock.adjust'), invalid({}), { body: { itemId: '<item>', warehouseId: '<warehouse>', quantity: -1, notes: REASON }, needs: 'stock on hand', plan: 'WP-5 N7' }),
  T('WP5.stock.damage', 'WP-5', 'POST', '/inventory/stock/damage', P('inventory', 'update', 'stock.adjust'), invalid({}), { body: { itemId: '<item>', warehouseId: '<warehouse>', quantity: 1, notes: REASON }, needs: 'stock on hand', plan: 'WP-5 N7' }),
  T('WP5.stock.quarantine', 'WP-5', 'POST', '/inventory/stock/quarantine', P('inventory', 'update', 'stock.adjust'), invalid({}), { body: { itemId: '<item>', warehouseId: '<warehouse>', quantity: 1, notes: REASON }, needs: 'stock on hand', plan: 'WP-5 N5' }),
  T('WP5.stock.release', 'WP-5', 'POST', '/inventory/stock/release', P('inventory', 'update', 'stock.adjust'), invalid({}), { body: { itemId: '<item>', warehouseId: '<warehouse>', quantity: 1, notes: REASON }, needs: 'quarantined stock', plan: 'WP-5 N5' }),
  T('WP5.transfer.create', 'WP-5', 'POST', '/inventory/transfers', P('inventory', 'create', 'stock.transfer'), invalid({}), { body: { fromWarehouseId: '<w1>', toWarehouseId: '<w2>', lines: [{ itemId: '<item>', quantity: 10 }] }, needs: 'two warehouses, stock', plan: 'WP-5 N4' }),
  T('WP5.transfer.dispatch', 'WP-5', 'POST', '/inventory/transfers/{transferId}/dispatch', P('inventory', 'update', 'stock.transfer'), ghost(['transferId']), { body: {}, needs: 'a draft transfer' }),
  T('WP5.transfer.receive', 'WP-5', 'POST', '/inventory/transfers/{transferId}/receive', P('inventory', 'update', 'stock.transfer'), ghost(['transferId']), { body: {}, needs: 'a dispatched transfer', plan: 'WP-5 N4 "7 received and 1 damaged"' }),
  T('WP5.warehouse.create', 'WP-5', 'POST', '/inventory/warehouses', P('inventory', 'create', 'warehouse.manage'), invalid({}), { body: { code: 'C3W-@stamp', name: 'CERT3 store @stamp' }, needs: 'none', plan: 'WP-5 "Two warehouses with bins"' }),
  T('WP5.item.create', 'WP-5', 'POST', '/inventory/items', P('inventory', 'create', 'item.manage'), invalid({}), { body: { sku: 'C3-@stamp', name: 'CERT3 item @stamp', unit: 'ea' }, needs: 'none', plan: 'WP-5 "a serial item"' }),
  T('WP5.material.plan', 'WP-5', 'POST', `${PRJ}/activities/{activityId}/materials`, P('procurement', 'create', 'material.plan'), invalid({}, VALIDATION, { ghost: ['activityId'] }), { body: { name: 'Rebar', unit: 't', qty: 60 }, needs: 'an activity', plan: 'WP-5 N6 material plan rows linked to PO lines' }),
  T('WP5.material.use', 'WP-5', 'POST', `${PRJ}/activities/{activityId}/materials/{materialId}/usage`, P('procurement', 'submit', 'material.use'), ghost(['activityId', 'materialId']), { body: { usedQty: 50 }, needs: 'a material plan row with issued quantity', plan: 'WP-5 N6 "usage 50 accepted, usage 70 gives 409"' }),
  T('WP5.directCost.create', 'WP-5', 'POST', `${PRJ}/direct-costs`, P('cost', 'create'), invalid({}),
    { body: { description: 'CERT3 DC @stamp', costDate: '@today', type: 'invoice', lines: [{ description: 'L1', amount: 1000 }] }, needs: 'the project; cost codes', plan: 'WP-5 D1, D2' }),
  T('WP5.directCost.update', 'WP-5', 'PATCH', `${PRJ}/direct-costs/{directCostId}`, P('cost', 'update'), ghost(['directCostId']), { body: { description: 'edited' }, needs: 'a draft direct cost' }),
  T('WP5.directCost.submit', 'WP-5', 'POST', `${PRJ}/direct-costs/{directCostId}/submit`, P('cost', 'submit', 'direct_cost.submit'), ghost(['directCostId']), { body: {}, needs: 'a draft direct cost' }),
  T('WP5.directCost.approve', 'WP-5', 'POST', `${PRJ}/direct-costs/{directCostId}/approve`, P('cost', 'approve', 'direct_cost.approve'), ghost(['directCostId']), { body: {}, needs: 'a submitted direct cost', plan: 'WP-5 D2 "concurrent approval posts once"' }),
  T('WP5.directCost.reject', 'WP-5', 'POST', `${PRJ}/direct-costs/{directCostId}/reject`, P('cost', 'approve', 'direct_cost.approve'), ghost(['directCostId']), { body: { reason: REASON }, needs: 'a submitted direct cost' }),
  T('WP5.directCost.void', 'WP-5', 'POST', `${PRJ}/direct-costs/{directCostId}/void`, P('cost', 'approve', 'direct_cost.void'), ghost(['directCostId']), { body: { reason: REASON }, needs: 'an approved direct cost', plan: 'WP-5 D2 "void writes -6,000.00"' }),
  T('WP5.directCost.pay', 'WP-5', 'POST', `${PRJ}/direct-costs/{directCostId}/payments`, P('cost', 'approve', 'direct_cost.pay'), ghost(['directCostId']), { body: { amount: 1000, paidAt: '@today' }, needs: 'an approved direct cost', plan: 'WP-5 D3' }),
  T('WP5.match.read', 'WP-5', 'GET', '/inventory/match/invoice/{directCostId}', P('inventory', 'read'), ghost(['directCostId']), { needs: 'a supplier invoice against a PO', plan: 'WP-5 D5, D6 three-way match' }),

  // ── WP-6 BOQ, allocations, budgets, cost codes ─────────────────────────────
  T('WP6.boq.upload', 'WP-6', 'POST', `${PRJ}/boq/upload`, R('boq', 'create', ['pm', 'planning_eng', 'qs']), badQuery({ dryRun: 'maybe' }),
    { body: { file: 'multipart "file": a BOQ workbook (130 rows, 3 sections)' }, needs: 'the project', plan: 'WP-6 U1-U7', notes: ['CAN_MODIFY = requireRoles(pm, planning_eng, qs), not the JSON; a template on module boq decides when one is attached'] }),
  T('WP6.boq.template', 'WP-6', 'GET', `${PRJ}/boq/template`, R('boq', 'read', ['pm', 'planning_eng', 'qs']), read(),
    { needs: 'the project', plan: 'WP-6 U7 roles', notes: ['CAN_MODIFY also guards this read: narrower than JSON boq.read (all nine roles); registered suspect (adjudication §B, proposed P3)'] }),
  T('WP6.boq.uploadFile', 'WP-6', 'GET', `${PRJ}/boq/uploads/{documentId}`, R('boq', 'read', ['pm', 'planning_eng', 'qs']), ghost(['documentId']),
    { needs: 'a stored BOQ upload', plan: 'WP-6 U1-U7 the uploaded workbook read back', notes: ['CAN_MODIFY also guards this read: narrower than JSON boq.read (all nine roles); registered suspect (adjudication §B, proposed P3)', 'past the guard a ghost key answers 404 FILE_NOT_FOUND (file-storage getProjectDocumentFile)'] }),
  T('WP6.boq.itemCreate', 'WP-6', 'POST', `${PRJ}/boq/items`, R('boq', 'create', ['pm', 'planning_eng', 'qs']), invalid({}, { status: 400, code: 'MISSING_FIELDS' }),
    { body: { code: 'B-@stamp', description: 'CERT3 row', quantity: 100, unit: 'm3', rate: 10 }, needs: 'the project', plan: 'WP-6 BOQ rows' }),
  T('WP6.boq.itemUpdate', 'WP-6', 'PATCH', `${PRJ}/boq/items/{itemId}`, R('boq', 'update', ['pm', 'planning_eng', 'qs']), ghost(['itemId']), { body: { quantity: 160 }, needs: 'a BOQ item', plan: 'WP-6 U2 "B-002 changed to 160"; U4 "PATCH gives 409 after the lock"' }),
  T('WP6.boq.itemDelete', 'WP-6', 'DELETE', `${PRJ}/boq/items/{itemId}`, P('boq', 'delete'), ghost(['itemId']), { needs: 'a BOQ item' }),
  T('WP6.boq.revisionSubmit', 'WP-6', 'POST', `${PRJ}/boq/revisions/{revisionId}/submit`, P('boq', 'submit'), ghost(['revisionId']), { body: {}, needs: 'a BOQ revision', plan: 'WP-6 "BOQ revisions are reviewed and locked"' }),
  T('WP6.boq.revisionApprove', 'WP-6', 'POST', `${PRJ}/boq/revisions/{revisionId}/approve`, P('boq', 'approve'), ghost(['revisionId']), { body: {}, needs: 'a submitted BOQ revision' }),
  T('WP6.boq.revisionLock', 'WP-6', 'POST', `${PRJ}/boq/revisions/{revisionId}/lock`, P('boq', 'approve'), ghost(['revisionId']), { body: {}, needs: 'an approved BOQ revision', plan: 'WP-6 U4' }),
  T('WP6.boq.jobRetry', 'WP-6', 'POST', `${PRJ}/boq/job/{jobId}/retry`, P('boq', 'update'), ghost(['jobId']), { body: {}, needs: 'a failed AI BOQ job (never on :5190: the job runs in process)', plan: 'WP-6 U5 L131' }),
  T('WP6.alloc.create', 'WP-6', 'POST', `${PRJ}/activity-boq-allocations`, P('boq', 'create', 'allocation.create'), invalid({}), { body: { boqItemId: '<item>', activityId: '<activity>', allocatedValue: 60000 }, needs: 'a BOQ item and an activity', plan: 'WP-6 A1' }),
  T('WP6.alloc.update', 'WP-6', 'PATCH', `${PRJ}/activity-boq-allocations/{id}`, P('boq', 'update', 'allocation.update'), ghost(['id']), { body: {}, needs: 'a draft allocation' }),
  T('WP6.alloc.submit', 'WP-6', 'POST', `${PRJ}/activity-boq-allocations/{id}/submit`, P('boq', 'submit', 'allocation.submit'), ghost(['id']), { body: {}, needs: 'a draft allocation', plan: 'WP-6 A2' }),
  T('WP6.alloc.approve', 'WP-6', 'POST', `${PRJ}/activity-boq-allocations/{id}/approve`, P('boq', 'approve', 'allocation.approve'), ghost(['id']), { body: {}, needs: 'a submitted allocation' }),
  T('WP6.alloc.reject', 'WP-6', 'POST', `${PRJ}/activity-boq-allocations/{id}/reject`, P('boq', 'approve', 'allocation.reject'), ghost(['id']), { body: { reason: REASON }, needs: 'a submitted allocation', plan: 'WP-6 HR-C17' }),
  T('WP6.alloc.bulk', 'WP-6', 'POST', `${PRJ}/activity-boq-allocations/bulk`, P('boq', 'create', 'allocation.create'), invalid({}), { body: { allocations: [] }, needs: 'BOQ items and activities', plan: 'WP-6 A4' }),
  T('WP6.alloc.import', 'WP-6', 'POST', `${PRJ}/activity-boq-allocations/import`, P('boq', 'create', 'allocation.create'), badQuery({ dryRun: 'maybe' }), { body: { file: 'multipart "file": a mapping workbook' }, needs: 'BOQ items and activities', plan: 'WP-6 A5 dry run, apply' }),
  T('WP6.alloc.importUndo', 'WP-6', 'POST', `${PRJ}/activity-boq-allocations/import/{batchId}/undo`, P('boq', 'approve', 'allocation.reject'), ghost(['batchId']), { body: {}, needs: 'an applied mapping import', plan: 'WP-6 A5 undo' }),
  T('WP6.alloc.mappingRules', 'WP-6', 'PATCH', `${PRJ}/activity-boq-allocations/mapping-rules`, P('boq', 'update', 'allocation.update'), invalid({}), { body: { rule: {} }, needs: 'the project', plan: 'WP-6 A6' }),
  T('WP6.alloc.coverage', 'WP-6', 'GET', `${PRJ}/activity-boq-allocations/coverage`, P('boq', 'read'), read(), { needs: 'the project', plan: 'WP-6 A3' }),
  T('WP6.budget.costCodes', 'WP-6', 'PUT', `${PRJ}/budget/cost-codes`, P('cost', 'update'), invalid({ costCodeIds: 'not-a-list' }), { body: { costCodeIds: ['<company cost code>'] }, needs: 'company cost codes', plan: 'WP-6 cost codes' }),
  T('WP6.budget.lineCreate', 'WP-6', 'POST', `${PRJ}/budget/lines`, P('cost', 'create'), invalid({}), { body: { costCodeId: '<cost code>', costType: 'material', originalBudget: 4000 }, needs: 'a project cost code', plan: 'WP-6 B1 seven typed lines' }),
  T('WP6.budget.lineUpdate', 'WP-6', 'PATCH', `${PRJ}/budget/lines/{lineId}`, P('cost', 'update'), ghost(['lineId']), { body: { description: 'edited' }, needs: 'a budget line', plan: 'WP-6 B2 guards; the Original lock' }),
  T('WP6.budget.lineDelete', 'WP-6', 'DELETE', `${PRJ}/budget/lines/{lineId}`, P('cost', 'delete'), ghost(['lineId']), { needs: 'a budget line' }),
  T('WP6.budget.transfer', 'WP-6', 'POST', `${PRJ}/budget/transfers`, P('cost', 'approve'), invalid({}), { body: { fromLineId: '<line>', toLineId: '<line>', amount: 20000, reason: REASON }, needs: 'two budget lines', plan: 'WP-6 B3' }),
  T('WP6.budget.lineRevision', 'WP-6', 'POST', `${PRJ}/budget/lines/{lineId}/revisions`, P('cost', 'approve'), ghost(['lineId']), { body: { amount: 1000, note: REASON }, needs: 'a budget line', plan: 'WP-6 B4' }),
  T('WP6.budget.snapshot', 'WP-6', 'POST', `${PRJ}/budget/snapshots`, P('cost', 'approve'), invalid({ reportingPeriodId: 'not-a-uuid' }), { body: { label: 'CERT3 @stamp' }, needs: 'budget lines', plan: 'WP-6 the Original-budget lock' }),

  // ── WP-7 contract time: EOT and weather ────────────────────────────────────
  T('WP7.eot.create', 'WP-7', 'POST', `${PRJ}/eot`, R('eot', 'create', ['pm', 'planning_eng', 'qs']), invalid({}),
    { body: { eventName: 'CERT3 EOT @stamp', delayDays: 10, affectedActivityIds: ['<activity>'], documentIds: ['<document>'] }, needs: 'an activity and a stored document', plan: 'WP-7 T1' }),
  T('WP7.eot.calculate', 'WP-7', 'POST', `${PRJ}/eot/calculate`, R('eot', 'create', ['pm', 'planning_eng', 'qs']), invalid({}), { body: { eventName: 'calc', delayDays: 10 }, needs: 'activities', plan: 'WP-7 T4, T5 impact' }),
  T('WP7.eot.update', 'WP-7', 'PATCH', `${PRJ}/eot/{claimId}`, R('eot', 'update', ['pm', 'planning_eng', 'qs']), ghost(['claimId']), { body: { delayDays: 30 }, needs: 'an EOT claim', plan: 'WP-7 T2 "A planner PATCH to 30 is expected 409 (today 200)"' }),
  T('WP7.eot.submit', 'WP-7', 'POST', `${PRJ}/eot/{claimId}/submit`, P('eot', 'submit', 'eot.submit'), ghost(['claimId']), { body: {}, needs: 'a draft claim' }),
  T('WP7.eot.approve', 'WP-7', 'POST', `${PRJ}/eot/{claimId}/approve`, P('eot', 'approve', 'eot.approve'), ghost(['claimId']), { body: { comment: REASON }, needs: 'a submitted claim', plan: 'WP-7 T2, T3' }),
  T('WP7.eot.reject', 'WP-7', 'POST', `${PRJ}/eot/{claimId}/reject`, P('eot', 'approve', 'eot.reject'), ghost(['claimId']), { body: { reason: REASON }, needs: 'a submitted claim', plan: 'WP-7 "Rejection needs a reason"' }),
  T('WP7.weather.create', 'WP-7', 'POST', `${PRJ}/weather-delays`, P('eot', 'create'), invalid({}), { body: { description: 'CERT3 rain @stamp', delayDays: 1, date: '@today', contractual: true }, needs: 'the project', plan: 'WP-7 manual delays 13 then 14 of 20' }),
  T('WP7.weather.update', 'WP-7', 'PATCH', `${PRJ}/weather-delays/{weatherId}`, P('eot', 'update'), ghost(['weatherId']), { body: { delayDays: 2 }, needs: 'a weather delay' }),
  T('WP7.weather.delete', 'WP-7', 'DELETE', `${PRJ}/weather-delays/{weatherId}`, P('eot', 'update'), ghost(['weatherId']),
    { needs: 'a weather delay', notes: ['DELETE is guarded by eot update (pm, planning_eng, qs) while JSON eot.delete is []'] }),
  T('WP7.weather.promote', 'WP-7', 'POST', `${PRJ}/daily-logs/{date}/entries/delays/{entryId}/weather-delay`, P('progress', 'update', 'daily_log.update'), badParam({ date: 'not-a-date' }, { ghost: ['entryId'] }),
    { body: {}, needs: 'a daily-log delay entry', plan: 'WP-7/WP-8 promotion of 2 h, 6 h, 10 h; HR-F4 "promotion needs eot:create"', notes: ['a contractual weather delay is created under daily_log.update: site and quality engineers may create one though JSON eot.create excludes them (HR-F4)'] }),
  T('WP7.contract.terms', 'WP-7', 'PUT', `${PRJ}/contract`, P('eot', 'update'), invalid({ form: 'not-a-form' }), { body: { delayNoticeDays: 28 }, needs: 'the project', plan: 'WP-7 contract terms; ldRatePerDay is on PATCH /projects/:id' }),
  T('WP7.notice.create', 'WP-7', 'POST', `${PRJ}/contract/notices`, P('document_control', 'create'), invalid({}),
    { body: { recordType: 'weather_delay', recordId: '<weather delay>', subject: 'Notice', body: REASON }, needs: 'a weather delay', plan: 'WP-8 "A contractual notice letter linked to a weather delay"' }),

  // ── WP-8 field, quality and documents ─────────────────────────────────────
  T('WP8.dailyLog.update', 'WP-8', 'PATCH', `${PRJ}/daily-logs/{date}`, P('progress', 'update', 'daily_log.update'), badParam({ date: 'not-a-date' }), { body: { summary: 'CERT3' }, needs: 'none (the day is created on first write)', plan: 'WP-8 "An approved day: PATCH ... 409 DAILY_LOG_APPROVED"' }),
  T('WP8.dailyLog.submit', 'WP-8', 'POST', `${PRJ}/daily-logs/{date}/submit`, P('progress', 'submit', 'daily_log.submit'), badParam({ date: 'not-a-date' }), { body: {}, needs: 'an open day with entries' }),
  T('WP8.dailyLog.approve', 'WP-8', 'POST', `${PRJ}/daily-logs/{date}/approve`, P('progress', 'approve', 'daily_log.approve'), badParam({ date: 'not-a-date' }), { body: {}, needs: 'a submitted day', plan: 'WP-8 "one day approved straight from open" (HR-F4)' }),
  T('WP8.dailyLog.reopen', 'WP-8', 'POST', `${PRJ}/daily-logs/{date}/reopen`, P('progress', 'approve', 'daily_log.approve'), badParam({ date: 'not-a-date' }), { body: { reason: REASON }, needs: 'an approved day', plan: 'HR-F4 "reopen needs a reason"' }),
  T('WP8.dailyLog.entryReview', 'WP-8', 'POST', `${PRJ}/daily-logs/{date}/entries/{section}/{entryId}/review`, P('progress', 'approve', 'daily_log.entry_review'), badParam({ date: 'not-a-date', section: 'manpower' }, { ghost: ['entryId'] }),
    { body: { decision: 'reject', reason: REASON }, needs: 'a submitted party entry', plan: 'WP-8 "Party lock: 409 DAILY_LOG_SUBMITTED. Rejecting without a reason: 400"' }),
  T('WP8.dailyLog.entryDelete', 'WP-8', 'DELETE', `${PRJ}/daily-logs/{date}/entries/{section}/{entryId}`, P('progress', 'submit', 'daily_log.submit'), badParam({ date: 'not-a-date', section: 'manpower' }, { ghost: ['entryId'] }), { needs: 'an entry', plan: 'WP-8 "entry delete each give exactly 409 DAILY_LOG_APPROVED"' }),
  T('WP8.timesheet.create', 'WP-8', 'POST', `${PRJ}/timesheets`, P('timesheet', 'create'), invalid({}), { body: { date: '@today', entries: [{ workerId: '<worker>', timeType: 'regular', hours: 8 }, { workerId: '<worker>', timeType: 'overtime', hours: 2 }, { workerId: '<worker>', timeType: 'double', hours: 1 }] }, needs: 'a worker', plan: 'WP-8 timesheets 650.00' }),
  T('WP8.timesheet.update', 'WP-8', 'PATCH', `${PRJ}/timesheets/{timesheetId}`, P('timesheet', 'update'), ghost(['timesheetId']), { body: {}, needs: 'a draft timesheet', plan: 'WP-8 "Reject, edit and approve gives 1,750.00"' }),
  T('WP8.timesheet.submit', 'WP-8', 'POST', `${PRJ}/timesheets/{timesheetId}/submit`, P('timesheet', 'submit', 'timesheet.submit'), ghost(['timesheetId']), { body: {}, needs: 'a draft timesheet' }),
  T('WP8.timesheet.approve', 'WP-8', 'POST', `${PRJ}/timesheets/{timesheetId}/approve`, P('timesheet', 'approve', 'timesheet.approve'), ghost(['timesheetId']), { body: {}, needs: 'a submitted timesheet' }),
  T('WP8.timesheet.reject', 'WP-8', 'POST', `${PRJ}/timesheets/{timesheetId}/reject`, P('timesheet', 'approve', 'timesheet.reject'), ghost(['timesheetId']), { body: { reason: REASON }, needs: 'a submitted timesheet' }),
  T('WP8.timesheet.reopen', 'WP-8', 'POST', `${PRJ}/timesheets/{timesheetId}/reopen`, P('timesheet', 'approve', 'timesheet.reopen'), ghost(['timesheetId']), { body: { reason: REASON }, needs: 'an approved timesheet', plan: 'WP-8 "Reopening a 2,000.00 sheet reverses it exactly"' }),
  T('WP8.crew.create', 'WP-8', 'POST', `${PRJ}/timesheets/crews`, P('timesheet', 'create'), invalid({}), { body: { name: 'CERT3 crew @stamp', workerIds: [] }, needs: 'workers', plan: 'WP-8 crews of 3 or more' }),
  T('WP8.worker.create', 'WP-8', 'POST', `${PRJ}/timesheets/workers`, P('timesheet', 'create', 'timesheet.worker_admin'), invalid({}), { body: { name: 'CERT3 worker @stamp', hourlyRate: 50, overtimeMultiplier: 1.5 }, needs: 'none', plan: 'WP-8 different rates and overtime multipliers' }),
  T('WP8.worker.update', 'WP-8', 'PATCH', `${PRJ}/timesheets/workers/{workerId}`, P('timesheet', 'update', 'timesheet.worker_admin'), ghost(['workerId']), { body: { hourlyRate: 55 }, needs: 'a worker', plan: 'WP-8 "A rate change between submit and approval" (HR-F5)' }),
  T('WP8.ncr.create', 'WP-8', 'POST', `${PRJ}/ncr`, P('ncr', 'create'), invalid({ severity: 'catastrophic' }), { body: { severity: 'major', description: 'CERT3 NCR @stamp' }, needs: 'the project', plan: 'WP-8 "NCRs: 2 major and 3 minor"' }),
  T('WP8.ncr.update', 'WP-8', 'PATCH', `${PRJ}/ncr/{ncrId}`, P('ncr', 'update'), ghost(['ncrId']), { body: { severity: 'minor' }, needs: 'an NCR', plan: 'WP-8 "a severity downgrade after closure (21 -> 33)" (HR-Q5)' }),
  T('WP8.ncr.submit', 'WP-8', 'POST', `${PRJ}/ncr/{ncrId}/submit`, P('ncr', 'submit', 'ncr.submit', { recordAllowance: 'the NCR assignee, whatever the role (requirePermissionOr isNcrAssignee)' }), ghost(['ncrId']), { body: {}, needs: 'an open NCR with closeout fields', plan: 'WP-8 NCR states' }),
  T('WP8.ncr.close', 'WP-8', 'POST', `${PRJ}/ncr/{ncrId}/close`, P('ncr', 'submit', 'ncr.close', { recordAllowance: 'the NCR assignee, whatever the role' }), ghost(['ncrId']), { body: {}, needs: 'an NCR' }),
  T('WP8.ncr.approve', 'WP-8', 'POST', `${PRJ}/ncr/{ncrId}/approve`, P('ncr', 'approve', 'ncr.approve'), ghost(['ncrId']), { body: {}, needs: 'a submitted NCR' }),
  T('WP8.ncr.reject', 'WP-8', 'POST', `${PRJ}/ncr/{ncrId}/reject`, P('ncr', 'approve', 'ncr.reject'), ghost(['ncrId']), { body: { reason: REASON }, needs: 'a submitted NCR', plan: 'WP-8 "Reject and reopen codes"' }),
  T('WP8.ncr.reopen', 'WP-8', 'POST', `${PRJ}/ncr/{ncrId}/reopen`, P('ncr', 'approve', 'ncr.reopen'), ghost(['ncrId']), { body: { reason: REASON }, needs: 'a closed NCR' }),
  T('WP8.ncr.delete', 'WP-8', 'DELETE', `${PRJ}/ncr/{ncrId}`, P('ncr', 'delete'), ghost(['ncrId']), { needs: 'an NCR', plan: 'WP-8 "hard deletes" (HR-Q4)' }),
  T('WP8.itp.create', 'WP-8', 'POST', `${PRJ}/itp`, P('inspection', 'create'), invalid({}), { body: { title: 'CERT3 ITP @stamp', status: 'failed' }, needs: 'the project', plan: 'WP-8 "Legacy ITPs: failed, waived, passed"' }),
  T('WP8.itp.update', 'WP-8', 'PATCH', `${PRJ}/itp/{itpId}`, P('inspection', 'update'), ghost(['itpId']), { body: { status: 'passed' }, needs: 'a legacy ITP', plan: 'WP-8 "a legacy ITP moved from failed to passed (+15)"' }),
  T('WP8.itp.delete', 'WP-8', 'DELETE', `${PRJ}/itp/{itpId}`, P('inspection', 'delete'), ghost(['itpId']), { needs: 'a legacy ITP', plan: 'HR-Q4 hard delete' }),
  T('WP8.punch.create', 'WP-8', 'POST', `${PRJ}/punch`, P('punch', 'create'), invalid({}), { body: { title: 'CERT3 punch @stamp', kind: 'defect' }, needs: 'the project', plan: 'WP-8 punch items and observations' }),
  T('WP8.punch.update', 'WP-8', 'PATCH', `${PRJ}/punch/{itemId}`, P('punch', 'update'), ghost(['itemId']), { body: { finalApproverUserId: '@user:quality' }, needs: 'a punch item', plan: 'WP-8 "The final-approver gate and its bypass" (HR-F3)' }),
  ...[
    ['open', 'submit', 'punch.open'],
    ['ready_for_review', 'submit', 'punch.ready_for_review'],
    ['close', 'approve', 'punch.close'],
    ['reopen', 'submit', 'punch.reopen'],
    ['dispute', 'submit', 'punch.dispute'],
    ['resolve_dispute', 'submit', 'punch.reopen'],
    ['void', 'approve', 'punch.void'],
  ].map(([action, permission, transition]) =>
    T(`WP8.punch.${action}`, 'WP-8', 'POST', `${PRJ}/punch/{itemId}/transition`, P('punch', permission, transition, { inHandler: true }), ghost(['itemId']),
      { body: { action, reason: REASON }, needs: 'a punch item in the state the action leaves', plan: 'WP-8 "The full illegal-transition table"', notes: ['checked inside the handler after body validation (routes/punch.js TRANSITION_PERMISSION)'] })),
  T('WP8.punch.distribute', 'WP-8', 'POST', `${PRJ}/punch/distribute`, P('punch', 'submit', 'punch.distribute'), invalid({ itemIds: 'not-a-list' }), { body: { itemIds: ['<punch item>'] }, needs: 'punch items' }),
  T('WP8.safety.create', 'WP-8', 'POST', `${PRJ}/safety`, P('safety', 'create'), invalid({}), { body: { incidentType: 'near_miss', title: 'CERT3 near miss @stamp' }, needs: 'the project', plan: 'WP-8 safety' }),
  T('WP8.safety.update', 'WP-8', 'PATCH', `${PRJ}/safety/{incidentId}`, P('safety', 'update'), ghost(['incidentId']), { body: { comment: 'edited' }, needs: 'an incident', plan: 'WP-8 "An LTI edited after closure" (HR-Q5)' }),
  T('WP8.safety.submit', 'WP-8', 'POST', `${PRJ}/safety/{incidentId}/submit`, P('safety', 'submit', 'safety.submit', { recordAllowance: 'the incident assignee, whatever the role' }), ghost(['incidentId']), { body: {}, needs: 'an open incident' }),
  T('WP8.safety.close', 'WP-8', 'POST', `${PRJ}/safety/{incidentId}/close`, P('safety', 'submit', 'safety.close', { recordAllowance: 'the incident assignee, whatever the role' }), ghost(['incidentId']), { body: {}, needs: 'an incident' }),
  T('WP8.safety.approve', 'WP-8', 'POST', `${PRJ}/safety/{incidentId}/approve`, P('safety', 'approve', 'safety.approve'), ghost(['incidentId']), { body: {}, needs: 'a submitted incident' }),
  T('WP8.safety.reject', 'WP-8', 'POST', `${PRJ}/safety/{incidentId}/reject`, P('safety', 'approve', 'safety.reject'), ghost(['incidentId']), { body: { reason: REASON }, needs: 'a submitted incident' }),
  T('WP8.safety.reopen', 'WP-8', 'POST', `${PRJ}/safety/{incidentId}/reopen`, P('safety', 'approve', 'safety.reopen'), ghost(['incidentId']), { body: { reason: REASON }, needs: 'a closed incident' }),
  T('WP8.rfi.create', 'WP-8', 'POST', `${PRJ}/rfi`, P('rfi', 'create'), invalid({}), { body: { subject: 'CERT3 RFI @stamp', question: REASON }, needs: 'the project', plan: 'WP-8 RFIs in every state' }),
  T('WP8.rfi.update', 'WP-8', 'PATCH', `${PRJ}/rfi/{rfiId}`, P('rfi', 'update'), ghost(['rfiId']), { body: { subject: 'edited' }, needs: 'an RFI', plan: 'WP-8 "Rewriting the official response after closure should give 409"' }),
  T('WP8.rfi.submit', 'WP-8', 'POST', `${PRJ}/rfi/{rfiId}/submit`, P('rfi', 'submit', 'rfi.submit'), ghost(['rfiId']), { body: {}, needs: 'a draft RFI' }),
  T('WP8.rfi.answer', 'WP-8', 'POST', `${PRJ}/rfi/{rfiId}/answer`, P('rfi', 'submit', 'rfi.answer'), ghost(['rfiId']), { body: { response: REASON }, needs: 'an open RFI', plan: 'WP-8 "one answered after dueDate"' }),
  T('WP8.rfi.response', 'WP-8', 'POST', `${PRJ}/rfi/{rfiId}/responses`, P('rfi', 'submit'), ghost(['rfiId']), { body: { body: REASON }, needs: 'an open RFI' }),
  T('WP8.rfi.official', 'WP-8', 'POST', `${PRJ}/rfi/{rfiId}/responses/{responseId}/official`, P('rfi', 'submit', 'rfi.answer'), ghost(['rfiId', 'responseId']), { body: {}, needs: 'an RFI response' }),
  T('WP8.rfi.close', 'WP-8', 'POST', `${PRJ}/rfi/{rfiId}/close`, P('rfi', 'approve', 'rfi.close'), ghost(['rfiId']), { body: { comment: REASON }, needs: 'an answered RFI' }),
  T('WP8.rfi.reopen', 'WP-8', 'POST', `${PRJ}/rfi/{rfiId}/reopen`, P('rfi', 'approve', 'rfi.reopen'), ghost(['rfiId']), { body: { reason: REASON }, needs: 'a closed RFI', plan: 'WP-8 "Reopen: revision +1"' }),
  T('WP8.submittal.create', 'WP-8', 'POST', `${PRJ}/submittals`, P('submittal', 'create'), invalid({}), { body: { title: 'CERT3 submittal @stamp' }, needs: 'the project', plan: 'WP-8 submittals' }),
  T('WP8.submittal.submit', 'WP-8', 'POST', `${PRJ}/submittals/{submittalId}/submit`, P('submittal', 'submit', 'submittal.submit'), ghost(['submittalId']), { body: {}, needs: 'a draft submittal' }),
  T('WP8.submittal.review', 'WP-8', 'POST', `${PRJ}/submittals/{submittalId}/review`, P('submittal', 'submit', 'submittal.review'), ghost(['submittalId']), { body: { comment: REASON }, needs: 'a submittal at a review step', plan: 'WP-8 2-step template (QS 3 days, Planner 4 days)' }),
  T('WP8.submittal.decide', 'WP-8', 'POST', `${PRJ}/submittals/{submittalId}/decide`, P('submittal', 'submit', 'submittal.review'), ghost(['submittalId']), { body: { decision: 'approve', comment: REASON }, needs: 'a submittal at a review step' }),
  T('WP8.submittal.resubmit', 'WP-8', 'POST', `${PRJ}/submittals/{submittalId}/resubmit`, P('submittal', 'submit', 'submittal.resubmit'), ghost(['submittalId']), { body: {}, needs: 'a returned submittal', plan: 'WP-8 "Response code reset on a new cycle"' }),
  T('WP8.submittal.approve', 'WP-8', 'POST', `${PRJ}/submittals/{submittalId}/approve`, P('submittal', 'approve', 'submittal.approve'), ghost(['submittalId']), { body: {}, needs: 'a reviewed submittal', plan: 'WP-8 "PM approval while steps are pending" (HR-F1)' }),
  T('WP8.submittal.reject', 'WP-8', 'POST', `${PRJ}/submittals/{submittalId}/reject`, P('submittal', 'approve', 'submittal.reject'), ghost(['submittalId']), { body: { reason: REASON }, needs: 'a reviewed submittal' }),
  T('WP8.submittal.workflowTemplate', 'WP-8', 'POST', `${PRJ}/submittals/workflow-templates`, P('submittal', 'update'), invalid({}), { body: { name: 'CERT3 2-step @stamp', steps: [] }, needs: 'the project', plan: 'WP-8 "one on a 2-step template"' }),
  T('WP8.drawing.create', 'WP-8', 'POST', `${PRJ}/drawings`, P('document_control', 'create'), invalid({}), { body: { drawingNumber: 'S-1', title: 'CERT3 S-1 @stamp' }, needs: 'the project', plan: 'WP-8 "Drawing S-1 revisions A to F"' }),
  T('WP8.drawing.update', 'WP-8', 'PATCH', `${PRJ}/drawings/{drawingId}`, P('document_control', 'update'), ghost(['drawingId']), { body: { title: 'edited' }, needs: 'a drawing' }),
  T('WP8.docRevision.upload', 'WP-8', 'POST', `${PRJ}/doc-control/{recordType}/{recordId}/revisions`, P('document_control', 'submit', 'document.revision.upload'), ghost(['recordId'], { params: { recordType: 'drawing' } }),
    { body: { revision: 'B', fileName: 'S-1-B.pdf' }, needs: 'a drawing (rfi, submittal, drawing or transmittal)', plan: 'WP-8 "The storeman\'s revisions are exactly [B]"' }),
  T('WP8.docRevision.submitReview', 'WP-8', 'POST', `${PRJ}/doc-control/revisions/{revisionId}/submit-review`, P('document_control', 'submit', 'document.revision.submit_review'), ghost(['revisionId']), { body: {}, needs: 'an uploaded revision' }),
  T('WP8.docRevision.approve', 'WP-8', 'POST', `${PRJ}/doc-control/revisions/{revisionId}/approve`, P('document_control', 'approve', 'document.revision.approve'), ghost(['revisionId']), { body: {}, needs: 'a revision in review', plan: 'WP-8 "Approving without review, approving out of order" (HR-F2)' }),
  T('WP8.docRevision.supersede', 'WP-8', 'POST', `${PRJ}/doc-control/revisions/{revisionId}/supersede`, P('document_control', 'approve', 'document.revision.supersede'), ghost(['revisionId']), { body: { reason: REASON }, needs: 'an approved revision', plan: 'WP-8 "superseding without a reason (400)"' }),
  T('WP8.drawingSet.publish', 'WP-8', 'POST', `${PRJ}/drawings/sets/{setId}/publish`, P('document_control', 'update', 'drawing.publish'), ghost(['setId']), { body: {}, needs: 'a processed drawing set (processing is CERT-6)' }),
  T('WP8.transmittal.create', 'WP-8', 'POST', `${PRJ}/transmittals`, P('document_control', 'create'), invalid({}), { body: { subject: 'CERT3 TX @stamp', sender: 'Oakmont', recipient: 'Client' }, needs: 'a drawing revision and an activity', plan: 'WP-8 "A transmittal citing a revision and an activity"' }),
  T('WP8.transmittal.update', 'WP-8', 'PATCH', `${PRJ}/transmittals/{transmittalId}`, P('document_control', 'update'), ghost(['transmittalId']), { body: { notes: 'edited' }, needs: 'a transmittal', plan: 'WP-8 "The distribute bypass through PATCH (recorded)"' }),
  T('WP8.correspondence.create', 'WP-8', 'POST', `${PRJ}/correspondence`, P('document_control', 'create'), invalid({}), { body: { direction: 'outgoing', type: 'letter', subject: 'CERT3 @stamp' }, needs: 'the project' }),
  T('WP8.meeting.create', 'WP-8', 'POST', `${PRJ}/meetings`, P('meeting', 'create'), invalid({}), { body: { title: 'CERT3 meeting @stamp', date: '@today' }, needs: 'the project', plan: 'WP-8 "A meeting with createTask action items"' }),
  T('WP8.meeting.update', 'WP-8', 'PATCH', `${PRJ}/meetings/{id}`, P('meeting', 'update'), ghost(['id']), { body: { title: 'edited' }, needs: 'a meeting', plan: 'HR-F6 "status set by PATCH"' }),
  T('WP8.meeting.distribute', 'WP-8', 'POST', `${PRJ}/meetings/{id}/distribute`, P('meeting', 'submit', 'meeting.distribute'), ghost(['id']), { body: {}, needs: 'a finalized meeting', plan: 'HR-F6 "drafts distributed"' }),
  T('WP8.task.create', 'WP-8', 'POST', `${PRJ}/tasks`, P('task', 'create', 'task.assign'), invalid({}), { body: { title: 'CERT3 task @stamp' }, needs: 'the project', plan: 'WP-8 tasks' }),
  T('WP8.task.update', 'WP-8', 'PATCH', `${PRJ}/tasks/{id}`, P('task', 'update'), ghost(['id']), { body: { title: 'edited' }, needs: 'a task' }),
  T('WP8.task.close', 'WP-8', 'POST', `${PRJ}/tasks/{id}/close`, P('task', 'update', 'task.close'), ghost(['id']), { body: {}, needs: 'an open task' }),
  T('WP8.location.create', 'WP-8', 'POST', `${PRJ}/locations`, P('location', 'create'), invalid({}), { body: { name: 'CERT3 Level 1 @stamp' }, needs: 'the project', plan: 'WP-8 locations' }),
  T('WP8.quality.dashboard', 'WP-8', 'GET', `${PRJ}/quality/dashboard`, OPEN, read(), { needs: 'the project', plan: 'WP-8 "21 on the quality dashboard"', notes: ['no module permission check: anyone on the project'] }),

  // ── WP-9 controls and reporting ────────────────────────────────────────────
  T('WP9.exception.review', 'WP-9', 'POST', `${PRJ}/controls/exceptions/{exceptionId}/review`, SVC('change_event update, or update on the subject module, decided in exception.service from routes/exceptions.js callerFor'), observe(['exceptionId']), { body: {}, needs: 'an exception row (the engine runs in process only)', plan: 'WP-9 handling' }),
  T('WP9.exception.snooze', 'WP-9', 'POST', `${PRJ}/controls/exceptions/{exceptionId}/snooze`, SVC('as review'), observe(['exceptionId']), { body: { until: '2027-01-01' }, needs: 'an exception row', plan: 'WP-9 snooze bounds' }),
  T('WP9.exception.dismiss', 'WP-9', 'POST', `${PRJ}/controls/exceptions/{exceptionId}/dismiss`, SVC('as review'), observe(['exceptionId']), { body: { reason: REASON }, needs: 'an exception row', plan: 'WP-9 T3 dismissal' }),
  T('WP9.exception.raise', 'WP-9', 'POST', `${PRJ}/controls/exceptions/{exceptionId}/raise-change-event`, SVC('change_event create'), observe(['exceptionId']), { body: {}, needs: 'an exception row', plan: 'WP-9 "raise (201, then 409 EXCEPTION_IN_CHANGE)"' }),
  T('WP9.health.read', 'WP-9', 'GET', `${PRJ}/health`, OPEN, read(), { needs: 'the project', plan: 'WP-9 health; "Health has no module permission check (recorded)"', notes: ['no module permission check'] }),
  T('WP9.workspaceDashboard.read', 'WP-9', 'GET', '/projects/workspace-dashboard', OPEN, read(), { needs: 'none', scope: 'org', plan: 'WP-9 workspace dashboard', notes: ['per-project figures are decided per project (requestForProject); the route itself has no gate'] }),
  T('WP9.export.xlsx', 'WP-9', 'GET', `${PRJ}/export/xlsx`, P('cost', 'export'), read({ binary: true }), { needs: 'the project', plan: 'WP-9 export "6 sheets"; HR-K7 "one permission per sheet"' }),
  T('WP9.export.schedule', 'WP-9', 'GET', `${PRJ}/export/schedule/{format}`, P('schedule', 'export'), read({ binary: true, params: { format: 'xer' } }), { needs: 'the project', plan: 'WP-9 "XER round trip"' }),
  T('WP9.report.create', 'WP-9', 'POST', '/reports', P('report', 'create'), invalid({}), { body: { name: 'CERT3 report @stamp', source: 'activity', projectId: '@project', visibility: 'project', columns: [] }, needs: 'none', plan: 'WP-9 report builder; 087 "Report definitions (private, project and organisation)"', notes: ['company-level route: organisation role, no project assignment, no template'] }),
  T('WP9.report.update', 'WP-9', 'PUT', '/reports/{reportId}', P('report', 'update'), ghost(['reportId']), { body: { name: 'edited' }, needs: 'a report definition', plan: 'WP-9 visibility', serviceRule: { appliesTo: 'report-builder.service canManage: creator || isCompanyAdmin || PM (scenario S6-report-manage)', scenario: 'S6-report-manage' } }),
  T('WP9.report.schedule', 'WP-9', 'POST', '/reports/{reportId}/schedules', P('report', 'update', 'report.schedule'), ghost(['reportId']), { body: { frequency: 'weekly', format: 'xlsx', recipients: { userIds: ['@user:finance'] } }, needs: 'a report definition', plan: 'WP-9 "a schedule sent to someone other than its owner"' }),
  T('WP9.report.export', 'WP-9', 'POST', '/reports/export', P('report', 'export'), invalid({}), { body: { source: 'activity', projectId: '@project', format: 'xlsx' }, needs: 'none', plan: 'WP-9 "XLSX totals equal the preview"' }),
  T('WP9.report.runDownload', 'WP-9', 'GET', '/reports/runs/{runId}/download', P('report', 'read'), ghost(['runId']), { needs: 'a scheduled run', plan: 'WP-9 "the recipient\'s download should give 200 (today 403)" (HR-K6)' }),
  T('WP9.audit.read', 'WP-9', 'GET', `${PRJ}/audit`, P('audit', 'read'), read(), { needs: 'the project', plan: 'WP-9 audit completeness' }),
  T('WP9.risk.create', 'WP-9', 'POST', `${PRJ}/risks`, P('risk', 'create'), invalid({}), { body: { description: 'CERT3 risk @stamp', probability: 'medium', impact: 'high' }, needs: 'the project', plan: 'WP-9 risk state machine' }),
  T('WP9.risk.update', 'WP-9', 'PATCH', `${PRJ}/risks/{id}`, P('risk', 'update'), ghost(['id']), { body: { description: 'edited' }, needs: 'a risk' }),
  T('WP9.risk.submit', 'WP-9', 'POST', `${PRJ}/risks/{id}/submit`, P('risk', 'submit', 'risk.submit'), ghost(['id']), { body: {}, needs: 'a draft risk' }),
  T('WP9.risk.close', 'WP-9', 'POST', `${PRJ}/risks/{id}/close`, P('risk', 'submit', 'risk.submit'), ghost(['id']), { body: {}, needs: 'an open risk', notes: ['close carries risk.submit, not a close transition'] }),
  T('WP9.risk.approve', 'WP-9', 'POST', `${PRJ}/risks/{id}/approve`, P('risk', 'approve', 'risk.approve'), ghost(['id']), { body: {}, needs: 'a submitted risk' }),
  T('WP9.risk.reject', 'WP-9', 'POST', `${PRJ}/risks/{id}/reject`, P('risk', 'approve', 'risk.reject'), ghost(['id']), { body: { reason: REASON }, needs: 'a submitted risk' }),
  T('WP9.risk.reopen', 'WP-9', 'POST', `${PRJ}/risks/{id}/reopen`, P('risk', 'approve', 'risk.reopen'), ghost(['id']), { body: { reason: REASON }, needs: 'a closed risk' }),
  T('WP9.risk.archive', 'WP-9', 'DELETE', `${PRJ}/risks/{id}`, P('risk', 'delete'), ghost(['id']), { needs: 'a risk', plan: 'WP-9 "an archived risk must be excluded"' }),
  T('WP9.schedule.history', 'WP-9', 'GET', `${PRJ}/schedule/revisions`, P('schedule', 'read'), read(), { needs: 'the project', plan: 'WP-9 schedule history' }),

  // ── company administration (the 052 probe; 087's PM administers 087) ──────
  T('ADM.users.read', 'ADM', 'GET', '/users', P('user_management', 'read'), read(), { needs: 'none', plan: 'WP-0 "whether company administration grants module rights"' }),
  T('ADM.users.invitations', 'ADM', 'GET', '/users/invitations', P('user_management', 'submit', 'user.invite'), read(), { needs: 'none', plan: 'D-ID-1 invitation gate; 087-FLD party user by invitation' }),
  T('ADM.party.assign', 'ADM', 'POST', `${PRJ}/parties`, P('project_parties', 'create', 'party.assign'), invalid({}), { body: { role: 'subcontractor', companyName: 'CERT3 Sub @stamp' }, needs: 'the project', plan: '087-FLD subcontractor party company' }),
  T('ADM.team.add', 'ADM', 'POST', `${PRJ}/team`, ADMIN, invalid({ userId: 'not-a-uuid' }), { body: { userId: '@user:site' }, needs: 'the project', plan: 'every CERT-3 project: people are put on it by an administrator', notes: ['the role list of this route omits quality_engineer: a quality engineer can only be added with the default (company) role'] }),
  T('ADM.costCode.create', 'ADM', 'POST', '/company/cost-codes', ADMIN, invalid({}), { body: { code: 'C3-@stamp', name: 'CERT3 cost code' }, needs: 'none', plan: 'WP-6 "Cost codes and lines for all eight cost types"' }),
  T('ADM.vendor.create', 'ADM', 'POST', '/company/vendors', ADMIN, invalid({}), { body: { name: 'CERT3 Vendor @stamp', type: 'subcontractor' }, needs: 'none', plan: 'WP-4/WP-5 vendors, suppliers, bidders' }),
  T('ADM.project.create', 'ADM', 'POST', '/projects', R('project', 'create', ['pm', 'planning_eng'], { orgRoleOnly: true }), invalid({}), { body: { name: 'CERT3 ... @stamp', startDate: '2026-01-05', endDate: '2027-06-30' }, needs: 'none (plan project limit)', plan: '§3.2 every CERT-3 project' }),
];

// ── real-record scenarios (permission-probe.js implements them) ──────────────
const SCENARIOS = Object.freeze([
  { id: 'S1-progress-submit', company: '087', transitions: ['WP2.progress.submit'],
    what: 'One activity per persona allowed by JSON (pm, planning_eng, site_engineer, quality_engineer), each assigned to that persona only (engineerIds), plus one activity assigned to the planner only. Each allowed persona submits 40% on its own activity: 200, submission.status submitted. The site and quality engineers on the planner\'s activity: 403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED (service rule, not the JSON). The five JSON-refused personas on the planner\'s activity: 403 FORBIDDEN with details progress/submit/submission.submit.' },
  { id: 'S2-progress-approve', company: '087', transitions: ['WP2.progress.approve'],
    what: 'The four submissions of S1. The six JSON-refused personas on the planner\'s submission: 403 FORBIDDEN. pm, planning_eng and qs each approve a different submission: 200, status approved. Approving the same one again: 200, still approved (idempotent).' },
  { id: 'S3-period-override', company: '087', transitions: ['WP3.period.lock', 'WP3.period.override'],
    what: 'A reporting period created by the cost controller. Finance locks without a reason: 409 REPORTING_READINESS_BLOCKED (the throwaway project has no baseline), else the gate is open and the scenario is recorded as not applicable. Finance with a reason: 403 REPORTING_READINESS_OVERRIDE_FORBIDDEN. The planner: 403 FORBIDDEN (guard). PM with a reason: 200, the period locked.' },
  { id: 'S4-unassigned', company: '087', transitions: ['(project access)'],
    what: 'A second throwaway project with nobody assigned. GET /projects/:id/activities: the eight non-PM personas 403 PROJECT_ACCESS_DENIED; the PM (company admin) 200.' },
  { id: 'S5-inventory-scope', company: '087', transitions: ['WP5.item.create', 'WP5.warehouse.create', 'WP5.stock.receive'],
    what: 'The warehouse persona creates a throwaway item and warehouse (201 each), then receives stock naming the UNASSIGNED project of S4. The inventory routes are company-level: the code has no project-access check for a person (only an API key\'s project list). Expected by the project-access rule: refused (403/404). A 2xx is the registered suspect (a person acts on a project they cannot open; adjudication §B, proposed P2, severity after reproduction).' },
  { id: 'S6-report-manage', company: '087 and 052', transitions: ['WP9.report.update'],
    what: 'The QS creates a private report. The finance persona (not the creator) PUTs it: 087 finance (plain member) expected refused; 052 finance (company admin) is let through by report-builder.service canManage (creator || isCompanyAdmin || PM). Recorded: a record-level right that company administration grants outside the JSON.' },
  { id: 'S7-admin-052', company: '052', transitions: ['every project- and org-scoped entry'],
    what: 'A throwaway project in 052 with nobody assigned. 052 finance (company admin, not assigned) runs the whole matrix on it with the expectation finance + COMPANY_ADMIN_MODULES; 052 QS (plain, not assigned) gets 403 PROJECT_ACCESS_DENIED on the project; finance\'s reach (org-wide visibility of an administrator) and its /company and report grants are recorded for the owner (HR-A1), never compared. GET /auth/me/permissions?projectId= as finance: role finance, isCompanyAdmin true, template null, and every module except user_management and project_parties equal to the JSON finance row (no JSON module right beyond those two).' },
]);

// ── what the code at HEAD 886c9f1 does that the JSON does not say ────────────
const ROUTE_VS_JSON = Object.freeze([
  { id: 'RJ-1', what: 'requireRoles guards decide by a hard-coded role list: POST/PATCH/DELETE /projects (pm, planning_eng), POST/PATCH change-orders (pm, qs), DELETE change-orders (pm), POST/PATCH eot and eot/calculate (pm, planning_eng, qs), BOQ upload/items/template/uploads (pm, planning_eng, qs), long-lead, equipment, weekly reports, notification scan. Today each list equals the JSON for the natural action, except the BOQ reads below.' },
  { id: 'RJ-2', what: '/projects/:id PATCH and DELETE run requireRoles BEFORE requireProjectAccess and map to module "project", which the JSON lacks: the organisation role decides and no template or project-assignment role is consulted.' },
  { id: 'RJ-3', what: 'GET /boq/template and GET /boq/uploads/:documentId are guarded by CAN_MODIFY (pm, planning_eng, qs): narrower than JSON boq.read (all nine roles).' },
  { id: 'RJ-4', what: 'DELETE guarded by update where JSON delete is empty: weather delays (eot.delete []), drawings, drawing sets, transmittals, correspondence (document_control.delete []).' },
  { id: 'RJ-5', what: 'Hard-coded "pm" in services: the reporting-readiness override (mirrors JSON reporting_period.override but ignores templates); the IPC over-certification override (no JSON key at all).' },
  { id: 'RJ-6', what: 'Progress submission needs an activity assignment unless pm or planning_eng (progress.service PROGRESS_ASSIGNMENT_OVERRIDE_ROLES); JSON grants site_engineer and quality_engineer unconditionally.' },
  { id: 'RJ-7', what: 'Record allowances: an NCR or safety assignee may submit and close it whatever the role (requirePermissionOr).' },
  { id: 'RJ-8', what: 'Company-level routes (/inventory, /reports) decide by the organisation role with no project assignment and no template; the inventory service checks a project only against an API key\'s project list (S5).' },
  { id: 'RJ-9', what: 'No module check: project health, quality dashboard, workspace dashboard (WP-9 "recorded"); exceptions decide in the service from change_event create/update or the subject module\'s update.' },
  { id: 'RJ-10', what: 'Punch transitions check the permission inside the handler, after body validation (TRANSITION_PERMISSION); resolve_dispute uses punch.reopen.' },
  { id: 'RJ-11', what: 'Transitions reused for other actions: risk close uses risk.submit; daily-log reopen uses daily_log.approve; PO reject uses po.approve; commitment return uses commitment.approve; commitment-CO void has no transition (commitment update); weather promotion from a daily log uses daily_log.update (HR-F4).' },
  { id: 'RJ-12', what: 'POST /projects/:id/team validates role against a list without quality_engineer, and config/permissions ROLE_ALIASES has no quality_engineer entry (harmless: normalizeRoleId returns the input).' },
]);

// ── company administration (WP-0 bullet: "whether company administration grants module rights")
const COMPANY_ADMIN = Object.freeze({
  definition: 'req.user.isCompanyAdmin = membership isAdmin || isOwner (membership.service toPrincipal)',
  jsonModuleRights: 'user_management and project_parties, every action and transition (rbac.js COMPANY_ADMIN_MODULES; permission-template.service resolveProjectPermissions decideWithAdmin). No other module: the role (or template) decides.',
  outsideJson: [
    'org-wide project visibility: project-authorization canAccessAllProjects(isCompanyAdmin) — an administrator of any role reaches every project without an assignment',
    'requireCompanyAdmin routes: project team (add/remove, templates), assignments resolve, /company cost codes, vendors and prequalification decisions, equipment, project templates, company form templates, submittal and workflow templates, company security',
    'report-builder.service: manage any report (canManage) and download any run',
    'comment, conversation and project-email moderation (canModerate)',
    'gantt-layout.service: shared layouts',
  ],
  personas: {
    '087': 'PM persona is an administrator; finance persona is not (087 % 3 = 0); the owner (finance role) is not a persona',
    '052': 'PM persona and finance persona (052 % 3 = 1) are administrators; the owner is a cost controller',
  },
  planAssumption: 'no JSON module rights beyond user_management and project_parties (asserted by the probe: S0.effective.pm.matrix, S7.effective.matrix, the P2 finance run); every grant outside the JSON (org-wide project visibility, the /company routes, report management, moderation, Gantt layouts) is recorded for the owner as HR-A1 and never failed (adjudication §B)',
});

// ── decisions ────────────────────────────────────────────────────────────────

/** Is this persona allowed by the guard the route enforces? null when the guard is not compared. */
const expectAllowed = (entry, persona) => {
  const { guard } = entry;
  switch (guard.kind) {
    case 'permission':
      return policyAllows(guard, persona);
    case 'roles':
      // The JSON decides wherever it has the module (the natural key: the mount module and the
      // method's action, as rbac moduleForRequest / ACTION_BY_METHOD name them); the route's own
      // list is compared against it by the probe. Only a module the JSON lacks ('project') falls
      // back to the route's list.
      return POLICY.modules[guard.module] ? allowedRoles(guard.module, guard.action).includes(persona.role) : guard.roles.includes(persona.role);
    case 'companyAdmin':
      return Boolean(persona.isCompanyAdmin);
    case 'projectAccess':
      return true;
    default:
      return null;
  }
};

/** The exact refusal the guard gives a role it does not allow. */
const denialFor = (entry) => {
  const { guard } = entry;
  if (guard.kind === 'permission') return { status: 403, code: 'FORBIDDEN', details: { module: guard.module, action: guard.action, transition: guard.transition } };
  if (guard.kind === 'roles') return { status: 403, code: 'FORBIDDEN' };
  if (guard.kind === 'companyAdmin') return { status: 403, code: 'FORBIDDEN', details: { requires: 'company_admin' } };
  return null;
};

/** The JSON key a route-level role list stands in for (the natural action of the method). */
const naturalKeyFor = (entry) => (entry.guard.kind === 'roles' ? { module: entry.guard.module, action: entry.guard.action } : null);

/**
 * Where a route's hard-coded role list and the JSON disagree today (computed when this
 * module loads). Each one shows up in the probe as a mismatch for the roles named.
 */
const ROLE_LIST_DIFFERENCES = TRANSITIONS.filter((entry) => entry.guard.kind === 'roles').map((entry) => {
  const { module, action, roles } = entry.guard;
  if (!POLICY.modules[module]) return { id: entry.id, module, action, jsonKey: null, routeRoles: roles, note: `module "${module}" is not in permissions.json: the route's list is the only rule` };
  const json = allowedRoles(module, action);
  const onlyRoute = roles.filter((role) => !json.includes(role));
  const onlyJson = json.filter((role) => !roles.includes(role));
  return onlyRoute.length || onlyJson.length ? { id: entry.id, module, action, jsonKey: `${module}:${action}`, routeRoles: roles, jsonRoles: json, routeOnly: onlyRoute, jsonOnly: onlyJson } : null;
}).filter(Boolean);

/**
 * Permission-guarded routes whose declared action is not the method's natural one
 * (DELETE guarded by update, a reject guarded by approve...). The declared key is what
 * the probe compares; these are listed for the register, where the natural key's JSON
 * row says something different.
 */
const NATURAL_ACTION = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete', GET: 'read' };
const DECLARED_VS_NATURAL = TRANSITIONS.filter((entry) => entry.guard.kind === 'permission' && entry.method === 'DELETE' && entry.guard.action !== 'delete').map((entry) => ({
  id: entry.id,
  declared: `${entry.guard.module}:${entry.guard.action}${entry.guard.transition ? `:${entry.guard.transition}` : ''}`,
  declaredRoles: allowedRoles(entry.guard.module, entry.guard.action, entry.guard.transition),
  natural: `${entry.guard.module}:${NATURAL_ACTION[entry.method]}`,
  naturalRoles: allowedRoles(entry.guard.module, NATURAL_ACTION[entry.method]),
}));

/** Refuses an entry the JSON cannot decide: unknown module, action or transition (the product would fall back silently). */
const validateMatrix = () => {
  const problems = [];
  const ids = new Set();
  for (const entry of TRANSITIONS) {
    if (ids.has(entry.id)) problems.push(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    const { guard } = entry;
    if (guard.kind === 'permission') {
      const modulePolicy = POLICY.modules[guard.module];
      if (!modulePolicy) problems.push(`${entry.id}: module ${guard.module} is not in permissions.json`);
      else {
        if (!ACTIONS.includes(guard.action) || !modulePolicy.actions || !(guard.action in modulePolicy.actions)) problems.push(`${entry.id}: action ${guard.module}.${guard.action} is not in permissions.json`);
        if (guard.transition && !(modulePolicy.transitions && guard.transition in modulePolicy.transitions)) problems.push(`${entry.id}: transition ${guard.module}.${guard.transition} is not in permissions.json (the product would fall back to the action)`);
        if (guard.serviceTransition && !(modulePolicy.transitions && guard.serviceTransition in modulePolicy.transitions)) problems.push(`${entry.id}: service transition ${guard.serviceTransition} is not in permissions.json`);
      }
    }
    if (guard.kind === 'roles') {
      for (const role of guard.roles) if (!ROLES.includes(role)) problems.push(`${entry.id}: role ${role} is not in permissions.json`);
    }
    if (!['ghost', 'invalid', 'badParam', 'badQuery', 'read', 'effect', 'scenario', 'observe'].includes(entry.probe.mode)) problems.push(`${entry.id}: unknown probe mode ${entry.probe.mode}`);
    if (entry.probe.mode !== 'scenario') {
      const placeholders = [...entry.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((name) => name !== 'projectId');
      const covered = new Set([...(entry.probe.ghost || []), ...Object.keys(entry.probe.params || {})]);
      for (const name of placeholders) if (!covered.has(name)) problems.push(`${entry.id}: path parameter {${name}} has no probe value`);
    }
  }
  return problems;
};

/** The expected allow (true) / deny (false) / not compared (null) of every entry for every persona given. */
const matrixFor = (personas) =>
  TRANSITIONS.map((entry) => ({
    id: entry.id,
    wp: entry.wp,
    key: entry.guard.kind === 'permission' ? `${entry.guard.module}:${entry.guard.action}${entry.guard.transition ? `:${entry.guard.transition}` : ''}` : entry.guard.kind === 'roles' ? `${POLICY.modules[entry.guard.module] ? `${entry.guard.module}:${entry.guard.action}` : 'no JSON key'} via roles(${entry.guard.roles.join(',')})` : entry.guard.kind,
    expected: Object.fromEntries(personas.map((persona) => [persona.key, expectAllowed(entry, persona)])),
  }));

const MATRIX_PROBLEMS = validateMatrix();

module.exports = {
  ACTIONS,
  COMPANY_ADMIN,
  COMPANY_ADMIN_MODULES,
  DECLARED_VS_NATURAL,
  MATRIX_PROBLEMS,
  ROLE_LIST_DIFFERENCES,
  POLICY,
  POLICY_PATH,
  POLICY_SHA256,
  ROLES,
  ROUTE_VS_JSON,
  SCENARIOS,
  TRANSITIONS,
  allowedRoles,
  denialFor,
  expectAllowed,
  matrixFor,
  naturalKeyFor,
  policyAllows,
  validateMatrix,
};

if (require.main === module) {
  // node permission-matrix.js : prints the computed matrix (no network, no database).
  const { PERSONAS } = require('../lib/spec');
  const personas = PERSONAS.map((p) => ({ key: p.key, role: p.role, isCompanyAdmin: p.key === 'pm' }));
  console.log(`permissions.json ${POLICY.version} sha256 ${POLICY_SHA256.slice(0, 16)}; ${TRANSITIONS.length} transitions; ${MATRIX_PROBLEMS.length} matrix problems`);
  for (const problem of MATRIX_PROBLEMS) console.log(`  PROBLEM ${problem}`);
  for (const d of ROLE_LIST_DIFFERENCES) console.log(`  ROLE LIST ${JSON.stringify(d)}`);
  for (const d of DECLARED_VS_NATURAL) console.log(`  DECLARED vs NATURAL ${JSON.stringify(d)}`);
  for (const row of matrixFor(personas)) {
    console.log(`${row.id.padEnd(34)} ${row.key.padEnd(52)} ${personas.map((p) => (row.expected[p.key] === null ? '.' : row.expected[p.key] ? 'Y' : '-')).join('')}`);
  }
  console.log(`columns: ${personas.map((p) => p.key).join(' ')}`);
}
