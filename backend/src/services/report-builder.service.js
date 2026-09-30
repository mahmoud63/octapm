const ExcelJS = require("exceljs");
const { brandWorkbook } = require("../utils/export-branding");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { can, canParty, normalizeRoleId } = require("../config/permissions");
const { COMPANY_ADMIN_MODULES } = require("../middleware/rbac");
const { assertProjectAccess, getProjectAccessWhere } = require("./project-authorization.service");
const { createPdf } = require("../utils/pdf-writer");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const sources = require("./report-sources");
const customFields = require("./custom-field.service");
const boqFigures = require("../utils/boq-figures");

/** Which custom-field record type each source reads (OCTA-PLAT-FIELDS-025). */
const SOURCE_RECORD_TYPES = Object.freeze({
  activity: "activity",
  rfi: "rfi",
  submittal: "submittal",
  punch_item: "punch_item",
  observation: "punch_item",
  inspection: "form_instance",
  ncr: "ncr",
  safety_incident: "safety_incident",
  change_order: "change_order",
  commitment: "commitment",
  sub_pay_app: "sub_pay_app",
  task: "task",
  risk: "risk",
  procurement_order: "procurement_order",
  ipc_certificate: "ipc_certificate",
  daily_log: "daily_log",
});

/** A source plus the organisation's custom fields as in-memory columns (`custom.<key>`). */
const resolveSource = async ({ orgId = null, key }) => {
  const base = getSourceOrThrow(key);
  const recordType = SOURCE_RECORD_TYPES[base.key];
  if (!recordType || !orgId) return base;
  const extra = await customFields.reportColumns({ orgId, recordType }).catch(() => []);
  if (!extra.length) return base;
  const columns = extra.map((field) => ({
    key: `custom.${field.key}`,
    label: field.label,
    type: field.reportType,
    computed: true,
    custom: true,
    fieldKey: field.key,
    enum: field.enum || null,
    compute: (row) => (row.__custom ? (row.__custom[field.key] ?? null) : null),
  }));
  return { ...base, recordType, columns: [...base.columns, ...columns] };
};

/**
 * Report builder (OCTA-RPT-BUILDER-023).
 *
 * A report is a source + columns + filters + sort + grouping. Every run is
 * evaluated as the caller: the projects in scope are the ones they can open,
 * and inside each project the source's permission module must be readable by
 * their role, party template or permission template; party users get the same
 * row visibility the register applies. Rendering to XLSX / PDF and scheduled
 * delivery share the same query path, so a scheduled report never shows more
 * than its owner could see on screen.
 */

const PREVIEW_LIMIT = 200;
const MAX_LIMIT = 1000;
const EXPORT_LIMIT = 5000;
const PDF_ROW_LIMIT = 2000;
const RUN_HISTORY_KEEP = 30;
const VISIBILITIES = ["private", "project", "org"];
const FREQUENCIES = ["daily", "weekly", "monthly"];
const FORMATS = ["pdf", "xlsx", "both"];
const AGGREGATE_FNS = ["count", "sum", "avg", "min", "max"];
const OPERATORS = ["eq", "neq", "in", "nin", "contains", "gt", "gte", "lt", "lte", "between", "empty", "not_empty", "is_true", "is_false", "last_days", "next_days", "before_today", "after_today", "today"];
const DAY_MS = 86_400_000;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// ─── access ────────────────────────────────────────────────────────────────

const accessibleProjects = async ({ orgId, user, projectId = null }) => {
  const where = { orgId, archivedAt: null, ...getProjectAccessWhere({ userId: user.id, role: user.role, isCompanyAdmin: user.isCompanyAdmin }) };
  if (projectId) where.id = projectId;
  return prisma.project.findMany({ where, select: { id: true, name: true, currency: true, status: true }, orderBy: { name: "asc" } });
};

const resolveProjectContext = async ({ orgId, user, projectId }) => {
  const access = await assertProjectAccess({ orgId, projectId, userId: user.id, role: user.role, isCompanyAdmin: user.isCompanyAdmin });
  let template = null;
  try {
    const { resolveTemplateContext } = require("./permission-template.service");
    const context = await resolveTemplateContext({ projectId, userId: user.id, partyAccess: access.partyAccess || [] });
    template = context?.compiled || null;
  } catch {
    template = null;
  }
  return { access, template };
};

/** The same decision `requirePermission` makes, evaluated for one project without a request. */
const canReadModule = ({ user, access, template, moduleName }) => {
  if (user.isCompanyAdmin && COMPANY_ADMIN_MODULES.has(moduleName)) return true;
  if (template) {
    const { templateAllows } = require("./permission-template.service");
    const decided = templateAllows(template, { module: moduleName, action: "read", transition: null });
    if (decided !== null && decided !== undefined) return Boolean(decided);
  }
  const role = normalizeRoleId(access.role || user.role);
  if (role && can({ role, module: moduleName, action: "read" })) return true;
  return (access.partyAccess || []).some((party) => canParty({ partyRole: party.role, module: moduleName, action: "read" }));
};

// ─── definition normalisation ──────────────────────────────────────────────

const getSourceOrThrow = (key) => {
  const source = sources.getSource(key);
  if (!source) throw new HttpError(400, "REPORT_SOURCE_UNKNOWN", `Unknown report source: ${key}`);
  return source;
};

const normalizeColumns = (source, keys) => {
  const wanted = Array.isArray(keys) && keys.length ? keys : source.defaultColumns;
  const unknown = wanted.filter((key) => !sources.columnByKey(source, key));
  if (unknown.length) throw new HttpError(400, "REPORT_COLUMN_UNKNOWN", `Unknown columns: ${unknown.join(", ")}`, { unknown });
  return [...new Set(wanted)];
};

const coerceValue = (column, value) => {
  if (value === null || value === undefined || value === "") return null;
  switch (column.type) {
    case "number":
    case "money": {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new HttpError(400, "REPORT_FILTER_VALUE", `${column.label} needs a number`);
      return numeric;
    }
    case "date": {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new HttpError(400, "REPORT_FILTER_VALUE", `${column.label} needs a date`);
      return date;
    }
    case "boolean":
      return value === true || value === "true" || value === 1 || value === "1";
    default:
      return String(value);
  }
};

const normalizeFilters = (source, filters) => {
  if (!Array.isArray(filters)) return [];
  return filters.map((filter, index) => {
    const column = sources.columnByKey(source, filter?.field);
    if (!column) throw new HttpError(400, "REPORT_FILTER_FIELD", `Filter ${index + 1}: unknown field ${filter?.field}`);
    const op = String(filter?.op || "eq");
    if (!OPERATORS.includes(op)) throw new HttpError(400, "REPORT_FILTER_OP", `Filter ${index + 1}: unknown operator ${op}`);
    let value = filter?.value;
    if (op === "in" || op === "nin") value = (Array.isArray(value) ? value : String(value ?? "").split(",")).map((item) => coerceValue(column, item)).filter((item) => item !== null);
    else if (op === "between") value = (Array.isArray(value) ? value : []).slice(0, 2).map((item) => coerceValue(column, item));
    else if (op === "last_days" || op === "next_days") value = Math.max(0, Math.round(Number(value) || 0));
    else if (["empty", "not_empty", "is_true", "is_false", "before_today", "after_today", "today"].includes(op)) value = null;
    else value = coerceValue(column, value);
    return { field: column.key, op, value };
  });
};

const normalizeSort = (source, sort) => {
  if (!sort || !sort.field) return source.defaultSort || null;
  const column = sources.columnByKey(source, sort.field);
  if (!column) throw new HttpError(400, "REPORT_SORT_FIELD", `Unknown sort field ${sort.field}`);
  return { field: column.key, dir: String(sort.dir).toLowerCase() === "desc" ? "desc" : "asc" };
};

