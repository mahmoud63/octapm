const store = { definitions: [], fieldsets: [], projectFieldsets: [], recordTypes: [], values: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
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
mockPrisma.user = { findMany: jest.fn(async ({ where }) => where.id.in.map((id) => ({ id, name: `User ${id}`, email: null }))) };
mockPrisma.company = { findMany: jest.fn(async ({ where }) => where.id.in.map((id) => ({ id, name: `Company ${id}` }))) };
const mockAudit = { ENTITY_TYPES: { CUSTOM_FIELD: "custom_field", CUSTOM_FIELDSET: "custom_fieldset", RECORD_TYPE: "record_type" }, ACTIONS: { CREATED: "created", UPDATED: "updated" }, recordEvent: jest.fn(async () => ({})) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);

const service = require("../custom-field.service");

const ORG = "org-1";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const RECORD = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const actor = { id: "pm-1", role: "pm" };

const reset = () => {
  for (const rows of Object.values(store)) rows.length = 0;
  jest.clearAllMocks();
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
});
