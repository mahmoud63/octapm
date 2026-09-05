const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const attachmentService = require("./attachment.service");
const fileStorageService = require("./file-storage.service");
const { isPartyScopedAccess } = require("./company-party.service");
const { recordWorkspacePath } = require("../utils/record-links");
const { createPdf, formatDate } = require("../utils/pdf-writer");

/**
 * Checklist / template engine (OCTA-QA-TEMPLATE-014).
 *
 * A FormTemplate (company-wide when projectId is null, or per project) holds
 * sections of items; a FormInstance is one filled-in copy tied to an
 * activity / location / drawing with an assignee, inspector and approver.
 * Items answered "fail" / "no" are deficient and can be turned into punch
 * items; ITP items flagged as hold points block progress approval on their
 * activity until they pass.
 */

const TYPES = Object.freeze(["inspection", "itp", "form", "talk"]);
const TYPE_PREFIX = Object.freeze({ inspection: "INS", itp: "ITP", form: "FRM", talk: "TBT" });
const TYPE_LABEL = Object.freeze({ inspection: "Inspection", itp: "ITP", form: "Form", talk: "Toolbox talk" });
const RESPONSE_TYPES = Object.freeze(["pass_fail", "yes_no", "checkbox", "text", "number", "choice", "date", "photo", "signature"]);
const POINT_TYPES = Object.freeze(["hold", "witness", "review"]);
const STATUS = Object.freeze({ SCHEDULED: "scheduled", IN_PROGRESS: "in_progress", COMPLETE: "complete", CLOSED: "closed", VOID: "void" });
const STATUSES = Object.freeze(Object.values(STATUS));
const OPEN_STATUSES = Object.freeze([STATUS.SCHEDULED, STATUS.IN_PROGRESS]);
const OUTCOMES = Object.freeze(["pass", "fail"]);
const SIGNATURE_ROLES = Object.freeze(["inspector", "approver", "subcontractor", "witness", "attendee"]);
const RECURRENCE_UNITS = Object.freeze(["day", "week", "month"]);
const PASSING_VALUES = Object.freeze(["pass", "na", "yes", "checked"]);
const DEFICIENT_VALUES = Object.freeze(["fail", "no"]);
const MAX_SIGNATURE_BYTES = 400 * 1024;
const MAX_ITEMS = 500;
const MAX_LIST = 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────

const trimOrNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const isUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const settingsOf = (template) => (template?.settingsJson && typeof template.settingsJson === "object" ? template.settingsJson : {});

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// ─── Templates ────────────────────────────────────────────────────────────

const normalizeOptions = (item, responseType) => {
  if (responseType === "choice") {
    const options = uniqueIds((Array.isArray(item.options) ? item.options : item.optionsJson || []).map((entry) => trimOrNull(entry)).filter(Boolean));
    if (!options.length) throw new HttpError(400, "FORM_CHOICE_OPTIONS_REQUIRED", `Give "${item.label}" at least one option`);
    return options.slice(0, 50);
  }
  if (responseType === "number") {
    const source = item.options && !Array.isArray(item.options) ? item.options : item.optionsJson && !Array.isArray(item.optionsJson) ? item.optionsJson : {};
    const min = Number.isFinite(Number(source.min)) && source.min !== null && source.min !== "" ? Number(source.min) : null;
    const max = Number.isFinite(Number(source.max)) && source.max !== null && source.max !== "" ? Number(source.max) : null;
    if (min !== null && max !== null && min > max) throw new HttpError(400, "FORM_NUMBER_RANGE_INVALID", `"${item.label}": min is greater than max`);
    return { min, max, unit: trimOrNull(source.unit) };
  }
  return null;
};

const normalizeItem = (item, index) => {
  const label = trimOrNull(item?.label);
  if (!label) throw new HttpError(400, "FORM_ITEM_LABEL_REQUIRED", `Item ${index + 1} needs a label`);
  const responseType = item.responseType || "pass_fail";
  if (!RESPONSE_TYPES.includes(responseType)) throw new HttpError(400, "FORM_RESPONSE_TYPE_INVALID", `"${label}": unknown response type ${responseType}`);
  const isHoldPoint = Boolean(item.isHoldPoint);
  let inspectionPointType = trimOrNull(item.inspectionPointType);
  if (inspectionPointType && !POINT_TYPES.includes(inspectionPointType)) throw new HttpError(400, "FORM_POINT_TYPE_INVALID", `"${label}": point type must be hold, witness or review`);
  if (isHoldPoint && !inspectionPointType) inspectionPointType = "hold";
  if (isHoldPoint && !["pass_fail", "yes_no", "checkbox"].includes(responseType)) {
    throw new HttpError(400, "FORM_HOLD_POINT_TYPE", `"${label}": a hold point must be a pass/fail, yes/no or checkbox item`);
  }
  return {
    id: isUuid(item.id) ? item.id : null,
    sortOrder: index,
    label: label.slice(0, 300),
    description: trimOrNull(item.description)?.slice(0, 2000) || null,
    responseType,
    required: item.required !== false,
    photoRequired: Boolean(item.photoRequired),
    isHoldPoint,
    inspectionPointType,
    optionsJson: normalizeOptions({ ...item, label }, responseType),
    reference: trimOrNull(item.reference)?.slice(0, 200) || null,
  };
};

const normalizeSections = (sections) => {
  if (!Array.isArray(sections)) return null;
  const normalized = sections.map((section, index) => {
    const title = trimOrNull(section?.title);
    if (!title) throw new HttpError(400, "FORM_SECTION_TITLE_REQUIRED", `Section ${index + 1} needs a title`);
    return {
      id: isUuid(section.id) ? section.id : null,
      sortOrder: index,
      title: title.slice(0, 200),
      description: trimOrNull(section.description)?.slice(0, 2000) || null,
      items: (Array.isArray(section.items) ? section.items : []).map(normalizeItem),
    };
  });
  const itemCount = normalized.reduce((sum, section) => sum + section.items.length, 0);
  if (itemCount > MAX_ITEMS) throw new HttpError(400, "FORM_TOO_MANY_ITEMS", `A template can have at most ${MAX_ITEMS} items`);
  return normalized;
};

const normalizeSettings = (settings = {}) => {
  const source = settings && typeof settings === "object" ? settings : {};
  const requireSignatures = uniqueIds((Array.isArray(source.requireSignatures) ? source.requireSignatures : []).filter((role) => SIGNATURE_ROLES.includes(role)));
  const deficiencyTarget = source.deficiencyTarget === "observation" ? "observation" : "punch_item";
  return {
    requireSignatures,
    deficiencyTarget,
    instructions: trimOrNull(source.instructions)?.slice(0, 4000) || null,
    ...(source.legacyPointType ? { legacyPointType: source.legacyPointType } : {}),
  };
};

const templateInclude = {
  sections: { orderBy: { sortOrder: "asc" }, include: { items: { orderBy: { sortOrder: "asc" } } } },
  _count: { select: { instances: true } },
};

const serializeItem = (item) => ({
  id: item.id,
  sectionId: item.sectionId,
  sortOrder: item.sortOrder,
  label: item.label,
  description: item.description,
  responseType: item.responseType,
  required: item.required,
  photoRequired: item.photoRequired,
  isHoldPoint: item.isHoldPoint,
  inspectionPointType: item.inspectionPointType,
  options: item.optionsJson ?? null,
  reference: item.reference,
});

const serializeTemplate = (template, { projectId = null } = {}) => ({
  id: template.id,
  orgId: template.orgId,
  projectId: template.projectId,
  scope: template.projectId ? "project" : "company",
  sourceTemplateId: template.sourceTemplateId,
  type: template.type,
  typeLabel: TYPE_LABEL[template.type] || template.type,
  name: template.name,
  description: template.description,
  trade: template.trade,
  version: template.version,
  status: template.status,
  isSystem: template.isSystem,
  settings: normalizeSettings(template.settingsJson),
  sectionCount: template.sections?.length ?? template._count?.sections ?? 0,
  itemCount: template.sections ? template.sections.reduce((sum, section) => sum + section.items.length, 0) : (template.itemCount ?? 0),
  holdPointCount: template.sections ? template.sections.reduce((sum, section) => sum + section.items.filter((item) => item.isHoldPoint).length, 0) : (template.holdPointCount ?? 0),
  instanceCount: template._count?.instances ?? 0,
  sections: template.sections
    ? template.sections.map((section) => ({
        id: section.id,
        title: section.title,
        description: section.description,
        sortOrder: section.sortOrder,
        items: section.items.map(serializeItem),
      }))
    : undefined,
  editable: Boolean(projectId ? template.projectId === projectId : !template.projectId),
  createdBy: template.createdBy,
  createdAt: toIso(template.createdAt),
  updatedAt: toIso(template.updatedAt),
});

const loadTemplate = async ({ orgId, templateId, projectId = undefined }, tx = prisma) => {
  const template = await tx.formTemplate.findFirst({
    where: {
      id: templateId,
      orgId,
      ...(projectId === undefined ? {} : projectId === null ? { projectId: null } : { OR: [{ projectId }, { projectId: null }] }),
    },
    include: templateInclude,
  });
  if (!template) throw new HttpError(404, "FORM_TEMPLATE_NOT_FOUND", "Template not found");
  return template;
};

