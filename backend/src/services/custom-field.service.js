const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const membershipService = require("./membership.service");

/**
 * Custom fields, fieldsets and record types (OCTA-PLAT-FIELDS-025).
 *
 * A field definition belongs to the company (shown on every project) or to
 * one project, on one record type. Values live in `CustomFieldValue`, one
 * row per record and field, validated against the definition on write. A
 * fieldset picks which fields a project (or a record type such as a "Site
 * Instruction" correspondence) shows and which are required.
 */

// `model`: the Prisma model that holds the record type's rows, each with its
// project — a value is read and written only for a record of the project it
// is asked on (recordsOnProject below; certification L45).
const RECORD_TYPES = Object.freeze({
  rfi: { label: "RFIs", module: "rfi", model: "rfi" },
  submittal: { label: "Submittals", module: "submittal", model: "submittal" },
  punch_item: { label: "Punch items & observations", module: "punch", model: "punchItem" },
  form_instance: { label: "Inspections & forms", module: "inspection", model: "formInstance" },
  ncr: { label: "NCRs", module: "ncr", model: "ncrRecord" },
  material_test: { label: "Material tests", module: "ncr", model: "materialTest" },
  safety_incident: { label: "Safety incidents", module: "safety", model: "safetyIncident" },
  drawing: { label: "Drawings", module: "document_control", model: "drawingRecord" },
  transmittal: { label: "Transmittals", module: "document_control", model: "transmittal" },
  correspondence: { label: "Correspondence", module: "document_control", recordTypes: true, model: "correspondence" },
  change_order: { label: "Change orders", module: "change_order", model: "changeOrder" },
  commitment: { label: "Commitments", module: "commitment", model: "commitment" },
  sub_pay_app: { label: "Pay applications", module: "sub_pay_app", model: "subPayApp" },
  ipc_certificate: { label: "Payment certificates", module: "ipc", model: "ipcCertificate" },
  task: { label: "Tasks", module: "task", model: "task" },
  risk: { label: "Risks", module: "risk", model: "risk" },
  procurement_order: { label: "Purchase orders", module: "procurement", model: "procurementOrder" },
  meeting: { label: "Meetings", module: "meeting", model: "meeting" },
  daily_log: { label: "Daily logs", module: "progress", model: "dailyLog" },
  activity: { label: "Activities", module: "schedule", model: "activity" },
});
const RECORD_TYPE_KEYS = Object.freeze(Object.keys(RECORD_TYPES));
const TOOLS_WITH_RECORD_TYPES = Object.freeze(RECORD_TYPE_KEYS.filter((key) => RECORD_TYPES[key].recordTypes));

