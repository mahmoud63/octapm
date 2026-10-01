const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const weatherFeed = require("./weather-feed.service");
const { isPartyScopedAccess } = require("./company-party.service");
const { createPdf } = require("../utils/pdf-writer");

/**
 * Project daily log (OCTA-FLD-DAILY-022).
 *
 * One log per project per day with typed sections (manpower, equipment,
 * deliveries, visitors, delays, notes, quantities). Staff entries are approved
 * as they are written; entries from party users (contractor / subcontractor
 * collaborators) are submitted and reviewed by the site team. Weather is
 * filled from the feed by project coordinates — breaches of the project's
 * thresholds raise a suggested weather delay — or typed in. The day can be
 * copied forward, submitted, approved, rendered to PDF and distributed by
 * email.
 *
 * The quantities section (PC-6, OCTAPM_PROGRESS_MEASUREMENT.md §4): a row
 * says how much of a BOQ item the activity has an approved allocation of was
 * installed that day. A row's own status is the section's review state, like
 * its six siblings, and NEVER progress: submitting the log mints one
 * QuantityProgressEntry per row (source daily_log, status submitted), and
 * only the progress approval writer (progress.service — a quantity-method
 * submission that bundles the entries, approved by the progress approvers)
 * makes an installed quantity official. Approving the log approves the log
 * and its rows' review state; it does not approve an entry. Editing a row
 * before its entry is approved updates the entry; removing a row removes a
 * still-pending entry and leaves an approved or rejected one as the trail
 * (its link to the row is nulled by the database).
 */

// Lazily: quantity-progress.service requires progress.service, whose own
// graph reaches back here through the routes.
const quantityProgress = () => require("./quantity-progress.service");

const LOG_STATUS = Object.freeze({ OPEN: "open", SUBMITTED: "submitted", APPROVED: "approved" });
const LOG_STATUSES = Object.values(LOG_STATUS);
const ENTRY_STATUS = Object.freeze({ DRAFT: "draft", SUBMITTED: "submitted", APPROVED: "approved", REJECTED: "rejected" });
const ENTRY_STATUSES = Object.values(ENTRY_STATUS);
const DELAY_TYPES = ["weather", "access", "design", "material", "labour", "equipment", "inspection", "utility", "other"];
const NOTE_KINDS = ["general", "safety", "instruction", "inspection", "issue"];
const DISTRIBUTION_ROLES = ["pm", "planning_eng", "qs", "cost_controller", "site_engineer", "finance", "procurement", "warehouse"];
const WEATHER_SOURCE = Object.freeze({ FEED: "feed", MANUAL: "manual" });
const DELAY_SOURCE = Object.freeze({ MANUAL: "manual", WEATHER_FEED: "weather_feed" });
const PDF_DOCUMENT_TYPE = "workflow_attachment";
const MAX_RANGE_DAYS = 120;

const DEFAULT_SETTINGS = Object.freeze({
  weatherFeedEnabled: true,
  thresholds: { ...weatherFeed.DEFAULT_THRESHOLDS },
  distributionRoles: ["pm"],
  distributionEmails: [],
  autoDistributeAt: null,
  copySections: ["manpower", "equipment"],
});

// ─── helpers ───────────────────────────────────────────────────────────────

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toDateOnly = (value) => {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(400, "INVALID_DATE", "Date must be YYYY-MM-DD");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new HttpError(400, "INVALID_DATE", "Date is not a real calendar day");
  }
  return date;
};

const dateKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const shiftDays = (key, days) => dateKey(new Date(toDateOnly(key).getTime() + days * 86_400_000));