const listTemplates = async ({ orgId, projectId = null, query = {} }) => {
  if (projectId) await ensureProject({ orgId, projectId });
  const scope = query.scope || (projectId ? "all" : "company");
  const where = {
    orgId,
    ...(scope === "company" ? { projectId: null } : scope === "project" ? { projectId } : { OR: [{ projectId }, { projectId: null }] }),
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : query.includeArchived ? {} : { status: { not: "archived" } }),
    ...(query.search ? { name: { contains: String(query.search).trim(), mode: "insensitive" } } : {}),
  };
  const rows = await prisma.formTemplate.findMany({
    where,
    include: templateInclude,
    orderBy: [{ projectId: "desc" }, { type: "asc" }, { name: "asc" }],
    take: 500,
  });
  const items = rows.map((row) => serializeTemplate(row, { projectId }));
  return {
    items,
    summary: {
      total: items.length,
      byType: TYPES.reduce((acc, type) => ({ ...acc, [type]: items.filter((item) => item.type === type).length }), {}),
      company: items.filter((item) => item.scope === "company").length,
      project: items.filter((item) => item.scope === "project").length,
    },
  };
};

const getTemplate = async ({ orgId, templateId, projectId = undefined }) => {
  const template = await loadTemplate({ orgId, templateId, projectId });
  return serializeTemplate(template, { projectId: projectId || null });
};

const writeStructure = async (tx, { templateId, sections }) => {
  for (const section of sections) {
    const savedSection = section.id
      ? await tx.formSection.update({ where: { id: section.id }, data: { title: section.title, description: section.description, sortOrder: section.sortOrder } })
      : await tx.formSection.create({ data: { templateId, title: section.title, description: section.description, sortOrder: section.sortOrder } });
    for (const item of section.items) {
      const data = {
        templateId,
        sectionId: savedSection.id,
        sortOrder: item.sortOrder,
        label: item.label,
        description: item.description,
        responseType: item.responseType,
        required: item.required,
        photoRequired: item.photoRequired,
        isHoldPoint: item.isHoldPoint,
        inspectionPointType: item.inspectionPointType,
        optionsJson: item.optionsJson,
        reference: item.reference,
      };
      if (item.id) await tx.formItem.update({ where: { id: item.id }, data });
      else await tx.formItem.create({ data });
    }
  }
};

const createTemplate = async ({ orgId, projectId = null, payload = {}, actor = null }) => {
  if (projectId) await ensureProject({ orgId, projectId });
  const name = trimOrNull(payload.name);
  if (!name) throw new HttpError(400, "FORM_TEMPLATE_NAME_REQUIRED", "Give the template a name");
  const type = payload.type || "inspection";
  if (!TYPES.includes(type)) throw new HttpError(400, "FORM_TYPE_INVALID", `Type must be one of ${TYPES.join(", ")}`);
  const sections = normalizeSections(payload.sections) || [];
  const status = ["draft", "active"].includes(payload.status) ? payload.status : "active";

  const created = await prisma.$transaction(async (tx) => {
    const template = await tx.formTemplate.create({
      data: {
        orgId,
        projectId,
        sourceTemplateId: isUuid(payload.sourceTemplateId) ? payload.sourceTemplateId : null,
        type,
        name: name.slice(0, 200),
        description: trimOrNull(payload.description)?.slice(0, 2000) || null,
        trade: trimOrNull(payload.trade)?.slice(0, 80) || null,
        status,
        settingsJson: normalizeSettings(payload.settings),
        createdBy: actor?.id || null,
        updatedBy: actor?.id || null,
      },
    });
    await writeStructure(tx, { templateId: template.id, sections: sections.map((section) => ({ ...section, id: null, items: section.items.map((item) => ({ ...item, id: null })) })) });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId: projectId || null,
      entityType: auditService.ENTITY_TYPES.FORM_TEMPLATE,
      entityId: template.id,
      action: auditService.ACTIONS.CREATED,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      summary: { name: template.name, type, scope: projectId ? "project" : "company", items: sections.reduce((sum, section) => sum + section.items.length, 0) },
    });
    return template;
  });
  return getTemplate({ orgId, templateId: created.id, projectId });
};

const updateTemplate = async ({ orgId, projectId = null, templateId, payload = {}, actor = null }) => {
  const existing = await loadTemplate({ orgId, templateId, projectId: projectId === null ? null : projectId }, prisma);
  if (projectId && existing.projectId !== projectId) {
    throw new HttpError(403, "FORM_TEMPLATE_COMPANY_SCOPED", "Company templates are edited from the company workspace; duplicate it into the project to change it here");
  }
  if (existing.isSystem && payload.sections !== undefined) {
    throw new HttpError(409, "FORM_TEMPLATE_SYSTEM", "The migrated ITP template cannot be restructured; duplicate it instead");
  }
  const sections = normalizeSections(payload.sections);
  const data = {};
  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "FORM_TEMPLATE_NAME_REQUIRED", "Give the template a name");
    data.name = name.slice(0, 200);
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description)?.slice(0, 2000) || null;
  if (payload.trade !== undefined) data.trade = trimOrNull(payload.trade)?.slice(0, 80) || null;
  if (payload.type !== undefined) {
    if (!TYPES.includes(payload.type)) throw new HttpError(400, "FORM_TYPE_INVALID", `Type must be one of ${TYPES.join(", ")}`);
    data.type = payload.type;
  }
  if (payload.status !== undefined) {
    if (!["draft", "active", "archived"].includes(payload.status)) throw new HttpError(400, "FORM_STATUS_INVALID", "Status must be draft, active or archived");
    data.status = payload.status;
  }
  if (payload.settings !== undefined) data.settingsJson = { ...normalizeSettings(payload.settings), ...(settingsOf(existing).legacyPointType ? { legacyPointType: settingsOf(existing).legacyPointType } : {}) };
  data.updatedBy = actor?.id || null;

  await prisma.$transaction(async (tx) => {
    if (sections) {
      const keptSectionIds = new Set(sections.map((section) => section.id).filter(Boolean));
      const keptItemIds = new Set(sections.flatMap((section) => section.items.map((item) => item.id)).filter(Boolean));
      const existingItems = existing.sections.flatMap((section) => section.items);
      for (const item of existingItems) {
        if (keptItemIds.has(item.id)) continue;
        const used = await tx.formItemResponse.count({ where: { itemId: item.id } });
        if (used) throw new HttpError(409, "FORM_ITEM_IN_USE", `"${item.label}" has ${used} answer${used === 1 ? "" : "s"} and cannot be removed — duplicate the template instead`);
      }
      // Items referenced by id must belong to this template.
      for (const id of keptItemIds) {
        if (!existingItems.some((item) => item.id === id)) throw new HttpError(400, "FORM_ITEM_NOT_FOUND", "An item id does not belong to this template");
      }
      for (const id of keptSectionIds) {
        if (!existing.sections.some((section) => section.id === id)) throw new HttpError(400, "FORM_SECTION_NOT_FOUND", "A section id does not belong to this template");
      }
      await tx.formItem.deleteMany({ where: { templateId, id: { notIn: [...keptItemIds] } } });
      await tx.formSection.deleteMany({ where: { templateId, id: { notIn: [...keptSectionIds] } } });
      await writeStructure(tx, { templateId, sections });
      data.version = { increment: 1 };
    }
    await tx.formTemplate.update({ where: { id: templateId }, data });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId: existing.projectId || null,
      entityType: auditService.ENTITY_TYPES.FORM_TEMPLATE,
      entityId: templateId,
      action: auditService.ACTIONS.UPDATED,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      summary: { name: data.name || existing.name, restructured: Boolean(sections), status: data.status || existing.status },
    });
  });
  return getTemplate({ orgId, templateId, projectId: projectId === null ? null : projectId });
};

const archiveTemplate = async ({ orgId, projectId = null, templateId, actor = null }) => {
  const existing = await loadTemplate({ orgId, templateId, projectId: projectId === null ? null : projectId });
  if (projectId && existing.projectId !== projectId) throw new HttpError(403, "FORM_TEMPLATE_COMPANY_SCOPED", "Company templates are archived from the company workspace");
  await prisma.formTemplate.update({ where: { id: templateId }, data: { status: "archived", updatedBy: actor?.id || null } });
  await auditService.recordEvent({
    orgId,
    projectId: existing.projectId || null,
    entityType: auditService.ENTITY_TYPES.FORM_TEMPLATE,
    entityId: templateId,
    action: auditService.ACTIONS.UPDATED,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    summary: { name: existing.name, status: "archived" },
  });
  return { id: templateId, status: "archived" };
};

/** Deep-copies a template into a project (or, with targetProjectId null, into the company library). */
const duplicateTemplate = async ({ orgId, templateId, targetProjectId = null, name = null, actor = null }) => {
  const source = await loadTemplate({ orgId, templateId, projectId: undefined });
  if (targetProjectId) await ensureProject({ orgId, projectId: targetProjectId });
  const sections = source.sections.map((section) => ({
    id: null,
    sortOrder: section.sortOrder,
    title: section.title,
    description: section.description,
    items: section.items.map((item) => ({ ...serializeItem(item), id: null, optionsJson: item.optionsJson })),
  }));
  const settings = normalizeSettings(source.settingsJson);
  delete settings.legacyPointType;
  return createTemplate({
    orgId,
    projectId: targetProjectId,
    actor,
    payload: {
      name: trimOrNull(name) || (targetProjectId && !source.projectId ? source.name : `${source.name} (copy)`),
      description: source.description,
      trade: source.trade,
      type: source.type,
      status: "active",
      sourceTemplateId: source.id,
      settings,
      sections: sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, options: item.optionsJson })) })),
    },
  });
};

