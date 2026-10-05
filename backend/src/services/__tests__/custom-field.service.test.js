const store = { definitions: [], fieldsets: [], projectFieldsets: [], recordTypes: [], values: [], rfis: [], changeOrders: [], tasks: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (key === "AND") return expected.every((clause) => matches(row, clause));
    if (key === "NOT") return !matches(row, expected);
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ("in" in expected) return expected.in.includes(row[key]);
      if ("not" in expected) return row[key] !== expected.not;
      return matches(row[key] || {}, expected);
    }
    return row[key] === expected;
  });
const withCount = (row) => ({ ...row, _count: { values: store.values.filter((value) => value.fieldId === row.id).length, projectFieldsets: store.projectFieldsets.filter((item) => item.fieldsetId === row.id).length } });
const table = (rows, prefix, { include = null } = {}) => ({
  findMany: jest.fn(async ({ where } = {}) => rows.filter((row) => matches(row, where)).map((row) => (include ? include(withCount(row)) : withCount(row)))),
  findFirst: jest.fn(async ({ where } = {}) => {
    const row = rows.find((item) => matches(item, where));
    return row ? (include ? include(withCount(row)) : withCount(row)) : null;
  }),
  count: jest.fn(async ({ where } = {}) => rows.filter((row) => matches(row, where)).length),
  create: jest.fn(async ({ data }) => {
    const row = { id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), status: "active", ...data };
    rows.push(row);
    return include ? include(withCount(row)) : withCount(row);
  }),
  update: jest.fn(async ({ where, data }) => {
    const row = rows.find((item) => item.id === where.id);
    Object.assign(row, data);
    return include ? include(withCount(row)) : withCount(row);
  }),
  updateMany: jest.fn(async ({ where, data }) => {
    let count = 0;
    for (const row of rows) if (matches(row, where)) Object.assign(row, data) && (count += 1);
    return { count };
  }),
  upsert: jest.fn(async ({ where, update, create }) => {
    const key = where.recordId_fieldId || where.projectId_recordType;
    const row = rows.find((item) => Object.entries(key).every(([k, v]) => item[k] === v));
    if (row) Object.assign(row, update);
    else rows.push({ id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), ...create });
    return row || rows[rows.length - 1];
  }),
  deleteMany: jest.fn(async ({ where }) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], where)) rows.splice(i, 1);
    return { count: before - rows.length };
  }),
  groupBy: jest.fn(async ({ where }) => {
    const counts = new Map();
    for (const row of rows.filter((item) => matches(item, where))) counts.set(row.recordType, (counts.get(row.recordType) || 0) + 1);
    return [...counts].map(([recordType, count]) => ({ recordType, _count: { _all: count } }));
  }),
});