const isValidTimezone = (value) => {
  if (!value) return false;
  try {
    Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const localDateKey = (now, timezone) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: isValidTimezone(timezone) ? timezone : "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const localTimeHm = (now, timezone) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: isValidTimezone(timezone) ? timezone : "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(/^24/, "00");

const formatTime = (value, timezone) =>
  value ? new Intl.DateTimeFormat("en-GB", { timeZone: isValidTimezone(timezone) ? timezone : "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "";

/** Accepts an ISO timestamp or `HH:mm` (placed on the log's day, UTC). */
const parseTimeOnDay = (value, day, field) => {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [h, m] = text.split(":").map(Number);
    if (h > 23 || m > 59) throw new HttpError(400, "INVALID_TIME", `${field} must be HH:mm`);
    return new Date(day.getTime() + (h * 60 + m) * 60_000);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, "INVALID_TIME", `${field} is invalid`);
  return parsed;
};

const required = (value, field) => {
  const text = trimOrNull(value);
  if (!text) throw new HttpError(400, "DAILY_LOG_FIELD_REQUIRED", `${field} is required`, { field });
  return text;
};

const pick = (payload, existing, key, fallback = null) => (payload[key] !== undefined ? payload[key] : existing ? existing[key] : fallback);

const hours = (value, fallback = 0) => clamp(toNumber(value, fallback), 0, 24);

// ─── sections ──────────────────────────────────────────────────────────────

const SECTIONS = Object.freeze({
  manpower: {
    model: "dailyLogManpower",
    label: "Manpower",
    fields: ["companyId", "companyName", "trade", "workers", "hours", "activityId", "locationId", "notes"],
    copyFields: ["partyId", "companyId", "companyName", "trade", "workers", "hours", "activityId", "locationId", "notes"],
    normalize: (payload, existing) => ({
      companyId: trimOrNull(pick(payload, existing, "companyId")),
      companyName: trimOrNull(pick(payload, existing, "companyName")),
      trade: required(pick(payload, existing, "trade"), "trade"),
      workers: Math.max(0, Math.round(toNumber(pick(payload, existing, "workers", 0)))),
      hours: hours(pick(payload, existing, "hours", 8), 8),
      activityId: trimOrNull(pick(payload, existing, "activityId")),
      locationId: trimOrNull(pick(payload, existing, "locationId")),
      notes: trimOrNull(pick(payload, existing, "notes")),
    }),
  },
  equipment: {
    model: "dailyLogEquipment",
    label: "Equipment",
    fields: ["companyId", "equipmentId", "name", "count", "hoursOperated", "hoursIdle", "activityId", "locationId", "notes"],
    copyFields: ["partyId", "companyId", "equipmentId", "name", "count", "hoursOperated", "hoursIdle", "activityId", "locationId", "notes"],
    normalize: (payload, existing) => ({
      companyId: trimOrNull(pick(payload, existing, "companyId")),
      equipmentId: trimOrNull(pick(payload, existing, "equipmentId")),
      name: required(pick(payload, existing, "name"), "name"),
      count: Math.max(1, Math.round(toNumber(pick(payload, existing, "count", 1), 1))),
      hoursOperated: hours(pick(payload, existing, "hoursOperated", 0)),
      hoursIdle: hours(pick(payload, existing, "hoursIdle", 0)),
      activityId: trimOrNull(pick(payload, existing, "activityId")),
      locationId: trimOrNull(pick(payload, existing, "locationId")),
      notes: trimOrNull(pick(payload, existing, "notes")),
    }),
  },
  deliveries: {
    model: "dailyLogDelivery",
    label: "Deliveries",
    fields: ["companyId", "supplierName", "description", "quantity", "unit", "poRef", "receivedBy", "deliveredAt", "activityId", "notes"],
    normalize: (payload, existing, { day }) => ({
      companyId: trimOrNull(pick(payload, existing, "companyId")),
      supplierName: trimOrNull(pick(payload, existing, "supplierName")),
      description: required(pick(payload, existing, "description"), "description"),
      quantity: pick(payload, existing, "quantity") === null || pick(payload, existing, "quantity") === undefined || pick(payload, existing, "quantity") === "" ? null : Math.max(0, toNumber(pick(payload, existing, "quantity"), 0)),
      unit: trimOrNull(pick(payload, existing, "unit")),
      poRef: trimOrNull(pick(payload, existing, "poRef")),
      receivedBy: trimOrNull(pick(payload, existing, "receivedBy")),
      deliveredAt: payload.deliveredAt !== undefined ? parseTimeOnDay(payload.deliveredAt, day, "deliveredAt") : existing?.deliveredAt ?? null,
      activityId: trimOrNull(pick(payload, existing, "activityId")),
      notes: trimOrNull(pick(payload, existing, "notes")),
    }),
  },
  visitors: {
    model: "dailyLogVisitor",
    label: "Visitors",
    fields: ["name", "company", "purpose", "arrivedAt", "leftAt", "notes"],
    normalize: (payload, existing, { day }) => ({
      name: required(pick(payload, existing, "name"), "name"),
      company: trimOrNull(pick(payload, existing, "company")),
      purpose: trimOrNull(pick(payload, existing, "purpose")),
      arrivedAt: payload.arrivedAt !== undefined ? parseTimeOnDay(payload.arrivedAt, day, "arrivedAt") : existing?.arrivedAt ?? null,
      leftAt: payload.leftAt !== undefined ? parseTimeOnDay(payload.leftAt, day, "leftAt") : existing?.leftAt ?? null,
      notes: trimOrNull(pick(payload, existing, "notes")),
    }),
  },
  delays: {
    model: "dailyLogDelay",
    label: "Delays",
    fields: ["type", "description", "hoursLost", "activityId", "locationId", "source", "weatherDelayId", "notes"],
    normalize: (payload, existing) => {
      const type = trimOrNull(pick(payload, existing, "type")) || "other";
      if (!DELAY_TYPES.includes(type)) throw new HttpError(400, "DAILY_LOG_DELAY_TYPE", `Delay type must be one of: ${DELAY_TYPES.join(", ")}`);
      return {
        type,
        description: required(pick(payload, existing, "description"), "description"),
        hoursLost: hours(pick(payload, existing, "hoursLost", 0)),
        activityId: trimOrNull(pick(payload, existing, "activityId")),
        locationId: trimOrNull(pick(payload, existing, "locationId")),
        notes: trimOrNull(pick(payload, existing, "notes")),
      };
    },
  },
  notes: {
    model: "dailyLogNote",
    label: "Notes",
    fields: ["kind", "text", "activityId", "locationId"],
    normalize: (payload, existing) => {
      const kind = trimOrNull(pick(payload, existing, "kind")) || "general";
      if (!NOTE_KINDS.includes(kind)) throw new HttpError(400, "DAILY_LOG_NOTE_KIND", `Note kind must be one of: ${NOTE_KINDS.join(", ")}`);
      return {
        kind,
        text: required(pick(payload, existing, "text"), "text"),
        activityId: trimOrNull(pick(payload, existing, "activityId")),
        locationId: trimOrNull(pick(payload, existing, "locationId")),
      };
    },
  },
  // PC-6 §4: installed quantity of an allocated BOQ item on an activity. No
  // copyFields — a quantity installed yesterday is not installed again today.
  // The item, the allocation and the unit are checked against the bill in
  // assertRefs (they need the database); here the shape and the sign.
  quantities: {
    model: "dailyLogQuantity",
    label: "Quantities",
    fields: ["activityId", "boqItemId", "allocationId", "locationId", "quantity", "unitCode", "notes"],
    normalize: (payload, existing) => {
      const quantity = quantityProgress().quantityDecimal(pick(payload, existing, "quantity"), "quantity");
      if (quantity === null) throw new HttpError(400, "DAILY_LOG_FIELD_REQUIRED", "quantity is required", { field: "quantity" });
      if (quantity.isNegative()) throw new HttpError(400, "QUANTITY_NEGATIVE", "A quantity entry is never negative; a correction is a rejection plus a new entry", { field: "quantity" });
      const unit = payload.unitCode !== undefined ? payload.unitCode : payload.unit !== undefined ? payload.unit : existing ? existing.unitCode : null;
      return {
        activityId: required(pick(payload, existing, "activityId"), "activityId"),
        boqItemId: required(pick(payload, existing, "boqItemId"), "boqItemId"),
        allocationId: trimOrNull(pick(payload, existing, "allocationId")),
        locationId: trimOrNull(pick(payload, existing, "locationId")),
        quantity,
        unitCode: trimOrNull(unit),
        notes: trimOrNull(pick(payload, existing, "notes")),
      };
    },
  },
});
const SECTION_KEYS = Object.keys(SECTIONS);
const QUANTITIES = "quantities";

const sectionConfig = (section) => {
  const config = SECTIONS[section];
  if (!config) throw new HttpError(400, "DAILY_LOG_SECTION_UNKNOWN", `Section must be one of: ${SECTION_KEYS.join(", ")}`);
  return config;
};

// ─── settings ──────────────────────────────────────────────────────────────

const mergeSettings = (raw) => {
  const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    weatherFeedEnabled: stored.weatherFeedEnabled !== false,
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(stored.thresholds || {}) },
    distributionRoles: Array.isArray(stored.distributionRoles) ? stored.distributionRoles.filter((role) => DISTRIBUTION_ROLES.includes(role)) : [...DEFAULT_SETTINGS.distributionRoles],
    distributionEmails: Array.isArray(stored.distributionEmails) ? stored.distributionEmails.filter(Boolean) : [],
    autoDistributeAt: typeof stored.autoDistributeAt === "string" && /^\d{2}:\d{2}$/.test(stored.autoDistributeAt) ? stored.autoDistributeAt : null,
    copySections: Array.isArray(stored.copySections) && stored.copySections.length ? stored.copySections.filter((key) => SECTIONS[key]?.copyFields) : [...DEFAULT_SETTINGS.copySections],
  };
};

const serializeSettings = (project) => ({
  projectId: project.id,
  latitude: project.latitude ?? null,
  longitude: project.longitude ?? null,
  timezone: project.timezone ?? null,
  weatherFeedAvailable: weatherFeed.isEnabled(),
  hasCoordinates: Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude)) && project.latitude !== null && project.longitude !== null,
  distributionRoleOptions: DISTRIBUTION_ROLES,
  ...mergeSettings(project.dailyLogSettingsJson),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const getSettings = async ({ orgId, projectId }) => serializeSettings(await ensureProject({ orgId, projectId }));

const updateSettings = async ({ orgId, projectId, payload = {}, actorId = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const current = mergeSettings(project.dailyLogSettingsJson);
  const data = {};

  if (payload.latitude !== undefined) {
    if (payload.latitude === null || payload.latitude === "") data.latitude = null;
    else {
      const value = Number(payload.latitude);
      if (!Number.isFinite(value) || value < -90 || value > 90) throw new HttpError(400, "DAILY_LOG_LATITUDE", "Latitude must be between -90 and 90");
      data.latitude = value;
    }
  }
  if (payload.longitude !== undefined) {
    if (payload.longitude === null || payload.longitude === "") data.longitude = null;
    else {
      const value = Number(payload.longitude);
      if (!Number.isFinite(value) || value < -180 || value > 180) throw new HttpError(400, "DAILY_LOG_LONGITUDE", "Longitude must be between -180 and 180");
      data.longitude = value;
    }
  }
  if (payload.timezone !== undefined) {
    const timezone = trimOrNull(payload.timezone);
    if (timezone && !isValidTimezone(timezone)) throw new HttpError(400, "DAILY_LOG_TIMEZONE", "Time zone must be an IANA name such as Asia/Riyadh");
    data.timezone = timezone;
  }

  const next = { ...current };
  if (payload.weatherFeedEnabled !== undefined) next.weatherFeedEnabled = Boolean(payload.weatherFeedEnabled);
  if (payload.thresholds !== undefined) {
    const thresholds = { ...current.thresholds };
    for (const key of Object.keys(weatherFeed.DEFAULT_THRESHOLDS)) {
      if (payload.thresholds?.[key] === undefined) continue;
      const raw = payload.thresholds[key];
      if (raw === null || raw === "") thresholds[key] = null;
      else {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new HttpError(400, "DAILY_LOG_THRESHOLD", `${key} must be a number`);
        thresholds[key] = value;
      }
    }
    next.thresholds = thresholds;
  }
  if (payload.distributionRoles !== undefined) {
    const roles = Array.isArray(payload.distributionRoles) ? payload.distributionRoles.map((role) => String(role)) : [];
    const unknown = roles.filter((role) => !DISTRIBUTION_ROLES.includes(role));
    if (unknown.length) throw new HttpError(400, "DAILY_LOG_DISTRIBUTION_ROLE", `Unknown roles: ${unknown.join(", ")}`);
    next.distributionRoles = [...new Set(roles)];
  }
  if (payload.distributionEmails !== undefined) {
    const emails = (Array.isArray(payload.distributionEmails) ? payload.distributionEmails : String(payload.distributionEmails || "").split(/[\s,;]+/))
      .map((email) => String(email).trim().toLowerCase())
      .filter(Boolean);
    const invalid = emails.filter((email) => !EMAIL_RE.test(email));
    if (invalid.length) throw new HttpError(400, "DAILY_LOG_DISTRIBUTION_EMAIL", `Invalid email: ${invalid.join(", ")}`);
    if (emails.length > 50) throw new HttpError(400, "DAILY_LOG_DISTRIBUTION_EMAIL", "At most 50 external addresses");
    next.distributionEmails = [...new Set(emails)];
  }
  if (payload.autoDistributeAt !== undefined) {
    const at = trimOrNull(payload.autoDistributeAt);
    if (at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new HttpError(400, "DAILY_LOG_AUTO_TIME", "Send time must be HH:mm (24h)");
    next.autoDistributeAt = at;
  }
  if (payload.copySections !== undefined) {
    const sections = Array.isArray(payload.copySections) ? payload.copySections.filter((key) => SECTIONS[key]?.copyFields) : [];
    next.copySections = sections.length ? [...new Set(sections)] : [...DEFAULT_SETTINGS.copySections];
  }
  data.dailyLogSettingsJson = next;

  const updated = await prisma.project.update({ where: { id: projectId }, data });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.PROJECT || "project",
    entityId: projectId,
    action: auditService.ACTIONS.UPDATED,
    actorId,
    summary: { transition: "daily_log.configure", autoDistributeAt: next.autoDistributeAt, hasCoordinates: updated.latitude !== null && updated.longitude !== null },
  });
  return serializeSettings(updated);
};

// ─── visibility / party context ────────────────────────────────────────────

const partyIdsOf = (viewer) => (viewer?.projectAccess?.partyAccess || []).map((party) => party.projectPartyId).filter(Boolean);
const isPartyViewer = (viewer) => Boolean(viewer && isPartyScopedAccess(viewer.projectAccess));

const entryVisibility = (viewer) => {
  if (!isPartyViewer(viewer)) return undefined;
  const ids = partyIdsOf(viewer);
  return { OR: [{ partyId: { in: ids.length ? ids : ["__none__"] } }, { createdBy: viewer.id || "__none__" }] };
};

const sectionsInclude = (viewer) =>
  Object.fromEntries(SECTION_KEYS.map((key) => [key, { where: entryVisibility(viewer), orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }]));

const resolveParty = async ({ tx, projectId, viewer, payload = {} }) => {
  if (isPartyViewer(viewer)) {
    const partyId = partyIdsOf(viewer)[0];
    const party = partyId ? await tx.projectParty.findFirst({ where: { id: partyId, projectId }, include: { company: { select: { id: true, name: true } } } }) : null;
    if (!party) throw new HttpError(403, "DAILY_LOG_PARTY_REQUIRED", "Your company is not a party on this project");
    return { partyId: party.id, companyId: party.companyId, companyName: party.company?.name || null, scoped: true };
  }
  const requested = trimOrNull(payload.partyId);
  if (requested) {
    const party = await tx.projectParty.findFirst({ where: { id: requested, projectId }, include: { company: { select: { id: true, name: true } } } });
    if (!party) throw new HttpError(400, "DAILY_LOG_PARTY_NOT_FOUND", "Party not found on this project");
    return { partyId: party.id, companyId: party.companyId, companyName: party.company?.name || null, scoped: false };
  }
  return { partyId: null, companyId: trimOrNull(payload.companyId), companyName: null, scoped: false };
};

const canTouchEntry = ({ entry, viewer }) => {
  if (!isPartyViewer(viewer)) return true;
  return (entry.partyId && partyIdsOf(viewer).includes(entry.partyId)) || (entry.createdBy && entry.createdBy === viewer.id);
};

// ─── loading & serialisation ───────────────────────────────────────────────

const loadLog = ({ tx = prisma, projectId, date, viewer }) =>
  tx.dailyLog.findUnique({ where: { projectId_date: { projectId, date } }, include: sectionsInclude(viewer) });

const lookups = async ({ tx = prisma, projectId, log }) => {
  const ids = { parties: new Set(), activities: new Set(), locations: new Set(), equipment: new Set(), boqItems: new Set() };
  for (const key of SECTION_KEYS) {
    for (const row of log?.[key] || []) {
      if (row.partyId) ids.parties.add(row.partyId);
      if (row.activityId) ids.activities.add(row.activityId);
      if (row.locationId) ids.locations.add(row.locationId);
      if (row.equipmentId) ids.equipment.add(row.equipmentId);
      if (row.boqItemId) ids.boqItems.add(row.boqItemId);
    }
  }
  const quantityRowIds = (log?.[QUANTITIES] || []).map((row) => row.id);
  const [parties, activities, locations, equipment, boqItems, entries] = await Promise.all([
    ids.parties.size ? tx.projectParty.findMany({ where: { id: { in: [...ids.parties] } }, include: { company: { select: { id: true, name: true } } } }) : [],
    ids.activities.size ? tx.activity.findMany({ where: { id: { in: [...ids.activities] }, projectId }, select: { id: true, name: true, activityCode: true, p6ActivityId: true, wbsCode: true } }) : [],
    ids.locations.size ? tx.location.findMany({ where: { id: { in: [...ids.locations] }, projectId }, select: { id: true, name: true, code: true } }) : [],
    ids.equipment.size ? tx.equipment.findMany({ where: { id: { in: [...ids.equipment] }, projectId }, select: { id: true, name: true, rateType: true } }) : [],
    ids.boqItems.size ? tx.boqItem.findMany({ where: { id: { in: [...ids.boqItems] }, projectId }, select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true } }) : [],
    quantityRowIds.length ? quantityProgress().entriesForDailyLogRows({ tx, rowIds: quantityRowIds }) : [],
  ]);
  // One entry per row: the pending or settled one it minted (the latest when a
  // trail of several exists).
  const entryByRow = new Map();
  for (const entry of entries) entryByRow.set(entry.dailyLogQuantityId, entry);
  return {
    parties: new Map(parties.map((party) => [party.id, { id: party.id, role: party.role, companyId: party.companyId, companyName: party.company?.name || null }])),
    activities: new Map(activities.map((activity) => [activity.id, { id: activity.id, name: activity.name, code: activity.activityCode || activity.p6ActivityId || activity.wbsCode || null }])),
    locations: new Map(locations.map((location) => [location.id, { id: location.id, name: location.name, code: location.code }])),
    equipment: new Map(equipment.map((item) => [item.id, { id: item.id, name: item.name, rateType: item.rateType }])),
    boqItems: new Map(boqItems.map((item) => [item.id, { id: item.id, code: item.code || item.ref || null, description: item.description, unit: item.unit, unitCode: item.unitCode }])),
    entries: entryByRow,
  };
};