const STARTER_TEMPLATES = [
  {
    type: "itp",
    name: "Concrete pour ITP",
    trade: "Concrete",
    settings: { requireSignatures: ["inspector", "approver"] },
    sections: [
      {
        title: "Before the pour",
        items: [
          { label: "Formwork dimensions, level and line checked against drawings", responseType: "pass_fail", isHoldPoint: true, inspectionPointType: "hold", photoRequired: true, reference: "Structural GA" },
          { label: "Reinforcement size, spacing, laps and cover verified", responseType: "pass_fail", isHoldPoint: true, inspectionPointType: "hold", photoRequired: true },
          { label: "Embedded items, sleeves and conduits in place", responseType: "pass_fail" },
          { label: "Surfaces clean and release agent applied", responseType: "yes_no" },
          { label: "Concrete mix design reference", responseType: "text" },
        ],
      },
      {
        title: "During the pour",
        items: [
          { label: "Slump test result", responseType: "number", options: { min: 0, max: 300, unit: "mm" } },
          { label: "Concrete temperature", responseType: "number", options: { min: 0, max: 45, unit: "°C" } },
          { label: "Test cubes taken and labelled", responseType: "yes_no", inspectionPointType: "witness" },
          { label: "Vibration and placement satisfactory", responseType: "pass_fail" },
        ],
      },
      {
        title: "After the pour",
        items: [
          { label: "Curing method applied", responseType: "choice", options: ["Curing compound", "Wet hessian", "Polythene", "Ponding"] },
          { label: "Finish and levels acceptable", responseType: "pass_fail", isHoldPoint: true, inspectionPointType: "hold" },
        ],
      },
    ],
  },
  {
    type: "inspection",
    name: "Weekly safety walk",
    trade: "HSE",
    settings: { requireSignatures: ["inspector"] },
    sections: [
      {
        title: "Access and housekeeping",
        items: [
          { label: "Walkways clear and lit", responseType: "pass_fail" },
          { label: "Edge protection in place", responseType: "pass_fail", photoRequired: true },
          { label: "Waste segregated and removed", responseType: "pass_fail" },
        ],
      },
      {
        title: "People and plant",
        items: [
          { label: "PPE worn by everyone on site", responseType: "pass_fail" },
          { label: "Plant inspection tags current", responseType: "pass_fail" },
          { label: "Permits displayed for hot works / confined spaces", responseType: "yes_no", required: false },
          { label: "Number of workers observed", responseType: "number", options: { min: 0, max: null, unit: "people" } },
        ],
      },
    ],
  },
  {
    type: "talk",
    name: "Toolbox talk: working at height",
    trade: "HSE",
    settings: { requireSignatures: ["inspector", "attendee"] },
    sections: [
      {
        title: "Talk",
        items: [
          { label: "Topic covered: hierarchy of fall protection", responseType: "checkbox" },
          { label: "Site-specific hazards discussed", responseType: "text" },
          { label: "Questions raised by the crew", responseType: "text", required: false },
          { label: "Date of talk", responseType: "date" },
          { label: "Attendance sheet photo", responseType: "photo" },
        ],
      },
    ],
  },
];

/** Adds the starter templates to the company library once. */
const seedStarterTemplates = async ({ orgId, actor = null }) => {
  const existing = await prisma.formTemplate.findMany({ where: { orgId, projectId: null }, select: { name: true } });
  const names = new Set(existing.map((row) => row.name));
  const created = [];
  for (const starter of STARTER_TEMPLATES) {
    if (names.has(starter.name)) continue;
    created.push(await createTemplate({ orgId, projectId: null, actor, payload: starter }));
  }
  return { created: created.length, items: created };
};

// ─── Instances ────────────────────────────────────────────────────────────

const personSelect = { select: { id: true, name: true, email: true } };
const instanceInclude = {
  template: { select: { id: true, name: true, type: true, version: true, settingsJson: true, projectId: true, isSystem: true } },
  activity: { select: { id: true, name: true } },
  location: { select: { id: true, name: true, code: true, path: true } },
  sheet: { select: { id: true, number: true, title: true } },
  assigneeUser: personSelect,
  inspectorUser: personSelect,
  approverUser: personSelect,
  ballInCourtUser: { select: { id: true, name: true } },
  assigneeCompany: { select: { id: true, name: true } },
};

const ballInCourtFor = (instance) => {
  switch (instance.status) {
    case STATUS.SCHEDULED:
    case STATUS.IN_PROGRESS:
      return instance.assigneeUserId || instance.inspectorUserId || instance.createdBy || null;
    case STATUS.COMPLETE:
      return instance.approverUserId || instance.createdBy || null;
    default:
      return null;
  }
};

const isAnswered = (response) => Boolean(response && response.value !== null && response.value !== undefined && response.value !== "");

const computeSummary = ({ items, responses, photoCounts = new Map(), signatures = [] }) => {
  const byItem = new Map(responses.map((response) => [response.itemId, response]));
  const summary = { total: items.length, required: 0, answered: 0, passed: 0, failed: 0, na: 0, deficient: 0, holdPoints: 0, holdPointsOpen: 0 };
  for (const item of items) {
    const response = byItem.get(item.id);
    if (item.required) summary.required += 1;
    const answered =
      item.responseType === "photo"
        ? (photoCounts.get(response?.id) || 0) > 0 || isAnswered(response)
        : item.responseType === "signature"
          ? signatures.some((signature) => signature.itemId === item.id) || isAnswered(response)
          : isAnswered(response);
    if (answered) summary.answered += 1;
    if (response && PASSING_VALUES.includes(response.value) && response.value !== "na") summary.passed += 1;
    if (response?.value === "na") summary.na += 1;
    if (response && DEFICIENT_VALUES.includes(response.value)) summary.failed += 1;
    if (response?.isDeficient) summary.deficient += 1;
    if (item.isHoldPoint) {
      summary.holdPoints += 1;
      if (!(response && PASSING_VALUES.includes(response.value))) summary.holdPointsOpen += 1;
    }
  }
  return summary;
};

const photoCountsFor = async (responseIds, tx = prisma) => {
  const ids = uniqueIds(responseIds);
  if (!ids.length || !tx.attachment?.groupBy) return new Map();
  const rows = await tx.attachment.groupBy({
    by: ["recordId"],
    where: { recordType: "form_response", recordId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.recordId, row._count._all]));
};

const serializeSignature = (signature, projectId) => ({
  id: signature.id,
  role: signature.role,
  itemId: signature.itemId,
  userId: signature.userId,
  userName: signature.user?.name || null,
  signerName: signature.signerName,
  signerCompany: signature.signerCompany,
  documentId: signature.documentId,
  imageUrl: signature.documentId ? `/api/v1/projects/${projectId}/attachments/documents/${signature.documentId}` : null,
  signedAt: toIso(signature.signedAt),
});

const serializeInstance = (instance, { items = null, responses = null, signatures = null, photoCounts = null, sections = null, holdPoints = null, now = new Date() } = {}) => {
  const summary =
    items && responses ? computeSummary({ items, responses, photoCounts: photoCounts || new Map(), signatures: signatures || [] }) : instance.summaryJson || null;
  const open = OPEN_STATUSES.includes(instance.status);
  const dueAt = instance.dueDate || instance.scheduledFor;
  const isOverdue = open && Boolean(dueAt) && new Date(dueAt) < now;
  const base = {
    id: instance.id,
    projectId: instance.projectId,
    templateId: instance.templateId,
    templateVersion: instance.templateVersion,
    template: instance.template
      ? { id: instance.template.id, name: instance.template.name, type: instance.template.type, version: instance.template.version, settings: normalizeSettings(instance.template.settingsJson), isSystem: instance.template.isSystem }
      : null,
    number: instance.number,
    ref: instance.ref,
    type: instance.type,
    typeLabel: TYPE_LABEL[instance.type] || instance.type,
    title: instance.title,
    status: instance.status,
    outcome: instance.outcome,
    activityId: instance.activityId,
    activity: instance.activity || null,
    locationId: instance.locationId,
    location: instance.location || null,
    sheetId: instance.sheetId,
    sheet: instance.sheet || null,
    assigneeUserId: instance.assigneeUserId,
    assigneeUser: instance.assigneeUser || null,
    assigneeCompanyId: instance.assigneeCompanyId,
    assigneeCompany: instance.assigneeCompany || null,
    inspectorUserId: instance.inspectorUserId,
    inspectorUser: instance.inspectorUser || null,
    approverUserId: instance.approverUserId,
    approverUser: instance.approverUser || null,
    ballInCourtUserId: instance.ballInCourtUserId,
    ballInCourtUser: instance.ballInCourtUser || null,
    scheduledFor: toIso(instance.scheduledFor),
    dueDate: toIso(instance.dueDate),
    isOverdue,
    recurrence: instance.recurrenceJson || null,
    startedAt: toIso(instance.startedAt),
    completedAt: toIso(instance.completedAt),
    completedBy: instance.completedBy,
    closedAt: toIso(instance.closedAt),
    closedBy: instance.closedBy,
    reopenReason: instance.reopenReason,
    summary,
    clientRequestId: instance.clientRequestId,
    legacyItpId: instance.legacyItpId,
    createdBy: instance.createdBy,
    createdAt: toIso(instance.createdAt),
    updatedAt: toIso(instance.updatedAt),
    path: recordWorkspacePath({ projectId: instance.projectId, recordType: "form_instance", recordId: instance.id }),
  };
  if (!sections) return base;
  const byItem = new Map((responses || []).map((response) => [response.itemId, response]));
  return {
    ...base,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      items: section.items.map((item) => {
        const response = byItem.get(item.id) || null;
        return {
          ...serializeItem(item),
          response: response
            ? {
                id: response.id,
                value: response.value,
                numberValue: response.numberValue,
                note: response.note,
                isDeficient: response.isDeficient,
                deficiencyRecordType: response.deficiencyRecordType,
                deficiencyRecordId: response.deficiencyRecordId,
                deficiencyPath: response.deficiencyRecordType && response.deficiencyRecordId ? recordWorkspacePath({ projectId: instance.projectId, recordType: response.deficiencyRecordType, recordId: response.deficiencyRecordId }) : null,
                answeredBy: response.answeredBy,
                answeredAt: toIso(response.answeredAt),
                photoCount: photoCounts?.get(response.id) || 0,
              }
            : null,
          signature: (signatures || []).find((signature) => signature.itemId === item.id) ? serializeSignature((signatures || []).find((signature) => signature.itemId === item.id), instance.projectId) : null,
        };
      }),
    })),
    signatures: (signatures || []).map((signature) => serializeSignature(signature, instance.projectId)),
    holdPoints: holdPoints || [],
  };
};