const FIELD_TYPES = Object.freeze(["text", "textarea", "number", "money", "date", "boolean", "select", "multi_select", "user", "company", "url"]);
const REPORT_TYPES = Object.freeze({ text: "string", textarea: "string", url: "string", number: "number", money: "money", date: "date", boolean: "boolean", select: "enum", multi_select: "string", user: "string", company: "string" });
const CONTEXT_TYPES = Object.freeze({ text: "string", textarea: "string", url: "string", number: "number", money: "number", date: "string", boolean: "boolean", select: "string", multi_select: "string", user: "string", company: "string" });
const CONDITION_OPS = Object.freeze(["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "contains", "is_true", "is_false", "empty", "not_empty"]);
const MAX_FIELDS_PER_TYPE = 60;
const MAX_OPTIONS = 100;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
const tablesReady = () => Boolean(prisma.customFieldDefinition?.findMany);

const getRecordType = (recordType) => {
  const meta = RECORD_TYPES[recordType];
  if (!meta) throw new HttpError(400, "CUSTOM_FIELD_RECORD_TYPE_UNKNOWN", `Unknown record type: ${recordType}`);
  return { key: recordType, ...meta };
};

// ─── definitions ───────────────────────────────────────────────────────────

const normalizeOptions = (type, options, label) => {
  if (type !== "select" && type !== "multi_select") return null;
  const list = Array.isArray(options) ? options : [];
  const seen = new Set();
  const normalized = [];
  for (const entry of list) {
    const value = trimOrNull(isPlainObject(entry) ? (entry.value ?? entry.label) : entry);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push({ value, label: trimOrNull(isPlainObject(entry) ? entry.label : null) || value });
  }
  if (!normalized.length) throw new HttpError(400, "CUSTOM_FIELD_OPTIONS", `${label}: add at least one option`);
  if (normalized.length > MAX_OPTIONS) throw new HttpError(400, "CUSTOM_FIELD_OPTIONS", `${label}: at most ${MAX_OPTIONS} options`);
  return normalized;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeValidation = (type, validation, label) => {
  if (!isPlainObject(validation)) return null;
  const out = {};
  if (type === "number" || type === "money") {
    const min = numberOrNull(validation.min);
    const max = numberOrNull(validation.max);
    if (min !== null) out.min = min;
    if (max !== null) out.max = max;
    if (min !== null && max !== null && min > max) throw new HttpError(400, "CUSTOM_FIELD_VALIDATION", `${label}: min is above max`);
  } else if (type === "date") {
    if (trimOrNull(validation.min)) out.min = String(validation.min).slice(0, 10);
    if (trimOrNull(validation.max)) out.max = String(validation.max).slice(0, 10);
  } else if (type === "text" || type === "textarea" || type === "url") {
    const minLength = numberOrNull(validation.minLength);
    const maxLength = numberOrNull(validation.maxLength);
    if (minLength !== null) out.minLength = Math.max(0, Math.round(minLength));
    if (maxLength !== null) out.maxLength = Math.max(1, Math.round(maxLength));
    const pattern = trimOrNull(validation.pattern);
    if (pattern) {
      try {
        new RegExp(pattern);
      } catch {
        throw new HttpError(400, "CUSTOM_FIELD_VALIDATION", `${label}: the pattern is not a valid regular expression`);
      }
      out.pattern = pattern;
    }
  }
  return Object.keys(out).length ? out : null;
};

const normalizeCondition = (condition, label) => {
  if (condition === null || condition === undefined || condition === "") return null;
  if (!isPlainObject(condition)) throw new HttpError(400, "CUSTOM_FIELD_CONDITION", `${label}: condition must be an object`);
  const field = trimOrNull(condition.field);
  const op = trimOrNull(condition.op) || "eq";
  if (!field) throw new HttpError(400, "CUSTOM_FIELD_CONDITION", `${label}: condition needs a field`);
  if (!CONDITION_OPS.includes(op)) throw new HttpError(400, "CUSTOM_FIELD_CONDITION", `${label}: unknown operator ${op}`);
  return { field, op, value: condition.value === undefined ? null : condition.value };
};

const evaluateCondition = (context, { field, op, value }) => {
  const actual = context?.[field];
  const lower = (item) => String(item ?? "").toLowerCase();
  switch (op) {
    case "eq":
      return typeof actual === "number" ? actual === Number(value) : lower(actual) === lower(value);
    case "neq":
      return !evaluateCondition(context, { field, op: "eq", value });
    case "gt":
      return Number(actual) > Number(value);
    case "gte":
      return Number(actual) >= Number(value);
    case "lt":
      return Number(actual) < Number(value);
    case "lte":
      return Number(actual) <= Number(value);
    case "in":
      return (Array.isArray(value) ? value : String(value ?? "").split(",")).map(lower).includes(lower(actual));
    case "nin":
      return !evaluateCondition(context, { field, op: "in", value });
    case "contains":
      return lower(actual).includes(lower(value));
    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false || actual === null || actual === undefined;
    case "empty":
      return actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && !actual.length);
    case "not_empty":
      return !evaluateCondition(context, { field, op: "empty", value });
    default:
      return false;
  }
};

/** Coerces one value to the field's type; throws a 400 naming the field. */
const coerceValue = (field, raw) => {
  const bad = (message) => new HttpError(400, "CUSTOM_FIELD_VALUE", `${field.label}: ${message}`);
  const rules = field.validation || {};
  if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && !raw.length)) return null;
  switch (field.type) {
    case "text":
    case "textarea":
    case "url": {
      const text = String(raw).trim();
      if (!text) return null;
      if (rules.minLength && text.length < rules.minLength) throw bad(`needs at least ${rules.minLength} characters`);
      if (rules.maxLength && text.length > rules.maxLength) throw bad(`at most ${rules.maxLength} characters`);
      if (rules.pattern && !new RegExp(rules.pattern).test(text)) throw bad("does not match the expected format");
      if (field.type === "url") {
        try {
          const url = new URL(text);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error("scheme");
        } catch {
          throw bad("needs a full http(s) address");
        }
      }
      return text;
    }
    case "number":
    case "money": {
      const numeric = Number(typeof raw === "string" ? raw.replace(/,/g, "") : raw);
      if (!Number.isFinite(numeric)) throw bad("needs a number");
      if (rules.min !== undefined && numeric < rules.min) throw bad(`must be at least ${rules.min}`);
      if (rules.max !== undefined && numeric > rules.max) throw bad(`must be at most ${rules.max}`);
      return field.type === "money" ? Math.round(numeric * 100) / 100 : numeric;
    }
    case "date": {
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) throw bad("needs a date");
      const day = date.toISOString().slice(0, 10);
      if (rules.min && day < rules.min) throw bad(`must be on or after ${rules.min}`);
      if (rules.max && day > rules.max) throw bad(`must be on or before ${rules.max}`);
      return day;
    }
    case "boolean":
      if (raw === true || raw === "true" || raw === 1 || raw === "1") return true;
      if (raw === false || raw === "false" || raw === 0 || raw === "0") return false;
      throw bad("needs yes or no");
    case "select": {
      const value = String(raw).trim();
      if (!(field.options || []).some((option) => option.value === value)) throw bad(`"${value}" is not one of the options`);
      return value;
    }
    case "multi_select": {
      const list = (Array.isArray(raw) ? raw : String(raw).split(",")).map((item) => String(item).trim()).filter(Boolean);
      const allowed = new Set((field.options || []).map((option) => option.value));
      const unknown = list.filter((item) => !allowed.has(item));
      if (unknown.length) throw bad(`${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not among the options`);
      return [...new Set(list)];
    }
    case "user":
    case "company": {
      const id = String(raw).trim();
      if (!ID_PATTERN.test(id)) throw bad(`needs a ${field.type} id`);
      return id;
    }
    default:
      throw bad("has an unsupported type");
  }
};