/**
 * The progress figure a quantities row minted, as the row carries it: its
 * state and its PROGRESS SOURCE provenance — never a quantity of its own (the
 * row's is the row's). `official` is true only once the progress approval
 * writer approved it.
 */
const serializeRowEntry = (entry) =>
  entry
    ? {
        id: entry.id,
        status: entry.status,
        official: entry.status === "approved",
        source: entry.source,
        submissionId: entry.submissionId || null,
        submissionStatus: entry.submission?.status || null,
        recordedBy: entry.createdBy || null,
        recordedAt: toIso(entry.createdAt),
        approvedBy: entry.approvedBy || null,
        approvedAt: toIso(entry.approvedAt),
        rejectedBy: entry.rejectedBy || null,
        rejectedAt: toIso(entry.rejectedAt),
        rejectionReason: entry.rejectionReason || null,
      }
    : null;

const serializeEntry = (section, row, maps) => {
  const config = SECTIONS[section];
  const base = {
    id: row.id,
    section,
    dailyLogId: row.dailyLogId,
    partyId: row.partyId || null,
    party: row.partyId ? maps.parties.get(row.partyId) || null : null,
    status: row.status,
    createdBy: row.createdBy || null,
    submittedAt: toIso(row.submittedAt),
    reviewedBy: row.reviewedBy || null,
    reviewedAt: toIso(row.reviewedAt),
    rejectionReason: row.rejectionReason || null,
    clientRequestId: row.clientRequestId || null,
    sortOrder: row.sortOrder ?? 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
  for (const field of config.fields) {
    const value = row[field];
    base[field] = value instanceof Date ? toIso(value) : value === undefined ? null : value;
  }
  if (row.activityId) base.activity = maps.activities.get(row.activityId) || null;
  if (row.locationId) base.location = maps.locations.get(row.locationId) || null;
  if (row.equipmentId) base.equipment = maps.equipment.get(row.equipmentId) || null;
  if (section === "manpower") base.manHours = Math.round(row.workers * row.hours * 100) / 100;
  if (section === "delays") base.suggested = row.source === DELAY_SOURCE.WEATHER_FEED && row.status === ENTRY_STATUS.DRAFT;
  if (section === QUANTITIES) {
    base.quantity = quantityProgress().quantityNumber(row.quantity);
    base.boqItem = maps.boqItems.get(row.boqItemId) || null;
    base.progressEntry = serializeRowEntry(maps.entries.get(row.id) || null);
  }
  return base;
};

const counted = (row) => row.status !== ENTRY_STATUS.REJECTED && row.status !== ENTRY_STATUS.DRAFT;

/** The section's quantity per unit — never summed across units (owner rule). */
const quantityTotals = (rows) => {
  const byUnit = new Map();
  for (const row of rows) {
    const line = byUnit.get(row.unitCode) || { unitCode: row.unitCode, quantity: quantityProgress().quantityDecimal(0), rows: 0 };
    line.quantity = line.quantity.plus(quantityProgress().quantityDecimal(row.quantity) ?? 0);
    line.rows += 1;
    byUnit.set(row.unitCode, line);
  }
  return [...byUnit.values()].map((line) => ({ unitCode: line.unitCode, quantity: quantityProgress().quantityNumber(line.quantity), rows: line.rows }));
};

const totalsFor = (log) => {
  const manpower = (log?.manpower || []).filter(counted);
  const equipment = (log?.equipment || []).filter(counted);
  const delays = (log?.delays || []).filter(counted);
  const quantities = (log?.[QUANTITIES] || []).filter(counted);
  const all = SECTION_KEYS.flatMap((key) => log?.[key] || []);
  return {
    quantityRows: quantities.length,
    quantities: quantityTotals(quantities),
    workers: manpower.reduce((sum, row) => sum + (row.workers || 0), 0),
    manHours: Math.round(manpower.reduce((sum, row) => sum + (row.workers || 0) * (row.hours || 0), 0) * 100) / 100,
    companies: new Set(manpower.map((row) => row.companyId || row.companyName || row.partyId).filter(Boolean)).size,
    equipmentCount: equipment.reduce((sum, row) => sum + (row.count || 0), 0),
    equipmentHours: Math.round(equipment.reduce((sum, row) => sum + (row.count || 1) * (row.hoursOperated || 0), 0) * 100) / 100,
    idleHours: Math.round(equipment.reduce((sum, row) => sum + (row.count || 1) * (row.hoursIdle || 0), 0) * 100) / 100,
    deliveries: (log?.deliveries || []).filter(counted).length,
    visitors: (log?.visitors || []).filter(counted).length,
    hoursLost: Math.round(delays.reduce((sum, row) => sum + (row.hoursLost || 0), 0) * 100) / 100,
    notes: (log?.notes || []).filter(counted).length,
    entries: all.length,
    awaitingReview: all.filter((row) => row.status === ENTRY_STATUS.SUBMITTED).length,
    suggestedDelays: (log?.delays || []).filter((row) => row.source === DELAY_SOURCE.WEATHER_FEED && row.status === ENTRY_STATUS.DRAFT).length,
  };
};

const pathFor = (projectId, key) => `/projects/${projectId}/site-reporting?date=${key}`;

const serializeLog = async ({ tx = prisma, projectId, date, log }) => {
  const key = dateKey(date);
  if (!log) {
    return {
      id: null,
      exists: false,
      projectId,
      date: key,
      status: LOG_STATUS.OPEN,
      weather: null,
      weatherSource: null,
      weatherFetchedAt: null,
      summary: null,
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
      distributedAt: null,
      distribution: null,
      pdfDocumentId: null,
      sections: Object.fromEntries(SECTION_KEYS.map((section) => [section, []])),
      totals: totalsFor(null),
      path: pathFor(projectId, key),
      createdAt: null,
      updatedAt: null,
    };
  }
  const maps = await lookups({ tx, projectId, log });
  return {
    id: log.id,
    exists: true,
    projectId,
    date: key,
    status: log.status,
    weather: log.weatherJson || null,
    weatherSource: log.weatherSource || null,
    weatherFetchedAt: toIso(log.weatherFetchedAt),
    summary: log.summary || null,
    submittedAt: toIso(log.submittedAt),
    submittedBy: log.submittedBy || null,
    approvedAt: toIso(log.approvedAt),
    approvedBy: log.approvedBy || null,
    distributedAt: toIso(log.distributedAt),
    distribution: log.distributionJson || null,
    pdfDocumentId: log.pdfDocumentId || null,
    sections: Object.fromEntries(SECTION_KEYS.map((section) => [section, (log[section] || []).map((row) => serializeEntry(section, row, maps))])),
    totals: totalsFor(log),
    path: pathFor(projectId, key),
    createdAt: toIso(log.createdAt),
    updatedAt: toIso(log.updatedAt),
  };
};

const getLog = async ({ orgId, projectId, date, viewer }) => {
  await ensureProject({ orgId, projectId });
  const day = toDateOnly(date);
  const log = await loadLog({ projectId, date: day, viewer });
  return serializeLog({ projectId, date: day, log });
};

const listLogs = async ({ orgId, projectId, from = null, to = null, viewer }) => {
  await ensureProject({ orgId, projectId });
  const end = to ? toDateOnly(to) : toDateOnly(new Date());
  const start = from ? toDateOnly(from) : toDateOnly(shiftDays(dateKey(end), -30));
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw new HttpError(400, "DAILY_LOG_RANGE", `Range must be ${MAX_RANGE_DAYS} days or fewer`);
  }
  const rows = await prisma.dailyLog.findMany({
    where: { projectId, date: { gte: start, lte: end } },
    include: sectionsInclude(viewer),
    orderBy: { date: "desc" },
  });
  return {
    from: dateKey(start),
    to: dateKey(end),
    items: rows.map((row) => ({
      id: row.id,
      date: dateKey(row.date),
      status: row.status,
      weather: row.weatherJson ? { condition: row.weatherJson.condition || null, summary: row.weatherJson.summary || null, tempMaxC: row.weatherJson.tempMaxC ?? null, precipitationMm: row.weatherJson.precipitationMm ?? null, alerts: row.weatherJson.alerts || [] } : null,
      weatherSource: row.weatherSource || null,
      totals: totalsFor(row),
      distributedAt: toIso(row.distributedAt),
    })),
  };
};

// ─── log lifecycle ─────────────────────────────────────────────────────────

const ensureLog = async ({ tx, orgId, projectId, date, actorId = null }) => {
  const existing = await tx.dailyLog.findUnique({ where: { projectId_date: { projectId, date } } });
  if (existing) return existing;
  return tx.dailyLog.create({ data: { orgId, projectId, date, status: LOG_STATUS.OPEN, createdBy: actorId } });
};

const assertEditable = (log, viewer) => {
  if (!log) return;
  if (log.status === LOG_STATUS.APPROVED) throw new HttpError(409, "DAILY_LOG_APPROVED", "This day is approved. Reopen it to change anything.");
  if (log.status === LOG_STATUS.SUBMITTED && isPartyViewer(viewer)) throw new HttpError(409, "DAILY_LOG_SUBMITTED", "This day has been submitted; ask the site team to reopen it.");
};

const logAudit = async ({ tx, orgId, projectId, log, action, actorId, summary, oldStatus, newStatus, reason }) =>
  auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.DAILY_LOG,
    entityId: log.id,
    action,
    actorId: actorId || null,
    oldStatus: oldStatus ?? undefined,
    newStatus: newStatus ?? undefined,
    reason: reason ?? undefined,
    summary: { date: dateKey(log.date), ...summary },
  });

const notify = (params) =>
  notificationService.createNotifications(params).catch((error) => {
    console.error("[daily-log] notification", error?.message || error);
    return null;
  });