const templateStructure = async (templateId, tx = prisma) => {
  const sections = await tx.formSection.findMany({ where: { templateId }, orderBy: { sortOrder: "asc" }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  return { sections, items: sections.flatMap((section) => section.items) };
};

const visibilityWhere = (viewer) => {
  const access = viewer?.projectAccess;
  if (!viewer || !isPartyScopedAccess(access)) return null;
  const companyIds = uniqueIds((access?.partyAccess || []).map((party) => party.companyId));
  const or = [{ createdBy: viewer.id }, { assigneeUserId: viewer.id }, { inspectorUserId: viewer.id }, { approverUserId: viewer.id }];
  if (companyIds.length) or.unshift({ assigneeCompanyId: { in: companyIds } });
  return { OR: or };
};

const assertVisible = (instance, viewer) => {
  const where = visibilityWhere(viewer);
  if (!where) return;
  const companyIds = uniqueIds((viewer.projectAccess?.partyAccess || []).map((party) => party.companyId));
  const visible =
    (instance.assigneeCompanyId && companyIds.includes(instance.assigneeCompanyId)) ||
    [instance.createdBy, instance.assigneeUserId, instance.inspectorUserId, instance.approverUserId].includes(viewer.id);
  if (!visible) throw new HttpError(404, "FORM_INSTANCE_NOT_FOUND", "Inspection not found");
};

const notify = async ({ orgId, projectId, instance, recipientUserIds, category, event, title, message, actor, priority = "normal" }) =>
  notificationService.createNotifications({
    orgId,
    projectId,
    actorId: actor?.id || null,
    recipientUserIds: uniqueIds(recipientUserIds),
    type: "inspection",
    category,
    event,
    title,
    message,
    priority,
    actionUrl: recordWorkspacePath({ projectId, recordType: "form_instance", recordId: instance.id }),
    entityType: "form_instance",
    entityId: instance.id,
    dedupeKeyBase: `form:${instance.id}:${event}:${Date.now()}`,
    metadata: { ref: instance.ref, status: instance.status, type: instance.type },
  });

const audit = ({ tx, orgId, projectId, instance, action, actor, oldStatus, newStatus, summary = {}, reason = null }) =>
  auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.FORM_INSTANCE,
    entityId: instance.id,
    action,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    oldStatus: oldStatus ?? null,
    newStatus: newStatus ?? instance.status,
    summary: { ref: instance.ref, title: instance.title, type: instance.type, ...(reason ? { reason } : {}), ...summary },
  });

const nextNumber = async (tx, { projectId, type }) => {
  const last = await tx.formInstance.aggregate({ where: { projectId, type }, _max: { number: true } });
  return (last._max.number || 0) + 1;
};

const refFor = (type, number) => `${TYPE_PREFIX[type] || "FRM"}-${String(number).padStart(3, "0")}`;

const validateReferences = async ({ orgId, projectId, data }, tx = prisma) => {
  const checks = [];
  if (data.locationId) checks.push(tx.location.findFirst({ where: { id: data.locationId, projectId }, select: { id: true } }).then((row) => [row, "LOCATION_NOT_FOUND", "Location not found"]));
  if (data.sheetId) checks.push(tx.sheet.findFirst({ where: { id: data.sheetId, projectId }, select: { id: true } }).then((row) => [row, "SHEET_NOT_FOUND", "Sheet not found"]));
  if (data.activityId) checks.push(tx.activity.findFirst({ where: { id: data.activityId, projectId }, select: { id: true } }).then((row) => [row, "ACTIVITY_NOT_FOUND", "Activity not found"]));
  if (data.assigneeCompanyId) checks.push(tx.company.findFirst({ where: { id: data.assigneeCompanyId, orgId }, select: { id: true } }).then((row) => [row, "COMPANY_NOT_FOUND", "Company not found"]));
  for (const [row, code, message] of await Promise.all(checks)) {
    if (!row) throw new HttpError(404, code, message);
  }
};

const normalizeRecurrence = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object") throw new HttpError(400, "FORM_RECURRENCE_INVALID", "Recurrence must be an object");
  const every = value.every;
  if (!RECURRENCE_UNITS.includes(every)) throw new HttpError(400, "FORM_RECURRENCE_INVALID", "Recurrence must repeat every day, week or month");
  const interval = Number.parseInt(value.interval ?? 1, 10);
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) throw new HttpError(400, "FORM_RECURRENCE_INVALID", "Recurrence interval must be between 1 and 52");
  const until = value.until ? toDate(value.until) : null;
  if (value.until && !until) throw new HttpError(400, "FORM_RECURRENCE_INVALID", "Recurrence end date is invalid");
  return { every, interval, until: until ? until.toISOString() : null };
};

const addRecurrence = (date, recurrence) => {
  const next = new Date(date);
  if (recurrence.every === "day") next.setUTCDate(next.getUTCDate() + recurrence.interval);
  if (recurrence.every === "week") next.setUTCDate(next.getUTCDate() + 7 * recurrence.interval);
  if (recurrence.every === "month") next.setUTCMonth(next.getUTCMonth() + recurrence.interval);
  return next;
};

const normalizeInstancePayload = (payload = {}, { partial = false } = {}) => {
  const data = {};
  const set = (key, value) => {
    if (value !== undefined) data[key] = value;
  };
  if (payload.title !== undefined) {
    const title = trimOrNull(payload.title);
    if (!title && !partial) throw new HttpError(400, "FORM_TITLE_REQUIRED", "Give the inspection a title");
    if (title) data.title = title.slice(0, 200);
  }
  if (payload.activityId !== undefined) set("activityId", payload.activityId || null);
  if (payload.locationId !== undefined) set("locationId", payload.locationId || null);
  if (payload.sheetId !== undefined) set("sheetId", payload.sheetId || null);
  if (payload.assigneeUserId !== undefined) set("assigneeUserId", payload.assigneeUserId || null);
  if (payload.assigneeCompanyId !== undefined) set("assigneeCompanyId", payload.assigneeCompanyId || null);
  if (payload.inspectorUserId !== undefined) set("inspectorUserId", payload.inspectorUserId || null);
  if (payload.approverUserId !== undefined) set("approverUserId", payload.approverUserId || null);
  if (payload.scheduledFor !== undefined) set("scheduledFor", toDate(payload.scheduledFor));
  if (payload.dueDate !== undefined) set("dueDate", toDate(payload.dueDate));
  if (payload.recurrence !== undefined) set("recurrenceJson", normalizeRecurrence(payload.recurrence));
  return data;
};

const loadInstance = async ({ orgId, projectId, instanceId }, tx = prisma) => {
  const instance = await tx.formInstance.findFirst({ where: { id: instanceId, orgId, projectId }, include: instanceInclude });
  if (!instance) throw new HttpError(404, "FORM_INSTANCE_NOT_FOUND", "Inspection not found");
  return instance;
};

const holdPointsFor = ({ instance, items, responses }) => {
  const byItem = new Map(responses.map((response) => [response.itemId, response]));
  return items
    .filter((item) => item.isHoldPoint)
    .map((item) => {
      const response = byItem.get(item.id);
      const passed = Boolean(response && PASSING_VALUES.includes(response.value));
      return {
        instanceId: instance.id,
        ref: instance.ref,
        title: instance.title,
        itemId: item.id,
        label: item.label,
        state: passed ? "passed" : response && DEFICIENT_VALUES.includes(response.value) ? "failed" : "pending",
        status: instance.status,
      };
    });
};

const enrichInstance = async ({ instance, viewer = null }, tx = prisma) => {
  if (viewer) assertVisible(instance, viewer);
  const { sections, items } = await templateStructure(instance.templateId, tx);
  const [responses, signatures] = await Promise.all([
    tx.formItemResponse.findMany({ where: { instanceId: instance.id } }),
    tx.signature.findMany({ where: { instanceId: instance.id }, include: { user: { select: { id: true, name: true } } }, orderBy: { signedAt: "asc" } }),
  ]);
  const photoCounts = await photoCountsFor(responses.map((response) => response.id), tx);
  const holdPoints = instance.type === "itp" ? holdPointsFor({ instance, items, responses }).filter((point) => point.state !== "passed") : [];
  return serializeInstance(instance, { items, responses, signatures, photoCounts, sections, holdPoints });
};

const persistSummary = async (tx, { instanceId, templateId }) => {
  const { items } = await templateStructure(templateId, tx);
  const [responses, signatures] = await Promise.all([
    tx.formItemResponse.findMany({ where: { instanceId } }),
    tx.signature.findMany({ where: { instanceId }, select: { itemId: true, role: true } }),
  ]);
  const photoCounts = await photoCountsFor(responses.map((response) => response.id), tx);
  const summary = computeSummary({ items, responses, photoCounts, signatures });
  await tx.formInstance.update({ where: { id: instanceId }, data: { summaryJson: summary } });
  return { summary, items, responses, signatures, photoCounts };
};