const serializeDefinition = (row) => ({
  id: row.id,
  projectId: row.projectId || null,
  scope: row.projectId ? "project" : "company",
  recordType: row.recordType,
  recordTypeLabel: RECORD_TYPES[row.recordType]?.label || row.recordType,
  key: row.key,
  label: row.label,
  description: row.description || null,
  type: row.type,
  options: Array.isArray(row.optionsJson) ? row.optionsJson : null,
  required: Boolean(row.required),
  hidden: Boolean(row.hidden),
  default: row.defaultJson ?? null,
  validation: isPlainObject(row.validationJson) ? row.validationJson : null,
  condition: isPlainObject(row.conditionJson) ? row.conditionJson : null,
  position: row.position ?? 0,
  status: row.status,
  valueCount: row._count?.values ?? null,
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const normalizeDefinition = (payload = {}, existing = null) => {
  const label = trimOrNull(payload.label) ?? existing?.label;
  if (!label) throw new HttpError(400, "CUSTOM_FIELD_LABEL_REQUIRED", "Give the field a label");
  if (label.length > 120) throw new HttpError(400, "CUSTOM_FIELD_LABEL_REQUIRED", "Keep the label under 120 characters");
  const type = trimOrNull(payload.type) ?? existing?.type;
  if (!FIELD_TYPES.includes(type)) throw new HttpError(400, "CUSTOM_FIELD_TYPE_UNKNOWN", `Field type must be one of ${FIELD_TYPES.join(", ")}`);
  const options = normalizeOptions(type, payload.options !== undefined ? payload.options : existing?.optionsJson, label);
  const validation = normalizeValidation(type, payload.validation !== undefined ? payload.validation : existing?.validationJson, label);
  const condition = payload.condition !== undefined ? normalizeCondition(payload.condition, label) : (existing?.conditionJson ?? null);
  const required = payload.required !== undefined ? Boolean(payload.required) : Boolean(existing?.required);
  const hidden = payload.hidden !== undefined ? Boolean(payload.hidden) : Boolean(existing?.hidden);
  const description = payload.description !== undefined ? trimOrNull(payload.description) : (existing?.description ?? null);
  const position = payload.position !== undefined ? Math.round(Number(payload.position) || 0) : (existing?.position ?? 0);
  let defaultValue = payload.default !== undefined ? payload.default : (existing?.defaultJson ?? null);
  if (defaultValue !== null && defaultValue !== undefined) defaultValue = coerceValue({ label, type, options, validation }, defaultValue);
  return { label, type, options, validation, condition, required, hidden, description, position, defaultValue };
};

const listDefinitions = async ({ orgId, projectId = null, recordType = null, includeArchived = false, scope = "all" }) => {
  if (!tablesReady()) return [];
  if (recordType) getRecordType(recordType);
  const scopes = scope === "company" ? [{ projectId: null }] : scope === "project" && projectId ? [{ projectId }] : projectId ? [{ projectId: null }, { projectId }] : scope === "everywhere" ? [] : [{ projectId: null }];
  const rows = await prisma.customFieldDefinition.findMany({
    where: { orgId, ...(recordType ? { recordType } : {}), ...(includeArchived ? {} : { status: "active" }), ...(scopes.length ? { OR: scopes } : {}) },
    include: { _count: { select: { values: true } } },
    orderBy: [{ recordType: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(serializeDefinition);
};

const createDefinition = async ({ orgId, projectId = null, recordType, payload = {}, actor = null }) => {
  const meta = getRecordType(recordType);
  const normalized = normalizeDefinition(payload);
  const key = slug(trimOrNull(payload.key) || normalized.label);
  if (!key) throw new HttpError(400, "CUSTOM_FIELD_KEY", "The key needs at least one letter or digit");
  const clash = await prisma.customFieldDefinition.findFirst({ where: { orgId, recordType, key }, select: { id: true, status: true } });
  if (clash) throw new HttpError(409, "CUSTOM_FIELD_KEY_EXISTS", `A field with key "${key}" already exists on ${meta.label}${clash.status === "archived" ? " (archived)" : ""}`);
  const active = await prisma.customFieldDefinition.count({ where: { orgId, recordType, status: "active" } });
  if (active >= MAX_FIELDS_PER_TYPE) throw new HttpError(400, "CUSTOM_FIELD_LIMIT", `At most ${MAX_FIELDS_PER_TYPE} fields per record type`);
  const row = await prisma.customFieldDefinition.create({
    data: {
      orgId,
      projectId,
      recordType,
      key,
      label: normalized.label,
      description: normalized.description,
      type: normalized.type,
      optionsJson: normalized.options,
      required: normalized.required,
      hidden: normalized.hidden,
      defaultJson: normalized.defaultValue,
      validationJson: normalized.validation,
      conditionJson: normalized.condition,
      position: normalized.position,
      createdBy: actor?.id || null,
    },
    include: { _count: { select: { values: true } } },
  });
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CUSTOM_FIELD || "custom_field", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { recordType, key, label: row.label, type: row.type, scope: projectId ? "project" : "company" } }).catch(() => null);
  return serializeDefinition(row);
};

const getDefinitionRow = async ({ orgId, projectId = null, definitionId }) => {
  const row = await prisma.customFieldDefinition.findFirst({ where: { id: definitionId, orgId }, include: { _count: { select: { values: true } } } });
  if (!row) throw new HttpError(404, "CUSTOM_FIELD_NOT_FOUND", "Field not found");
  if ((row.projectId || null) !== (projectId || null)) throw new HttpError(403, "CUSTOM_FIELD_SCOPE", row.projectId ? "This field belongs to another project" : "Company fields are managed under Company › Custom fields");
  return row;
};

const updateDefinition = async ({ orgId, projectId = null, definitionId, payload = {}, actor = null }) => {
  const existing = await getDefinitionRow({ orgId, projectId, definitionId });
  const normalized = normalizeDefinition(payload, existing);
  if (normalized.type !== existing.type && existing._count.values > 0) throw new HttpError(409, "CUSTOM_FIELD_IN_USE", "Change the type only while no record holds a value; archive the field and add a new one instead");
  const status = payload.status !== undefined ? (payload.status === "archived" ? "archived" : "active") : existing.status;
  const row = await prisma.customFieldDefinition.update({
    where: { id: existing.id },
    data: {
      label: normalized.label,
      description: normalized.description,
      type: normalized.type,
      optionsJson: normalized.options,
      required: normalized.required,
      hidden: normalized.hidden,
      defaultJson: normalized.defaultValue,
      validationJson: normalized.validation,
      conditionJson: normalized.condition,
      position: normalized.position,
      status,
      archivedAt: status === "archived" ? (existing.archivedAt || new Date()) : null,
      updatedBy: actor?.id || null,
    },
    include: { _count: { select: { values: true } } },
  });
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CUSTOM_FIELD || "custom_field", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { recordType: row.recordType, key: row.key, fields: Object.keys(payload) } }).catch(() => null);
  return serializeDefinition(row);
};

const archiveDefinition = async ({ orgId, projectId = null, definitionId, actor = null }) => updateDefinition({ orgId, projectId, definitionId, payload: { status: "archived" }, actor });

// ─── fieldsets ─────────────────────────────────────────────────────────────

const serializeFieldset = (row) => ({
  id: row.id,
  recordType: row.recordType,
  recordTypeLabel: RECORD_TYPES[row.recordType]?.label || row.recordType,
  name: row.name,
  description: row.description || null,
  isDefault: Boolean(row.isDefault),
  fields: Array.isArray(row.fieldsJson) ? row.fieldsJson : [],
  status: row.status,
  projectCount: row._count?.projectFieldsets ?? null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const normalizeFieldsetFields = async ({ orgId, recordType, fields }) => {
  const list = Array.isArray(fields) ? fields : [];
  const ids = [...new Set(list.map((entry) => trimOrNull(isPlainObject(entry) ? entry.fieldId : entry)).filter(Boolean))];
  if (!ids.length) return [];
  const known = await prisma.customFieldDefinition.findMany({ where: { id: { in: ids }, orgId, recordType }, select: { id: true } });
  const knownIds = new Set(known.map((row) => row.id));
  const missing = ids.filter((id) => !knownIds.has(id));
  if (missing.length) throw new HttpError(400, "CUSTOM_FIELDSET_FIELD", `Unknown field${missing.length === 1 ? "" : "s"} for ${RECORD_TYPES[recordType]?.label || recordType}`);
  const seen = new Set();
  return list
    .map((entry, index) => {
      const fieldId = trimOrNull(isPlainObject(entry) ? entry.fieldId : entry);
      if (!fieldId || seen.has(fieldId)) return null;
      seen.add(fieldId);
      const required = isPlainObject(entry) && entry.required !== undefined && entry.required !== null ? Boolean(entry.required) : null;
      const hidden = isPlainObject(entry) && entry.hidden !== undefined && entry.hidden !== null ? Boolean(entry.hidden) : null;
      return { fieldId, required, hidden, position: index };
    })
    .filter(Boolean);
};

const listFieldsets = async ({ orgId, recordType = null, includeArchived = false }) => {
  if (!tablesReady()) return [];
  const rows = await prisma.customFieldset.findMany({
    where: { orgId, ...(recordType ? { recordType } : {}), ...(includeArchived ? {} : { status: "active" }) },
    include: { _count: { select: { projectFieldsets: true } } },
    orderBy: [{ recordType: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(serializeFieldset);
};

const clearDefault = async ({ tx, orgId, recordType, exceptId = null }) =>
  tx.customFieldset.updateMany({ where: { orgId, recordType, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { isDefault: false } });

const createFieldset = async ({ orgId, payload = {}, actor = null }) => {
  const recordType = payload.recordType;
  getRecordType(recordType);
  const name = trimOrNull(payload.name);
  if (!name) throw new HttpError(400, "CUSTOM_FIELDSET_NAME_REQUIRED", "Give the fieldset a name");
  const fields = await normalizeFieldsetFields({ orgId, recordType, fields: payload.fields });
  const isDefault = Boolean(payload.isDefault);
  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) await clearDefault({ tx, orgId, recordType });
    return tx.customFieldset.create({ data: { orgId, recordType, name, description: trimOrNull(payload.description), isDefault, fieldsJson: fields, createdBy: actor?.id || null } });
  });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.CUSTOM_FIELDSET || "custom_fieldset", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { recordType, name, fields: fields.length, isDefault } }).catch(() => null);
  return serializeFieldset(row);
};

const updateFieldset = async ({ orgId, fieldsetId, payload = {}, actor = null }) => {
  const existing = await prisma.customFieldset.findFirst({ where: { id: fieldsetId, orgId } });
  if (!existing) throw new HttpError(404, "CUSTOM_FIELDSET_NOT_FOUND", "Fieldset not found");
  const name = payload.name !== undefined ? trimOrNull(payload.name) : existing.name;
  if (!name) throw new HttpError(400, "CUSTOM_FIELDSET_NAME_REQUIRED", "Give the fieldset a name");
  const fields = payload.fields !== undefined ? await normalizeFieldsetFields({ orgId, recordType: existing.recordType, fields: payload.fields }) : undefined;
  const isDefault = payload.isDefault !== undefined ? Boolean(payload.isDefault) : existing.isDefault;
  const status = payload.status !== undefined ? (payload.status === "archived" ? "archived" : "active") : existing.status;
  const row = await prisma.$transaction(async (tx) => {
    if (isDefault && status === "active") await clearDefault({ tx, orgId, recordType: existing.recordType, exceptId: existing.id });
    return tx.customFieldset.update({
      where: { id: existing.id },
      data: {
        name,
        description: payload.description !== undefined ? trimOrNull(payload.description) : existing.description,
        isDefault: status === "active" ? isDefault : false,
        ...(fields !== undefined ? { fieldsJson: fields } : {}),
        status,
        archivedAt: status === "archived" ? (existing.archivedAt || new Date()) : null,
        updatedBy: actor?.id || null,
      },
      include: { _count: { select: { projectFieldsets: true } } },
    });
  });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.CUSTOM_FIELDSET || "custom_fieldset", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { recordType: row.recordType, name: row.name, fields: Object.keys(payload) } }).catch(() => null);
  return serializeFieldset(row);
};

const archiveFieldset = async ({ orgId, fieldsetId, actor = null }) => updateFieldset({ orgId, fieldsetId, payload: { status: "archived" }, actor });

// ─── record types (e.g. "Site Instruction" correspondence) ─────────────────

const serializeRecordType = (row) => ({
  id: row.id,
  tool: row.tool,
  toolLabel: RECORD_TYPES[row.tool]?.label || row.tool,
  key: row.key,
  label: row.label,
  description: row.description || null,
  fieldsetId: row.fieldsetId || null,
  fieldset: row.fieldset ? { id: row.fieldset.id, name: row.fieldset.name } : null,
  settings: isPlainObject(row.settingsJson) ? row.settingsJson : {},
  position: row.position ?? 0,
  status: row.status,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const assertFieldsetFor = async ({ orgId, recordType, fieldsetId }) => {
  if (!fieldsetId) return null;
  const fieldset = await prisma.customFieldset.findFirst({ where: { id: fieldsetId, orgId, recordType, status: "active" }, select: { id: true } });
  if (!fieldset) throw new HttpError(400, "CUSTOM_FIELDSET_NOT_FOUND", `Pick an active fieldset for ${RECORD_TYPES[recordType]?.label || recordType}`);
  return fieldset.id;
};

const listRecordTypes = async ({ orgId, tool = null, includeArchived = false }) => {
  if (!tablesReady() || !prisma.recordTypeDefinition?.findMany) return [];
  const rows = await prisma.recordTypeDefinition.findMany({
    where: { orgId, ...(tool ? { tool } : {}), ...(includeArchived ? {} : { status: "active" }) },
    include: { fieldset: { select: { id: true, name: true } } },
    orderBy: [{ tool: "asc" }, { position: "asc" }, { label: "asc" }],
  });
  return rows.map(serializeRecordType);
};

const createRecordType = async ({ orgId, payload = {}, actor = null }) => {
  const tool = trimOrNull(payload.tool);
  if (!TOOLS_WITH_RECORD_TYPES.includes(tool)) throw new HttpError(400, "RECORD_TYPE_TOOL", `Record types are available for: ${TOOLS_WITH_RECORD_TYPES.join(", ")}`);
  const label = trimOrNull(payload.label);
  if (!label) throw new HttpError(400, "RECORD_TYPE_LABEL_REQUIRED", "Give the record type a name");
  const key = slug(trimOrNull(payload.key) || label);
  if (!key) throw new HttpError(400, "RECORD_TYPE_KEY", "The key needs at least one letter or digit");
  const clash = await prisma.recordTypeDefinition.findFirst({ where: { orgId, tool, key }, select: { id: true } });
  if (clash) throw new HttpError(409, "RECORD_TYPE_KEY_EXISTS", `A record type with key "${key}" already exists`);
  const fieldsetId = await assertFieldsetFor({ orgId, recordType: tool, fieldsetId: trimOrNull(payload.fieldsetId) });
  const row = await prisma.recordTypeDefinition.create({
    data: { orgId, tool, key, label, description: trimOrNull(payload.description), fieldsetId, settingsJson: isPlainObject(payload.settings) ? payload.settings : null, position: Math.round(Number(payload.position) || 0), createdBy: actor?.id || null },
    include: { fieldset: { select: { id: true, name: true } } },
  });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.RECORD_TYPE || "record_type", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { tool, key, label } }).catch(() => null);
  return serializeRecordType(row);
};

const updateRecordType = async ({ orgId, recordTypeId, payload = {}, actor = null }) => {
  const existing = await prisma.recordTypeDefinition.findFirst({ where: { id: recordTypeId, orgId } });
  if (!existing) throw new HttpError(404, "RECORD_TYPE_NOT_FOUND", "Record type not found");
  const label = payload.label !== undefined ? trimOrNull(payload.label) : existing.label;
  if (!label) throw new HttpError(400, "RECORD_TYPE_LABEL_REQUIRED", "Give the record type a name");
  const fieldsetId = payload.fieldsetId !== undefined ? await assertFieldsetFor({ orgId, recordType: existing.tool, fieldsetId: trimOrNull(payload.fieldsetId) }) : existing.fieldsetId;
  const status = payload.status !== undefined ? (payload.status === "archived" ? "archived" : "active") : existing.status;
  const row = await prisma.recordTypeDefinition.update({
    where: { id: existing.id },
    data: {
      label,
      description: payload.description !== undefined ? trimOrNull(payload.description) : existing.description,
      fieldsetId,
      settingsJson: payload.settings !== undefined ? (isPlainObject(payload.settings) ? payload.settings : null) : existing.settingsJson,
      position: payload.position !== undefined ? Math.round(Number(payload.position) || 0) : existing.position,
      status,
      archivedAt: status === "archived" ? (existing.archivedAt || new Date()) : null,
      updatedBy: actor?.id || null,
    },
    include: { fieldset: { select: { id: true, name: true } } },
  });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.RECORD_TYPE || "record_type", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { tool: row.tool, key: row.key, fields: Object.keys(payload) } }).catch(() => null);
  return serializeRecordType(row);
};