const updateLog = async ({ orgId, projectId, date, payload = {}, actor = null, viewer = null }) => {
  const day = toDateOnly(date);
  const log = await prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const row = await ensureLog({ tx, orgId, projectId, date: day, actorId: actor?.id });
    assertEditable(row, viewer);
    const data = {};
    if (payload.summary !== undefined) data.summary = trimOrNull(payload.summary);
    if (payload.weather !== undefined) {
      if (payload.weather === null) {
        data.weatherJson = null;
        data.weatherSource = null;
        data.weatherFetchedAt = null;
      } else {
        const manual = {
          source: WEATHER_SOURCE.MANUAL,
          date: dateKey(day),
          condition: trimOrNull(payload.weather.condition),
          tempMinC: payload.weather.tempMinC === null || payload.weather.tempMinC === undefined || payload.weather.tempMinC === "" ? null : toNumber(payload.weather.tempMinC, null),
          tempMaxC: payload.weather.tempMaxC === null || payload.weather.tempMaxC === undefined || payload.weather.tempMaxC === "" ? null : toNumber(payload.weather.tempMaxC, null),
          precipitationMm: payload.weather.precipitationMm === null || payload.weather.precipitationMm === undefined || payload.weather.precipitationMm === "" ? null : Math.max(0, toNumber(payload.weather.precipitationMm, 0)),
          windMaxKph: payload.weather.windMaxKph === null || payload.weather.windMaxKph === undefined || payload.weather.windMaxKph === "" ? null : Math.max(0, toNumber(payload.weather.windMaxKph, 0)),
          notes: trimOrNull(payload.weather.notes),
          alerts: [],
        };
        manual.summary = weatherFeed.summarize(manual);
        data.weatherJson = manual;
        data.weatherSource = WEATHER_SOURCE.MANUAL;
        data.weatherFetchedAt = null;
      }
    }
    const updated = Object.keys(data).length ? await tx.dailyLog.update({ where: { id: row.id }, data }) : row;
    if (Object.keys(data).length) {
      await logAudit({ tx, orgId, projectId, log: updated, action: auditService.ACTIONS.UPDATED, actorId: actor?.id, summary: { transition: "daily_log.update", fields: Object.keys(data) } });
    }
    return loadLog({ tx, projectId, date: day, viewer });
  });
  return serializeLog({ projectId, date: day, log });
};

// ─── PC-6 §4: the pending layer follows the day ────────────────────────────

/**
 * Mints a submitted entry for every quantities row that counts and retires
 * the free pending entry of every row that does not (quantity-progress
 * .service mintDailyLogEntries). Called wherever the day closes or a
 * closed day changes: submit, approve, and — on a day already submitted —
 * a row added, edited back into counting, or re-approved by the site team.
 * Never on an open day: an open day's rows are site records only.
 */
const mintQuantities = async ({ tx, orgId, projectId, log, rows, actor }) =>
  quantityProgress().mintDailyLogEntries({ tx, orgId, projectId, log, rows: rows.filter(counted), retiredRows: rows.filter((row) => !counted(row)), actor });

const mintedSummary = (minted) => ({ minted: minted.minted.length, synced: minted.synced.length, kept: minted.kept.length, retired: (minted.retired || []).length });

/** On a submitted day a counted row has a pending entry at once; on an open day nothing is minted. */
const mintOnSubmittedDay = async ({ tx, orgId, projectId, log, row, actor }) => {
  if (log.status !== LOG_STATUS.SUBMITTED || !counted(row)) return null;
  return mintQuantities({ tx, orgId, projectId, log, rows: [row], actor });
};

const submitLog = async ({ orgId, projectId, date, actor, viewer = null }) => {
  const day = toDateOnly(date);
  const project = await ensureProject({ orgId, projectId });
  const result = await prisma.$transaction(async (tx) => {
    const row = await loadLog({ tx, projectId, date: day, viewer: null });
    if (!row) throw new HttpError(404, "DAILY_LOG_NOT_FOUND", "Nothing has been logged for this day yet");
    if (row.status === LOG_STATUS.APPROVED) throw new HttpError(409, "DAILY_LOG_APPROVED", "This day is already approved");
    if (totalsFor(row).entries === 0) throw new HttpError(400, "DAILY_LOG_EMPTY", "Add at least one entry before submitting");
    const now = new Date();
    const updated = await tx.dailyLog.update({ where: { id: row.id }, data: { status: LOG_STATUS.SUBMITTED, submittedAt: now, submittedBy: actor?.id || null } });
    // PC-6 §4: every quantities row that counts (not draft, not rejected by the
    // site team) becomes a SUBMITTED quantity progress entry — pending, never
    // official: the progress approval writer decides, not this log. A row
    // that stopped counting since has its free pending entry retired.
    const minted = await mintQuantities({ tx, orgId, projectId, log: updated, rows: row[QUANTITIES] || [], actor });
    await logAudit({
      tx,
      orgId,
      projectId,
      log: updated,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: actor?.id,
      oldStatus: row.status,
      newStatus: LOG_STATUS.SUBMITTED,
      summary: { transition: "daily_log.submit", quantityEntries: mintedSummary(minted) },
    });
    return loadLog({ tx, projectId, date: day, viewer });
  });
  await notify({
    orgId,
    projectId,
    actorId: actor?.id || null,
    recipientRoles: ["pm"],
    category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL,
    event: "daily_log.submitted",
    title: `Daily log ${dateKey(day)} submitted`,
    message: `${project.name}: the daily log for ${dateKey(day)} is ready for approval.`,
    actionUrl: pathFor(projectId, dateKey(day)),
    entityType: "daily_log",
    entityId: result.id,
    dedupeKeyBase: `daily_log.submitted:${result.id}:${Date.now()}`,
  });
  return serializeLog({ projectId, date: day, log: result });
};

const approveLog = async ({ orgId, projectId, date, actor, viewer = null }) => {
  const day = toDateOnly(date);
  await ensureProject({ orgId, projectId });
  const { log, submittedBy } = await prisma.$transaction(async (tx) => {
    const row = await loadLog({ tx, projectId, date: day, viewer: null });
    if (!row) throw new HttpError(404, "DAILY_LOG_NOT_FOUND", "Nothing has been logged for this day yet");
    if (row.status === LOG_STATUS.APPROVED) return { log: row, submittedBy: null };
    const now = new Date();
    // PC-6 §4: approving closes the day, so every quantities row that counts
    // has its pending entry now — a row recorded after the day was submitted
    // would otherwise sit in an approved log (which refuses a resubmit) and
    // never reach the approvers. Minting is all this does to the pending
    // layer: the entries are NOT approved here (they stay submitted). Only
    // the progress approval writer (progress.service) approves an entry.
    const minted = await mintQuantities({ tx, orgId, projectId, log: row, rows: row[QUANTITIES] || [], actor });
    // Each section row's own review state — for the quantities section too,
    // which is the row's site-record state and nothing more.
    for (const key of SECTION_KEYS) {
      await tx[SECTIONS[key].model].updateMany({ where: { dailyLogId: row.id, status: ENTRY_STATUS.SUBMITTED }, data: { status: ENTRY_STATUS.APPROVED, reviewedBy: actor?.id || null, reviewedAt: now } });
    }
    const updated = await tx.dailyLog.update({ where: { id: row.id }, data: { status: LOG_STATUS.APPROVED, approvedAt: now, approvedBy: actor?.id || null } });
    await logAudit({ tx, orgId, projectId, log: updated, action: auditService.ACTIONS.APPROVED, actorId: actor?.id, oldStatus: row.status, newStatus: LOG_STATUS.APPROVED, summary: { transition: "daily_log.approve", entriesApproved: totalsFor(row).awaitingReview, quantityEntries: mintedSummary(minted) } });
    return { log: await loadLog({ tx, projectId, date: day, viewer }), submittedBy: row.submittedBy };
  });
  if (submittedBy && submittedBy !== actor?.id) {
    await notify({
      orgId,
      projectId,
      actorId: actor?.id || null,
      recipientUserIds: [submittedBy],
      category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
      event: "daily_log.approved",
      title: `Daily log ${dateKey(day)} approved`,
      message: `The daily log for ${dateKey(day)} was approved.`,
      actionUrl: pathFor(projectId, dateKey(day)),
      entityType: "daily_log",
      entityId: log.id,
      dedupeKeyBase: `daily_log.approved:${log.id}`,
    });
  }
  return serializeLog({ projectId, date: day, log });
};

const reopenLog = async ({ orgId, projectId, date, actor, reason = null, viewer = null }) => {
  const day = toDateOnly(date);
  await ensureProject({ orgId, projectId });
  const log = await prisma.$transaction(async (tx) => {
    const row = await tx.dailyLog.findUnique({ where: { projectId_date: { projectId, date: day } } });
    if (!row) throw new HttpError(404, "DAILY_LOG_NOT_FOUND", "Nothing has been logged for this day yet");
    if (row.status === LOG_STATUS.OPEN) return loadLog({ tx, projectId, date: day, viewer });
    const updated = await tx.dailyLog.update({ where: { id: row.id }, data: { status: LOG_STATUS.OPEN, approvedAt: null, approvedBy: null, submittedAt: null, submittedBy: null } });
    await logAudit({ tx, orgId, projectId, log: updated, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id, oldStatus: row.status, newStatus: LOG_STATUS.OPEN, reason: trimOrNull(reason), summary: { transition: "daily_log.reopen" } });
    return loadLog({ tx, projectId, date: day, viewer });
  });
  return serializeLog({ projectId, date: day, log });
};

// ─── entries ───────────────────────────────────────────────────────────────

const enrichPayload = async ({ tx, orgId, projectId, section, payload, party }) => {
  const next = { ...payload };
  if (party.scoped) {
    // Collaborators log for their own company only.
    next.companyId = party.companyId;
    next.companyName = party.companyName;
  }
  if (section === "manpower") {
    const companyId = trimOrNull(next.companyId) || party.companyId;
    if (companyId && !trimOrNull(next.companyName)) {
      const company = companyId === party.companyId && party.companyName ? { name: party.companyName } : await tx.company.findFirst({ where: { id: companyId, orgId }, select: { name: true } });
      next.companyName = company?.name || next.companyName || null;
    }
    if (!next.companyId && party.companyId) next.companyId = party.companyId;
  } else if (section === "equipment") {
    const equipmentId = trimOrNull(next.equipmentId);
    if (equipmentId) {
      const equipment = await tx.equipment.findFirst({ where: { id: equipmentId, projectId }, select: { name: true } });
      if (!equipment) throw new HttpError(400, "DAILY_LOG_EQUIPMENT_NOT_FOUND", "Equipment not found on this project");
      if (!trimOrNull(next.name)) next.name = equipment.name;
    }
    if (!next.companyId && party.companyId) next.companyId = party.companyId;
  } else if (section === "deliveries" && !next.companyId && party.companyId) {
    next.companyId = party.companyId;
  }
  return next;
};