const normalizeAggregates = (source, aggregates) => {
  if (!Array.isArray(aggregates)) return [];
  return aggregates.map((aggregate) => {
    const fn = String(aggregate?.fn || "count");
    if (!AGGREGATE_FNS.includes(fn)) throw new HttpError(400, "REPORT_AGGREGATE_FN", `Unknown aggregate ${fn}`);
    if (fn === "count") return { fn, field: null };
    const column = sources.columnByKey(source, aggregate?.field);
    if (!column) throw new HttpError(400, "REPORT_AGGREGATE_FIELD", `Unknown aggregate field ${aggregate?.field}`);
    if (!["number", "money"].includes(column.type) && fn !== "min" && fn !== "max") throw new HttpError(400, "REPORT_AGGREGATE_FIELD", `${column.label} is not numeric`);
    return { fn, field: column.key };
  });
};

const normalizeDefinition = async ({ orgId = null, payload = {}, existing = null }) => {
  const source = await resolveSource({ orgId, key: payload.source ?? existing?.source });
  const columns = normalizeColumns(source, payload.columns ?? existing?.columnsJson);
  const filters = normalizeFilters(source, payload.filters ?? existing?.filtersJson);
  const sort = normalizeSort(source, payload.sort ?? existing?.sortJson);
  const groupBy = payload.groupBy !== undefined ? trimOrNull(payload.groupBy) : existing?.groupBy ?? null;
  if (groupBy && !sources.columnByKey(source, groupBy)) throw new HttpError(400, "REPORT_GROUP_FIELD", `Unknown group field ${groupBy}`);
  const aggregates = normalizeAggregates(source, payload.aggregates ?? existing?.aggregatesJson);
  const chart = payload.chart !== undefined ? (isPlainObject(payload.chart) ? { type: ["bar", "line", "pie", "none"].includes(payload.chart.type) ? payload.chart.type : "none", metric: trimOrNull(payload.chart.metric) || "count" } : null) : existing?.chartJson ?? null;
  const visibility = payload.visibility !== undefined ? String(payload.visibility) : existing?.visibility || "private";
  if (!VISIBILITIES.includes(visibility)) throw new HttpError(400, "REPORT_VISIBILITY", "Visibility must be private, project or org");
  return { source: source.key, columns, filters, sort, groupBy, aggregates, chart, visibility };
};

// ─── query building ────────────────────────────────────────────────────────

const getPath = (row, path) => path.split(".").reduce((current, part) => (current === null || current === undefined ? undefined : current[part]), row);

const nest = (path, condition) => path.split(".").reverse().reduce((inner, part) => ({ [part]: inner }), condition);

const startOfToday = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const prismaCondition = (column, filter) => {
  const { op, value } = filter;
  const text = column.type === "string" || column.type === "enum";
  switch (op) {
    case "eq":
      return text ? { equals: value, mode: "insensitive" } : { equals: value };
    case "neq":
      return text ? { not: { equals: value, mode: "insensitive" } } : { not: value };
    case "in":
      return { in: value };
    case "nin":
      return { notIn: value };
    case "contains":
      return { contains: String(value), mode: "insensitive" };
    case "gt":
      return { gt: value };
    case "gte":
      return { gte: value };
    case "lt":
      return { lt: value };
    case "lte":
      return { lte: value };
    case "between":
      return { ...(value[0] !== null && value[0] !== undefined ? { gte: value[0] } : {}), ...(value[1] !== null && value[1] !== undefined ? { lte: value[1] } : {}) };
    case "empty":
      return { equals: null };
    case "not_empty":
      return { not: null };
    case "is_true":
      return { equals: true };
    case "is_false":
      return { equals: false };
    case "last_days":
      return { gte: new Date(startOfToday().getTime() - value * DAY_MS) };
    case "next_days":
      return { gte: startOfToday(), lte: new Date(startOfToday().getTime() + (value + 1) * DAY_MS) };
    case "before_today":
      return { lt: startOfToday() };
    case "after_today":
      return { gte: new Date(startOfToday().getTime() + DAY_MS) };
    case "today":
      return { gte: startOfToday(), lt: new Date(startOfToday().getTime() + DAY_MS) };
    default:
      return null;
  }
};

const matchesInMemory = (column, filter, value) => {
  const { op } = filter;
  const target = filter.value;
  const lower = (item) => String(item ?? "").toLowerCase();
  const time = (item) => (item ? new Date(item).getTime() : null);
  switch (op) {
    case "eq":
      return column.type === "date" ? time(value) === time(target) : column.type === "string" || column.type === "enum" ? lower(value) === lower(target) : value === target;
    case "neq":
      return !matchesInMemory(column, { ...filter, op: "eq" }, value);
    case "in":
      return target.some((item) => (column.type === "string" || column.type === "enum" ? lower(item) === lower(value) : item === value));
    case "nin":
      return !matchesInMemory(column, { ...filter, op: "in" }, value);
    case "contains":
      return lower(value).includes(lower(target));
    case "gt":
      return column.type === "date" ? time(value) > time(target) : Number(value) > Number(target);
    case "gte":
      return column.type === "date" ? time(value) >= time(target) : Number(value) >= Number(target);
    case "lt":
      return column.type === "date" ? time(value) < time(target) : Number(value) < Number(target);
    case "lte":
      return column.type === "date" ? time(value) <= time(target) : Number(value) <= Number(target);
    case "between": {
      const [low, high] = target;
      const numeric = column.type === "date" ? time(value) : Number(value);
      return (low === null || low === undefined || numeric >= (column.type === "date" ? time(low) : Number(low))) && (high === null || high === undefined || numeric <= (column.type === "date" ? time(high) : Number(high)));
    }
    case "empty":
      return value === null || value === undefined || value === "";
    case "not_empty":
      return !(value === null || value === undefined || value === "");
    case "is_true":
      return value === true;
    case "is_false":
      return value === false;
    case "last_days":
      return time(value) !== null && time(value) >= startOfToday().getTime() - target * DAY_MS;
    case "next_days":
      return time(value) !== null && time(value) >= startOfToday().getTime() && time(value) <= startOfToday().getTime() + (target + 1) * DAY_MS;
    case "before_today":
      return time(value) !== null && time(value) < startOfToday().getTime();
    case "after_today":
      return time(value) !== null && time(value) >= startOfToday().getTime() + DAY_MS;
    case "today":
      return time(value) !== null && time(value) >= startOfToday().getTime() && time(value) < startOfToday().getTime() + DAY_MS;
    default:
      return true;
  }
};

// `inMemory`: columns a filter must see as the caller receives them (a
// column withheld on some project is filtered after it is withheld, never on
// the stored figure in the database).
const splitFilters = (source, filters, inMemory = new Set()) => {
  const db = [];
  const memory = [];
  for (const filter of filters) {
    const column = sources.columnByKey(source, filter.field);
    if (column.computed || column.json || inMemory.has(column.key)) memory.push({ column, filter });
    else {
      const condition = prismaCondition(column, filter);
      if (condition) db.push(nest(column.path, condition));
    }
  }
  return { db, memory };
};