const createInstance = async ({ orgId, projectId, payload = {}, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const clientRequestId = trimOrNull(payload.clientRequestId);
  if (clientRequestId) {
    const existing = await prisma.formInstance.findFirst({ where: { projectId, clientRequestId }, include: instanceInclude });
    if (existing) return enrichInstance({ instance: existing });
  }
  if (!isUuid(payload.templateId)) throw new HttpError(400, "FORM_TEMPLATE_REQUIRED", "Choose a template");
  const template = await loadTemplate({ orgId, templateId: payload.templateId, projectId });
  if (template.status !== "active") throw new HttpError(409, "FORM_TEMPLATE_INACTIVE", "This template is not active");
  const itemCount = template.sections.reduce((sum, section) => sum + section.items.length, 0);
  if (!itemCount) throw new HttpError(409, "FORM_TEMPLATE_EMPTY", "Add at least one item to the template first");
  const data = normalizeInstancePayload({ title: template.name, ...payload });
  await validateReferences({ orgId, projectId, data });
  const startNow = Boolean(payload.startNow);
  const now = new Date();

  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, { projectId, type: template.type });
    const instance = await tx.formInstance.create({
      data: {
        orgId,
        projectId,
        templateId: template.id,
        templateVersion: template.version,
        number,
        ref: refFor(template.type, number),
        type: template.type,
        status: startNow ? STATUS.IN_PROGRESS : STATUS.SCHEDULED,
        startedAt: startNow ? now : null,
        clientRequestId,
        clientCreatedAt: toDate(payload.clientCreatedAt),
        deviceId: trimOrNull(payload.deviceId),
        createdBy: actor?.id || null,
        updatedBy: actor?.id || null,
        ...data,
      },
    });
    const withBall = await tx.formInstance.update({
      where: { id: instance.id },
      data: { ballInCourtUserId: ballInCourtFor(instance), summaryJson: computeSummary({ items: template.sections.flatMap((section) => section.items), responses: [] }) },
      include: instanceInclude,
    });
    await audit({ tx, orgId, projectId, instance: withBall, action: auditService.ACTIONS.CREATED, actor, newStatus: withBall.status, summary: { templateId: template.id, templateName: template.name, activityId: withBall.activityId } });
    return withBall;
  });

  await notify({
    orgId,
    projectId,
    instance: created,
    actor,
    recipientUserIds: [created.assigneeUserId, created.inspectorUserId],
    category: notificationService.NOTIFICATION_CATEGORIES.ASSIGNMENT,
    event: "inspection.scheduled",
    title: `${created.ref} scheduled: ${created.title}`,
    message: [TYPE_LABEL[created.type], created.location?.name, created.activity?.name, created.scheduledFor ? `on ${formatDate(created.scheduledFor)}` : created.dueDate ? `due ${formatDate(created.dueDate)}` : null, `on ${project.name}`].filter(Boolean).join(" · "),
  });
  return enrichInstance({ instance: created });
};

const getInstance = async ({ orgId, projectId, instanceId, viewer = null }) => {
  const instance = await loadInstance({ orgId, projectId, instanceId });
  return enrichInstance({ instance, viewer });
};

const listInstances = async ({ orgId, projectId, filters = {}, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const now = new Date();
  const where = { orgId, projectId };
  const scope = visibilityWhere(viewer);
  if (scope) where.AND = [scope];
  if (filters.status && filters.status !== "all") {
    const statuses = String(filters.status).split(",").map((value) => value.trim()).filter((value) => STATUSES.includes(value));
    if (statuses.length) where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  } else if (!filters.status) {
    where.status = { not: STATUS.VOID };
  }
  if (filters.type && TYPES.includes(filters.type)) where.type = filters.type;
  if (filters.templateId) where.templateId = filters.templateId;
  if (filters.activityId) where.activityId = filters.activityId;
  if (filters.sheetId) where.sheetId = filters.sheetId;
  if (filters.assigneeUserId) where.assigneeUserId = filters.assigneeUserId;
  if (filters.assigneeCompanyId) where.assigneeCompanyId = filters.assigneeCompanyId;
  if (filters.ballInCourtUserId) where.ballInCourtUserId = filters.ballInCourtUserId;
  if (filters.outcome && OUTCOMES.includes(filters.outcome)) where.outcome = filters.outcome;
  if (filters.locationId) {
    const location = await prisma.location.findFirst({ where: { id: filters.locationId, projectId }, select: { path: true } });
    if (location) where.location = { path: { startsWith: location.path } };
    else where.locationId = filters.locationId;
  }
  if (filters.overdue) {
    where.status = { in: OPEN_STATUSES };
    where.OR = [{ dueDate: { lt: now } }, { dueDate: null, scheduledFor: { lt: now } }];
  }
  if (filters.from || filters.to) {
    where.scheduledFor = { ...(filters.from ? { gte: toDate(filters.from) } : {}), ...(filters.to ? { lte: toDate(filters.to) } : {}) };
  }
  if (filters.search) {
    const search = String(filters.search).trim();
    if (search) {
      const or = [{ ref: { contains: search, mode: "insensitive" } }, { title: { contains: search, mode: "insensitive" } }, { location: { name: { contains: search, mode: "insensitive" } } }];
      where.AND = [...(where.AND || []), { OR: or }];
    }
  }
  const rows = await prisma.formInstance.findMany({
    where,
    include: instanceInclude,
    orderBy: [{ status: "asc" }, { scheduledFor: "asc" }, { number: "desc" }],
    take: Math.min(Number(filters.limit) || MAX_LIST, MAX_LIST),
  });
  const items = rows.map((row) => serializeInstance(row, { now }));
  const byStatus = {};
  const byType = {};
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byType[item.type] = (byType[item.type] || 0) + 1;
  }
  return {
    items,
    summary: {
      total: items.length,
      open: items.filter((item) => OPEN_STATUSES.includes(item.status)).length,
      overdue: items.filter((item) => item.isOverdue).length,
      failed: items.filter((item) => item.outcome === "fail").length,
      awaitingClose: items.filter((item) => item.status === STATUS.COMPLETE).length,
      holdPointsOpen: items.filter((item) => item.type === "itp" && item.status !== STATUS.VOID).reduce((sum, item) => sum + (item.summary?.holdPointsOpen || 0), 0),
      byStatus,
      byType,
    },
  };
};

const updateInstance = async ({ orgId, projectId, instanceId, payload = {}, actor = null }) => {
  const existing = await loadInstance({ orgId, projectId, instanceId });
  if (!OPEN_STATUSES.includes(existing.status)) throw new HttpError(409, "FORM_INSTANCE_LOCKED", `A ${existing.status.replace(/_/g, " ")} inspection cannot be edited`);
  const data = normalizeInstancePayload(payload, { partial: true });
  await validateReferences({ orgId, projectId, data });
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.formInstance.update({ where: { id: instanceId }, data: { ...data, updatedBy: actor?.id || null }, include: instanceInclude });
    const withBall = await tx.formInstance.update({ where: { id: instanceId }, data: { ballInCourtUserId: ballInCourtFor(row) }, include: instanceInclude });
    await audit({ tx, orgId, projectId, instance: withBall, action: auditService.ACTIONS.UPDATED, actor, summary: { changed: Object.keys(data) } });
    return withBall;
  });
  const reassigned = (data.assigneeUserId && data.assigneeUserId !== existing.assigneeUserId) || (data.inspectorUserId && data.inspectorUserId !== existing.inspectorUserId);
  if (reassigned) {
    await notify({
      orgId,
      projectId,
      instance: updated,
      actor,
      recipientUserIds: [data.assigneeUserId, data.inspectorUserId],
      category: notificationService.NOTIFICATION_CATEGORIES.ASSIGNMENT,
      event: "inspection.assigned",
      title: `${updated.ref} assigned: ${updated.title}`,
      message: [TYPE_LABEL[updated.type], updated.location?.name, updated.scheduledFor ? `on ${formatDate(updated.scheduledFor)}` : null].filter(Boolean).join(" · "),
    });
  }
  return enrichInstance({ instance: updated });
};

const deleteInstance = async ({ orgId, projectId, instanceId, actor = null }) => {
  const existing = await loadInstance({ orgId, projectId, instanceId });
  if (existing.status !== STATUS.SCHEDULED) throw new HttpError(409, "FORM_INSTANCE_NOT_DELETABLE", "Only scheduled inspections can be deleted; void the others");
  const answers = await prisma.formItemResponse.count({ where: { instanceId } });
  if (answers) throw new HttpError(409, "FORM_INSTANCE_NOT_DELETABLE", "This inspection already has answers; void it instead");
  await prisma.$transaction(async (tx) => {
    await audit({ tx, orgId, projectId, instance: existing, action: auditService.ACTIONS.DELETED, actor, oldStatus: existing.status, newStatus: null });
    await tx.formInstance.delete({ where: { id: instanceId } });
  });
  return { deleted: true, id: instanceId };
};