const assertRefs = async ({ tx, orgId, projectId, section, data, actor = null }) => {
  if (data.activityId) {
    const activity = await tx.activity.findFirst({ where: { id: data.activityId, projectId }, select: { id: true } });
    if (!activity) throw new HttpError(400, "DAILY_LOG_ACTIVITY_NOT_FOUND", "Activity not found on this project");
  }
  if (data.locationId) {
    const location = await tx.location.findFirst({ where: { id: data.locationId, projectId }, select: { id: true } });
    if (!location) throw new HttpError(400, "DAILY_LOG_LOCATION_NOT_FOUND", "Location not found on this project");
  }
  if (section === QUANTITIES) {
    // PC-6 §4: the row names an item the activity has an approved allocation
    // of, in that item's unit (or an alias); the allocation is resolved. The
    // person recording it is under the same rule as a progress submission —
    // a site engineer records on the activities assigned to them — applied
    // here, when the row is recorded, since the log is submitted as a whole
    // by one person for every author's rows.
    await require("./progress.service").assertProgressSubmitAllowed({ projectId, activityIds: [data.activityId], userId: actor?.id || null, userRole: actor?.role || null, tx });
    const resolved = await quantityProgress().resolveDailyLogQuantity({ tx, orgId, projectId, activityId: data.activityId, boqItemId: data.boqItemId, allocationId: data.allocationId, unit: data.unitCode });
    data.allocationId = resolved.allocationId;
    data.unitCode = resolved.unitCode;
  }
};

const addEntry = async ({ orgId, projectId, date, section, payload = {}, actor = null, viewer = null }) => {
  const config = sectionConfig(section);
  const day = toDateOnly(date);
  const project = await ensureProject({ orgId, projectId });
  const outcome = await prisma.$transaction(async (tx) => {
    const clientRequestId = trimOrNull(payload.clientRequestId);
    if (clientRequestId) {
      const replay = await tx[config.model].findFirst({ where: { projectId, clientRequestId } });
      if (replay) return { entryId: replay.id, replayed: true, scoped: false, log: await loadLog({ tx, projectId, date: day, viewer }) };
    }
    const row = await ensureLog({ tx, orgId, projectId, date: day, actorId: actor?.id });
    assertEditable(row, viewer);
    const party = await resolveParty({ tx, projectId, viewer, payload });
    const data = config.normalize(await enrichPayload({ tx, orgId, projectId, section, payload, party }), null, { day });
    await assertRefs({ tx, orgId, projectId, section, data, actor });
    const now = new Date();
    const status = party.scoped ? ENTRY_STATUS.SUBMITTED : payload.status === ENTRY_STATUS.DRAFT ? ENTRY_STATUS.DRAFT : ENTRY_STATUS.APPROVED;
    const sortOrder = await tx[config.model].count({ where: { dailyLogId: row.id } });
    const entry = await tx[config.model].create({
      data: {
        orgId,
        projectId,
        dailyLogId: row.id,
        partyId: party.partyId,
        ...data,
        status,
        createdBy: actor?.id || null,
        submittedAt: status === ENTRY_STATUS.SUBMITTED ? now : null,
        clientRequestId,
        sortOrder,
      },
    });
    // PC-6 §4: a row taken by a day already submitted is pending at once (an
    // open day's row stays a site record until the day is submitted).
    const minted = section === QUANTITIES ? await mintOnSubmittedDay({ tx, orgId, projectId, log: row, row: entry, actor }) : null;
    await logAudit({ tx, orgId, projectId, log: row, action: auditService.ACTIONS.CREATED, actorId: actor?.id, summary: { transition: "daily_log.entry_add", section, entryId: entry.id, status, partyId: party.partyId, ...(minted ? { quantityEntries: mintedSummary(minted) } : {}) } });
    return { entryId: entry.id, replayed: false, scoped: party.scoped, log: await loadLog({ tx, projectId, date: day, viewer }) };
  });
  if (outcome.scoped) {
    await notify({
      orgId,
      projectId,
      actorId: actor?.id || null,
      recipientRoles: ["pm", "site_engineer"],
      category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL,
      event: "daily_log.entry_submitted",
      title: `Daily log ${dateKey(day)}: ${config.label.toLowerCase()} to review`,
      message: `${project.name}: a collaborator added ${config.label.toLowerCase()} for ${dateKey(day)}. Review it in the daily log.`,
      actionUrl: pathFor(projectId, dateKey(day)),
      entityType: "daily_log",
      entityId: outcome.log?.id || null,
      dedupeKeyBase: `daily_log.entry_submitted:${outcome.log?.id}:${section}:${localDateKey(new Date(), "UTC")}`,
    });
  }
  const log = await serializeLog({ projectId, date: day, log: outcome.log });
  return { ...log, entryId: outcome.entryId, replayed: outcome.replayed };
};

const findEntry = async ({ tx, config, projectId, day, entryId }) => {
  const row = await tx.dailyLog.findUnique({ where: { projectId_date: { projectId, date: day } } });
  if (!row) throw new HttpError(404, "DAILY_LOG_NOT_FOUND", "Nothing has been logged for this day yet");
  const entry = await tx[config.model].findFirst({ where: { id: entryId, dailyLogId: row.id } });
  if (!entry) throw new HttpError(404, "DAILY_LOG_ENTRY_NOT_FOUND", "Entry not found");
  return { row, entry };
};

const updateEntry = async ({ orgId, projectId, date, section, entryId, payload = {}, actor = null, viewer = null }) => {
  const config = sectionConfig(section);
  const day = toDateOnly(date);
  await ensureProject({ orgId, projectId });
  const log = await prisma.$transaction(async (tx) => {
    const { row, entry } = await findEntry({ tx, config, projectId, day, entryId });
    assertEditable(row, viewer);
    if (!canTouchEntry({ entry, viewer })) throw new HttpError(403, "DAILY_LOG_ENTRY_FORBIDDEN", "You can only change your own company's entries");
    const party = { partyId: entry.partyId, companyId: entry.companyId ?? null, companyName: entry.companyName ?? null, scoped: isPartyViewer(viewer) };
    // PC-6 §4: a quantities row whose entry is approved or rejected progress
    // is locked (the correction is a new row); one bundled into a pending
    // submission is held; a free pending entry follows the row's edit.
    const pendingEntry = section === QUANTITIES ? await quantityProgress().dailyLogRowEntryGate({ tx, rowId: entry.id }) : null;
    const data = config.normalize(await enrichPayload({ tx, orgId, projectId, section, payload, party }), entry, { day });
    if (section === QUANTITIES && (data.activityId !== entry.activityId || data.boqItemId !== entry.boqItemId) && pendingEntry) {
      throw new HttpError(400, "QUANTITY_ENTRY_IMMUTABLE_FIELD", "A submitted quantity's activity and BOQ item are not changed; remove the row and record another", { field: data.activityId !== entry.activityId ? "activityId" : "boqItemId" });
    }
    await assertRefs({ tx, orgId, projectId, section, data, actor });
    const resubmit = party.scoped || entry.status === ENTRY_STATUS.REJECTED;
    const updated = await tx[config.model].update({
      where: { id: entry.id },
      data: {
        ...data,
        ...(resubmit ? { status: party.scoped ? ENTRY_STATUS.SUBMITTED : ENTRY_STATUS.APPROVED, submittedAt: new Date(), reviewedBy: null, reviewedAt: null, rejectionReason: null } : {}),
      },
    });
    if (pendingEntry) await quantityProgress().syncDailyLogRowEntry({ tx, orgId, projectId, row: updated, log: row, entry: pendingEntry, actorId: actor?.id || null });
    // A row without an entry on a submitted day (one the site team had rejected and this edit resubmits) is pending again at once.
    const minted = section === QUANTITIES && !pendingEntry ? await mintOnSubmittedDay({ tx, orgId, projectId, log: row, row: updated, actor }) : null;
    await logAudit({ tx, orgId, projectId, log: row, action: auditService.ACTIONS.UPDATED, actorId: actor?.id, summary: { transition: "daily_log.entry_update", section, entryId: updated.id, status: updated.status, ...(pendingEntry ? { quantityEntryId: pendingEntry.id } : {}), ...(minted ? { quantityEntries: mintedSummary(minted) } : {}) } });
    return loadLog({ tx, projectId, date: day, viewer });
  });
  return serializeLog({ projectId, date: day, log });
};

const deleteEntry = async ({ orgId, projectId, date, section, entryId, actor = null, viewer = null }) => {
  const config = sectionConfig(section);
  const day = toDateOnly(date);
  await ensureProject({ orgId, projectId });
  const log = await prisma.$transaction(async (tx) => {
    const { row, entry } = await findEntry({ tx, config, projectId, day, entryId });
    assertEditable(row, viewer);
    if (!canTouchEntry({ entry, viewer })) throw new HttpError(403, "DAILY_LOG_ENTRY_FORBIDDEN", "You can only remove your own company's entries");
    // PC-6 §4: a still-pending entry goes with its row (no pending ghost); an
    // entry bundled into a pending submission holds the row; an approved or
    // rejected entry stays as the trail, its link to the row nulled.
    const removedEntry = section === QUANTITIES ? await quantityProgress().deleteDailyLogRowEntry({ tx, orgId, projectId, row: entry, actorId: actor?.id || null }) : null;
    await tx[config.model].delete({ where: { id: entry.id } });
    await logAudit({ tx, orgId, projectId, log: row, action: auditService.ACTIONS.DELETED, actorId: actor?.id, summary: { transition: "daily_log.entry_delete", section, entryId: entry.id, ...(removedEntry ? { quantityEntryId: removedEntry.id } : {}) } });
    return loadLog({ tx, projectId, date: day, viewer });
  });
  return serializeLog({ projectId, date: day, log });
};

const reviewEntry = async ({ orgId, projectId, date, section, entryId, decision, reason = null, actor = null, viewer = null }) => {
  const config = sectionConfig(section);
  const day = toDateOnly(date);
  await ensureProject({ orgId, projectId });
  if (!["approve", "reject"].includes(decision)) throw new HttpError(400, "DAILY_LOG_DECISION", "Decision must be approve or reject");
  const trimmedReason = trimOrNull(reason);
  if (decision === "reject" && !trimmedReason) throw new HttpError(400, "DAILY_LOG_REASON_REQUIRED", "Say why the entry is rejected");
  const { log, entry } = await prisma.$transaction(async (tx) => {
    const { row, entry: existing } = await findEntry({ tx, config, projectId, day, entryId });
    if (row.status === LOG_STATUS.APPROVED) throw new HttpError(409, "DAILY_LOG_APPROVED", "This day is approved. Reopen it to change anything.");
    const now = new Date();
    // PC-6 §4: a quantities row the site team rejects stops counting, so the
    // free pending entry it minted goes with the decision (never left for a
    // date bundle to pick up); an entry already approved progress locks the
    // row, one bundled into a pending submission holds it. Approving a row
    // leaves its entry alone — the row's review state is never progress.
    const rejectedEntry =
      section === QUANTITIES && decision === "reject"
        ? await quantityProgress().rejectDailyLogRowEntry({ tx, orgId, projectId, row: existing, actorId: actor?.id || null, reason: trimmedReason })
        : null;
    const updated = await tx[config.model].update({
      where: { id: existing.id },
      data: decision === "approve"
        ? { status: ENTRY_STATUS.APPROVED, reviewedBy: actor?.id || null, reviewedAt: now, rejectionReason: null }
        : { status: ENTRY_STATUS.REJECTED, reviewedBy: actor?.id || null, reviewedAt: now, rejectionReason: trimmedReason },
    });
    // A row approved back on a submitted day counts again: pending at once.
    const minted = section === QUANTITIES && decision === "approve" ? await mintOnSubmittedDay({ tx, orgId, projectId, log: row, row: updated, actor }) : null;
    await logAudit({ tx, orgId, projectId, log: row, action: decision === "approve" ? auditService.ACTIONS.APPROVED : auditService.ACTIONS.REJECTED, actorId: actor?.id, reason: trimmedReason, summary: { transition: `daily_log.entry_${decision}`, section, entryId: updated.id, source: existing.source || null, ...(rejectedEntry ? { quantityEntryId: rejectedEntry.id } : {}), ...(minted ? { quantityEntries: mintedSummary(minted) } : {}) } });
    return { log: await loadLog({ tx, projectId, date: day, viewer }), entry: updated };
  });
  if (entry.createdBy && entry.createdBy !== actor?.id && entry.partyId) {
    await notify({
      orgId,
      projectId,
      actorId: actor?.id || null,
      recipientUserIds: [entry.createdBy],
      category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
      event: `daily_log.entry_${decision === "approve" ? "approved" : "rejected"}`,
      title: `Daily log ${dateKey(day)}: ${config.label.toLowerCase()} ${decision === "approve" ? "accepted" : "returned"}`,
      message: decision === "approve" ? `Your ${config.label.toLowerCase()} entry for ${dateKey(day)} was accepted.` : `Your ${config.label.toLowerCase()} entry for ${dateKey(day)} was returned: ${trimmedReason}`,
      actionUrl: pathFor(projectId, dateKey(day)),
      entityType: "daily_log",
      entityId: log.id,
      dedupeKeyBase: `daily_log.entry_review:${entry.id}:${Date.now()}`,
    });
  }
  return serializeLog({ projectId, date: day, log });
};

