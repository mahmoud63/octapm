/**
 * Feature adoption (Superadmin integration, 2026-10-11): which companies and
 * projects actually use which OctaPM capabilities, read from the records the
 * capabilities themselves create — counts and dates only, never a record's
 * content. "Uses" means the project holds at least one such record; the
 * 30-day figure means one was created in the last 30 days.
 *
 * Organisations are the live ones the rest of the console counts (active,
 * with an active member). Each capability is one bounded aggregate per table;
 * a platform-wide rollup is deferred until the data needs it.
 */
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { daysAgo } = require("./platform-read-models");

const LIVE_ORGS = Prisma.sql`SELECT o.id FROM "Organisation" o WHERE o.status = 'active'
  AND EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."orgId" = o.id AND m.status = 'active')`;

/**
 * Capability → the project-scoped tables whose rows show it in use (the
 * column holding the creation time). Inventory and AI are read separately:
 * inventory is company-level, AI from the gateway ledger.
 */
const CAPABILITIES = Object.freeze([
  { key: "schedule", label: "Schedule", tables: [["Activity", "createdAt"]] },
  { key: "progress", label: "Progress", tables: [["ProgressSubmission", "createdAt"]] },
  { key: "boq", label: "BOQ", tables: [["BoqItem", "createdAt"]] },
  { key: "cost", label: "Cost", tables: [["CostRecord", "updatedAt"]] },
  { key: "commercial", label: "Commercial (changes, IPC, commitments)", tables: [["ChangeOrder", "createdAt"], ["IpcCertificate", "createdAt"], ["Commitment", "createdAt"]] },
  { key: "procurement", label: "Procurement", tables: [["ProcurementOrder", "createdAt"]] },
  { key: "quality", label: "Quality (NCR, ITP, inspections, punch)", tables: [["NcrRecord", "createdAt"], ["ItpRecord", "createdAt"], ["FormInstance", "createdAt"], ["PunchItem", "createdAt"]] },
  { key: "rfi", label: "RFIs", tables: [["Rfi", "createdAt"]] },
  { key: "submittals", label: "Submittals", tables: [["Submittal", "createdAt"]] },
  { key: "reports", label: "Reports", tables: [["ProgressReport", "createdAt"], ["WeeklyReport", "createdAt"]] },
  { key: "documents", label: "Documents", tables: [["ProjectDocument", "createdAt"]] },
  { key: "bim", label: "BIM / 5D", tables: [["BimModel", "createdAt"]] },
  { key: "closeout", label: "Closeout / Turnover", tables: [["CloseoutDeliverable", "createdAt"]] },
  { key: "consultant_reviews", label: "Consultant Reviews", tables: [["ExternalSubmission", "createdAt"]] },
]);

const n = (value) => (value === null || value === undefined ? 0 : Number(value));

/** One capability's rows per organisation: projects using it, records, last record, projects active in 30 days. */
const capabilityRows = (capability, since30) =>
  Prisma.join(
    capability.tables.map(([table, column]) => Prisma.sql`
      SELECT p."orgId" AS org_id, t."projectId" AS project_id, t.${Prisma.raw(`"${column}"`)} AS at
      FROM ${Prisma.raw(`"${table}"`)} t JOIN "Project" p ON p.id = t."projectId"
      WHERE p."orgId" IN (${LIVE_ORGS})`),
    " UNION ALL "
  );