const validateResponseValue = ({ item, value, note }) => {
  if (value === null || value === undefined || value === "") return { value: null, numberValue: null, isDeficient: false };
  const text = String(value).trim();
  switch (item.responseType) {
    case "pass_fail":
      if (!["pass", "fail", "na"].includes(text)) throw new HttpError(400, "FORM_RESPONSE_INVALID", `"${item.label}": answer pass, fail or na`);
      return { value: text, numberValue: null, isDeficient: text === "fail" };
    case "yes_no":
      if (!["yes", "no", "na"].includes(text)) throw new HttpError(400, "FORM_RESPONSE_INVALID", `"${item.label}": answer yes, no or na`);
      return { value: text, numberValue: null, isDeficient: text === "no" };
    case "checkbox": {
      const checked = text === "checked" || text === "true" || text === "1";
      return { value: checked ? "checked" : "unchecked", numberValue: null, isDeficient: false };
    }
    case "text":
      return { value: text.slice(0, 4000), numberValue: null, isDeficient: false };
    case "number": {
      const number = Number(text);
      if (!Number.isFinite(number)) throw new HttpError(400, "FORM_RESPONSE_INVALID", `"${item.label}": enter a number`);
      const options = item.optionsJson && typeof item.optionsJson === "object" && !Array.isArray(item.optionsJson) ? item.optionsJson : {};
      const outOfRange = (options.min !== null && options.min !== undefined && number < options.min) || (options.max !== null && options.max !== undefined && number > options.max);
      return { value: String(number), numberValue: number, isDeficient: Boolean(outOfRange) };
    }
    case "choice": {
      const options = Array.isArray(item.optionsJson) ? item.optionsJson : [];
      if (!options.includes(text)) throw new HttpError(400, "FORM_RESPONSE_INVALID", `"${item.label}": choose one of ${options.join(", ")}`);
      return { value: text, numberValue: null, isDeficient: false };
    }
    case "date": {
      const date = toDate(text);
      if (!date) throw new HttpError(400, "FORM_RESPONSE_INVALID", `"${item.label}": enter a date`);
      return { value: date.toISOString().slice(0, 10), numberValue: null, isDeficient: false };
    }
    case "photo":
      return { value: "provided", numberValue: null, isDeficient: false };
    case "signature":
      return { value: "signed", numberValue: null, isDeficient: false };
    default:
      return { value: text, numberValue: null, isDeficient: Boolean(note) && false };
  }
};

/** Saves answers (bulk upsert); starting a scheduled inspection on the first answer. */
const respond = async ({ orgId, projectId, instanceId, responses = [], actor = null, viewer = null }) => {
  const existing = await loadInstance({ orgId, projectId, instanceId });
  if (viewer) assertVisible(existing, viewer);
  if (!OPEN_STATUSES.includes(existing.status)) throw new HttpError(409, "FORM_INSTANCE_LOCKED", `A ${existing.status.replace(/_/g, " ")} inspection cannot be answered`);
  if (!Array.isArray(responses) || !responses.length) throw new HttpError(400, "FORM_RESPONSES_REQUIRED", "Send at least one answer");
  if (responses.length > MAX_ITEMS) throw new HttpError(400, "FORM_TOO_MANY_ITEMS", "Too many answers in one request");
  const { items } = await templateStructure(existing.templateId);
  const byId = new Map(items.map((item) => [item.id, item]));
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    let deficientAdded = 0;
    for (const entry of responses) {
      const item = byId.get(entry?.itemId);
      if (!item) throw new HttpError(400, "FORM_ITEM_NOT_FOUND", "An answer refers to an item that is not on this template");
      const note = trimOrNull(entry.note)?.slice(0, 2000) || null;
      const parsed = validateResponseValue({ item, value: entry.value, note });
      if (parsed.value === null && !note) {
        await tx.formItemResponse.deleteMany({ where: { instanceId, itemId: item.id, deficiencyRecordId: null } });
        continue;
      }
      const previous = await tx.formItemResponse.findUnique({ where: { instanceId_itemId: { instanceId, itemId: item.id } } });
      if (parsed.isDeficient && !previous?.isDeficient) deficientAdded += 1;
      await tx.formItemResponse.upsert({
        where: { instanceId_itemId: { instanceId, itemId: item.id } },
        create: { instanceId, itemId: item.id, value: parsed.value, numberValue: parsed.numberValue, note, isDeficient: parsed.isDeficient, answeredBy: actor?.id || null, answeredAt: now },
        update: { value: parsed.value, numberValue: parsed.numberValue, note, isDeficient: parsed.isDeficient, answeredBy: actor?.id || null, answeredAt: now },
      });
    }
    const { summary } = await persistSummary(tx, { instanceId, templateId: existing.templateId });
    const data = { updatedBy: actor?.id || null };
    if (existing.status === STATUS.SCHEDULED) {
      data.status = STATUS.IN_PROGRESS;
      data.startedAt = now;
    }
    const row = await tx.formInstance.update({ where: { id: instanceId }, data, include: instanceInclude });
    await tx.formInstance.update({ where: { id: instanceId }, data: { ballInCourtUserId: ballInCourtFor(row) } });
    await audit({
      tx,
      orgId,
      projectId,
      instance: row,
      action: existing.status === STATUS.SCHEDULED ? auditService.ACTIONS.STATUS_CHANGED : auditService.ACTIONS.UPDATED,
      actor,
      oldStatus: existing.status,
      newStatus: row.status,
      summary: { answers: responses.length, answered: summary.answered, total: summary.total, deficient: summary.deficient, deficientAdded },
    });
    return row;
  });
  return enrichInstance({ instance: updated });
};

const startInstance = async ({ orgId, projectId, instanceId, actor = null, viewer = null }) => {
  const existing = await loadInstance({ orgId, projectId, instanceId });
  if (viewer) assertVisible(existing, viewer);
  if (existing.status !== STATUS.SCHEDULED) throw new HttpError(409, "FORM_TRANSITION_INVALID", `Cannot start an inspection that is ${existing.status.replace(/_/g, " ")}`);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.formInstance.update({ where: { id: instanceId }, data: { status: STATUS.IN_PROGRESS, startedAt: new Date(), updatedBy: actor?.id || null }, include: instanceInclude });
    await tx.formInstance.update({ where: { id: instanceId }, data: { ballInCourtUserId: ballInCourtFor(row) } });
    await audit({ tx, orgId, projectId, instance: row, action: auditService.ACTIONS.STATUS_CHANGED, actor, oldStatus: existing.status, newStatus: row.status });
    return row;
  });
  return enrichInstance({ instance: updated });
};

const completionProblems = ({ items, responses, signatures, photoCounts, settings }) => {
  const byItem = new Map(responses.map((response) => [response.itemId, response]));
  const problems = [];
  for (const item of items) {
    const response = byItem.get(item.id);
    const photos = photoCounts.get(response?.id) || 0;
    if (item.responseType === "photo") {
      if (item.required && photos === 0) problems.push({ itemId: item.id, label: item.label, reason: "photo" });
      continue;
    }
    if (item.responseType === "signature") {
      if (item.required && !signatures.some((signature) => signature.itemId === item.id)) problems.push({ itemId: item.id, label: item.label, reason: "signature" });
      continue;
    }
    if (item.required && !isAnswered(response)) problems.push({ itemId: item.id, label: item.label, reason: "answer" });
    else if (item.photoRequired && isAnswered(response) && response.value !== "na" && photos === 0) problems.push({ itemId: item.id, label: item.label, reason: "photo" });
  }
  for (const role of settings.requireSignatures || []) {
    if (!signatures.some((signature) => signature.role === role && !signature.itemId)) problems.push({ role, reason: "signature_role", label: `${role} signature` });
  }
  return problems;
};

const completeInstance = async ({ orgId, projectId, instanceId, actor = null, viewer = null }) => {
  const existing = await loadInstance({ orgId, projectId, instanceId });
  if (viewer) assertVisible(existing, viewer);
  if (!OPEN_STATUSES.includes(existing.status)) throw new HttpError(409, "FORM_TRANSITION_INVALID", `Cannot complete an inspection that is ${existing.status.replace(/_/g, " ")}`);
  const settings = normalizeSettings(existing.template?.settingsJson);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const { summary, items, responses, signatures, photoCounts } = await persistSummary(tx, { instanceId, templateId: existing.templateId });
    const problems = completionProblems({ items, responses, signatures, photoCounts, settings });
    if (problems.length) {
      throw new HttpError(400, "FORM_INCOMPLETE", `${problems.length} item${problems.length === 1 ? "" : "s"} still need${problems.length === 1 ? "s" : ""} attention before this can be completed`, { problems });
    }
    const outcome = summary.failed > 0 || summary.deficient > 0 ? "fail" : "pass";
    const row = await tx.formInstance.update({
      where: { id: instanceId },
      data: { status: STATUS.COMPLETE, outcome, completedAt: now, completedBy: actor?.id || null, startedAt: existing.startedAt || now, updatedBy: actor?.id || null },
      include: instanceInclude,
    });
    const withBall = await tx.formInstance.update({ where: { id: instanceId }, data: { ballInCourtUserId: ballInCourtFor(row) }, include: instanceInclude });
    await audit({ tx, orgId, projectId, instance: withBall, action: auditService.ACTIONS.STATUS_CHANGED, actor, oldStatus: existing.status, newStatus: STATUS.COMPLETE, summary: { outcome, ...summary } });

    // Recurring inspections: schedule the next one.
    let next = null;
    const recurrence = existing.recurrenceJson;
    const anchor = existing.scheduledFor || existing.dueDate;
    if (recurrence && recurrence.every && anchor) {
      const nextDate = addRecurrence(anchor, recurrence);
      if (!recurrence.until || nextDate <= new Date(recurrence.until)) {
        const number = await nextNumber(tx, { projectId, type: existing.type });
        next = await tx.formInstance.create({
          data: {
            orgId,
            projectId,
            templateId: existing.templateId,
            templateVersion: existing.templateVersion,
            number,
            ref: refFor(existing.type, number),
            type: existing.type,
            title: existing.title,
            status: STATUS.SCHEDULED,
            activityId: existing.activityId,
            locationId: existing.locationId,
            sheetId: existing.sheetId,
            assigneeUserId: existing.assigneeUserId,
            assigneeCompanyId: existing.assigneeCompanyId,
            inspectorUserId: existing.inspectorUserId,
            approverUserId: existing.approverUserId,
            ballInCourtUserId: ballInCourtFor({ ...existing, status: STATUS.SCHEDULED }),
            scheduledFor: existing.scheduledFor ? nextDate : null,
            dueDate: existing.dueDate ? addRecurrence(existing.dueDate, recurrence) : null,
            recurrenceJson: recurrence,
            summaryJson: computeSummary({ items, responses: [] }),
            createdBy: actor?.id || null,
            updatedBy: actor?.id || null,
          },
          include: instanceInclude,
        });
        await audit({ tx, orgId, projectId, instance: next, action: auditService.ACTIONS.CREATED, actor, newStatus: STATUS.SCHEDULED, summary: { recurringFrom: existing.ref } });
      }
    }
    return { instance: withBall, next, outcome, summary };
  });

  await notify({
    orgId,
    projectId,
    instance: result.instance,
    actor,
    recipientUserIds: [result.instance.approverUserId, result.instance.createdBy],
    category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL,
    event: "inspection.complete",
    title: `${result.instance.ref} complete — ${result.outcome === "pass" ? "passed" : "failed"}`,
    message: [`${result.summary.answered}/${result.summary.total} answered`, result.summary.deficient ? `${result.summary.deficient} deficient` : null, result.summary.holdPointsOpen ? `${result.summary.holdPointsOpen} hold point${result.summary.holdPointsOpen === 1 ? "" : "s"} open` : null].filter(Boolean).join(" · "),
    priority: result.outcome === "fail" ? "high" : "normal",
  });
  if (result.next) {
    await notify({
      orgId,
      projectId,
      instance: result.next,
      actor,
      recipientUserIds: [result.next.assigneeUserId, result.next.inspectorUserId],
      category: notificationService.NOTIFICATION_CATEGORIES.ASSIGNMENT,
      event: "inspection.scheduled",
      title: `${result.next.ref} scheduled: ${result.next.title}`,
      message: result.next.scheduledFor ? `Next ${TYPE_LABEL[result.next.type].toLowerCase()} on ${formatDate(result.next.scheduledFor)}` : `Recurring ${TYPE_LABEL[result.next.type].toLowerCase()}`,
    });
  }
  const enriched = await enrichInstance({ instance: result.instance });
  return { ...enriched, nextInstance: result.next ? serializeInstance(result.next) : null };
};