// ─── copy previous day ─────────────────────────────────────────────────────

const copyPrevious = async ({ orgId, projectId, date, sections = null, actor = null, viewer = null }) => {
  const day = toDateOnly(date);
  const project = await ensureProject({ orgId, projectId });
  const settings = mergeSettings(project.dailyLogSettingsJson);
  const wanted = (Array.isArray(sections) && sections.length ? sections : settings.copySections).filter((key) => SECTIONS[key]?.copyFields);
  if (!wanted.length) throw new HttpError(400, "DAILY_LOG_COPY_SECTIONS", "Choose manpower and/or equipment to copy");

  const result = await prisma.$transaction(async (tx) => {
    const target = await ensureLog({ tx, orgId, projectId, date: day, actorId: actor?.id });
    assertEditable(target, viewer);
    const party = isPartyViewer(viewer) ? await resolveParty({ tx, projectId, viewer }) : null;
    const visibility = { ...(entryVisibility(viewer) || {}), status: { in: [ENTRY_STATUS.APPROVED, ENTRY_STATUS.SUBMITTED] } };
    const candidates = await tx.dailyLog.findMany({
      where: { projectId, date: { lt: day } },
      orderBy: { date: "desc" },
      take: 14,
      include: Object.fromEntries(wanted.map((key) => [key, { where: visibility, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }])),
    });
    const source = candidates.find((row) => wanted.some((key) => row[key]?.length));
    if (!source) throw new HttpError(404, "DAILY_LOG_NOTHING_TO_COPY", "No earlier day with entries to copy in the last two weeks");

    const copied = {};
    const skipped = {};
    const now = new Date();
    for (const key of wanted) {
      const config = SECTIONS[key];
      const rows = source[key] || [];
      if (!rows.length) {
        skipped[key] = "nothing on the source day";
        continue;
      }
      const existing = await tx[config.model].count({ where: { dailyLogId: target.id, ...(entryVisibility(viewer) || {}) } });
      if (existing > 0) {
        skipped[key] = "already has entries";
        continue;
      }
      const status = party ? ENTRY_STATUS.SUBMITTED : ENTRY_STATUS.APPROVED;
      await tx[config.model].createMany({
        data: rows.map((row, index) => ({
          orgId,
          projectId,
          dailyLogId: target.id,
          ...Object.fromEntries(config.copyFields.map((field) => [field, row[field] ?? null])),
          ...(party ? { partyId: party.partyId } : {}),
          status,
          createdBy: actor?.id || null,
          submittedAt: status === ENTRY_STATUS.SUBMITTED ? now : null,
          sortOrder: index,
        })),
      });
      copied[key] = rows.length;
    }
    await logAudit({ tx, orgId, projectId, log: target, action: auditService.ACTIONS.CREATED, actorId: actor?.id, summary: { transition: "daily_log.copy_previous", fromDate: dateKey(source.date), copied, skipped } });
    return { fromDate: dateKey(source.date), copied, skipped, log: await loadLog({ tx, projectId, date: day, viewer }) };
  });
  const log = await serializeLog({ projectId, date: day, log: result.log });
  return { ...log, copy: { fromDate: result.fromDate, copied: result.copied, skipped: result.skipped } };
};

// ─── weather ───────────────────────────────────────────────────────────────

const refreshWeather = async ({ orgId, projectId, date, actor = null, viewer = null, fetchImpl = undefined, now = new Date() }) => {
  const day = toDateOnly(date);
  const project = await ensureProject({ orgId, projectId });
  const settings = mergeSettings(project.dailyLogSettingsJson);
  if (!weatherFeed.isEnabled() || !settings.weatherFeedEnabled) throw new HttpError(400, "WEATHER_FEED_DISABLED", "The weather feed is switched off for this project");
  if (project.latitude === null || project.longitude === null) throw new HttpError(400, "WEATHER_COORDINATES_REQUIRED", "Set the site coordinates in the daily log settings first");

  const weather = await weatherFeed.fetchDailyWeather({ latitude: project.latitude, longitude: project.longitude, date: dateKey(day), timezone: project.timezone || "auto", fetchImpl, now });
  const alerts = weatherFeed.evaluateThresholds(weather, settings.thresholds);
  const outcome = await prisma.$transaction(async (tx) => {
    const row = await ensureLog({ tx, orgId, projectId, date: day, actorId: actor?.id });
    if (row.weatherSource === WEATHER_SOURCE.MANUAL && actor === null) {
      return { log: await loadLog({ tx, projectId, date: day, viewer }), suggested: false, skipped: true };
    }
    await tx.dailyLog.update({ where: { id: row.id }, data: { weatherJson: { ...weather, alerts }, weatherSource: WEATHER_SOURCE.FEED, weatherFetchedAt: now } });
    let suggested = false;
    if (alerts.length && row.status !== LOG_STATUS.APPROVED) {
      const description = alerts.map((alert) => alert.message).join("; ");
      const existing = await tx.dailyLogDelay.findFirst({ where: { dailyLogId: row.id, source: DELAY_SOURCE.WEATHER_FEED } });
      if (!existing) {
        await tx.dailyLogDelay.create({ data: { orgId, projectId, dailyLogId: row.id, type: "weather", description, hoursLost: 0, source: DELAY_SOURCE.WEATHER_FEED, status: ENTRY_STATUS.DRAFT, createdBy: actor?.id || null, sortOrder: await tx.dailyLogDelay.count({ where: { dailyLogId: row.id } }) } });
        suggested = true;
      } else if (existing.status === ENTRY_STATUS.DRAFT) {
        await tx.dailyLogDelay.update({ where: { id: existing.id }, data: { description } });
      }
    }
    await logAudit({ tx, orgId, projectId, log: row, action: auditService.ACTIONS.UPDATED, actorId: actor?.id, summary: { transition: "daily_log.weather_refresh", condition: weather.condition, precipitationMm: weather.precipitationMm, alerts: alerts.map((alert) => alert.metric), suggested } });
    return { log: await loadLog({ tx, projectId, date: day, viewer }), suggested, skipped: false };
  });
  if (outcome.suggested) {
    await notify({
      orgId,
      projectId,
      actorId: actor?.id || null,
      recipientRoles: ["pm", "site_engineer", "planning_eng"],
      category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
      event: "daily_log.weather_delay_suggested",
      title: `Weather delay suggested for ${dateKey(day)}`,
      message: `${project.name}: ${alerts.map((alert) => alert.message).join("; ")}. Confirm the lost hours in the daily log.`,
      priority: "high",
      actionUrl: pathFor(projectId, dateKey(day)),
      entityType: "daily_log",
      entityId: outcome.log?.id || null,
      dedupeKeyBase: `daily_log.weather_delay_suggested:${outcome.log?.id}`,
    });
  }
  const log = await serializeLog({ projectId, date: day, log: outcome.log });
  return { ...log, weatherSkipped: outcome.skipped, alerts };
};

/** Turns an accepted weather delay row into a contractual WeatherDelay record. */
const logWeatherDelay = async ({ orgId, projectId, date, entryId, payload = {}, actor = null, viewer = null }) => {
  const day = toDateOnly(date);
  await ensureProject({ orgId, projectId });
  const { row, entry } = await findEntry({ tx: prisma, config: SECTIONS.delays, projectId, day, entryId });
  if (entry.weatherDelayId) throw new HttpError(409, "DAILY_LOG_WEATHER_DELAY_EXISTS", "This delay is already on the weather register");
  const weatherService = require("./weather.service");
  const delayDays = payload.delayDays !== undefined ? Math.max(0, toNumber(payload.delayDays, 0)) : Math.round((entry.hoursLost / 8) * 2) / 2;
  const created = await weatherService.createWeatherDelay({
    orgId,
    projectId,
    userId: actor?.id || null,
    payload: {
      date: dateKey(day),
      description: trimOrNull(payload.description) || entry.description,
      delayDays,
      contractual: payload.contractual !== undefined ? Boolean(payload.contractual) : true,
      affectedActivityIds: Array.isArray(payload.activityIds) && payload.activityIds.length ? payload.activityIds : entry.activityId ? [entry.activityId] : [],
    },
  });
  await prisma.dailyLogDelay.update({ where: { id: entry.id }, data: { weatherDelayId: created.id, status: entry.status === ENTRY_STATUS.DRAFT ? ENTRY_STATUS.APPROVED : entry.status, reviewedBy: entry.reviewedBy || actor?.id || null, reviewedAt: entry.reviewedAt || new Date() } });
  await logAudit({ tx: prisma, orgId, projectId, log: row, action: auditService.ACTIONS.UPDATED, actorId: actor?.id, summary: { transition: "daily_log.weather_delay_logged", entryId: entry.id, weatherDelayId: created.id, delayDays } });
  const log = await serializeLog({ projectId, date: day, log: await loadLog({ projectId, date: day, viewer }) });
  return { ...log, weatherDelay: { id: created.id, delayDays, contractual: created.contractual } };
};

// ─── rendering ─────────────────────────────────────────────────────────────

const statusNote = (entry) => {
  if (entry.suggested) return "suggested";
  if (entry.status === ENTRY_STATUS.SUBMITTED) return "awaiting review";
  if (entry.status === ENTRY_STATUS.REJECTED) return "rejected";
  if (entry.status === ENTRY_STATUS.DRAFT) return "draft";
  return "";
};

/** The section's quantity per unit, never one figure across units. */
const quantityTotalsText = (totals) => ((totals?.quantities || []).length ? ` · installed ${totals.quantities.map((line) => `${num(line.quantity, 3)} ${line.unitCode}`).join(", ")}` : "");