const archiveRecordType = async ({ orgId, recordTypeId, actor = null }) => updateRecordType({ orgId, recordTypeId, payload: { status: "archived" }, actor });

/** Record services call this to accept a `recordTypeKey`; returns the key or throws. */
const assertRecordTypeKey = async ({ orgId, tool, key }) => {
  const trimmed = trimOrNull(key);
  if (!trimmed) return null;
  if (!prisma.recordTypeDefinition?.findFirst) return trimmed;
  const row = await prisma.recordTypeDefinition.findFirst({ where: { orgId, tool, key: trimmed, status: "active" }, select: { key: true } });
  if (!row) throw new HttpError(400, "RECORD_TYPE_UNKNOWN", `Unknown ${RECORD_TYPES[tool]?.label?.toLowerCase() || tool} type: ${trimmed}`);
  return row.key;
};

// ─── project assignments ───────────────────────────────────────────────────

const getProjectFieldsets = async ({ orgId, projectId }) => {
  if (!prisma.projectFieldset?.findMany) return [];
  const rows = await prisma.projectFieldset.findMany({ where: { orgId, projectId }, include: { fieldset: { select: { id: true, name: true, recordType: true, status: true } } } });
  return rows.map((row) => ({ recordType: row.recordType, recordTypeLabel: RECORD_TYPES[row.recordType]?.label || row.recordType, fieldsetId: row.fieldsetId, fieldset: row.fieldset ? { id: row.fieldset.id, name: row.fieldset.name, status: row.fieldset.status } : null }));
};