const transition = async ({ orgId, projectId, instanceId, action, reason = null, actor = null }) => {
  const existing = await loadInstance({ orgId, projectId, instanceId });
  const text = trimOrNull(reason);
  const rules = {
    close: { from: [STATUS.COMPLETE], to: STATUS.CLOSED, data: { closedAt: new Date(), closedBy: actor?.id || null } },
    reopen: { from: [STATUS.COMPLETE, STATUS.CLOSED], to: STATUS.IN_PROGRESS, reasonRequired: true, data: { outcome: null, completedAt: null, completedBy: null, closedAt: null, closedBy: null, reopenReason: text } },
    void: { from: [STATUS.SCHEDULED, STATUS.IN_PROGRESS, STATUS.COMPLETE], to: STATUS.VOID, reasonRequired: true, data: { reopenReason: text } },
  };
  const rule = rules[action];
  if (!rule) throw new HttpError(400, "FORM_ACTION_INVALID", `Unknown action: ${action}`);
  if (!rule.from.includes(existing.status)) throw new HttpError(409, "FORM_TRANSITION_INVALID", `Cannot ${action} an inspection that is ${existing.status.replace(/_/g, " ")}`);
  if (rule.reasonRequired && !text) throw new HttpError(400, "FORM_REASON_REQUIRED", "Give a reason");
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.formInstance.update({ where: { id: instanceId }, data: { status: rule.to, updatedBy: actor?.id || null, ...rule.data }, include: instanceInclude });
    const withBall = await tx.formInstance.update({ where: { id: instanceId }, data: { ballInCourtUserId: ballInCourtFor(row) }, include: instanceInclude });
    await audit({ tx, orgId, projectId, instance: withBall, action: auditService.ACTIONS.STATUS_CHANGED, actor, oldStatus: existing.status, newStatus: rule.to, reason: text });
    return withBall;
  });
  const titles = { close: `${updated.ref} closed`, reopen: `${updated.ref} reopened`, void: `${updated.ref} voided` };
  await notify({
    orgId,
    projectId,
    instance: updated,
    actor,
    recipientUserIds: [updated.assigneeUserId, updated.inspectorUserId, updated.createdBy, action === "close" ? null : updated.approverUserId],
    category: action === "reopen" ? notificationService.NOTIFICATION_CATEGORIES.ASSIGNMENT : notificationService.NOTIFICATION_CATEGORIES.QUALITY,
    event: `inspection.${action}`,
    title: titles[action],
    message: text || updated.title,
  });
  return enrichInstance({ instance: updated });
};