const num = (value, digits = 1) => (value === null || value === undefined ? "" : String(Math.round(Number(value) * 10 ** digits) / 10 ** digits));

/** The quantities row's progress state beside its site-record state. */
const progressNote = (row) => (!row.progressEntry ? "not yet submitted" : row.progressEntry.official ? "official" : row.progressEntry.status === "rejected" ? "progress rejected" : "pending progress");
const quantityNote = (row) => [statusNote(row), progressNote(row)].filter(Boolean).join(" · ");

/** The BOQ item as a quantities row names it: code + description for a BOQ reader, description alone otherwise. */
const itemCell = (row, boqAccess) => (row.boqItem ? `${boqAccess?.boq !== false && row.boqItem.code ? `${row.boqItem.code} ` : ""}${row.boqItem.description || ""}`.trim() : "");

const renderPdf = async ({ orgId, projectId, date, viewer = null, boqAccess = null }) => {
  const day = toDateOnly(date);
  const project = await ensureProject({ orgId, projectId });
  const log = await serializeLog({ projectId, date: day, log: await loadLog({ projectId, date: day, viewer }) });
  const tz = project.timezone || "UTC";
  const pdf = createPdf({ title: `Daily log ${log.date} — ${project.name}`, author: "OctaPM", footer: project.name });
  pdf.heading(`Daily log — ${log.date}`);
  pdf.keyValues([
    ["Project", project.name],
    ["Status", log.status],
    ["Weather", log.weather?.summary || (log.weather ? weatherFeed.summarize(log.weather) : "not recorded")],
    ["Weather source", log.weatherSource === WEATHER_SOURCE.FEED ? `feed (${log.weather?.source || "feed"})` : log.weatherSource || "—"],
    ["Alerts", (log.weather?.alerts || []).map((alert) => alert.message).join("; ") || "none"],
    ["Totals", `${log.totals.workers} workers · ${num(log.totals.manHours)} man-hours · ${log.totals.equipmentCount} plant (${num(log.totals.equipmentHours)} h) · ${log.totals.deliveries} deliveries · ${log.totals.visitors} visitors · ${num(log.totals.hoursLost)} h lost${quantityTotalsText(log.totals)}`],
    ["Distributed", log.distributedAt ? `${new Date(log.distributedAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : "not yet"],
  ]);
  if (log.summary) {
    pdf.heading("Summary", { level: 2 });
    pdf.paragraph(log.summary);
  }
  const cell = (entry) => (entry.activity ? `${entry.activity.code ? `${entry.activity.code} ` : ""}${entry.activity.name}` : "");
  const sectionTable = (title, rows, columns) => {
    pdf.heading(`${title} (${rows.length})`, { level: 2 });
    if (!rows.length) {
      pdf.paragraph("None recorded.", { color: "0.4 0.4 0.4" });
      return;
    }
    pdf.table({ columns, rows, size: 8 });
  };
  sectionTable("Manpower", log.sections.manpower, [
    { key: (row) => row.companyName || row.party?.companyName || "", label: "Company", width: 0.22 },
    { key: "trade", label: "Trade", width: 0.18 },
    { key: (row) => String(row.workers), label: "Workers", width: 0.1, align: "right" },
    { key: (row) => num(row.hours), label: "Hrs each", width: 0.1, align: "right" },
    { key: (row) => num(row.manHours), label: "Man-hours", width: 0.12, align: "right" },
    { key: cell, label: "Activity", width: 0.18 },
    { key: statusNote, label: "", width: 0.1 },
  ]);
  sectionTable("Equipment", log.sections.equipment, [
    { key: (row) => row.name, label: "Equipment", width: 0.3 },
    { key: (row) => String(row.count), label: "No.", width: 0.08, align: "right" },
    { key: (row) => num(row.hoursOperated), label: "Operated h", width: 0.12, align: "right" },
    { key: (row) => num(row.hoursIdle), label: "Idle h", width: 0.1, align: "right" },
    { key: cell, label: "Activity", width: 0.25 },
    { key: statusNote, label: "", width: 0.15 },
  ]);
  sectionTable("Deliveries", log.sections.deliveries, [
    { key: (row) => formatTime(row.deliveredAt, tz), label: "Time", width: 0.08 },
    { key: (row) => row.supplierName || "", label: "Supplier", width: 0.2 },
    { key: (row) => row.description, label: "Description", width: 0.32 },
    { key: (row) => (row.quantity === null ? "" : `${num(row.quantity, 2)} ${row.unit || ""}`.trim()), label: "Qty", width: 0.12, align: "right" },
    { key: (row) => row.receivedBy || "", label: "Received by", width: 0.16 },
    { key: statusNote, label: "", width: 0.12 },
  ]);
  sectionTable("Visitors", log.sections.visitors, [
    { key: (row) => row.name, label: "Name", width: 0.25 },
    { key: (row) => row.company || "", label: "Company", width: 0.25 },
    { key: (row) => row.purpose || "", label: "Purpose", width: 0.3 },
    { key: (row) => formatTime(row.arrivedAt, tz), label: "In", width: 0.1 },
    { key: (row) => formatTime(row.leftAt, tz), label: "Out", width: 0.1 },
  ]);
  sectionTable("Delays", log.sections.delays, [
    { key: (row) => row.type, label: "Type", width: 0.12 },
    { key: (row) => row.description, label: "Description", width: 0.42 },
    { key: (row) => num(row.hoursLost), label: "Hours lost", width: 0.12, align: "right" },
    { key: cell, label: "Activity", width: 0.22 },
    { key: statusNote, label: "", width: 0.12 },
  ]);
  sectionTable("Quantities installed", log.sections.quantities, [
    { key: (row) => itemCell(row, boqAccess), label: "BOQ item", width: 0.34 },
    { key: (row) => `${num(row.quantity, 3)} ${row.unitCode || ""}`.trim(), label: "Qty", width: 0.14, align: "right" },
    { key: cell, label: "Activity", width: 0.26 },
    { key: quantityNote, label: "", width: 0.26 },
  ]);
  pdf.heading(`Notes (${log.sections.notes.length})`, { level: 2 });
  if (!log.sections.notes.length) pdf.paragraph("None recorded.", { color: "0.4 0.4 0.4" });
  for (const note of log.sections.notes) {
    pdf.paragraph(`[${note.kind}${statusNote(note) ? ` · ${statusNote(note)}` : ""}] ${note.text}${note.activity ? ` — ${cell(note)}` : ""}`);
  }
  const slug = String(project.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return { buffer: pdf.render(), fileName: `daily-log-${slug}-${log.date}.pdf`, log };
};

/** Plain-text digest for the distribution email (external readers have no login). */
const renderText = ({ project, log }) => {
  const lines = [`Daily log — ${project.name} — ${log.date}`, `Status: ${log.status}`, `Weather: ${log.weather?.summary || "not recorded"}`];
  if ((log.weather?.alerts || []).length) lines.push(`Weather alerts: ${log.weather.alerts.map((alert) => alert.message).join("; ")}`);
  lines.push(`Totals: ${log.totals.workers} workers, ${num(log.totals.manHours)} man-hours, ${log.totals.equipmentCount} plant, ${log.totals.deliveries} deliveries, ${log.totals.visitors} visitors, ${num(log.totals.hoursLost)} h lost${quantityTotalsText(log.totals)}`);
  if (log.summary) lines.push("", "Summary:", log.summary);
  const block = (title, rows, line) => {
    if (!rows.length) return;
    lines.push("", `${title}:`);
    for (const row of rows) lines.push(`- ${line(row)}${statusNote(row) ? ` (${statusNote(row)})` : ""}`);
  };
  block("Manpower", log.sections.manpower, (row) => `${row.companyName || row.party?.companyName || "—"} · ${row.trade} · ${row.workers} × ${num(row.hours)} h`);
  block("Equipment", log.sections.equipment, (row) => `${row.name} × ${row.count} · ${num(row.hoursOperated)} h operated`);
  block("Deliveries", log.sections.deliveries, (row) => `${row.supplierName ? `${row.supplierName}: ` : ""}${row.description}${row.quantity !== null ? ` (${num(row.quantity, 2)} ${row.unit || ""})` : ""}`);
  block("Visitors", log.sections.visitors, (row) => `${row.name}${row.company ? ` (${row.company})` : ""}${row.purpose ? ` — ${row.purpose}` : ""}`);
  block("Delays", log.sections.delays, (row) => `${row.type}: ${row.description} · ${num(row.hoursLost)} h`);
  // The digest goes to the distribution list and to external addresses: the
  // item's description and unit, never its code or the bill's figures.
  block("Quantities installed", log.sections.quantities, (row) => `${itemCell(row, { boq: false })} · ${num(row.quantity, 3)} ${row.unitCode || ""}${row.activity ? ` — ${row.activity.name}` : ""} · ${progressNote(row)}`);
  block("Notes", log.sections.notes, (row) => `[${row.kind}] ${row.text}`);
  return lines.join("\n");
};

// ─── distribution ──────────────────────────────────────────────────────────

const distribute = async ({ orgId, projectId, date, actor = null, to = null, note = null, scheduled = false }) => {
  const day = toDateOnly(date);
  const project = await ensureProject({ orgId, projectId });
  const settings = mergeSettings(project.dailyLogSettingsJson);
  const existing = await prisma.dailyLog.findUnique({ where: { projectId_date: { projectId, date: day } } });
  if (!existing) throw new HttpError(404, "DAILY_LOG_NOT_FOUND", "Nothing has been logged for this day yet");

  const rendered = await renderPdf({ orgId, projectId, date: day, viewer: null });
  if (rendered.log.totals.entries === 0 && !rendered.log.weather && !rendered.log.summary) {
    throw new HttpError(400, "DAILY_LOG_EMPTY", "There is nothing to send for this day yet");
  }
  const { uploadProjectDocument } = require("./file-storage.service");
  const document = await uploadProjectDocument({
    orgId,
    projectId,
    userId: actor?.id || null,
    file: { buffer: rendered.buffer, originalname: rendered.fileName, mimetype: "application/pdf", size: rendered.buffer.length },
    documentType: PDF_DOCUMENT_TYPE,
    linkedEntityType: "daily_log",
    linkedEntityId: existing.id,
  });

  const roles = Array.isArray(to?.roles) ? to.roles.filter((role) => DISTRIBUTION_ROLES.includes(role)) : settings.distributionRoles;
  const userIds = Array.isArray(to?.userIds) ? to.userIds.filter(Boolean) : [];
  const emails = (Array.isArray(to?.emails) ? to.emails : settings.distributionEmails).map((email) => String(email).trim().toLowerCase()).filter((email) => EMAIL_RE.test(email));
  const key = rendered.log.date;
  const digest = renderText({ project, log: rendered.log });
  const extra = trimOrNull(note);

  let notified = 0;
  if (roles.length || userIds.length) {
    const result = await notify({
      orgId,
      projectId,
      actorId: actor?.id || null,
      recipientRoles: roles,
      recipientUserIds: userIds,
      category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
      event: "daily_log.distributed",
      title: `Daily log ${key} — ${project.name}`,
      message: `${extra ? `${extra}\n\n` : ""}${digest}`,
      actionUrl: pathFor(projectId, key),
      entityType: "daily_log",
      entityId: existing.id,
      dedupeKeyBase: `daily_log.distributed:${existing.id}:${Date.now()}`,
      metadata: { documentId: document.id, scheduled },
    });
    notified = result?.created || 0;
  }

  const { sendEmail } = require("./email.service");
  const sent = [];
  const failed = [];
  for (const email of emails) {
    try {
      await sendEmail({
        to: email,
        subject: `Daily log ${key} — ${project.name}`,
        body: `${extra ? `${extra}\n\n` : ""}${digest}\n\nThe PDF is attached to the day in OctaPM${process.env.WEB_APP_URL ? `: ${process.env.WEB_APP_URL}${pathFor(projectId, key)}` : "."}`,
        metadata: { event: "daily_log.distributed", projectId, dailyLogId: existing.id, documentId: document.id },
      });
      sent.push(email);
    } catch (error) {
      failed.push({ email, error: error?.code || error?.message || "EMAIL_DELIVERY_FAILED" });
    }
  }

  const now = new Date();
  const distribution = { at: now.toISOString(), by: actor?.id || null, scheduled, roles, userIds, emails: sent, failedEmails: failed, notified, documentId: document.id, fileName: document.fileName };
  const updated = await prisma.dailyLog.update({ where: { id: existing.id }, data: { distributedAt: now, distributionJson: distribution, pdfDocumentId: document.id } });
  await logAudit({ tx: prisma, orgId, projectId, log: updated, action: auditService.ACTIONS.UPDATED, actorId: actor?.id, summary: { transition: "daily_log.distribute", scheduled, notified, emailed: sent.length, failed: failed.length, documentId: document.id } });
  const log = await serializeLog({ projectId, date: day, log: await loadLog({ projectId, date: day, viewer: null }) });
  return { ...log, distribution, document: { id: document.id, fileName: document.fileName } };
};

// ─── reporting ─────────────────────────────────────────────────────────────

const manpowerReport = async ({ orgId, projectId, from = null, to = null, groupBy = "company", viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const end = to ? toDateOnly(to) : toDateOnly(new Date());
  const start = from ? toDateOnly(from) : toDateOnly(shiftDays(dateKey(end), -30));
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new HttpError(400, "DAILY_LOG_RANGE", `Range must be ${MAX_RANGE_DAYS} days or fewer`);
  if (!["company", "trade", "company_trade", "activity"].includes(groupBy)) throw new HttpError(400, "DAILY_LOG_GROUP_BY", "groupBy must be company, trade, company_trade or activity");

  const rows = await prisma.dailyLogManpower.findMany({
    where: { projectId, status: { in: [ENTRY_STATUS.APPROVED, ENTRY_STATUS.SUBMITTED] }, ...(entryVisibility(viewer) || {}), dailyLog: { date: { gte: start, lte: end } } },
    include: { dailyLog: { select: { date: true } } },
  });
  const activityIds = [...new Set(rows.map((row) => row.activityId).filter(Boolean))];
  const activities = activityIds.length ? await prisma.activity.findMany({ where: { id: { in: activityIds } }, select: { id: true, name: true, p6ActivityId: true } }) : [];
  const activityName = new Map(activities.map((activity) => [activity.id, `${activity.p6ActivityId ? `${activity.p6ActivityId} ` : ""}${activity.name}`]));

  const groups = new Map();
  const byDate = new Map();
  for (const row of rows) {
    const company = row.companyName || "Unassigned";
    const label = groupBy === "company" ? company : groupBy === "trade" ? row.trade : groupBy === "activity" ? (row.activityId ? activityName.get(row.activityId) || "Unknown activity" : "No activity") : `${company} · ${row.trade}`;
    const key = groupBy === "company" ? row.companyId || company : groupBy === "trade" ? row.trade : groupBy === "activity" ? row.activityId || "none" : `${row.companyId || company}|${row.trade}`;
    const group = groups.get(key) || { key, label, companyId: row.companyId || null, companyName: company, trade: groupBy === "company" || groupBy === "activity" ? null : row.trade, activityId: groupBy === "activity" ? row.activityId : null, workers: 0, manHours: 0, days: new Set(), entries: 0 };
    const manHours = (row.workers || 0) * (row.hours || 0);
    group.workers += row.workers || 0;
    group.manHours += manHours;
    group.days.add(dateKey(row.dailyLog.date));
    group.entries += 1;
    groups.set(key, group);
    const dayKey = dateKey(row.dailyLog.date);
    const dayRow = byDate.get(dayKey) || { date: dayKey, workers: 0, manHours: 0 };
    dayRow.workers += row.workers || 0;
    dayRow.manHours += manHours;
    byDate.set(dayKey, dayRow);
  }
  const items = [...groups.values()]
    .map((group) => ({ ...group, days: group.days.size, manHours: Math.round(group.manHours * 100) / 100, avgWorkersPerDay: group.days.size ? Math.round((group.workers / group.days.size) * 10) / 10 : 0 }))
    .sort((a, b) => b.manHours - a.manHours);
  const totals = items.reduce((acc, group) => ({ workers: acc.workers + group.workers, manHours: Math.round((acc.manHours + group.manHours) * 100) / 100, entries: acc.entries + group.entries }), { workers: 0, manHours: 0, entries: 0 });
  return { from: dateKey(start), to: dateKey(end), groupBy, items, byDate: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, manHours: Math.round(row.manHours * 100) / 100 })), totals: { ...totals, days: byDate.size } };
};

// ─── jobs ──────────────────────────────────────────────────────────────────

const projectsWithFeed = async ({ orgId }) => {
  const projects = await prisma.project.findMany({ where: { orgId, status: "active", latitude: { not: null }, longitude: { not: null } }, select: { id: true, name: true, timezone: true, dailyLogSettingsJson: true } });
  return projects.filter((project) => mergeSettings(project.dailyLogSettingsJson).weatherFeedEnabled);
};

/** Fills today's (and, until it is final, yesterday's) weather for every project with coordinates. */
const runWeatherFill = async ({ orgId, now = new Date(), log = () => {}, fetchImpl = undefined }) => {
  const result = { projects: 0, refreshed: 0, suggested: 0, skipped: 0, errors: [] };
  if (!weatherFeed.isEnabled()) return { ...result, disabled: true };
  const projects = await projectsWithFeed({ orgId });
  result.projects = projects.length;
  for (const project of projects) {
    const tz = project.timezone || "UTC";
    const today = localDateKey(now, tz);
    const yesterday = shiftDays(today, -1);
    for (const key of [today, yesterday]) {
      const row = await prisma.dailyLog.findUnique({ where: { projectId_date: { projectId: project.id, date: toDateOnly(key) } }, select: { weatherSource: true, weatherFetchedAt: true, status: true } });
      if (row?.weatherSource === WEATHER_SOURCE.MANUAL || row?.status === LOG_STATUS.APPROVED) {
        result.skipped += 1;
        continue;
      }
      const fetchedAt = row?.weatherFetchedAt ? new Date(row.weatherFetchedAt).getTime() : 0;
      const stale = key === today ? now.getTime() - fetchedAt > 3 * 60 * 60_000 : localDateKey(new Date(fetchedAt || 0), tz) < today;
      if (!stale) {
        result.skipped += 1;
        continue;
      }
      try {
        const refreshed = await refreshWeather({ orgId, projectId: project.id, date: key, actor: null, fetchImpl, now });
        result.refreshed += 1;
        if (refreshed.totals?.suggestedDelays) result.suggested += 1;
      } catch (error) {
        result.errors.push({ projectId: project.id, date: key, code: error?.code || "WEATHER_FILL_FAILED", message: error?.message });
        log(`weather ${project.name} ${key}: ${error?.message}`);
      }
    }
  }
  return result;
};

const runWeatherJob = async ({ job, log }) => runWeatherFill({ orgId: job.orgId, log });

const runDistributeJob = async ({ job, payload }) => {
  const result = await distribute({ orgId: job.orgId, projectId: payload.projectId, date: payload.date, actor: null, scheduled: true });
  return { date: result.date, notified: result.distribution.notified, emailed: result.distribution.emails.length, failed: result.distribution.failedEmails.length, documentId: result.document.id };
};

/**
 * Finds projects whose local clock has passed their send time today and whose
 * log has content but has not gone out yet, and hands each to `enqueue`.
 */
const queueScheduledDistributions = async ({ now = new Date(), enqueue }) => {
  const projects = await prisma.project.findMany({ where: { status: "active" }, select: { id: true, orgId: true, timezone: true, dailyLogSettingsJson: true } });
  const queued = [];
  for (const project of projects) {
    const settings = mergeSettings(project.dailyLogSettingsJson);
    if (!settings.autoDistributeAt) continue;
    const tz = project.timezone || "UTC";
    const today = localDateKey(now, tz);
    if (localTimeHm(now, tz) < settings.autoDistributeAt) continue;
    const row = await prisma.dailyLog.findUnique({ where: { projectId_date: { projectId: project.id, date: toDateOnly(today) } }, include: sectionsInclude(null) });
    if (!row) continue;
    if (row.distributedAt && localDateKey(new Date(row.distributedAt), tz) === today) continue;
    if (row.autoDistributeQueuedFor && localDateKey(new Date(row.autoDistributeQueuedFor), tz) === today) continue;
    if (totalsFor(row).entries === 0 && !row.weatherJson && !row.summary) continue;
    // Claim from the value this tick read, so a second scheduler that saw the
    // same log (two processes during a deploy) does not queue it again.
    const claimed = await prisma.dailyLog.updateMany({ where: { id: row.id, autoDistributeQueuedFor: row.autoDistributeQueuedFor ?? null }, data: { autoDistributeQueuedFor: now } });
    if (claimed.count !== 1) continue;
    await enqueue({ orgId: project.orgId, projectId: project.id, payload: { projectId: project.id, date: today, scheduled: true } });
    queued.push({ projectId: project.id, date: today });
  }
  return { checked: projects.length, queued };
};

module.exports = {
  DEFAULT_SETTINGS,
  DELAY_SOURCE,
  DELAY_TYPES,
  DISTRIBUTION_ROLES,
  ENTRY_STATUS,
  ENTRY_STATUSES,
  LOG_STATUS,
  LOG_STATUSES,
  NOTE_KINDS,
  QUANTITIES,
  SECTION_KEYS,
  SECTIONS,
  WEATHER_SOURCE,
  addEntry,
  approveLog,
  copyPrevious,
  deleteEntry,
  distribute,
  getLog,
  getSettings,
  listLogs,
  localDateKey,
  localTimeHm,
  logWeatherDelay,
  manpowerReport,
  mergeSettings,
  queueScheduledDistributions,
  refreshWeather,
  renderPdf,
  renderText,
  reopenLog,
  reviewEntry,
  runDistributeJob,
  runWeatherFill,
  runWeatherJob,
  serializeLog,
  submitLog,
  toDateOnly,
  totalsFor,
  updateEntry,
  updateLog,
  updateSettings,
};
