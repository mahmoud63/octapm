/**
 * Shared pieces of the platform-admin read models: windows, paging, the
 * record-type → module map, the activity sources, and the subscription view.
 */
const { Prisma } = require("@prisma/client");
const { isExpired, serializeSubscription } = require("../subscription.service");

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = Object.freeze([7, 30, 90]);
// "Last activity" is looked up within this bound so no query ever scans the
// whole history of AuditEvent / ProductEvent / RefreshSession.
const ACTIVITY_LOOKBACK_DAYS = 90;

const daysAgo = (days, now = new Date()) => new Date(now.getTime() - days * DAY_MS);
const startOfUtcMonth = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Paging: page >= 1, 1 <= pageSize <= 100. */
const paging = ({ page, pageSize }) => {
  const p = Math.max(1, Number.parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
  return { page: p, pageSize: size, offset: (p - 1) * size };
};
const pageInfo = ({ page, pageSize }, total) => ({
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

/**
 * Audit entity types → product modules. A type not listed keeps its own name
 * (so a new record type shows up rather than disappearing). System records
 * (jobs, webhooks, API clients) are not product usage and are excluded.
 */
const RECORD_MODULES = Object.freeze({
  project: "projects",
  project_setup_readiness: "projects",
  location: "projects",
  boq_item: "boq",
  boq_revision: "boq",
  schedule_revision: "schedule",
  activity_boq_allocation: "mapping",
  progress_submission: "progress",
  quantity_progress_entry: "progress",
  daily_report: "daily_reports",
  site_diary: "daily_reports",
  daily_log: "daily_logs",
  rfi: "rfi",
  submittal: "submittals",
  submittal_package: "submittals",
  submittal_workflow_template: "submittals",
  change_order: "changes",
  change_event: "changes",
  eot_claim: "changes",
  weather_delay: "changes",
  cost_record: "cost",
  burn_rate_entry: "cost",
  budget_line: "cost",
  budget_snapshot: "cost",
  ipc_certificate: "commercial",
  ipc_item: "commercial",
  sub_valuation: "commercial",
  sub_pay_app: "commercial",
  commitment: "commercial",
  commitment_change_order: "commercial",
  procurement_supplier: "procurement",
  procurement_package: "procurement",
  procurement_order: "procurement",
  procurement_alert: "procurement",
  delivery_receipt: "procurement",
  bid_package: "procurement",
  bid: "procurement",
  activity_material_usage: "inventory",
  activity_equipment_usage: "inventory",
  safety_incident: "safety",
  punch_item: "punch",
  form_template: "quality",
  form_instance: "quality",
  document_revision: "documents",
  attachment: "documents",
  photo: "documents",
  drawing_set: "drawings",
  sheet: "drawings",
  sheet_revision: "drawings",
  markup: "drawings",
  pin: "drawings",
  report: "reports",
  risk: "risk",
  meeting: "meetings",
  task: "tasks",
  workflow_template: "workflows",
  workflow_instance: "workflows",
  custom_field: "company_admin",
  custom_fieldset: "company_admin",
  record_type: "company_admin",
});
const SYSTEM_RECORD_TYPES = Object.freeze(["background_job", "api_client", "webhook", "accounting_connection"]);

/** SQL: CASE "entityType" WHEN ... THEN module ... ELSE "entityType" END */
const recordModuleSql = (column = Prisma.sql`"entityType"`) =>
  Prisma.sql`CASE ${column} ${Prisma.join(
    Object.entries(RECORD_MODULES).map(([type, module]) => Prisma.sql`WHEN ${type} THEN ${module}`),
    " ",
  )} ELSE ${column} END`;

/**
 * One activity stream for "who / which company did something", built only
 * from canonical rows: record changes (AuditEvent actor), tracked product
 * events, and session issue/refresh (RefreshSession, counted only — never its
 * token hash or address).
 */
const activitySql = (since, { liveOrgsOnly = true } = {}) => {
  const live = liveOrgsOnly
    ? Prisma.sql`AND "orgId" IN (SELECT id FROM "Organisation" WHERE status = 'active')`
    : Prisma.empty;
  return Prisma.sql`
  SELECT "orgId", "actorId" AS "userId", "occurredAt" AS at FROM "AuditEvent"
    WHERE "occurredAt" >= ${since} AND "entityType" NOT IN (${Prisma.join(SYSTEM_RECORD_TYPES)}) ${live}
  UNION ALL
  SELECT "orgId", "userId", "createdAt" AS at FROM "ProductEvent" WHERE "createdAt" >= ${since} ${live}
  UNION ALL
  SELECT "orgId", "userId", "createdAt" AS at FROM "RefreshSession" WHERE "createdAt" >= ${since} ${live}`;
};

/**
 * AuditEvent and ProductEvent rows outlive their organisation (no foreign
 * key, by design). Every cross-company count is limited to organisations that
 * exist and are active — the same population as the "active companies"
 * denominator, so a share can never exceed 100%.
 */
const LIVE_ORG_FILTER = Prisma.sql`"orgId" IN (SELECT id FROM "Organisation" WHERE status = 'active')`;

/**
 * The platform view of a subscription: canonical fields through the billing
 * service's own serializer, plus provider linkage as booleans. Stripe ids,
 * payment-method details and prices are never returned.
 */
const platformSubscription = (sub, { lastInvoiceStatus = null } = {}) => {
  if (!sub) return null;
  const view = serializeSubscription(sub);
  return {
    plan: view.plan,
    planName: view.planName,
    recognized: view.recognized,
    configurationError: view.configurationError,
    status: view.status,
    hasAccess: !isExpired(sub),
    seats: view.seats,
    billingCycle: view.billingCycle,
    trialStartsAt: sub.trialStartsAt || null,
    trialEndsAt: view.trialEndsAt,
    currentPeriodEnd: view.currentPeriodEnd,
    cancelAtPeriodEnd: view.cancelAtPeriodEnd,
    canceledAt: sub.canceledAt || null,
    providerCustomerLinked: Boolean(sub.stripeCustomerId),
    providerSubscriptionLinked: Boolean(sub.stripeSubscriptionId),
    lastInvoiceStatus,
    paymentIssue: sub.status === "past_due" || lastInvoiceStatus === "failed",
  };
};

const toInt = (value) => (value === null || value === undefined ? 0 : Number(value));

module.exports = {
  ACTIVITY_LOOKBACK_DAYS,
  DAY_MS,
  LIVE_ORG_FILTER,
  RECORD_MODULES,
  SYSTEM_RECORD_TYPES,
  WINDOWS,
  activitySql,
  daysAgo,
  pageInfo,
  paging,
  platformSubscription,
  recordModuleSql,
  startOfUtcMonth,
  toInt,
};