const setProjectFieldset = async ({ orgId, projectId, recordType, fieldsetId = null, actor = null }) => {
  getRecordType(recordType);
  if (!fieldsetId) {
    await prisma.projectFieldset.deleteMany({ where: { orgId, projectId, recordType } });
  } else {
    await assertFieldsetFor({ orgId, recordType, fieldsetId });
    await prisma.projectFieldset.upsert({ where: { projectId_recordType: { projectId, recordType } }, update: { fieldsetId }, create: { orgId, projectId, recordType, fieldsetId } });
  }
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CUSTOM_FIELDSET || "custom_fieldset", entityId: fieldsetId || projectId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { recordType, fieldsetId, assignment: fieldsetId ? "assigned" : "cleared" } }).catch(() => null);
  return getProjectFieldsets({ orgId, projectId });
};

// ─── effective schema ──────────────────────────────────────────────────────

const fieldFromDefinition = (row, override = null) => ({
  id: row.id,
  key: row.key,
  label: row.label,
  description: row.description || null,
  type: row.type,
  options: Array.isArray(row.optionsJson) ? row.optionsJson : null,
  required: override?.required ?? Boolean(row.required),
  hidden: override?.hidden ?? Boolean(row.hidden),
  default: row.defaultJson ?? null,
  validation: isPlainObject(row.validationJson) ? row.validationJson : null,
  condition: isPlainObject(row.conditionJson) ? row.conditionJson : null,
  position: row.position ?? 0,
  scope: row.projectId ? "project" : "company",
});