/** Stores a drawn signature (PNG data URL) as a project document and a Signature row. */
const sign = async ({ orgId, projectId, instanceId, payload = {}, actor = null, viewer = null, meta = {} }) => {
  const existing = await loadInstance({ orgId, projectId, instanceId });
  if (viewer) assertVisible(existing, viewer);
  if (existing.status === STATUS.VOID || existing.status === STATUS.CLOSED) throw new HttpError(409, "FORM_INSTANCE_LOCKED", "A closed inspection cannot be signed");
  const role = SIGNATURE_ROLES.includes(payload.role) ? payload.role : null;
  if (!role) throw new HttpError(400, "FORM_SIGNATURE_ROLE_INVALID", `Role must be one of ${SIGNATURE_ROLES.join(", ")}`);
  const signerName = trimOrNull(payload.signerName) || actor?.name || null;
  if (!signerName) throw new HttpError(400, "FORM_SIGNER_NAME_REQUIRED", "Who is signing?");
  const itemId = isUuid(payload.itemId) ? payload.itemId : null;
  if (itemId) {
    const item = await prisma.formItem.findFirst({ where: { id: itemId, templateId: existing.templateId }, select: { id: true, responseType: true } });
    if (!item) throw new HttpError(400, "FORM_ITEM_NOT_FOUND", "Signature item not found on this template");
    if (item.responseType !== "signature") throw new HttpError(400, "FORM_ITEM_NOT_SIGNATURE", "That item does not take a signature");
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(payload.image || ""));
  if (!match) throw new HttpError(400, "FORM_SIGNATURE_IMAGE_INVALID", "Send the signature as a PNG data URL");
  const buffer = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_SIGNATURE_BYTES) throw new HttpError(400, "FORM_SIGNATURE_IMAGE_INVALID", `Signature image must be under ${Math.round(MAX_SIGNATURE_BYTES / 1024)} KB`);
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new HttpError(400, "FORM_SIGNATURE_IMAGE_INVALID", "Signature image must be a PNG");

  const document = await fileStorageService.uploadProjectDocument({
    orgId,
    projectId,
    userId: actor?.id || null,
    file: { buffer, originalname: `signature-${role}-${existing.ref}.png`, mimetype: "image/png", size: buffer.length },
    documentType: fileStorageService.DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
    linkedEntityType: "form_instance",
    linkedEntityId: existing.id,
  });
  await attachmentService.createAttachments({
    orgId,
    projectId,
    userId: actor?.id || null,
    userRole: actor?.role || null,
    recordType: "form_instance",
    recordId: existing.id,
    role: "signature",
    caption: `${role} signature — ${signerName}`,
    documentIds: [document.id],
  });

  const signature = await prisma.$transaction(async (tx) => {
    await tx.signature.deleteMany({ where: { instanceId: existing.id, role, itemId, ...(actor?.id ? { userId: actor.id } : { signerName }) } });
    const row = await tx.signature.create({
      data: {
        orgId,
        projectId,
        recordType: "form_instance",
        recordId: existing.id,
        instanceId: existing.id,
        itemId,
        role,
        userId: actor?.id || null,
        signerName: signerName.slice(0, 200),
        signerCompany: trimOrNull(payload.signerCompany)?.slice(0, 200) || null,
        documentId: document.id,
        ipAddress: trimOrNull(meta.ip)?.slice(0, 64) || null,
        userAgent: trimOrNull(meta.userAgent)?.slice(0, 300) || null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    if (itemId) {
      await tx.formItemResponse.upsert({
        where: { instanceId_itemId: { instanceId: existing.id, itemId } },
        create: { instanceId: existing.id, itemId, value: "signed", answeredBy: actor?.id || null, answeredAt: new Date() },
        update: { value: "signed", answeredBy: actor?.id || null, answeredAt: new Date() },
      });
    }
    await persistSummary(tx, { instanceId: existing.id, templateId: existing.templateId });
    if (existing.status === STATUS.SCHEDULED) await tx.formInstance.update({ where: { id: existing.id }, data: { status: STATUS.IN_PROGRESS, startedAt: new Date() } });
    await audit({ tx, orgId, projectId, instance: existing, action: auditService.ACTIONS.UPDATED, actor, summary: { signed: role, signerName, itemId } });
    return row;
  });
  return { signature: serializeSignature(signature, projectId), instance: await getInstance({ orgId, projectId, instanceId }) };
};

/** Turns a deficient answer into a punch item (observation target lands with OBS-015). */
const raiseDeficiency = async ({ orgId, projectId, instanceId, itemId, payload = {}, actor = null, viewer = null }) => {
  const existing = await loadInstance({ orgId, projectId, instanceId });
  if (viewer) assertVisible(existing, viewer);
  const item = await prisma.formItem.findFirst({ where: { id: itemId, templateId: existing.templateId } });
  if (!item) throw new HttpError(404, "FORM_ITEM_NOT_FOUND", "Item not found on this template");
  const response = await prisma.formItemResponse.findUnique({ where: { instanceId_itemId: { instanceId, itemId } } });
  if (response?.deficiencyRecordId) throw new HttpError(409, "FORM_DEFICIENCY_EXISTS", "This item already has a linked record");
  const target = payload.target === "observation" ? "observation" : "punch_item";
  const punchService = require("./punch.service");
  const record = await punchService.createPunchItem({
    orgId,
    projectId,
    actor,
    payload: {
      ...(target === "observation"
        ? {
            kind: "observation",
            observationType: payload.observationType || (existing.type === "talk" ? "safety" : "quality"),
            hazard: trimOrNull(payload.hazard),
            contributingCondition: trimOrNull(payload.contributingCondition),
          }
        : {}),
      sourceRecordType: "form_instance",
      sourceRecordId: existing.id,
      title: trimOrNull(payload.title) || `${item.label} — ${existing.ref}`,
      description: [response?.note, `Raised from ${existing.ref} · ${existing.title}`].filter(Boolean).join("\n"),
      priority: ["low", "normal", "high", "urgent"].includes(payload.priority) ? payload.priority : "normal",
      trade: trimOrNull(payload.trade),
      locationId: existing.locationId,
      locationText: trimOrNull(payload.locationText),
      sheetId: existing.sheetId,
      activityId: existing.activityId,
      assigneeCompanyId: payload.assigneeCompanyId || existing.assigneeCompanyId || null,
      assigneeUserId: payload.assigneeUserId || null,
      managerUserId: payload.managerUserId || existing.inspectorUserId || actor?.id || null,
      finalApproverUserId: payload.finalApproverUserId || existing.approverUserId || null,
      dueDate: payload.dueDate || null,
      status: "open",
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.formItemResponse.upsert({
      where: { instanceId_itemId: { instanceId, itemId } },
      create: { instanceId, itemId, value: null, isDeficient: true, deficiencyRecordType: target, deficiencyRecordId: record.id, answeredBy: actor?.id || null, answeredAt: new Date() },
      update: { isDeficient: true, deficiencyRecordType: target, deficiencyRecordId: record.id },
    });
    await persistSummary(tx, { instanceId, templateId: existing.templateId });
    await audit({ tx, orgId, projectId, instance: existing, action: auditService.ACTIONS.UPDATED, actor, summary: { deficiency: item.label, [target === "observation" ? "observation" : "punchItem"]: record.ref } });
  });
  return { record, instance: await getInstance({ orgId, projectId, instanceId }) };
};

/**
 * ITP hold points on an activity that have not passed. Used by progress
 * approval; returns [] when the tables are not present (older test doubles).
 */
const openHoldPoints = async ({ projectId, activityId }, tx = prisma) => {
  if (!activityId || !tx.formInstance?.findMany) return [];
  const instances = await tx.formInstance.findMany({
    where: { projectId, activityId, type: "itp", status: { not: STATUS.VOID } },
    select: { id: true, ref: true, title: true, status: true, templateId: true, responses: { select: { itemId: true, value: true } } },
    orderBy: { number: "asc" },
  });
  if (!instances.length) return [];
  const items = await tx.formItem.findMany({ where: { templateId: { in: uniqueIds(instances.map((instance) => instance.templateId)) }, isHoldPoint: true }, select: { id: true, templateId: true, label: true, isHoldPoint: true } });
  const result = [];
  for (const instance of instances) {
    const holdItems = items.filter((item) => item.templateId === instance.templateId);
    result.push(...holdPointsFor({ instance, items: holdItems, responses: instance.responses }).filter((point) => point.state !== "passed"));
  }
  return result;
};

const readDocumentBytes = async ({ orgId, projectId, document }) => {
  const file = await fileStorageService.getProjectDocumentFile({ orgId, projectId, key: document.id, documentType: document.documentType });
  if (file.path) return require("fs/promises").readFile(file.path);
  if (file.redirectUrl) {
    const response = await fetch(file.redirectUrl, { signal: AbortSignal.timeout(30_000) });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
  }
  return null;
};

const valueLabel = (item, response) => {
  if (!response || !isAnswered(response)) return item.responseType === "photo" && response ? "Photo" : "—";
  const value = response.value;
  if (item.responseType === "number") return `${value}${item.optionsJson?.unit ? ` ${item.optionsJson.unit}` : ""}`;
  if (item.responseType === "checkbox") return value === "checked" ? "Yes" : "No";
  if (value === "na") return "N/A";
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
};

const exportInstancePdf = async ({ orgId, projectId, instanceId, includePhotos = false, viewer = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const instance = await loadInstance({ orgId, projectId, instanceId });
  if (viewer) assertVisible(instance, viewer);
  const full = await enrichInstance({ instance });
  const doc = createPdf({ title: `${full.ref} ${full.title}`, author: project.name, pageSize: "A4", footer: `${project.name} · ${full.ref} · generated ${formatDate(new Date())}` });
  doc.heading(`${full.ref} · ${full.title}`);
  doc.keyValues([
    ["Type", full.typeLabel],
    ["Template", `${full.template?.name || ""} v${full.templateVersion}`],
    ["Status", `${full.status.replace(/_/g, " ")}${full.outcome ? ` · ${full.outcome}` : ""}`],
    ["Activity", full.activity?.name || "—"],
    ["Location", full.location?.name || "—"],
    ["Drawing", full.sheet ? `${full.sheet.number} ${full.sheet.title}` : "—"],
    ["Company", full.assigneeCompany?.name || "—"],
    ["Assignee", full.assigneeUser?.name || "—"],
    ["Inspector", full.inspectorUser?.name || "—"],
    ["Approver", full.approverUser?.name || "—"],
    ["Scheduled", full.scheduledFor ? formatDate(full.scheduledFor) : "—"],
    ["Completed", full.completedAt ? formatDate(full.completedAt) : "—"],
  ]);
  if (full.summary) {
    doc.paragraph(`${full.summary.answered}/${full.summary.total} answered · ${full.summary.passed} passed · ${full.summary.failed} failed · ${full.summary.na} N/A · ${full.summary.deficient} deficient${full.summary.holdPoints ? ` · ${full.summary.holdPointsOpen} of ${full.summary.holdPoints} hold points open` : ""}`, { size: 9 });
  }
  let index = 0;
  const photoBuffers = [];
  for (const section of full.sections) {
    doc.heading(section.title, { level: 2 });
    doc.table({
      columns: [
        { key: "n", label: "#", width: 24, align: "right" },
        { key: "label", label: "Item", width: 0.55 },
        { key: "result", label: "Result", width: 70 },
        { key: "note", label: "Notes", width: 0.45 },
      ],
      rows: section.items.map((item) => {
        index += 1;
        return {
          n: String(index),
          label: `${item.label}${item.isHoldPoint ? " [HOLD]" : item.inspectionPointType ? ` [${item.inspectionPointType.toUpperCase()}]` : ""}${item.reference ? ` (${item.reference})` : ""}`,
          result: valueLabel(item, item.response),
          note: [item.response?.note, item.response?.deficiencyRecordType ? `→ ${item.response.deficiencyRecordType.replace(/_/g, " ")}` : null, item.response?.photoCount ? `${item.response.photoCount} photo${item.response.photoCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · "),
        };
      }),
      size: 8.5,
      zebra: true,
    });
  }
  if (full.signatures.length) {
    doc.heading("Signatures", { level: 2 });
    doc.table({
      columns: [
        { key: "role", label: "Role", width: 90 },
        { key: "name", label: "Name", width: 0.5 },
        { key: "company", label: "Company", width: 0.5 },
        { key: "at", label: "Signed", width: 110 },
      ],
      rows: full.signatures.map((signature) => ({ role: signature.role, name: signature.signerName, company: signature.signerCompany || "", at: new Date(signature.signedAt).toLocaleString("en-GB") })),
      size: 8.5,
    });
  }
  if (includePhotos) {
    const responseIds = full.sections.flatMap((section) => section.items.map((item) => item.response?.id).filter(Boolean));
    const attachments = responseIds.length
      ? await prisma.attachment.findMany({
          where: { projectId, recordType: "form_response", recordId: { in: responseIds }, document: { mimeType: "image/jpeg" } },
          include: { document: true },
          orderBy: { createdAt: "asc" },
          take: 40,
        })
      : [];
    for (const attachment of attachments) {
      try {
        const buffer = await readDocumentBytes({ orgId, projectId, document: attachment.document });
        if (buffer) photoBuffers.push(buffer);
      } catch {
        // A missing photo never blocks the export.
      }
    }
    if (photoBuffers.length) {
      doc.heading("Photos", { level: 2 });
      for (let offset = 0; offset < photoBuffers.length; offset += 3) doc.imageRow(photoBuffers.slice(offset, offset + 3), { width: 160 });
    }
  }
  const fileName = `${full.ref.toLowerCase()}-${full.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "inspection"}.pdf`;
  return { buffer: doc.render(), fileName, photos: photoBuffers.length };
};

module.exports = {
  TYPES,
  TYPE_LABEL,
  TYPE_PREFIX,
  RESPONSE_TYPES,
  POINT_TYPES,
  STATUS,
  STATUSES,
  OUTCOMES,
  SIGNATURE_ROLES,
  RECURRENCE_UNITS,
  STARTER_TEMPLATES,
  normalizeSections,
  normalizeSettings,
  computeSummary,
  completionProblems,
  validateResponseValue,
  ballInCourtFor,
  visibilityWhere,
  holdPointsFor,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  archiveTemplate,
  duplicateTemplate,
  seedStarterTemplates,
  listInstances,
  getInstance,
  createInstance,
  updateInstance,
  deleteInstance,
  respond,
  startInstance,
  completeInstance,
  transition,
  sign,
  raiseDeficiency,
  openHoldPoints,
  exportInstancePdf,
};