const cellValue = (column, row) => {
  const raw = column.computed ? column.compute(row) : getPath(row, column.path);
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (column.type === "money" || column.type === "number") {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (column.type === "date") return toIso(raw);
  if (column.type === "boolean") return Boolean(raw);
  if (typeof raw === "object" && raw !== null && typeof raw.toNumber === "function") return raw.toNumber();
  return raw;
};

const compareValues = (column, a, b) => {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (column.type === "number" || column.type === "money") return Number(a) - Number(b);
  if (column.type === "date") return new Date(a).getTime() - new Date(b).getTime();
  if (column.type === "boolean") return Number(b) - Number(a);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

const projectNameOf = (row, source) => (source.key === "daily_log_manpower" ? null : row.project?.name || null);

/**
 * Runs a normalised definition as `user`. Returns the flattened rows, the
 * columns used, grouping and totals, plus how many projects were queried or
 * denied by permission.
 */
const runQuery = async ({ orgId, user, definition, limit = PREVIEW_LIMIT, offset = 0, apiClient = null }) => {
  const source = await resolveSource({ orgId, key: definition.source });
  // An API key reads a source only with a scope on the source's module, and
  // only on its own projects; the report used to run as the key's owner
  // (Phase 21D, CX21-431).
  const keyProjects = apiClient?.projectIds?.length ? apiClient.projectIds : null;
  if (apiClient && !require("./api-client.service").scopeAllows(apiClient, source.module, "read")) {
    throw new HttpError(403, "API_KEY_SCOPE", `This API key cannot read ${source.module}`);
  }
  if (keyProjects && definition.projectId && !keyProjects.includes(definition.projectId)) {
    throw new HttpError(403, "FORBIDDEN_PROJECT", "This API key is not allowed on that project");
  }
  const columns = normalizeColumns(source, definition.columns).map((key) => sources.columnByKey(source, key));
  const filters = normalizeFilters(source, definition.filters);
  const sort = normalizeSort(source, definition.sort);
  const groupBy = definition.groupBy ? sources.columnByKey(source, definition.groupBy) : null;
  const aggregates = normalizeAggregates(source, definition.aggregates);
  const cap = Math.min(Math.max(1, Number(limit) || PREVIEW_LIMIT), EXPORT_LIMIT);

  const projects = (await accessibleProjects({ orgId, user, projectId: definition.projectId || null })).filter((project) => !keyProjects || keyProjects.includes(project.id));
  // The source's columns that state a figure an allocation gives one
  // activity (E1): withheld on every project where the caller may not read
  // the BOQ — decided per project as the BOQ endpoints decide it, and for an
  // API key only with a scope on the BOQ too.
  const mappingKeys = boqFigures.reportMappingColumns(source.key);
  // A cost record's DEFAULT forecast (R5-2) is built from the record's budget:
  // withheld on those rows only, on the same projects.
  const defaultForecastKeys = boqFigures.reportDefaultForecastColumns(source.key);
  // The certificate source's cap-limited totals (PC-7a review): withheld on a
  // certificate not yet certified where the caller may not read the BOQ and
  // the contract's value is unestablished under a retention cap — as GET
  // /ipc answers the same caller (utils/boq-figures retentionCapWithheld).
  const capKeys = boqFigures.reportCertificateCapColumns(source.key);
  const keyReadsBoq = !apiClient || require("./api-client.service").scopeAllows(apiClient, "boq", "read");
  const contexts = [];
  let denied = 0;
  for (const project of projects) {
    try {
      const context = await resolveProjectContext({ orgId, user, projectId: project.id });
      if (canReadModule({ user, access: context.access, template: context.template, moduleName: source.module })) {
        const boq = (!mappingKeys.length && !capKeys.length && !defaultForecastKeys.length) || (keyReadsBoq && canReadModule({ user, access: context.access, template: context.template, moduleName: "boq" }));
        contexts.push({ project, ...context, boq });
      } else denied += 1;
    } catch {
      denied += 1;
    }
  }
  const withheldProjectIds = new Set(contexts.filter((context) => !context.boq).map((context) => context.project.id));
  // Each such project's contract terms, read once, kept only where they withhold.
  const capTerms = new Map();
  if (capKeys.length) {
    const primeContracts = require("./prime-contract.service");
    for (const projectId of withheldProjectIds) {
      const terms = await primeContracts.contractValueTerms({ orgId, projectId });
      if (boqFigures.retentionCapWithheld(terms, { boq: false, budget: false })) capTerms.set(projectId, terms);
    }
  }
  const withholding = new Set([...(withheldProjectIds.size ? [...mappingKeys, ...defaultForecastKeys] : []), ...(capTerms.size ? capKeys : [])]);

  const { db: dbFilters, memory: memoryFilters } = splitFilters(source, filters, withholding);
  const groups = new Map();
  for (const context of contexts) {
    const viewer = { id: user.id, projectAccess: context.access };
    const scope = source.visibility ? source.visibility({ viewer, projectAccess: context.access }) : null;
    // Projects whose visibility clause is identical share one query; a party
    // user's clause names project-specific party ids, so it stays per project.
    const signature = scope && Object.keys(scope).length ? JSON.stringify(scope) : "shared";
    const bucket = groups.get(signature) || { projectIds: [], scope };
    bucket.projectIds.push(context.project.id);
    groups.set(signature, bucket);
  }

  const raw = [];
  for (const bucket of groups.values()) {
    const where = { projectId: { in: bucket.projectIds }, ...(source.baseWhere || {}), AND: [...dbFilters, ...(bucket.scope && Object.keys(bucket.scope).length ? [bucket.scope] : [])] };
    const rows = await prisma[source.model].findMany({ where, include: source.include || undefined, take: EXPORT_LIMIT });
    raw.push(...rows);
  }
  if (source.recordType && raw.length) await customFields.attachValues({ orgId, recordType: source.recordType, rows: raw });

  const columnFor = (key) => sources.columnByKey(source, key);
  const allColumns = [...new Set([...columns.map((column) => column.key), ...(sort ? [sort.field] : []), ...(groupBy ? [groupBy.key] : []), ...aggregates.filter((aggregate) => aggregate.field).map((aggregate) => aggregate.field), ...memoryFilters.map(({ column }) => column.key)])].map(columnFor);

  let flat = raw.map((row) => {
    const values = { id: row.id, projectId: row.projectId || row.dailyLog?.projectId || null, projectName: projectNameOf(row, source) };
    for (const column of allColumns) values[column.key] = cellValue(column, row);
    const rowKeys = boqFigures.rowHasDefaultForecast(row) ? [...mappingKeys, ...defaultForecastKeys] : mappingKeys;
    const mapped = withheldProjectIds.has(values.projectId) ? boqFigures.withheldReportRow(values, rowKeys, { boq: false }) : values;
    const terms = capTerms.get(values.projectId);
    return terms ? boqFigures.withheldReportCertificateRow(mapped, { status: row.status, keys: capKeys, terms, access: { boq: false, budget: false } }) : mapped;
  });
  // The withheld columns this run uses (shown, sorted, grouped, filtered or aggregated).
  // A default-forecast column is named withheld only when a row's was (R5-2).
  const rowWithheld = (key) => flat.some((row) => row.withheldColumns && row.withheldColumns.includes(key));
  const withheldKeys = allColumns
    .map((column) => column.key)
    .filter((key) => withholding.has(key) && (!defaultForecastKeys.includes(key) || mappingKeys.includes(key) || rowWithheld(key)));
  for (const { column, filter } of memoryFilters) flat = flat.filter((row) => matchesInMemory(column, filter, row[column.key]));
  if (sort) {
    const column = columnFor(sort.field);
    // Sorted on a withheld column, the withheld rows tie; they are then put
    // in the order of their ids — not the database's, which an update of the
    // stored figure can change.
    const tieBreak = withholding.has(sort.field) ? (a, b) => String(a.id).localeCompare(String(b.id)) : () => 0;
    flat.sort((a, b) => compareValues(column, a[sort.field], b[sort.field]) * (sort.dir === "desc" ? -1 : 1) || tieBreak(a, b));
  }

  const total = flat.length;
  const page = flat.slice(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + cap);
  const aggregate = (rows) => {
    const result = { count: rows.length };
    for (const item of aggregates) {
      if (item.fn === "count") continue;
      const key = `${item.fn}_${item.field}`;
      // Over a column withheld from any of the rows (or over no rows, when
      // the column is withheld on some project): no figure — not a sum of
      // the rest, not a zero.
      if (withholding.has(item.field) && (!rows.length || rows.some((row) => row.withheldColumns && row.withheldColumns.includes(item.field)))) {
        result[key] = null;
        continue;
      }
      const values = rows.map((row) => row[item.field]).filter((value) => value !== null && value !== undefined);
      const numbers = values.map(Number).filter(Number.isFinite);
      if (item.fn === "sum") result[key] = Math.round(numbers.reduce((sum, value) => sum + value, 0) * 100) / 100;
      else if (item.fn === "avg") result[key] = numbers.length ? Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100 : null;
      else if (item.fn === "min") result[key] = values.length ? values.reduce((min, value) => (compareValues(columnFor(item.field), value, min) < 0 ? value : min)) : null;
      else if (item.fn === "max") result[key] = values.length ? values.reduce((max, value) => (compareValues(columnFor(item.field), value, max) > 0 ? value : max)) : null;
    }
    return result;
  };
  let groupRows = null;
  if (groupBy) {
    const byKey = new Map();
    for (const row of flat) {
      const value = row[groupBy.key];
      const label = value === null || value === undefined || value === "" ? "(blank)" : groupBy.type === "date" ? String(value).slice(0, 10) : String(value);
      const entry = byKey.get(label) || { key: label, label, rows: [] };
      entry.rows.push(row);
      byKey.set(label, entry);
    }
    groupRows = [...byKey.values()].map((entry) => ({ key: entry.key, label: entry.label, ...aggregate(entry.rows) })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  // Said once for the run, and on each column it touches, only when a
  // column this run uses was withheld on some project: a BOQ reader's
  // answer carries none of it.
  const withheld = withheldKeys.length
    ? capKeys.length
      ? { columns: withheldKeys, reason: boqFigures.RETENTION_CAP_WITHHELD, projects: capTerms.size }
      : { columns: withheldKeys, reason: boqFigures.MAPPING_DETAILS_WITHHELD, projects: withheldProjectIds.size }
    : null;
  const describeColumn = (column) => ({
    key: column.key,
    label: column.label,
    type: column.type,
    ...(withheld && withheldKeys.includes(column.key) ? { withheld: true, withheldReason: withheld.reason } : {}),
  });
  return {
    source: { key: source.key, label: source.label, module: source.module },
    columns: columns.map(describeColumn),
    rows: page,
    rowCount: page.length,
    total,
    truncated: raw.length >= EXPORT_LIMIT || total > cap + (Number(offset) || 0),
    groupBy: groupBy ? { key: groupBy.key, label: groupBy.label, type: groupBy.type } : null,
    aggregates: aggregates.map((item) => ({ ...item, key: item.fn === "count" ? "count" : `${item.fn}_${item.field}`, label: item.fn === "count" ? "Count" : `${item.fn} of ${columnFor(item.field).label}` })),
    groups: groupRows,
    totals: aggregate(flat),
    projects: { inScope: projects.length, queried: contexts.length, denied },
    ...(withheld ? { withheld } : {}),
    generatedAt: new Date().toISOString(),
  };
};

// ─── rendering ─────────────────────────────────────────────────────────────

const formatCell = (column, value, currency = "") => {
  if (value === null || value === undefined) return "";
  switch (column.type) {
    case "date":
      return String(value).slice(0, 10);
    case "money":
      return `${currency ? `${currency} ` : ""}${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "number":
      return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return String(value);
  }
};

const describeFilters = (source, filters) =>
  (filters || []).map((filter) => {
    const column = sources.columnByKey(source, filter.field);
    const label = column ? column.label : filter.field;
    const value = Array.isArray(filter.value) ? filter.value.map((item) => (item instanceof Date ? item.toISOString().slice(0, 10) : item)).join(", ") : filter.value instanceof Date ? filter.value.toISOString().slice(0, 10) : filter.value;
    return `${label} ${filter.op.replace(/_/g, " ")}${value === null || value === undefined ? "" : ` ${value}`}`;
  });

// What a file says of the columns withheld from its reader (left blank in its cells).
const withheldNote = (result) => {
  const labels = result.withheld.columns.map((key) => sources.columnByKey(sources.getSource(result.source.key), key)?.label || key);
  return `${labels.join(", ")} — ${result.withheld.reason} (left blank on ${result.withheld.projects} project${result.withheld.projects === 1 ? "" : "s"})`;
};

const renderXlsx = async ({ report, result, user, project = null }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OctaPM";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Data");
  sheet.columns = [{ header: "Project", key: "projectName", width: 24 }, ...result.columns.map((column) => ({ header: column.label, key: column.key, width: column.type === "string" ? 32 : 16 }))];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  for (const row of result.rows) {
    const values = { projectName: row.projectName || "" };
    for (const column of result.columns) {
      const value = row[column.key];
      values[column.key] = value === null || value === undefined ? "" : column.type === "date" ? new Date(value) : column.type === "boolean" ? (value ? "Yes" : "No") : value;
    }
    const excelRow = sheet.addRow(values);
    result.columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 2);
      if (column.type === "money") cell.numFmt = "#,##0.00";
      if (column.type === "date") cell.numFmt = "yyyy-mm-dd";
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: result.columns.length + 1 } };

  if (result.groups) {
    const summary = workbook.addWorksheet("Summary");
    summary.columns = [{ header: result.groupBy.label, key: "label", width: 32 }, { header: "Count", key: "count", width: 12 }, ...result.aggregates.filter((item) => item.fn !== "count").map((item) => ({ header: item.label, key: item.key, width: 18 }))];
    summary.getRow(1).font = { bold: true };
    for (const group of result.groups) summary.addRow(group);
    summary.addRow({ label: "Total", ...result.totals });
    summary.lastRow.font = { bold: true };
  }

  const about = workbook.addWorksheet("About");
  about.columns = [{ header: "Field", key: "field", width: 22 }, { header: "Value", key: "value", width: 80 }];
  about.getRow(1).font = { bold: true };
  about.addRows([
    { field: "Report", value: report.name },
    { field: "Source", value: result.source.label },
    { field: "Scope", value: project ? project.name : "All projects I can see" },
    { field: "Filters", value: describeFilters(sources.getSource(result.source.key), report.filters).join("; ") || "none" },
    { field: "Rows", value: `${result.total}${result.truncated ? " (truncated)" : ""}` },
    { field: "Projects", value: `${result.projects.queried} queried, ${result.projects.denied} not permitted` },
    ...(result.withheld ? [{ field: "Withheld", value: withheldNote(result) }] : []),
    { field: "Generated", value: `${result.generatedAt} by ${user?.name || user?.email || user?.id || "system"}` },
  ]);
  brandWorkbook(workbook, {
    title: report.name || "Report",
    project: project ? project.name : null,
  });
  return workbook.xlsx.writeBuffer().then((buffer) => Buffer.from(buffer));
};

const renderPdf = ({ report, result, user, project = null }) => {
  const landscape = result.columns.length > 6;
  const pdf = createPdf({ title: report.name, author: "OctaPM", pageSize: landscape ? "A4-landscape" : "A4", footer: project ? project.name : "All projects" });
  pdf.heading(report.name);
  pdf.keyValues([
    ["Source", result.source.label],
    ["Scope", project ? project.name : "All projects I can see"],
    ["Filters", describeFilters(sources.getSource(result.source.key), report.filters).join("; ") || "none"],
    ["Rows", `${result.total}${result.truncated ? " (truncated)" : ""} · ${result.projects.queried} project${result.projects.queried === 1 ? "" : "s"}${result.projects.denied ? ` (${result.projects.denied} not permitted)` : ""}`],
    ["Generated", `${result.generatedAt.slice(0, 16).replace("T", " ")} UTC · ${user?.name || user?.email || "scheduled"}`],
    ...(result.withheld ? [["Withheld", withheldNote(result)]] : []),
  ]);
  if (report.description) pdf.paragraph(report.description);
  if (result.groups) {
    pdf.heading(`By ${result.groupBy.label}`, { level: 2 });
    const aggregateColumns = result.aggregates.filter((item) => item.fn !== "count");
    pdf.table({
      columns: [
        { key: "label", label: result.groupBy.label, width: 0.4 },
        { key: (row) => String(row.count), label: "Count", width: 0.15, align: "right" },
        ...aggregateColumns.map((item) => ({ key: (row) => formatCell({ type: sources.columnByKey(sources.getSource(result.source.key), item.field)?.type || "number" }, row[item.key]), label: item.label, width: 0.45 / Math.max(1, aggregateColumns.length), align: "right" })),
      ],
      rows: [...result.groups, { label: "Total", ...result.totals }],
      size: 8.5,
    });
  }
  pdf.heading("Rows", { level: 2 });
  const rows = result.rows.slice(0, PDF_ROW_LIMIT);
  if (!rows.length) pdf.paragraph("No rows match.", { color: "0.4 0.4 0.4" });
  else {
    const showProject = !project;
    const widthFor = (column) => (column.type === "string" ? 2 : column.type === "date" ? 1 : column.type === "boolean" ? 0.7 : 1.1);
    const columns = [...(showProject ? [{ key: "projectName", label: "Project", width: 1.4 }] : []), ...result.columns.map((column) => ({ key: (row) => formatCell(column, row[column.key]), label: column.label, width: widthFor(column), align: column.type === "money" || column.type === "number" ? "right" : "left" }))];
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    pdf.table({ columns: columns.map((column) => ({ ...column, width: column.width / totalWidth })), rows, size: landscape ? 7.5 : 8 });
    if (result.rows.length > PDF_ROW_LIMIT) pdf.paragraph(`Showing the first ${PDF_ROW_LIMIT} of ${result.total} rows; use the XLSX export for the full set.`, { color: "0.4 0.4 0.4" });
  }
  return pdf.render();
};

const fileBase = (report) => `${String(report.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "report"}-${new Date().toISOString().slice(0, 10)}`;

// ─── definitions ───────────────────────────────────────────────────────────

const serializeDefinition = (row, user = null) => ({
  id: row.id,
  projectId: row.projectId || null,
  project: row.project ? { id: row.project.id, name: row.project.name } : null,
  name: row.name,
  description: row.description || null,
  source: row.source,
  sourceLabel: sources.getSource(row.source)?.label || row.source,
  columns: Array.isArray(row.columnsJson) ? row.columnsJson : [],
  filters: Array.isArray(row.filtersJson) ? row.filtersJson : [],
  sort: row.sortJson || null,
  groupBy: row.groupBy || null,
  aggregates: Array.isArray(row.aggregatesJson) ? row.aggregatesJson : [],
  chart: row.chartJson || null,
  visibility: row.visibility,
  createdBy: row.createdBy || null,
  isOwner: Boolean(user && row.createdBy === user.id),
  scheduleCount: row._count?.schedules ?? row.schedules?.length ?? 0,
  lastRunAt: toIso(row.lastRunAt),
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const listSources = async ({ orgId = null } = {}) => Promise.all(sources.SOURCE_KEYS.map(async (key) => sources.describeSource(await resolveSource({ orgId, key }))));

const visibleDefinitionsWhere = async ({ orgId, user, projectId = null }) => {
  const projects = await accessibleProjects({ orgId, user });
  const ids = projects.map((project) => project.id);
  return {
    orgId,
    ...(projectId ? { projectId } : {}),
    OR: [{ createdBy: user.id }, { visibility: "org" }, { visibility: "project", projectId: { in: ids } }],
  };
};

const listDefinitions = async ({ orgId, user, projectId = null, source = null }) => {
  const where = await visibleDefinitionsWhere({ orgId, user, projectId });
  if (source) where.source = source;
  const rows = await prisma.reportDefinition.findMany({ where, include: { project: { select: { id: true, name: true } }, _count: { select: { schedules: true } } }, orderBy: [{ updatedAt: "desc" }] });
  // listSources is async: without the await this serialised an unresolved
  // Promise as `{}`, and the report builder crashed calling .find() on it.
  return { items: rows.map((row) => serializeDefinition(row, user)), sources: await listSources({ orgId }) };
};

const getDefinitionRow = async ({ orgId, user, reportId }) => {
  const where = await visibleDefinitionsWhere({ orgId, user });
  const row = await prisma.reportDefinition.findFirst({ where: { ...where, id: reportId }, include: { project: { select: { id: true, name: true } }, _count: { select: { schedules: true } } } });
  if (!row) throw new HttpError(404, "REPORT_NOT_FOUND", "Report not found");
  return row;
};

const getDefinition = async ({ orgId, user, reportId }) => serializeDefinition(await getDefinitionRow({ orgId, user, reportId }), user);

const canManage = ({ user, row }) => row.createdBy === user.id || user.isCompanyAdmin || normalizeRoleId(user.role) === "pm";

const assertManage = ({ user, row }) => {
  if (!canManage({ user, row })) throw new HttpError(403, "REPORT_FORBIDDEN", "Only the report's owner or a project manager can change it");
};

const createDefinition = async ({ orgId, user, payload = {} }) => {
  const name = trimOrNull(payload.name);
  if (!name) throw new HttpError(400, "REPORT_NAME_REQUIRED", "Give the report a name");
  const normalized = await normalizeDefinition({ orgId, payload });
  const projectId = trimOrNull(payload.projectId);
  if (projectId) {
    const projects = await accessibleProjects({ orgId, user, projectId });
    if (!projects.length) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  const row = await prisma.reportDefinition.create({
    data: {
      orgId,
      projectId,
      name,
      description: trimOrNull(payload.description),
      source: normalized.source,
      columnsJson: normalized.columns,
      filtersJson: normalized.filters,
      sortJson: normalized.sort,
      groupBy: normalized.groupBy,
      aggregatesJson: normalized.aggregates,
      chartJson: normalized.chart,
      visibility: normalized.visibility,
      createdBy: user.id,
    },
    include: { project: { select: { id: true, name: true } } },
  });
  await auditService.recordEvent({ orgId, projectId: projectId || null, entityType: auditService.ENTITY_TYPES.REPORT || "report", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: user.id, summary: { name, source: normalized.source, visibility: normalized.visibility } }).catch(() => null);
  return serializeDefinition(row, user);
};

const updateDefinition = async ({ orgId, user, reportId, payload = {} }) => {
  const existing = await getDefinitionRow({ orgId, user, reportId });
  assertManage({ user, row: existing });
  const normalized = await normalizeDefinition({ orgId, payload, existing });
  const data = {
    source: normalized.source,
    columnsJson: normalized.columns,
    filtersJson: normalized.filters,
    sortJson: normalized.sort,
    groupBy: normalized.groupBy,
    aggregatesJson: normalized.aggregates,
    chartJson: normalized.chart,
    visibility: normalized.visibility,
    updatedBy: user.id,
  };
  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "REPORT_NAME_REQUIRED", "Give the report a name");
    data.name = name;
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description);
  if (payload.projectId !== undefined) {
    const projectId = trimOrNull(payload.projectId);
    if (projectId) {
      const projects = await accessibleProjects({ orgId, user, projectId });
      if (!projects.length) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    data.projectId = projectId;
  }
  const row = await prisma.reportDefinition.update({ where: { id: existing.id }, data, include: { project: { select: { id: true, name: true } }, _count: { select: { schedules: true } } } });
  await auditService.recordEvent({ orgId, projectId: row.projectId || null, entityType: auditService.ENTITY_TYPES.REPORT || "report", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: user.id, summary: { name: row.name, fields: Object.keys(payload) } }).catch(() => null);
  return serializeDefinition(row, user);
};

const deleteDefinition = async ({ orgId, user, reportId }) => {
  const existing = await getDefinitionRow({ orgId, user, reportId });
  assertManage({ user, row: existing });
  await prisma.reportDefinition.delete({ where: { id: existing.id } });
  await auditService.recordEvent({ orgId, projectId: existing.projectId || null, entityType: auditService.ENTITY_TYPES.REPORT || "report", entityId: existing.id, action: auditService.ACTIONS.DELETED, actorId: user.id, summary: { name: existing.name } }).catch(() => null);
  return { deleted: true };
};

/** Ad-hoc run of an unsaved definition (the builder's preview). */
const preview = async ({ orgId, user, payload = {}, limit = PREVIEW_LIMIT, offset = 0, apiClient = null }) => {
  const normalized = await normalizeDefinition({ orgId, payload });
  const projectId = trimOrNull(payload.projectId);
  return runQuery({ orgId, user, definition: { ...normalized, projectId }, limit: Math.min(MAX_LIMIT, limit), offset, apiClient });
};

const runDefinition = async ({ orgId, user, reportId, limit = PREVIEW_LIMIT, offset = 0, apiClient = null }) => {
  const row = await getDefinitionRow({ orgId, user, reportId });
  const result = await runQuery({ orgId, user, apiClient, definition: { source: row.source, columns: row.columnsJson, filters: row.filtersJson, sort: row.sortJson, groupBy: row.groupBy, aggregates: row.aggregatesJson, projectId: row.projectId }, limit: Math.min(MAX_LIMIT, limit), offset });
  await prisma.reportDefinition.update({ where: { id: row.id }, data: { lastRunAt: new Date() } }).catch(() => null);
  return { report: serializeDefinition(row, user), ...result };
};

const renderDefinition = async ({ orgId, user, reportId = null, definition = null, format = "pdf", apiClient = null }) => {
  const row = reportId ? await getDefinitionRow({ orgId, user, reportId }) : null;
  const report = row
    ? { id: row.id, name: row.name, description: row.description, source: row.source, columns: row.columnsJson, filters: row.filtersJson, sort: row.sortJson, groupBy: row.groupBy, aggregates: row.aggregatesJson, projectId: row.projectId }
    : { id: null, name: trimOrNull(definition?.name) || "Report", description: trimOrNull(definition?.description), ...(await normalizeDefinition({ orgId, payload: definition || {} })), projectId: trimOrNull(definition?.projectId) };
  const result = await runQuery({ orgId, user, definition: report, limit: EXPORT_LIMIT, apiClient });
  const project = report.projectId ? await prisma.project.findFirst({ where: { id: report.projectId, orgId }, select: { id: true, name: true, currency: true } }) : null;
  const base = fileBase(report);
  if (format === "xlsx") return { buffer: await renderXlsx({ report, result, user, project }), fileName: `${base}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", result };
  return { buffer: renderPdf({ report, result, user, project }), fileName: `${base}.pdf`, mimeType: "application/pdf", result };
};

// ─── schedules ─────────────────────────────────────────────────────────────

const isValidTimezone = (value) => {
  try {
    Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const partsIn = (date, timezone) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) };
};

/** UTC instant for a wall-clock time in a zone (two-pass offset correction). */
const zonedToUtc = ({ year, month, day, hour, minute, timezone }) => {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const local = partsIn(new Date(guess), timezone);
    const shown = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const diff = shown - target;
    if (!diff) break;
    guess -= diff;
  }
  return new Date(guess);
};

const computeNextRun = ({ frequency, dayOfWeek = 1, dayOfMonth = 1, hour = 7, minute = 0, timezone = "UTC", from = new Date() }) => {
  const tz = isValidTimezone(timezone) ? timezone : "UTC";
  const start = partsIn(from, tz);
  for (let offset = 0; offset < 62; offset += 1) {
    const candidate = new Date(Date.UTC(start.year, start.month - 1, start.day + offset, 12));
    const local = partsIn(candidate, tz);
    const daysInMonth = new Date(Date.UTC(local.year, local.month, 0)).getUTCDate();
    const matches = frequency === "daily" || (frequency === "weekly" && local.weekday === dayOfWeek) || (frequency === "monthly" && local.day === Math.min(dayOfMonth, daysInMonth));
    if (!matches) continue;
    const instant = zonedToUtc({ year: local.year, month: local.month, day: local.day, hour, minute, timezone: tz });
    if (instant.getTime() > from.getTime()) return instant;
  }
  return null;
};

const normalizeRecipients = (value = {}) => {
  const list = (items) => (Array.isArray(items) ? items.map((item) => String(item).trim()).filter(Boolean) : []);
  const emails = list(value.emails).map((email) => email.toLowerCase());
  const invalid = emails.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalid.length) throw new HttpError(400, "REPORT_RECIPIENT_EMAIL", `Invalid email: ${invalid.join(", ")}`);
  return { userIds: [...new Set(list(value.userIds))], roles: [...new Set(list(value.roles).map(normalizeRoleId))], emails: [...new Set(emails)] };
};

const serializeSchedule = (row) => ({
  id: row.id,
  reportId: row.reportId,
  frequency: row.frequency,
  dayOfWeek: row.dayOfWeek,
  dayOfMonth: row.dayOfMonth,
  hour: row.hour,
  minute: row.minute,
  timezone: row.timezone,
  format: row.format,
  recipients: row.recipientsJson || { userIds: [], roles: [], emails: [] },
  enabled: row.enabled,
  nextRunAt: toIso(row.nextRunAt),
  lastRunAt: toIso(row.lastRunAt),
  lastStatus: row.lastStatus || null,
  lastError: row.lastError || null,
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const listSchedules = async ({ orgId, user, reportId }) => {
  const row = await getDefinitionRow({ orgId, user, reportId });
  const schedules = await prisma.reportSchedule.findMany({ where: { reportId: row.id }, orderBy: { createdAt: "asc" } });
  return schedules.map(serializeSchedule);
};

const scheduleData = (payload, existing = null) => {
  const frequency = payload.frequency !== undefined ? String(payload.frequency) : existing?.frequency || "weekly";
  if (!FREQUENCIES.includes(frequency)) throw new HttpError(400, "REPORT_SCHEDULE_FREQUENCY", "Frequency must be daily, weekly or monthly");
  const format = payload.format !== undefined ? String(payload.format) : existing?.format || "pdf";
  if (!FORMATS.includes(format)) throw new HttpError(400, "REPORT_SCHEDULE_FORMAT", "Format must be pdf, xlsx or both");
  const timezone = payload.timezone !== undefined ? trimOrNull(payload.timezone) || "UTC" : existing?.timezone || "UTC";
  if (!isValidTimezone(timezone)) throw new HttpError(400, "REPORT_SCHEDULE_TIMEZONE", "Time zone must be an IANA name");
  const int = (value, fallback, min, max, code) => {
    if (value === undefined) return fallback;
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < min || numeric > max) throw new HttpError(400, code, `Value must be between ${min} and ${max}`);
    return numeric;
  };
  return {
    frequency,
    format,
    timezone,
    dayOfWeek: int(payload.dayOfWeek, existing?.dayOfWeek ?? 1, 0, 6, "REPORT_SCHEDULE_DAY"),
    dayOfMonth: int(payload.dayOfMonth, existing?.dayOfMonth ?? 1, 1, 31, "REPORT_SCHEDULE_DAY"),
    hour: int(payload.hour, existing?.hour ?? 7, 0, 23, "REPORT_SCHEDULE_TIME"),
    minute: int(payload.minute, existing?.minute ?? 0, 0, 59, "REPORT_SCHEDULE_TIME"),
    recipientsJson: payload.recipients !== undefined ? normalizeRecipients(payload.recipients) : existing?.recipientsJson || { userIds: [], roles: [], emails: [] },
    enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : existing?.enabled ?? true,
  };
};

const createSchedule = async ({ orgId, user, reportId, payload = {} }) => {
  const report = await getDefinitionRow({ orgId, user, reportId });
  const data = scheduleData(payload);
  const recipients = data.recipientsJson;
  if (!recipients.userIds.length && !recipients.roles.length && !recipients.emails.length) recipients.userIds = [user.id];
  const row = await prisma.reportSchedule.create({ data: { orgId, reportId: report.id, ...data, nextRunAt: data.enabled ? computeNextRun({ ...data, from: new Date() }) : null, createdBy: user.id } });
  return serializeSchedule(row);
};

const updateSchedule = async ({ orgId, user, reportId, scheduleId, payload = {} }) => {
  const report = await getDefinitionRow({ orgId, user, reportId });
  const existing = await prisma.reportSchedule.findFirst({ where: { id: scheduleId, reportId: report.id } });
  if (!existing) throw new HttpError(404, "REPORT_SCHEDULE_NOT_FOUND", "Schedule not found");
  if (existing.createdBy !== user.id && !canManage({ user, row: report })) throw new HttpError(403, "REPORT_FORBIDDEN", "Only the schedule's owner or a project manager can change it");
  const data = scheduleData(payload, existing);
  const row = await prisma.reportSchedule.update({ where: { id: existing.id }, data: { ...data, nextRunAt: data.enabled ? computeNextRun({ ...data, from: new Date() }) : null } });
  return serializeSchedule(row);
};

const deleteSchedule = async ({ orgId, user, reportId, scheduleId }) => {
  const report = await getDefinitionRow({ orgId, user, reportId });
  const existing = await prisma.reportSchedule.findFirst({ where: { id: scheduleId, reportId: report.id } });
  if (!existing) throw new HttpError(404, "REPORT_SCHEDULE_NOT_FOUND", "Schedule not found");
  if (existing.createdBy !== user.id && !canManage({ user, row: report })) throw new HttpError(403, "REPORT_FORBIDDEN", "Only the schedule's owner or a project manager can remove it");
  await prisma.reportSchedule.delete({ where: { id: existing.id } });
  return { deleted: true };
};

// ─── runs ──────────────────────────────────────────────────────────────────

const serializeRun = (row) => ({
  id: row.id,
  reportId: row.reportId,
  scheduleId: row.scheduleId || null,
  status: row.status,
  trigger: row.trigger,
  format: row.format,
  rowCount: row.rowCount,
  truncated: row.truncated,
  hasPdf: Boolean(row.pdfBytes?.length || row.hasPdf),
  hasXlsx: Boolean(row.xlsxBytes?.length || row.hasXlsx),
  fileBase: row.fileBase || null,
  recipients: row.recipientsJson || null,
  delivery: row.deliveryJson || null,
  error: row.error || null,
  requestedBy: row.requestedBy || null,
  startedAt: toIso(row.startedAt),
  finishedAt: toIso(row.finishedAt),
  createdAt: toIso(row.createdAt),
});

const RUN_SELECT = { id: true, reportId: true, scheduleId: true, status: true, trigger: true, format: true, rowCount: true, truncated: true, fileBase: true, recipientsJson: true, deliveryJson: true, error: true, requestedBy: true, startedAt: true, finishedAt: true, createdAt: true };

const listRuns = async ({ orgId, user, reportId, limit = 20 }) => {
  const report = await getDefinitionRow({ orgId, user, reportId });
  // Bytes stay out of the list; a second narrow query just flags which files exist.
  const rows = await prisma.reportRun.findMany({ where: { reportId: report.id }, select: RUN_SELECT, orderBy: { createdAt: "desc" }, take: Math.min(100, limit) });
  const flags = await prisma.reportRun.findMany({ where: { id: { in: rows.map((row) => row.id) } }, select: { id: true, pdfBytes: true, xlsxBytes: true } });
  const flagById = new Map(flags.map((row) => [row.id, { hasPdf: Boolean(row.pdfBytes?.length), hasXlsx: Boolean(row.xlsxBytes?.length) }]));
  return rows.map((row) => serializeRun({ ...row, ...(flagById.get(row.id) || {}) }));
};

const loadUserForRun = async ({ orgId, userId }) => {
  if (!userId) return null;
  const user = await prisma.user.findFirst({ where: { id: userId, orgId, status: "active" }, select: { id: true, name: true, email: true, role: true, isCompanyAdmin: true } });
  return user;
};

const deliverRun = async ({ orgId, report, run, recipients, user }) => {
  const summary = `${run.rowCount} row${run.rowCount === 1 ? "" : "s"}${run.truncated ? " (truncated)" : ""}`;
  const actionUrl = `/reports?reportId=${report.id}&runId=${run.id}`;
  let notified = 0;
  if (recipients.userIds.length || recipients.roles.length) {
    const result = await notificationService
      .createNotifications({
        orgId,
        projectId: report.projectId || null,
        actorId: null,
        recipientUserIds: recipients.userIds,
        recipientRoles: recipients.roles,
        category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
        event: "report.delivered",
        title: `Report ready: ${report.name}`,
        message: `${report.name} — ${summary}. Open OctaPM to download the ${run.format === "both" ? "PDF and XLSX" : run.format.toUpperCase()}.`,
        actionUrl,
        entityType: "report",
        entityId: report.id,
        dedupeKeyBase: `report.delivered:${run.id}`,
        metadata: { runId: run.id, format: run.format },
      })
      .catch(() => null);
    notified = result?.created || 0;
  }
  const sent = [];
  const failed = [];
  if (recipients.emails.length) {
    const { sendEmail } = require("./email.service");
    for (const email of recipients.emails) {
      try {
        await sendEmail({
          to: email,
          subject: `Report: ${report.name}`,
          body: `${report.name} — ${summary}.\n\nSign in to OctaPM to download it${process.env.WEB_APP_URL ? `: ${process.env.WEB_APP_URL}${actionUrl}` : "."}\n\nSent by ${user?.name || "a scheduled report"}.`,
          metadata: { event: "report.delivered", reportId: report.id, runId: run.id },
        });
        sent.push(email);
      } catch (error) {
        failed.push({ email, error: error?.code || error?.message || "EMAIL_DELIVERY_FAILED" });
      }
    }
  }
  return { notified, emails: sent, failedEmails: failed, at: new Date().toISOString() };
};

const pruneRuns = async ({ reportId }) => {
  const stale = await prisma.reportRun.findMany({ where: { reportId }, select: { id: true }, orderBy: { createdAt: "desc" }, skip: RUN_HISTORY_KEEP });
  if (stale.length) await prisma.reportRun.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
};

/**
 * Renders a run: evaluates the report as the run's requester (or the
 * schedule's owner), stores the files on the run, delivers and prunes history.
 */
const executeRun = async ({ runId, now = new Date() }) => {
  const run = await prisma.reportRun.findUnique({ where: { id: runId }, include: { report: true, schedule: true } });
  if (!run) throw new HttpError(404, "REPORT_RUN_NOT_FOUND", "Run not found");
  await prisma.reportRun.update({ where: { id: run.id }, data: { status: "running", startedAt: now, error: null } });
  try {
    const user = await loadUserForRun({ orgId: run.orgId, userId: run.requestedBy || run.schedule?.createdBy || run.report.createdBy });
    if (!user) throw new HttpError(409, "REPORT_RUN_NO_OWNER", "The report's owner is no longer active; re-create the schedule as an active user");
    const report = { id: run.report.id, name: run.report.name, description: run.report.description, source: run.report.source, columns: run.report.columnsJson, filters: run.report.filtersJson, sort: run.report.sortJson, groupBy: run.report.groupBy, aggregates: run.report.aggregatesJson, projectId: run.report.projectId };
    const result = await runQuery({ orgId: run.orgId, user, definition: report, limit: EXPORT_LIMIT });
    const project = report.projectId ? await prisma.project.findFirst({ where: { id: report.projectId }, select: { id: true, name: true, currency: true } }) : null;
    const wantPdf = run.format === "pdf" || run.format === "both";
    const wantXlsx = run.format === "xlsx" || run.format === "both";
    const pdfBytes = wantPdf ? renderPdf({ report, result, user, project }) : null;
    const xlsxBytes = wantXlsx ? await renderXlsx({ report, result, user, project }) : null;
    const recipients = normalizeRecipients(run.recipientsJson || run.schedule?.recipientsJson || {});
    const delivery = recipients.userIds.length || recipients.roles.length || recipients.emails.length ? await deliverRun({ orgId: run.orgId, report, run: { ...run, rowCount: result.total, truncated: result.truncated }, recipients, user }) : null;
    const finished = await prisma.reportRun.update({
      where: { id: run.id },
      data: { status: "succeeded", rowCount: result.total, truncated: result.truncated, pdfBytes, xlsxBytes, fileBase: fileBase(report), recipientsJson: recipients, deliveryJson: delivery, finishedAt: new Date() },
      select: RUN_SELECT,
    });
    await prisma.reportDefinition.update({ where: { id: run.reportId }, data: { lastRunAt: new Date() } }).catch(() => null);
    if (run.scheduleId) {
      await prisma.reportSchedule.update({ where: { id: run.scheduleId }, data: { lastRunAt: new Date(), lastStatus: "succeeded", lastError: null } }).catch(() => null);
    }
    await pruneRuns({ reportId: run.reportId }).catch(() => null);
    return serializeRun({ ...finished, hasPdf: Boolean(pdfBytes), hasXlsx: Boolean(xlsxBytes) });
  } catch (error) {
    const message = error?.message || "Report run failed";
    await prisma.reportRun.update({ where: { id: run.id }, data: { status: "failed", error: `${error?.code ? `${error.code}: ` : ""}${message}`, finishedAt: new Date() } }).catch(() => null);
    if (run.scheduleId) await prisma.reportSchedule.update({ where: { id: run.scheduleId }, data: { lastRunAt: new Date(), lastStatus: "failed", lastError: message } }).catch(() => null);
    throw error;
  }
};

const createRun = async ({ orgId, user, reportId, format = "pdf", recipients = null, deliver = false }) => {
  const report = await getDefinitionRow({ orgId, user, reportId });
  if (!FORMATS.includes(format)) throw new HttpError(400, "REPORT_SCHEDULE_FORMAT", "Format must be pdf, xlsx or both");
  const normalizedRecipients = deliver ? normalizeRecipients(recipients || { userIds: [user.id] }) : { userIds: [], roles: [], emails: [] };
  const run = await prisma.reportRun.create({ data: { orgId, reportId: report.id, status: "queued", trigger: "manual", format, recipientsJson: normalizedRecipients, requestedBy: user.id } });
  return executeRun({ runId: run.id });
};

const getRunFile = async ({ orgId, user, runId, format }) => {
  const run = await prisma.reportRun.findFirst({ where: { id: runId, orgId }, include: { report: true } });
  if (!run) throw new HttpError(404, "REPORT_RUN_NOT_FOUND", "Run not found");
  // A company admin takes any run's file (CX21-458); everyone else must be
  // able to see the report at all.
  if (!user.isCompanyAdmin) await getDefinitionRow({ orgId, user, reportId: run.reportId });
  // The file holds what its requester could see, not what this reader can:
  // it is the requester's (a scheduled run: the report's owner's) to
  // download, and a company admin's (Phase 21D, CX21-442).
  const owner = run.requestedBy || run.report?.createdBy || null;
  if (!user.isCompanyAdmin && owner !== user.id) {
    throw new HttpError(403, "REPORT_RUN_NOT_YOURS", "A stored report file can be downloaded only by whoever requested it");
  }
  const bytes = format === "xlsx" ? run.xlsxBytes : run.pdfBytes;
  if (!bytes || !bytes.length) throw new HttpError(404, "REPORT_RUN_FILE_MISSING", `This run has no ${format.toUpperCase()} file`);
  return { buffer: Buffer.from(bytes), fileName: `${run.fileBase || "report"}.${format}`, mimeType: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf" };
};

/** Scheduler hook: queue every enabled schedule whose time has come. */
const queueDueSchedules = async ({ now = new Date(), enqueue }) => {
  const due = await prisma.reportSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, include: { report: { select: { id: true, orgId: true, projectId: true } } }, take: 200 });
  const queued = [];
  for (const schedule of due) {
    const next = computeNextRun({ ...schedule, from: now });
    // Advance only from the value this tick read: if another process already
    // moved nextRunAt on (a second scheduler during a deploy), it owns this run.
    const claimed = await prisma.reportSchedule.updateMany({ where: { id: schedule.id, nextRunAt: schedule.nextRunAt }, data: { nextRunAt: next } });
    if (claimed.count !== 1) continue;
    const run = await prisma.reportRun.create({ data: { orgId: schedule.orgId, reportId: schedule.reportId, scheduleId: schedule.id, status: "queued", trigger: "schedule", format: schedule.format, recipientsJson: schedule.recipientsJson, requestedBy: schedule.createdBy } });
    await enqueue({ orgId: schedule.orgId, projectId: schedule.report.projectId || null, payload: { runId: run.id, reportId: schedule.reportId, scheduleId: schedule.id } });
    queued.push({ scheduleId: schedule.id, runId: run.id, nextRunAt: toIso(next) });
  }
  return { due: due.length, queued };
};

const runReportRenderJob = async ({ payload }) => {
  if (!payload?.runId) throw new HttpError(400, "REPORT_RUN_REQUIRED", "runId is required");
  const run = await executeRun({ runId: payload.runId });
  return { runId: run.id, status: run.status, rowCount: run.rowCount };
};

module.exports = {
  AGGREGATE_FNS,
  EXPORT_LIMIT,
  FORMATS,
  FREQUENCIES,
  OPERATORS,
  PREVIEW_LIMIT,
  VISIBILITIES,
  canReadModule,
  computeNextRun,
  createDefinition,
  createRun,
  createSchedule,
  deleteDefinition,
  deleteSchedule,
  executeRun,
  getDefinition,
  getRunFile,
  listDefinitions,
  listRuns,
  listSchedules,
  listSources,
  normalizeDefinition,
  preview,
  queueDueSchedules,
  renderDefinition,
  renderPdf,
  renderXlsx,
  runDefinition,
  runQuery,
  runReportRenderJob,
  updateDefinition,
  updateSchedule,
  zonedToUtc,
};