/**
 * The fields a record of `recordType` shows on `projectId`: the record type's
 * fieldset, else the project's assigned fieldset, else the default fieldset,
 * else every active field; project fields are always appended.
 */
const schemaFor = async ({ orgId, projectId, recordType, recordTypeKey = null }) => {
  const meta = getRecordType(recordType);
  const empty = { recordType, recordTypeLabel: meta.label, module: meta.module, fields: [], fieldset: null, recordTypeDefinition: null };
  if (!tablesReady()) return empty;
  const definitions = await prisma.customFieldDefinition.findMany({ where: { orgId, recordType, status: "active", OR: [{ projectId: null }, { projectId }] }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  const byId = new Map(definitions.map((row) => [row.id, row]));
  const recordTypeDefinition = recordTypeKey && prisma.recordTypeDefinition?.findFirst ? await prisma.recordTypeDefinition.findFirst({ where: { orgId, tool: recordType, key: recordTypeKey, status: "active" }, include: { fieldset: true } }) : null;
  let fieldset = recordTypeDefinition?.fieldset && recordTypeDefinition.fieldset.status === "active" ? recordTypeDefinition.fieldset : null;
  if (!fieldset && prisma.projectFieldset?.findFirst) {
    const assigned = await prisma.projectFieldset.findFirst({ where: { orgId, projectId, recordType }, include: { fieldset: true } });
    if (assigned?.fieldset?.status === "active") fieldset = assigned.fieldset;
  }
  if (!fieldset && prisma.customFieldset?.findFirst) fieldset = await prisma.customFieldset.findFirst({ where: { orgId, recordType, isDefault: true, status: "active" } });
  let fields;
  if (fieldset) {
    const entries = Array.isArray(fieldset.fieldsJson) ? fieldset.fieldsJson : [];
    const used = new Set();
    fields = entries
      .map((entry) => {
        const row = byId.get(entry.fieldId);
        if (!row) return null;
        used.add(row.id);
        return fieldFromDefinition(row, entry);
      })
      .filter(Boolean);
    for (const row of definitions) if (row.projectId && !used.has(row.id)) fields.push(fieldFromDefinition(row));
  } else {
    fields = definitions.map((row) => fieldFromDefinition(row));
  }
  return {
    recordType,
    recordTypeLabel: meta.label,
    module: meta.module,
    fields,
    fieldset: fieldset ? { id: fieldset.id, name: fieldset.name } : null,
    recordTypeDefinition: recordTypeDefinition ? serializeRecordType(recordTypeDefinition) : null,
  };
};

/**
 * Validates a values map against a schema. Returns the coerced map (only
 * keys present in the schema). `partial` skips the required check for keys
 * that were not sent. Throws 400 CUSTOM_FIELD_INVALID listing every problem.
 */
const validateValues = ({ schema, values = {}, context = {}, partial = false }) => {
  const input = isPlainObject(values) ? values : {};
  const known = new Set(schema.fields.map((field) => field.key));
  const problems = [];
  const normalized = {};
  for (const key of Object.keys(input)) if (!known.has(key)) problems.push({ key, message: `Unknown field "${key}"` });
  for (const field of schema.fields) {
    if (!(field.key in input)) continue;
    try {
      normalized[field.key] = coerceValue(field, input[field.key]);
    } catch (error) {
      problems.push({ key: field.key, message: error.message });
    }
  }
  const visibleContext = { ...context, ...normalized };
  for (const field of schema.fields) {
    if (field.hidden || !field.required) continue;
    if (partial && !(field.key in input)) continue;
    if (field.condition && !evaluateCondition(visibleContext, field.condition)) continue;
    const value = normalized[field.key];
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) problems.push({ key: field.key, message: `${field.label} is required` });
  }
  if (problems.length) throw new HttpError(400, "CUSTOM_FIELD_INVALID", problems.map((problem) => problem.message).join("; "), { problems });
  return normalized;
};

const valueRowsToMap = (rows, byFieldId) => {
  const out = {};
  for (const row of rows) {
    const field = byFieldId.get(row.fieldId);
    if (field) out[field.key] = row.valueJson ?? null;
  }
  return out;
};

/**
 * The records among `recordIds` that are records of `recordType` on
 * `projectId` and — with a `viewer` (document-text.service documentViewer) —
 * that the viewer may see: the record type's module read and, for a viewer
 * a record's own rule binds (a party's RFIs and submittals, a vendor's
 * commitments and pay applications; for a company member too, a colleague's
 * draft RFI and — without project-wide task visibility — a colleague's task:
 * audit.service recordRuleFor, certification R16), the records that rule
 * admits. Values were read and written by { orgId, recordType, recordId }
 * alone: through a project they were on, a member confined to other projects
 * read and overwrote the values of a record of a project they could not open
 * (certification L45).
 */
const recordsOnProject = async ({ tx = prisma, orgId = null, projectId, recordType, recordIds, viewer = null }) => {
  const meta = getRecordType(recordType);
  const ids = [...new Set((recordIds || []).filter((id) => typeof id === "string" && id))];
  if (!ids.length || !projectId || !tx[meta.model]?.findMany) return [];
  const rows = await tx[meta.model].findMany({ where: { id: { in: ids }, projectId }, select: { id: true } });
  const found = rows.map((row) => row.id);
  if (!viewer || !found.length) return found;
  if (viewer.canRead && !viewer.canRead(meta.module)) return [];
  const reader = recordType === "task" ? await auditService.withTaskVisibility({ orgId, projectId, viewer }) : viewer;
  const scope = auditService.recordRuleFor(recordType, reader);
  if (!scope) return found;
  if (!scope.where || !tx[scope.model]?.findMany) return [];
  const visible = await tx[scope.model].findMany({ where: { id: { in: found }, projectId, ...scope.where }, select: { id: true } });
  const admitted = new Set(visible.map((row) => row.id));
  return found.filter((recordId) => admitted.has(recordId));
};

/** One record of the project the viewer may see, or a 404 that does not say whether it exists elsewhere. */
const assertRecordOnProject = async ({ tx = prisma, orgId = null, projectId, recordType, recordId, viewer = null }) => {
  const [found] = await recordsOnProject({ tx, orgId, projectId, recordType, recordIds: [recordId], viewer });
  if (!found) throw new HttpError(404, "CUSTOM_FIELD_RECORD_NOT_FOUND", "Record not found on this project");
  return found;
};

const getValues = async ({ orgId, projectId, recordType, recordId, recordTypeKey = null, viewer = null }) => {
  await assertRecordOnProject({ orgId, projectId, recordType, recordId, viewer });
  const schema = await schemaFor({ orgId, projectId, recordType, recordTypeKey });
  if (!prisma.customFieldValue?.findMany) return { ...schema, values: {} };
  const rows = await prisma.customFieldValue.findMany({ where: { orgId, recordType, recordId } });
  const byFieldId = new Map(schema.fields.map((field) => [field.id, field]));
  return { ...schema, values: valueRowsToMap(rows, byFieldId) };
};

/**
 * A person or company a value names is this company's own: one of its people
 * (a present membership, or a legacy row homed here) or a company of its directory. Another company's id
 * is refused exactly as an id that exists nowhere; a value already stored
 * and not changed is left alone. Before this check a field took any id and a
 * report then printed the other company's person or company by name
 * (certification L38 review, M8).
 */
const assertNamedReferences = async ({ client, orgId, byKey, existing, normalized }) => {
  const named = [];
  for (const [key, value] of Object.entries(normalized)) {
    const field = byKey.get(key);
    if (!field || (field.type !== "user" && field.type !== "company") || value === null || value === undefined) continue;
    if (JSON.stringify(existing[key] ?? null) === JSON.stringify(value)) continue;
    named.push({ field, value });
  }
  if (!named.length) return;
  const userIds = named.filter((item) => item.field.type === "user").map((item) => item.value);
  const companyIds = named.filter((item) => item.field.type === "company").map((item) => item.value);
  // The workspace's people as every list of them is read (membershipService.userInOrgWhere):
  // a present membership, or a legacy row homed here with no membership at all.
  const members = userIds.length
    ? new Set((await client.user.findMany({ where: membershipService.userInOrgWhere({ tx: client, orgId, where: { id: { in: userIds } } }), select: { id: true } })).map((row) => row.id))
    : new Set();
  const companies = companyIds.length
    ? new Set((await client.company.findMany({ where: { orgId, id: { in: companyIds } }, select: { id: true } })).map((row) => row.id))
    : new Set();
  const problems = named
    .filter(({ field, value }) => (field.type === "user" ? !members.has(value) : !companies.has(value)))
    .map(({ field }) => ({ key: field.key, message: `${field.label} needs a ${field.type === "user" ? "person" : "company"} of this organisation` }));
  if (problems.length) throw new HttpError(400, "CUSTOM_FIELD_INVALID", problems.map((problem) => problem.message).join("; "), { problems });
};

/** Writes a values map for one record of the project (upsert; null removes), audited on the record itself. */
const setValues = async ({ orgId, projectId, recordType, recordId, values = {}, actor = null, recordTypeKey = null, context = {}, partial = false, tx = null, viewer = null }) => {
  const client = tx || prisma;
  await assertRecordOnProject({ tx: client, orgId, projectId, recordType, recordId, viewer });
  const schema = await schemaFor({ orgId, projectId, recordType, recordTypeKey });
  if (!schema.fields.length) {
    if (isPlainObject(values) && Object.keys(values).length) throw new HttpError(400, "CUSTOM_FIELD_INVALID", "This record type has no custom fields", { problems: [] });
    return { ...schema, values: {} };
  }
  const byFieldId = new Map(schema.fields.map((field) => [field.id, field]));
  const byKey = new Map(schema.fields.map((field) => [field.key, field]));
  const existingRows = await client.customFieldValue.findMany({ where: { orgId, recordType, recordId } });
  const existing = valueRowsToMap(existingRows, byFieldId);
  const merged = partial ? { ...existing, ...(isPlainObject(values) ? values : {}) } : { ...Object.fromEntries(schema.fields.map((field) => [field.key, null])), ...(isPlainObject(values) ? values : {}) };
  const normalized = validateValues({ schema, values: merged, context, partial });
  await assertNamedReferences({ client, orgId, byKey, existing, normalized });
  const changed = [];
  for (const [key, value] of Object.entries(normalized)) {
    const field = byKey.get(key);
    const before = existing[key] ?? null;
    if (JSON.stringify(before) === JSON.stringify(value)) continue;
    changed.push({ key, label: field.label, from: before, to: value });
    if (value === null) await client.customFieldValue.deleteMany({ where: { recordId, fieldId: field.id } });
    else await client.customFieldValue.upsert({ where: { recordId_fieldId: { recordId, fieldId: field.id } }, update: { valueJson: value, updatedBy: actor?.id || null }, create: { orgId, projectId, recordType, recordId, fieldId: field.id, valueJson: value, updatedBy: actor?.id || null } });
  }
  if (changed.length) {
    await auditService.recordEvent({ orgId, projectId, entityType: recordType, entityId: recordId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { customFields: changed.map((item) => item.label), changes: changed } }).catch(() => null);
  }
  return { ...schema, values: { ...existing, ...normalized } };
};

/** Values for many records at once: Map recordId → { key: value }. */
const valuesForRecords = async ({ orgId, recordType, recordIds }) => {
  const out = new Map();
  const ids = [...new Set((recordIds || []).filter(Boolean))];
  if (!ids.length || !prisma.customFieldValue?.findMany) return out;
  const rows = await prisma.customFieldValue.findMany({ where: { orgId, recordType, recordId: { in: ids } }, include: { field: { select: { key: true, status: true } } } });
  for (const row of rows) {
    if (!row.field || row.field.status !== "active") continue;
    const entry = out.get(row.recordId) || {};
    entry[row.field.key] = row.valueJson ?? null;
    out.set(row.recordId, entry);
  }
  return out;
};

/** Values for the records of one project the viewer may see (the project's GET /custom-fields/values); other ids are left out. */
const valuesForProjectRecords = async ({ orgId, projectId, recordType, recordIds, viewer = null }) => {
  const ids = await recordsOnProject({ orgId, projectId, recordType, recordIds, viewer });
  return valuesForRecords({ orgId, recordType, recordIds: ids });
};

/** Active definitions for reports: every scope, keys are unique per record type. */
const reportColumns = async ({ orgId, recordType }) => {
  if (!RECORD_TYPES[recordType] || !tablesReady()) return [];
  const rows = await prisma.customFieldDefinition.findMany({ where: { orgId, recordType, status: "active" }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return rows.map((row) => ({ id: row.id, key: row.key, label: row.label, type: row.type, reportType: REPORT_TYPES[row.type] || "string", enum: row.type === "select" && Array.isArray(row.optionsJson) ? row.optionsJson.map((option) => option.value) : null }));
};

const displayValue = (field, value, names) => {
  if (value === null || value === undefined) return null;
  if (field.type === "multi_select") return Array.isArray(value) ? value.join(", ") : String(value);
  if (field.type === "user" || field.type === "company") return names.get(`${field.type}:${value}`) || value;
  return value;
};

/** Sets `row.__custom = { key: displayValue }` on report rows (names for people and companies). */
const attachValues = async ({ orgId, recordType, rows }) => {
  const fields = await reportColumns({ orgId, recordType });
  if (!fields.length) return rows;
  const values = await valuesForRecords({ orgId, recordType, recordIds: rows.map((row) => row.id) });
  const names = new Map();
  const userIds = new Set();
  const companyIds = new Set();
  for (const entry of values.values()) {
    for (const field of fields) {
      const value = entry[field.key];
      if (!value) continue;
      if (field.type === "user") userIds.add(value);
      if (field.type === "company") companyIds.add(value);
    }
  }
  // Names come from this company only: its people, past ones included (a
  // record that named an approver who has since left still shows their name,
  // as other history does). A value that names anyone else — one stored
  // before values were checked — is shown as the bare id.
  if (userIds.size && prisma.user?.findMany) {
    const ownPeople = membershipService.hasMembershipModel(prisma)
      ? { id: { in: [...userIds] }, OR: [{ orgId }, { memberships: { some: { orgId } } }] }
      : { id: { in: [...userIds] }, orgId };
    const users = await prisma.user.findMany({ where: ownPeople, select: { id: true, name: true, email: true } });
    for (const user of users) names.set(`user:${user.id}`, user.name || user.email || user.id);
  }
  if (companyIds.size && prisma.company?.findMany) {
    const companies = await prisma.company.findMany({ where: { orgId, id: { in: [...companyIds] } }, select: { id: true, name: true } });
    for (const company of companies) names.set(`company:${company.id}`, company.name || company.id);
  }
  for (const row of rows) {
    const entry = values.get(row.id) || {};
    row.__custom = Object.fromEntries(fields.map((field) => [field.key, displayValue(field, entry[field.key], names)]));
  }
  return rows;
};

/** Flattened `custom.<key>` values for workflow rules and conditions. */
const contextFor = async ({ orgId, recordType, recordId }) => {
  if (!RECORD_TYPES[recordType] || !prisma.customFieldValue?.findMany) return {};
  const values = await valuesForRecords({ orgId, recordType, recordIds: [recordId] });
  const entry = values.get(recordId) || {};
  return Object.fromEntries(Object.entries(entry).map(([key, value]) => [`custom.${key}`, Array.isArray(value) ? value.join(",") : value]));
};

/** Context fields a workflow template can test, one per active custom field. */
const customContextFields = async ({ orgId, recordType }) => {
  const fields = await reportColumns({ orgId, recordType }).catch(() => []);
  return fields.map((field) => ({ key: `custom.${field.key}`, label: `${field.label} (custom)`, type: CONTEXT_TYPES[field.type] || "string", options: field.enum }));
};

const describeRecordTypes = async ({ orgId }) => {
  const counts = new Map();
  if (tablesReady()) {
    const grouped = await prisma.customFieldDefinition.groupBy({ by: ["recordType"], where: { orgId, status: "active" }, _count: { _all: true } }).catch(() => []);
    for (const row of grouped) counts.set(row.recordType, row._count?._all ?? 0);
  }
  return RECORD_TYPE_KEYS.map((key) => ({ key, label: RECORD_TYPES[key].label, module: RECORD_TYPES[key].module, supportsRecordTypes: Boolean(RECORD_TYPES[key].recordTypes), fieldCount: counts.get(key) || 0 }));
};

module.exports = {
  RECORD_TYPES,
  RECORD_TYPE_KEYS,
  TOOLS_WITH_RECORD_TYPES,
  FIELD_TYPES,
  CONDITION_OPS,
  coerceValue,
  evaluateCondition,
  normalizeDefinition,
  listDefinitions,
  createDefinition,
  updateDefinition,
  archiveDefinition,
  listFieldsets,
  createFieldset,
  updateFieldset,
  archiveFieldset,
  listRecordTypes,
  createRecordType,
  updateRecordType,
  archiveRecordType,
  assertRecordTypeKey,
  getProjectFieldsets,
  setProjectFieldset,
  schemaFor,
  validateValues,
  recordsOnProject,
  getValues,
  setValues,
  valuesForRecords,
  valuesForProjectRecords,
  reportColumns,
  attachValues,
  contextFor,
  customContextFields,
  describeRecordTypes,
};