const getFeatureAdoption = async ({ orgId = null, now = new Date() } = {}) => {
  const since30 = daysAgo(30, now);
  const orgFilter = orgId ? Prisma.sql`AND x.org_id = ${orgId}` : Prisma.empty;
  const perCapability = await Promise.all(
    CAPABILITIES.map((capability) => prisma.$queryRaw`
      SELECT x.org_id, count(DISTINCT x.project_id)::int AS projects, count(*)::int AS records,
             count(DISTINCT x.project_id) FILTER (WHERE x.at >= ${since30})::int AS projects_30d,
             max(x.at) AS last_at
      FROM (${capabilityRows(capability, since30)}) x WHERE true ${orgFilter} GROUP BY 1`)
  );
  const orgScope = orgId ? Prisma.sql`AND p."orgId" = ${orgId}` : Prisma.empty;
  const [projectsPerOrg, ai, inventory, orgs] = await Promise.all([
    prisma.$queryRaw`SELECT p."orgId" AS org_id, count(*)::int AS projects FROM "Project" p WHERE p."orgId" IN (${LIVE_ORGS}) AND p."archivedAt" IS NULL ${orgScope} GROUP BY 1`,
    prisma.$queryRaw`
      SELECT r."orgId" AS org_id, count(DISTINCT r."projectId")::int AS projects, count(*)::int AS records,
             count(DISTINCT r."projectId") FILTER (WHERE r."createdAt" >= ${since30})::int AS projects_30d, max(r."createdAt") AS last_at
      FROM "AiRun" r WHERE r."orgId" IN (${LIVE_ORGS}) AND r.status = 'ok' ${orgId ? Prisma.sql`AND r."orgId" = ${orgId}` : Prisma.empty} GROUP BY 1`,
    prisma.$queryRaw`
      SELECT i."orgId" AS org_id, count(*)::int AS records, max(i."createdAt") AS last_at
      FROM "InventoryItem" i WHERE i."orgId" IN (${LIVE_ORGS}) ${orgId ? Prisma.sql`AND i."orgId" = ${orgId}` : Prisma.empty} GROUP BY 1`,
    prisma.$queryRaw`SELECT o.id, o.name FROM "Organisation" o WHERE o.id IN (${LIVE_ORGS}) ${orgId ? Prisma.sql`AND o.id = ${orgId}` : Prisma.empty}`,
  ]);
  const orgName = new Map(orgs.map((row) => [row.id, row.name]));
  const projectsOf = new Map(projectsPerOrg.map((row) => [row.org_id, n(row.projects)]));
  const capabilities = [
    ...CAPABILITIES.map((capability, index) => ({ key: capability.key, label: capability.label, rows: perCapability[index] })),
    { key: "ai", label: "AI (Ask OctaPM, reports, search)", rows: ai },
  ];
  const summary = capabilities.map((capability) => ({
    key: capability.key,
    label: capability.label,
    companies: capability.rows.length,
    projects: capability.rows.reduce((sum, row) => sum + n(row.projects), 0),
    projectsActive30d: capability.rows.reduce((sum, row) => sum + n(row.projects_30d), 0),
    records: capability.rows.reduce((sum, row) => sum + n(row.records), 0),
    lastAt: capability.rows.reduce((last, row) => (row.last_at && (!last || row.last_at > last) ? row.last_at : last), null),
  }));
  summary.push({ key: "inventory", label: "Inventory (company-level)", companies: inventory.length, projects: null, projectsActive30d: null, records: inventory.reduce((sum, row) => sum + n(row.records), 0), lastAt: inventory.reduce((last, row) => (row.last_at && (!last || row.last_at > last) ? row.last_at : last), null) });
  // Company × capability: how many of each company's projects use each capability.
  const byCompany = [...orgName.entries()].map(([id, name]) => ({
    organisation: { id, name },
    projects: projectsOf.get(id) || 0,
    capabilities: Object.fromEntries(capabilities.map((capability) => [capability.key, n(capability.rows.find((row) => row.org_id === id)?.projects)])),
    inventoryItems: n(inventory.find((row) => row.org_id === id)?.records),
  })).filter((row) => row.projects || Object.values(row.capabilities).some(Boolean) || row.inventoryItems).sort((a, b) => b.projects - a.projects || a.organisation.name.localeCompare(b.organisation.name));
  return {
    generatedAt: now.toISOString(),
    organisation: orgId || null,
    capabilities: summary,
    byCompany: byCompany.slice(0, 200),
    detail: await newFeatureDetail({ orgId, now }),
    definitions: {
      uses: "A project uses a capability when it holds at least one record that capability creates (counts and dates only, never content).",
      active30d: "Projects that created such a record in the last 30 days.",
      ai: "Projects with at least one successful AI gateway call.",
    },
  };
};