const mockPrisma = {};
mockPrisma.$transaction = jest.fn((fn) => fn(mockPrisma));
mockPrisma.customFieldDefinition = table(store.definitions, "field");
mockPrisma.customFieldset = table(store.fieldsets, "fieldset");
mockPrisma.projectFieldset = table(store.projectFieldsets, "pfs", { include: (row) => ({ ...row, fieldset: store.fieldsets.find((item) => item.id === row.fieldsetId) || null }) });
mockPrisma.recordTypeDefinition = table(store.recordTypes, "rt", { include: (row) => ({ ...row, fieldset: row.fieldsetId ? store.fieldsets.find((item) => item.id === row.fieldsetId) || null : null }) });
mockPrisma.customFieldValue = table(store.values, "val", { include: (row) => ({ ...row, field: store.definitions.find((item) => item.id === row.fieldId) || null }) });
// The records values are written for: a value is read and written only for a
// record of the route's project (certification L45).
mockPrisma.rfi = table(store.rfis, "rfi");
mockPrisma.changeOrder = table(store.changeOrders, "co");
mockPrisma.task = table(store.tasks, "task");
// The organisation's people: USER belongs to org-1; anyone else does not (a person
// field names this company's people only — certification L38 review, M8). A query
// scoped to an organisation (userInOrgWhere) sees only that organisation's people.
const ORG_PEOPLE = { "org-1": ["33333333-3333-4333-8333-333333333333"] };
mockPrisma.user = { findMany: jest.fn(async ({ where }) => where.id.in.filter((id) => !where.orgId || (ORG_PEOPLE[where.orgId] || []).includes(id)).map((id) => ({ id, name: `User ${id}`, email: null }))) };
mockPrisma.company = { findMany: jest.fn(async ({ where }) => where.id.in.map((id) => ({ id, name: `Company ${id}` }))) };
const mockAudit = {
  ENTITY_TYPES: { CUSTOM_FIELD: "custom_field", CUSTOM_FIELDSET: "custom_fieldset", RECORD_TYPE: "record_type" },
  ACTIONS: { CREATED: "created", UPDATED: "updated" },
  recordEvent: jest.fn(async () => ({})),
  // The records' own rules as they bind a reader: the real ones (certification R16).
  recordRuleFor: (...args) => jest.requireActual("../audit.service").recordRuleFor(...args),
  withTaskVisibility: (...args) => jest.requireActual("../audit.service").withTaskVisibility(...args),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);

const service = require("../custom-field.service");

const ORG = "org-1";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const RECORD = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT = "44444444-4444-4444-8444-444444444444";
const OTHER_RECORD = "55555555-5555-4555-8555-555555555555";
const Y_RECORD = "66666666-6666-4666-8666-666666666666";
const actor = { id: "pm-1", role: "pm" };

const reset = () => {
  for (const rows of Object.values(store)) rows.length = 0;
  jest.clearAllMocks();
  // RECORD is company X's RFI (and a change order) on PROJECT; Y_RECORD company
  // Y's RFI on PROJECT; OTHER_RECORD an RFI of another project of the company.
  store.rfis.push({ id: RECORD, projectId: PROJECT, ownerPartyId: "party-x" }, { id: Y_RECORD, projectId: PROJECT, ownerPartyId: "party-y" }, { id: OTHER_RECORD, projectId: OTHER_PROJECT, ownerPartyId: "party-x" });
  store.changeOrders.push({ id: RECORD, projectId: PROJECT });
};

describe("custom fields", () => {
  beforeEach(reset);

  it("validates definitions and derives keys", async () => {
    await expect(service.createDefinition({ orgId: ORG, recordType: "nope", payload: { label: "X", type: "text" } })).rejects.toMatchObject({ code: "CUSTOM_FIELD_RECORD_TYPE_UNKNOWN" });
    await expect(service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "X", type: "banana" } })).rejects.toMatchObject({ code: "CUSTOM_FIELD_TYPE_UNKNOWN" });
    await expect(service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Zone", type: "select", options: [] } })).rejects.toMatchObject({ code: "CUSTOM_FIELD_OPTIONS" });
    await expect(service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Budget", type: "number", validation: { min: 10, max: 5 } } })).rejects.toMatchObject({ code: "CUSTOM_FIELD_VALIDATION" });
    const field = await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Contract clause #", type: "text", required: true, validation: { maxLength: 20 } }, actor });
    expect(field).toMatchObject({ key: "contract_clause", scope: "company", required: true, validation: { maxLength: 20 } });
    await expect(service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Contract clause", type: "text" } })).rejects.toMatchObject({ code: "CUSTOM_FIELD_KEY_EXISTS" });
    expect(mockAudit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ entityType: "custom_field", action: "created", summary: expect.objectContaining({ key: "contract_clause", scope: "company" }) }));
    await expect(service.updateDefinition({ orgId: ORG, projectId: PROJECT, definitionId: field.id, payload: { label: "Clause" } })).rejects.toMatchObject({ code: "CUSTOM_FIELD_SCOPE" });
  });

  it("builds the schema from company + project fields, fieldsets and record types", async () => {
    const zone = await service.createDefinition({ orgId: ORG, recordType: "correspondence", payload: { label: "Zone", type: "select", options: ["North", "South"] }, actor });
    const instructedBy = await service.createDefinition({ orgId: ORG, recordType: "correspondence", payload: { label: "Instructed by", type: "user" }, actor });
    const projectOnly = await service.createDefinition({ orgId: ORG, projectId: PROJECT, recordType: "correspondence", payload: { label: "Gate", type: "text" }, actor });
    await service.createDefinition({ orgId: ORG, projectId: "other-project", recordType: "correspondence", payload: { label: "Elsewhere", type: "text" }, actor });

    const plain = await service.schemaFor({ orgId: ORG, projectId: PROJECT, recordType: "correspondence" });
    expect(plain.fields.map((field) => field.key)).toEqual(["zone", "instructed_by", "gate"]);
    expect(plain.fields[0].options).toEqual([{ value: "North", label: "North" }, { value: "South", label: "South" }]);
    expect(plain.fieldset).toBeNull();

    const fieldset = await service.createFieldset({ orgId: ORG, payload: { recordType: "correspondence", name: "Site instruction", isDefault: false, fields: [{ fieldId: instructedBy.id, required: true }, { fieldId: zone.id, hidden: true }] }, actor });
    await expect(service.createFieldset({ orgId: ORG, payload: { recordType: "correspondence", name: "Bad", fields: [{ fieldId: "missing" }] } })).rejects.toMatchObject({ code: "CUSTOM_FIELDSET_FIELD" });
    const siteInstruction = await service.createRecordType({ orgId: ORG, payload: { tool: "correspondence", label: "Site Instruction", fieldsetId: fieldset.id, settings: { defaults: { direction: "outgoing", type: "notice" } } }, actor });
    expect(siteInstruction).toMatchObject({ key: "site_instruction", fieldset: { id: fieldset.id } });
    await expect(service.createRecordType({ orgId: ORG, payload: { tool: "rfi", label: "X" } })).rejects.toMatchObject({ code: "RECORD_TYPE_TOOL" });

    const typed = await service.schemaFor({ orgId: ORG, projectId: PROJECT, recordType: "correspondence", recordTypeKey: "site_instruction" });
    expect(typed.fieldset).toEqual({ id: fieldset.id, name: "Site instruction" });
    expect(typed.fields.map((field) => [field.key, field.required, field.hidden])).toEqual([["instructed_by", true, false], ["zone", false, true], ["gate", false, false]]);
    expect(typed.recordTypeDefinition.settings).toEqual({ defaults: { direction: "outgoing", type: "notice" } });
    expect(projectOnly.scope).toBe("project");

    await service.setProjectFieldset({ orgId: ORG, projectId: PROJECT, recordType: "correspondence", fieldsetId: fieldset.id, actor });
    const assigned = await service.schemaFor({ orgId: ORG, projectId: PROJECT, recordType: "correspondence" });
    expect(assigned.fieldset.id).toBe(fieldset.id);
    await service.setProjectFieldset({ orgId: ORG, projectId: PROJECT, recordType: "correspondence", fieldsetId: null, actor });
    expect((await service.schemaFor({ orgId: ORG, projectId: PROJECT, recordType: "correspondence" })).fieldset).toBeNull();

    await expect(service.assertRecordTypeKey({ orgId: ORG, tool: "correspondence", key: "site_instruction" })).resolves.toBe("site_instruction");
    await expect(service.assertRecordTypeKey({ orgId: ORG, tool: "correspondence", key: "memo_x" })).rejects.toMatchObject({ code: "RECORD_TYPE_UNKNOWN" });
  });

  it("coerces and validates values, honours conditions, upserts and audits on the record", async () => {
    await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Contract clause", type: "text", required: true }, actor });
    await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Claim value", type: "money", validation: { min: 0 } }, actor });
    await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Needed by", type: "date" }, actor });
    await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Trades", type: "multi_select", options: ["civil", "mep"] }, actor });
    await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Owner rep", type: "user", required: true, condition: { field: "priority", op: "eq", value: "urgent" } }, actor });

    await expect(service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, values: { claim_value: "abc" }, actor })).rejects.toMatchObject({
      code: "CUSTOM_FIELD_INVALID",
      details: { problems: expect.arrayContaining([expect.objectContaining({ key: "claim_value" }), expect.objectContaining({ key: "contract_clause", message: "Contract clause is required" })]) },
    });
    // Owner rep is required only for urgent RFIs
    await expect(service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, values: { contract_clause: "14.2" }, context: { priority: "urgent" }, actor })).rejects.toMatchObject({ details: { problems: [expect.objectContaining({ key: "owner_rep" })] } });

    const saved = await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, values: { contract_clause: " 14.2 ", claim_value: "1,250.456", needed_by: "2026-10-01T09:00:00Z", trades: "mep, civil", unknown: 1 }, context: { priority: "normal" }, actor }).catch((error) => error);
    expect(saved).toMatchObject({ code: "CUSTOM_FIELD_INVALID", details: { problems: [{ key: "unknown", message: 'Unknown field "unknown"' }] } });

    const result = await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, values: { contract_clause: " 14.2 ", claim_value: "1,250.456", needed_by: "2026-10-01T09:00:00Z", trades: "mep, civil" }, context: { priority: "normal" }, actor });
    expect(result.values).toEqual({ contract_clause: "14.2", claim_value: 1250.46, needed_by: "2026-10-01", trades: ["mep", "civil"], owner_rep: null });
    expect(store.values).toHaveLength(4);
    expect(mockAudit.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ entityType: "rfi", entityId: RECORD, action: "updated", summary: expect.objectContaining({ customFields: ["Contract clause", "Claim value", "Needed by", "Trades"] }) }));

    // partial write keeps the other keys; null removes
    const partial = await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, values: { trades: null }, partial: true, actor });
    expect(partial.values).toMatchObject({ contract_clause: "14.2", claim_value: 1250.46, trades: null });
    expect(store.values).toHaveLength(3);

    const read = await service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD });
    expect(read.values).toEqual({ contract_clause: "14.2", claim_value: 1250.46, needed_by: "2026-10-01" });
  });

  it("feeds reports and workflow rules", async () => {
    await service.createDefinition({ orgId: ORG, recordType: "change_order", payload: { label: "Funding source", type: "select", options: ["owner", "contingency"] }, actor });
    await service.createDefinition({ orgId: ORG, recordType: "change_order", payload: { label: "Approver", type: "user" }, actor });
    await service.createDefinition({ orgId: ORG, recordType: "change_order", payload: { label: "Old", type: "text" }, actor }).then((field) => service.archiveDefinition({ orgId: ORG, definitionId: field.id, actor }));
    // A person who is not a member here is refused like one who exists nowhere; nothing is stored.
    await expect(
      service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "change_order", recordId: RECORD, values: { funding_source: "contingency", approver: "99999999-9999-4999-8999-999999999999" }, actor }),
    ).rejects.toMatchObject({ code: "CUSTOM_FIELD_INVALID", details: { problems: [{ key: "approver", message: "Approver needs a person of this organisation" }] } });
    expect(store.values).toHaveLength(0);
    await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "change_order", recordId: RECORD, values: { funding_source: "contingency", approver: USER }, actor });

    const columns = await service.reportColumns({ orgId: ORG, recordType: "change_order" });
    expect(columns.map((column) => [column.key, column.reportType])).toEqual([["funding_source", "enum"], ["approver", "string"]]);
    expect(columns[0].enum).toEqual(["owner", "contingency"]);

    const rows = [{ id: RECORD }, { id: "other" }];
    await service.attachValues({ orgId: ORG, recordType: "change_order", rows });
    expect(rows[0].__custom).toEqual({ funding_source: "contingency", approver: `User ${USER}` });
    expect(rows[1].__custom).toEqual({ funding_source: null, approver: null });

    expect(await service.contextFor({ orgId: ORG, recordType: "change_order", recordId: RECORD })).toEqual({ "custom.funding_source": "contingency", "custom.approver": USER });
    expect(await service.customContextFields({ orgId: ORG, recordType: "change_order" })).toEqual([
      { key: "custom.funding_source", label: "Funding source (custom)", type: "string", options: ["owner", "contingency"] },
      { key: "custom.approver", label: "Approver (custom)", type: "string", options: null },
    ]);
    expect(await service.contextFor({ orgId: ORG, recordType: "budget_revision", recordId: RECORD })).toEqual({});

    const catalogue = await service.describeRecordTypes({ orgId: ORG });
    expect(catalogue.find((item) => item.key === "change_order")).toMatchObject({ fieldCount: 2, supportsRecordTypes: false });
    expect(catalogue.find((item) => item.key === "correspondence").supportsRecordTypes).toBe(true);
  });

  it("reads and writes values only for a record of the project they are asked on (certification L45)", async () => {
    await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Probe", type: "text" }, actor });
    // OTHER_RECORD is an RFI of another project: asked through PROJECT it is not found, and nothing is written.
    await expect(service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: OTHER_RECORD })).rejects.toMatchObject({ status: 404, code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });
    await expect(service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: OTHER_RECORD, values: { probe: "written-through-another-project" }, partial: true, actor })).rejects.toMatchObject({ status: 404, code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });
    expect(store.values).toHaveLength(0);
    expect(mockAudit.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ entityId: OTHER_RECORD }));
    // A record type's own table decides: a change order id is not an RFI.
    await expect(service.getValues({ orgId: ORG, projectId: OTHER_PROJECT, recordType: "change_order", recordId: RECORD })).rejects.toMatchObject({ code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });

    // Through its own project it is read and written.
    const own = await service.setValues({ orgId: ORG, projectId: OTHER_PROJECT, recordType: "rfi", recordId: OTHER_RECORD, values: { probe: "own" }, partial: true, actor });
    expect(own.values).toEqual({ probe: "own" });
    expect((await service.getValues({ orgId: ORG, projectId: OTHER_PROJECT, recordType: "rfi", recordId: OTHER_RECORD })).values).toEqual({ probe: "own" });
    await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, values: { probe: "here" }, partial: true, actor });

    // The bulk read leaves out every id that is not a record of the project.
    const bulk = await service.valuesForProjectRecords({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordIds: [RECORD, OTHER_RECORD, "not-a-record"] });
    expect(Object.fromEntries(bulk)).toEqual({ [RECORD]: { probe: "here" } });
  });

  it("gives a reader only the values of records its module and its party's rule admit (certification L45)", async () => {
    await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Probe", type: "text" }, actor });
    await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: Y_RECORD, values: { probe: "y-only" }, partial: true, actor });
    await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, values: { probe: "x" }, partial: true, actor });
    const guestX = { id: "guest-x", userId: "guest-x", canRead: () => true, partyIds: ["party-x"], companyIds: ["company-x"] };

    // Company Y's RFI is not routed to company X's guest: not found, read or written.
    await expect(service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: Y_RECORD, viewer: guestX })).rejects.toMatchObject({ code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });
    await expect(service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: Y_RECORD, values: { probe: "x-wrote" }, partial: true, actor, viewer: guestX })).rejects.toMatchObject({ code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });
    expect((await service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: Y_RECORD })).values).toEqual({ probe: "y-only" });
    const bulk = await service.valuesForProjectRecords({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordIds: [RECORD, Y_RECORD], viewer: guestX });
    expect([...bulk.keys()]).toEqual([RECORD]);

    // Its own company's RFI is read and written.
    expect((await service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, viewer: guestX })).values).toEqual({ probe: "x" });
    await expect(service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, values: { probe: "x2" }, partial: true, actor, viewer: guestX })).resolves.toMatchObject({ values: { probe: "x2" } });

    // A company member is not bound by the party rule; a reader without the module reads nothing.
    const member = { id: "member", userId: "member", canRead: () => true, partyIds: null, companyIds: null };
    expect((await service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: Y_RECORD, viewer: member })).values).toEqual({ probe: "y-only" });
    const noRfi = { ...member, canRead: (moduleName) => moduleName !== "rfi" };
    await expect(service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, viewer: noRfi })).rejects.toMatchObject({ code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });
  });

  it("keeps a company member to the tasks the task routes show them and to the drafts that are theirs (certification R16)", async () => {
    const OWN_TASK = "77777777-7777-4777-8777-777777777777";
    const OTHER_TASK = "88888888-8888-4888-8888-888888888888";
    const DRAFT = "99999999-9999-4999-8999-999999999999";
    await service.createDefinition({ orgId: ORG, recordType: "task", payload: { label: "Probe", type: "text" }, actor });
    await service.createDefinition({ orgId: ORG, recordType: "rfi", payload: { label: "Probe", type: "text" }, actor });
    store.tasks.push({ id: OWN_TASK, projectId: PROJECT, assigneeId: "qs-1", createdById: "pm-1" }, { id: OTHER_TASK, projectId: PROJECT, assigneeId: "site-1", createdById: "pm-1" });
    store.rfis.push({ id: DRAFT, projectId: PROJECT, status: "draft", createdBy: "pm-1", managerUserId: null });
    await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "task", recordId: OTHER_TASK, values: { probe: "theirs" }, partial: true, actor });
    await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "task", recordId: OWN_TASK, values: { probe: "mine" }, partial: true, actor });
    await service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: DRAFT, values: { probe: "draft" }, partial: true, actor });
    const qs = { id: "qs-1", userId: "qs-1", canRead: () => true, partyIds: null, companyIds: null, projectWideTasks: false };

    // A colleague's task: not found, read or written; the bulk read leaves it out.
    await expect(service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "task", recordId: OTHER_TASK, viewer: qs })).rejects.toMatchObject({ status: 404, code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });
    await expect(service.setValues({ orgId: ORG, projectId: PROJECT, recordType: "task", recordId: OTHER_TASK, values: { probe: "qs-wrote" }, partial: true, actor, viewer: qs })).rejects.toMatchObject({ code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });
    const bulk = await service.valuesForProjectRecords({ orgId: ORG, projectId: PROJECT, recordType: "task", recordIds: [OWN_TASK, OTHER_TASK], viewer: qs });
    expect([...bulk.keys()]).toEqual([OWN_TASK]);
    // Their own task is read and written.
    expect((await service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "task", recordId: OWN_TASK, viewer: qs })).values).toEqual({ probe: "mine" });
    // A PM sees every task.
    const pm = { ...qs, id: "pm-1", userId: "pm-1", projectWideTasks: true };
    expect((await service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "task", recordId: OTHER_TASK, viewer: pm })).values).toEqual({ probe: "theirs" });
    // A reader that does not say is decided as the task routes would; one that cannot be resolved sees its own.
    const unsaid = { id: "qs-1", userId: "qs-1", canRead: () => true, partyIds: null, companyIds: null };
    await expect(service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "task", recordId: OTHER_TASK, viewer: unsaid })).rejects.toMatchObject({ code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });

    // A colleague's draft RFI is its author's: not the QS's; the author reads it, and a sent RFI is everyone's.
    await expect(service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: DRAFT, viewer: qs })).rejects.toMatchObject({ code: "CUSTOM_FIELD_RECORD_NOT_FOUND" });
    expect((await service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: DRAFT, viewer: pm })).values).toEqual({ probe: "draft" });
    await expect(service.getValues({ orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RECORD, viewer: qs })).resolves.toMatchObject({ recordType: "rfi" });
  });
});