/** BIM / 5D, Closeout and Consultant Reviews in a little more depth — still counts and metadata only. */
const newFeatureDetail = async ({ orgId = null, now = new Date() } = {}) => {
  const scope = orgId ? Prisma.sql`AND p."orgId" = ${orgId}` : Prisma.sql`AND p."orgId" IN (${LIVE_ORGS})`;
  const [bim, closeout, consultants, reviews] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(DISTINCT p."orgId")::int AS companies, count(DISTINCT m."projectId")::int AS projects,
             count(DISTINCT (m."projectId", m.name))::int AS models, count(*)::int AS revisions,
             count(*) FILTER (WHERE m.status = 'failed')::int AS failed_parses,
             coalesce(sum(m."elementCount"), 0)::int AS elements,
             coalesce(sum(m."linkedCount") FILTER (WHERE m."isCurrent"), 0)::int AS mapped_current,
             coalesce(sum(m."elementCount") FILTER (WHERE m."isCurrent"), 0)::int AS elements_current,
             max(m."createdAt") AS last_at
      FROM "BimModel" m JOIN "Project" p ON p.id = m."projectId" WHERE true ${scope}`,
    prisma.$queryRaw`
      SELECT count(DISTINCT d."projectId")::int AS projects, count(*)::int AS deliverables,
             count(*) FILTER (WHERE d.status IN ('accepted', 'waived', 'not_applicable'))::int AS settled,
             count(*) FILTER (WHERE d.status = 'submitted')::int AS submitted,
             (SELECT count(*)::int FROM "ProjectCloseout" c JOIN "Project" p ON p.id = c."projectId" WHERE c."substantialCompletionAt" IS NOT NULL ${scope}) AS substantial,
             (SELECT count(*)::int FROM "ProjectCloseout" c JOIN "Project" p ON p.id = c."projectId" WHERE c."handoverAt" IS NOT NULL ${scope}) AS handed_over,
             (SELECT count(*)::int FROM "ProjectCloseout" c JOIN "Project" p ON p.id = c."projectId" WHERE c."finalCompletionAt" IS NOT NULL ${scope}) AS final_complete,
             max(d."createdAt") AS last_at
      FROM "CloseoutDeliverable" d JOIN "Project" p ON p.id = d."projectId" WHERE true ${scope}`,
    prisma.$queryRaw`
      SELECT count(DISTINCT pp."projectId")::int AS projects, count(*)::int AS parties,
             (SELECT count(*)::int FROM "ProjectPartyMember" mm JOIN "ProjectParty" q ON q.id = mm."projectPartyId" JOIN "Project" p ON p.id = q."projectId" WHERE q.role = 'consultant' AND mm.status = 'active' ${scope}) AS active_consultants,
             (SELECT count(*)::int FROM "InvitationToken" i JOIN "ProjectParty" q ON q.id = i."projectPartyId" JOIN "Project" p ON p.id = q."projectId" WHERE q.role = 'consultant' ${scope}) AS invited,
             (SELECT count(*)::int FROM "InvitationToken" i JOIN "ProjectParty" q ON q.id = i."projectPartyId" JOIN "Project" p ON p.id = q."projectId" WHERE q.role = 'consultant' AND i."acceptedAt" IS NOT NULL ${scope}) AS accepted
      FROM "ProjectParty" pp JOIN "Project" p ON p.id = pp."projectId" WHERE pp.role = 'consultant' ${scope}`,
    prisma.$queryRaw`
      SELECT count(DISTINCT s."projectId")::int AS projects, count(*)::int AS submissions,
             count(*) FILTER (WHERE s.status IN ('submitted', 'under_review'))::int AS awaiting_consultant,
             count(*) FILTER (WHERE s.status IN ('submitted', 'under_review') AND s."dueAt" < ${now})::int AS overdue,
             count(*) FILTER (WHERE s.status IN ('returned', 'revising', 'responded'))::int AS with_contractor,
             count(*) FILTER (WHERE s.status IN ('acknowledged', 'closed'))::int AS completed,
             count(*) FILTER (WHERE s.status = 'withdrawn')::int AS withdrawn,
             (SELECT count(*)::int FROM "ExternalReviewCycle" c JOIN "Project" p ON p.id = c."projectId" WHERE c."respondedAt" IS NOT NULL ${scope}) AS responses,
             (SELECT round(avg(extract(epoch FROM (c."respondedAt" - c."submittedAt")) * 1000))::bigint FROM "ExternalReviewCycle" c JOIN "Project" p ON p.id = c."projectId" WHERE c."respondedAt" IS NOT NULL ${scope}) AS avg_response_ms,
             max(s."lastSubmittedAt") AS last_at
      FROM "ExternalSubmission" s JOIN "Project" p ON p.id = s."projectId" WHERE true ${scope}`,
  ]);
  const b = bim[0] || {};
  const c = closeout[0] || {};
  const k = consultants[0] || {};
  const r = reviews[0] || {};
  return {
    bim: { companies: n(b.companies), projects: n(b.projects), models: n(b.models), revisions: n(b.revisions), failedParses: n(b.failed_parses), elements: n(b.elements), currentElements: n(b.elements_current), currentElementsWithLinks: n(b.mapped_current), lastActivityAt: b.last_at || null },
    closeout: { projects: n(c.projects), deliverables: n(c.deliverables), settled: n(c.settled), awaitingReview: n(c.submitted), projectsSubstantiallyComplete: n(c.substantial), projectsHandedOver: n(c.handed_over), projectsFinalComplete: n(c.final_complete), lastActivityAt: c.last_at || null },
    consultantReviews: {
      projectsWithConsultants: n(k.projects),
      consultantCompanies: n(k.parties),
      activeConsultants: n(k.active_consultants),
      invitationsSent: n(k.invited),
      invitationsAccepted: n(k.accepted),
      projectsWithReviews: n(r.projects),
      submissions: n(r.submissions),
      awaitingConsultant: n(r.awaiting_consultant),
      overdue: n(r.overdue),
      withContractor: n(r.with_contractor),
      completed: n(r.completed),
      withdrawn: n(r.withdrawn),
      responses: n(r.responses),
      averageResponseMs: r.avg_response_ms === null || r.avg_response_ms === undefined ? null : Number(r.avg_response_ms),
      lastActivityAt: r.last_at || null,
    },
  };
};

module.exports = { CAPABILITIES, getFeatureAdoption, newFeatureDetail };
