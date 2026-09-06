const fs = require("fs");
const os = require("os");
const path = require("path");

const store = { models: [], elements: [], links: [], notifications: [], audits: [], jobs: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const DATE_KEYS = new Set(["createdAt", "updatedAt", "parsedAt"]);
const clone = (row) => (row ? JSON.parse(JSON.stringify(row), (key, value) => (DATE_KEYS.has(key) && value ? new Date(value) : value)) : row);

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((clause) => matches(row, clause));
    if (key === "AND") return condition.every((clause) => matches(row, clause));
    const value = row[key];
    // Prisma stores an unset optional column as NULL, so `undefined` matches `null`.
    if (condition === null) return (value ?? null) === null;
    if (typeof condition !== "object") return value === condition;
    if ("in" in condition) return condition.in.includes(value);
    if ("not" in condition) return value !== condition.not;
    if ("gt" in condition) return Number(value || 0) > condition.gt;
    if ("contains" in condition) return String(value || "").toLowerCase().includes(String(condition.contains).toLowerCase());
    return true;
  });

const sortRows = (rows, orderBy) => {
  if (!orderBy) return rows;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  return rows.sort((a, b) => {
    for (const order of orders) {
      const [key, dir] = Object.entries(order)[0];
      const av = a[key] ?? "";
      const bv = b[key] ?? "";
      if (av === bv) continue;
      return (av > bv ? 1 : -1) * (dir === "desc" ? -1 : 1);
    }
    return 0;
  });
};

const table = (name, { hydrate = (row) => row, defaults = {} } = {}) => ({
  findMany: jest.fn(async ({ where = {}, orderBy, take, cursor, skip = 0 } = {}) => {
    let rows = sortRows(store[name].filter((row) => matches(row, where)).map((row) => hydrate(clone(row))), orderBy);
    if (cursor) {
      const index = rows.findIndex((row) => row.id === cursor.id);
      rows = index >= 0 ? rows.slice(index + skip) : rows;
    }
    return take ? rows.slice(0, take) : rows;
  }),
  findFirst: jest.fn(async ({ where = {}, orderBy } = {}) => {
    const rows = sortRows(store[name].filter((row) => matches(row, where)), orderBy);
    return rows.length ? hydrate(clone(rows[0])) : null;
  }),
  count: jest.fn(async ({ where = {} } = {}) => store[name].filter((row) => matches(row, where)).length),
  aggregate: jest.fn(async ({ where = {}, _max }) => {
    const key = Object.keys(_max)[0];
    const values = store[name].filter((row) => matches(row, where)).map((row) => row[key]).filter((value) => value !== null && value !== undefined);
    return { _max: { [key]: values.length ? Math.max(...values) : null } };
  }),
  groupBy: jest.fn(async ({ by, where = {}, _sum = {} }) => {
    const groups = new Map();
    for (const row of store[name].filter((item) => matches(item, where))) {
      const key = by.map((field) => row[field] ?? "").join("|");
      if (!groups.has(key)) groups.set(key, { rows: [], keys: Object.fromEntries(by.map((field) => [field, row[field] ?? null])) });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].map((group) => ({
      ...group.keys,
      _count: { _all: group.rows.length },
      _sum: Object.fromEntries(Object.keys(_sum).map((field) => [field, group.rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)])),
    }));
  }),
  create: jest.fn(async ({ data }) => {
    const row = { id: nextId(name), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
    store[name].push(row);
    return hydrate(clone(row));
  }),
  createMany: jest.fn(async ({ data }) => {
    for (const item of data) store[name].push({ id: nextId(name), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...item });
    return { count: data.length };
  }),
  update: jest.fn(async ({ where, data }) => {
    const row = store[name].find((item) => item.id === where.id);
    if (!row) throw new Error(`${name} ${where.id} not found`);
    Object.assign(row, data, { updatedAt: new Date() });
    return hydrate(clone(row));
  }),
  updateMany: jest.fn(async ({ where = {}, data }) => {
    const rows = store[name].filter((row) => matches(row, where));
    rows.forEach((row) => Object.assign(row, data));
    return { count: rows.length };
  }),
  delete: jest.fn(async ({ where }) => {
    store[name] = store[name].filter((row) => row.id !== where.id);
    if (name === "models") {
      store.elements = store.elements.filter((row) => row.modelId !== where.id);
      store.links = store.links.filter((row) => row.modelId !== where.id);
    }
    return {};
  }),
  deleteMany: jest.fn(async ({ where = {} } = {}) => {
    const before = store[name].length;
    store[name] = store[name].filter((row) => !matches(row, where));
    return { count: before - store[name].length };
  }),
});

const PROJECT = { id: "p1", orgId: "org-1", name: "Riverside Tower" };
const ACTIVITIES = [{ id: "act-1", projectId: "p1", name: "Pour slab L1", activityCode: "A100" }];
const LOCATIONS = [{ id: "loc-1", projectId: "p1", name: "Level 01", code: "L1" }];
const hydrateElement = (row) => ({ ...row, links: store.links.filter((link) => link.elementId === row.id).map(clone) });
const hydrateLink = (row) => ({ ...row, element: store.elements.find((element) => element.id === row.elementId) || null, model: store.models.find((model) => model.id === row.modelId) || null });

const mockPrisma = {
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" && where.orgId === "org-1" ? PROJECT : null)) },
  activity: { findFirst: jest.fn(async ({ where }) => ACTIVITIES.find((row) => row.id === where.id && row.projectId === where.projectId) || null), findMany: jest.fn(async ({ where }) => ACTIVITIES.filter((row) => where.id.in.includes(row.id))) },
  location: { findFirst: jest.fn(async ({ where }) => LOCATIONS.find((row) => row.id === where.id && row.projectId === where.projectId) || null), findMany: jest.fn(async ({ where }) => LOCATIONS.filter((row) => where.id.in.includes(row.id))) },
  bimModel: table("models", {
    defaults: { elementCount: 0, entityCount: 0, storeyCount: 0, linkedCount: 0, unitsJson: {}, headerJson: {}, spatialJson: [], warningsJson: [], typeSummaryJson: [] },
    hydrate: (row) => ({ ...row, sourceDocument: row.documentId ? { id: row.documentId, fileName: "tower.ifc", originalName: "tower.ifc", sizeBytes: 2048 } : null }),
  }),
  bimElement: table("elements", { defaults: { linkCount: 0 }, hydrate: hydrateElement }),
  bimElementLink: table("links", { hydrate: hydrateLink }),
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
const mockJobs = { JOB_TYPES: { BIM_PARSE: "bim.parse" }, enqueueJob: jest.fn(async (job) => { const row = { id: nextId("job"), ...job }; store.jobs.push(row); return row; }) };
const mockStorage = {
  DOCUMENT_TYPES: { BIM_MODEL: "bim_model" },
  ensureTempUploadDirSync: () => os.tmpdir(),
  cleanupTempFiles: jest.fn(async () => null),
  markDocumentLinked: jest.fn(async () => null),
  uploadProjectDocument: jest.fn(async () => ({ id: "doc-1", fileName: "tower.ifc", originalName: "Riverside Tower.ifc", sizeBytes: 2048 })),
  getBimModelFile: jest.fn(async () => ({ path: mockIfcPath })),
};
const mockAudit = { ACTIONS: { CREATED: "created", UPDATED: "updated", DELETED: "deleted", IMPORTED: "imported" }, recordEvent: jest.fn(async (event) => store.audits.push(event)) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { WORKFLOW: "workflow" }, createNotifications: jest.fn(async (payload) => store.notifications.push(payload)) };

let mockIfcPath = "";

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../../jobs/job.service", () => mockJobs);
jest.mock("../file-storage.service", () => mockStorage);
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);

const service = require("../bim.service");

const MODEL_IFC = `ISO-10303-21;
HEADER;
FILE_NAME('Riverside Tower.ifc','2026-09-10T08:15:00',('Amal'),('OctaPM'),'Revit 2026','Autodesk Revit','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#10= IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#12= IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#13= IFCUNITASSIGNMENT((#10,#12));
#20= IFCPROJECT('proj-guid',$,'Riverside Tower',$,$,'Tower',$,$,#13);
#21= IFCSITE('site-guid',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,0.,$,$);
#22= IFCBUILDING('bldg-guid',$,'Tower A',$,$,$,$,$,.ELEMENT.,$,$,$);
#23= IFCBUILDINGSTOREY('storey-1',$,'Level 01',$,$,$,$,$,.ELEMENT.,0.);
#24= IFCBUILDINGSTOREY('storey-2',$,'Level 02',$,$,$,$,$,.ELEMENT.,3600.);
#30= IFCRELAGGREGATES('a1',$,$,$,#20,(#21));
#31= IFCRELAGGREGATES('a2',$,$,$,#21,(#22));
#32= IFCRELAGGREGATES('a3',$,$,$,#22,(#23,#24));
#100= IFCWALL('wall-1',$,'Concrete wall 300',$,$,$,$,'W-101',$);
#101= IFCWALL('wall-2',$,'Concrete wall 300',$,$,$,$,'W-102',$);
#102= IFCSLAB('slab-1',$,'Slab 250',$,$,$,$,'S-201',$);
#103= IFCWALL('wall-3',$,'Blockwork wall 200',$,$,$,$,'W-201',$);
#130= IFCRELCONTAINEDINSPATIALSTRUCTURE('c1',$,$,$,(#100,#101,#102),#23);
#131= IFCRELCONTAINEDINSPATIALSTRUCTURE('c2',$,$,$,(#103),#24);
#200= IFCWALLTYPE('wt-1',$,'Concrete 300',$,$,$,$,'WT-300',$,$);
#201= IFCRELDEFINESBYTYPE('t1',$,$,$,(#100,#101),#200);
#300= IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('REI 120'),$);
#303= IFCPROPERTYSET('ps-1',$,'Pset_WallCommon',$,(#300));
#304= IFCRELDEFINESBYPROPERTIES('d1',$,$,$,(#100,#101),#303);
#310= IFCQUANTITYVOLUME('NetVolume',$,$,4.5,$);
#311= IFCQUANTITYAREA('NetSideArea',$,$,15.,$);
#313= IFCELEMENTQUANTITY('q-1',$,'Qto_WallBaseQuantities',$,$,(#310,#311));
#314= IFCRELDEFINESBYPROPERTIES('d2',$,$,$,(#100,#101),#313);
#320= IFCMATERIAL('Concrete C40/50');
#325= IFCRELASSOCIATESMATERIAL('m1',$,$,$,(#100,#101),#320);
ENDSEC;
END-ISO-10303-21;
`;

const scope = { orgId: "org-1", projectId: "p1" };
const actor = { id: "u-plan", name: "Plan", role: "planning_eng" };
const file = { path: "/tmp/upload.ifc", originalname: "Riverside Tower.ifc", mimetype: "application/octet-stream", size: 2048 };

const reset = () => {
  for (const key of Object.keys(store)) store[key] = [];
  jest.clearAllMocks();
};
const uploadAndParse = async (payload = {}) => {
  const model = await service.createModel({ ...scope, userId: actor.id, file, payload });
  await service.runBimParseJob({ job: { id: "job-1", orgId: "org-1" }, payload: { modelId: model.id } });
  return service.getModel({ ...scope, modelId: model.id });
};

beforeAll(() => {
  mockIfcPath = path.join(os.tmpdir(), `octapm-bim-${Date.now()}.ifc`);
  fs.writeFileSync(mockIfcPath, MODEL_IFC, "latin1");
});
afterAll(() => fs.unlinkSync(mockIfcPath));

describe("BIM models", () => {
  beforeEach(reset);

  it("uploads a model, queues the parse job, then stores the spatial breakdown, elements, quantities and type summary", async () => {
    const created = await service.createModel({ ...scope, userId: actor.id, file, payload: { discipline: "structural" } });
    expect(created).toMatchObject({ name: "Riverside Tower", discipline: "structural", status: "processing", version: 1, isCurrent: true, elementCount: 0, fileName: "Riverside Tower.ifc" });
    expect(mockJobs.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "bim.parse", payload: { modelId: created.id } }));
    await expect(service.createModel({ ...scope, userId: actor.id, file, payload: { discipline: "nope" } })).rejects.toMatchObject({ code: "BIM_DISCIPLINE_INVALID" });
    await expect(service.createModel({ ...scope, userId: actor.id, file: null })).rejects.toMatchObject({ code: "NO_FILE" });

    const result = await service.runBimParseJob({ job: { id: "job-1", orgId: "org-1" }, payload: { modelId: created.id } });
    expect(result).toEqual({ elements: 4, schema: "IFC4" });
    const model = await service.getModel({ ...scope, modelId: created.id });
    expect(model).toMatchObject({ status: "ready", schema: "IFC4", ifcProjectName: "Riverside Tower", siteName: "Site", buildingName: "Tower A", elementCount: 4, storeyCount: 2, warnings: [] });
    expect(model.units).toEqual({ length: "mm", volume: "m³" });
    expect(model.header.originatingSystem).toBe("Autodesk Revit");
    expect(model.typeSummary).toEqual([
      { ifcType: "IFCWALL", label: "Wall", count: 3, netVolume: 9, netArea: 30 },
      { ifcType: "IFCSLAB", label: "Slab", count: 1, netVolume: 0, netArea: 0 },
    ]);
    expect(store.notifications[0]).toMatchObject({ event: "bim.ready", recipientUserIds: [actor.id] });
    expect(store.audits.map((event) => event.action)).toEqual(["created", "imported"]);

    const tree = await service.spatialTree({ ...scope, modelId: created.id });
    expect(tree.items).toHaveLength(1);
    expect(tree.items[0].children[0].children[0].children.map((node) => [node.name, node.elementCount])).toEqual([
      ["Level 01", 3],
      ["Level 02", 1],
    ]);
    expect(tree.storeys.map((node) => node.globalId)).toEqual(["storey-1", "storey-2"]);
  });

  it("marks the model failed with the reason when the file cannot be read", async () => {
    const created = await service.createModel({ ...scope, userId: actor.id, file });
    mockStorage.getBimModelFile.mockResolvedValueOnce({ path: path.join(os.tmpdir(), "does-not-exist.ifc") });
    await expect(service.runBimParseJob({ job: { id: "job-2", orgId: "org-1" }, payload: { modelId: created.id } })).rejects.toThrow();
    expect((await service.getModel({ ...scope, modelId: created.id })).status).toBe("failed");
    const requeued = await service.reparseModel({ ...scope, modelId: created.id, actor });
    expect(requeued).toMatchObject({ status: "processing", error: null });
  });

  it("filters and pages the elements, and rolls quantities up by type and by storey", async () => {
    const model = await uploadAndParse();
    const all = await service.listElements({ ...scope, modelId: model.id, query: {} });
    expect(all.total).toBe(4);
    expect(all.items.map((element) => [element.ifcType, element.name, element.storeyName])).toEqual([
      ["IFCSLAB", "Slab 250", "Level 01"],
      ["IFCWALL", "Blockwork wall 200", "Level 02"],
      ["IFCWALL", "Concrete wall 300", "Level 01"],
      ["IFCWALL", "Concrete wall 300", "Level 01"],
    ]);
    expect(all.items[2]).toMatchObject({ typeLabel: "Wall", tag: "W-101", typeName: "Concrete 300", materials: ["Concrete C40/50"], quantities: { netVolume: 4.5, netArea: 15 }, spatialPath: "Site / Tower A / Level 01" });

    expect((await service.listElements({ ...scope, modelId: model.id, query: { ifcType: "ifcwall" } })).total).toBe(3);
    expect((await service.listElements({ ...scope, modelId: model.id, query: { storeyGlobalId: "storey-2" } })).items.map((element) => element.tag)).toEqual(["W-201"]);
    expect((await service.listElements({ ...scope, modelId: model.id, query: { q: "blockwork" } })).items.map((element) => element.tag)).toEqual(["W-201"]);
    expect((await service.listElements({ ...scope, modelId: model.id, query: { typeName: "Concrete 300" } })).total).toBe(2);
    const firstPage = await service.listElements({ ...scope, modelId: model.id, query: { limit: 2 } });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await service.listElements({ ...scope, modelId: model.id, query: { limit: 2, cursor: firstPage.nextCursor } });
    expect(secondPage.items.map((element) => element.id)).not.toEqual(firstPage.items.map((element) => element.id));

    const byType = await service.quantitySummary({ ...scope, modelId: model.id, query: {} });
    expect(byType.groupBy).toBe("type");
    expect(byType.items).toEqual([
      expect.objectContaining({ key: "IFCWALL", label: "Wall", elements: 3, netVolume: 9, netArea: 30 }),
      expect.objectContaining({ key: "IFCSLAB", label: "Slab", elements: 1 }),
    ]);
    expect(byType.totals).toMatchObject({ elements: 4, netVolume: 9, netArea: 30 });
    const byStorey = await service.quantitySummary({ ...scope, modelId: model.id, query: { groupBy: "storey", ifcType: "IFCWALL" } });
    expect(byStorey.items).toEqual([
      expect.objectContaining({ label: "Level 01", elements: 2, netVolume: 9 }),
      expect.objectContaining({ label: "Level 02", elements: 1, netVolume: 0 }),
    ]);
  });

  it("links elements to an activity one by one and in bulk from a filter, keeps the counts and refuses unknown records", async () => {
    const model = await uploadAndParse();
    const walls = await service.listElements({ ...scope, modelId: model.id, query: { typeName: "Concrete 300" } });

    const single = await service.createLinks({ ...scope, modelId: model.id, actor, payload: { recordType: "activity", recordId: "act-1", elementIds: [walls.items[0].id] } });
    expect(single).toMatchObject({ linked: 1, alreadyLinked: 0, recordTitle: "A100 Pour slab L1" });
    const bulk = await service.createLinks({ ...scope, modelId: model.id, actor, payload: { recordType: "activity", recordId: "act-1", filter: { ifcType: "IFCWALL" } } });
    expect(bulk).toMatchObject({ linked: 2, alreadyLinked: 1 });
    expect((await service.getModel({ ...scope, modelId: model.id })).linkedCount).toBe(3);
    expect((await service.listElements({ ...scope, modelId: model.id, query: { linked: "true" } })).total).toBe(3);
    expect((await service.listElements({ ...scope, modelId: model.id, query: { linked: "false" } })).items.map((element) => element.ifcType)).toEqual(["IFCSLAB"]);

    await expect(service.createLinks({ ...scope, modelId: model.id, actor, payload: { recordType: "drawing", recordId: "x" } })).rejects.toMatchObject({ code: "BIM_LINK_RECORD_TYPE_INVALID" });
    await expect(service.createLinks({ ...scope, modelId: model.id, actor, payload: { recordType: "activity", recordId: "nope" } })).rejects.toMatchObject({ code: "BIM_LINK_RECORD_NOT_FOUND" });
    await expect(service.createLinks({ ...scope, modelId: model.id, actor, payload: { recordType: "activity", recordId: "act-1" } })).rejects.toMatchObject({ code: "BIM_LINK_ELEMENTS_REQUIRED" });
    await expect(service.createLinks({ ...scope, modelId: model.id, actor, payload: { recordType: "activity", recordId: "act-1", relationType: "wat", elementIds: [walls.items[0].id] } })).rejects.toMatchObject({ code: "BIM_LINK_RELATION_INVALID" });
    await expect(service.createLinks({ ...scope, modelId: model.id, actor, payload: { recordType: "activity", recordId: "act-1", filter: { ifcType: "IFCDOOR" } } })).rejects.toMatchObject({ code: "BIM_LINK_ELEMENTS_REQUIRED" });

    const links = await service.listLinks({ ...scope, modelId: model.id, query: {} });
    expect(links.items).toHaveLength(3);
    expect(links.items[0]).toMatchObject({ recordType: "activity", recordTitle: "A100 Pour slab L1", recordPath: "/projects/p1/activities?recordId=act-1", relationType: "represents" });
    expect(links.records).toEqual([expect.objectContaining({ recordType: "activity", recordId: "act-1", elements: 3 })]);

    const forActivity = await service.elementsForRecord({ ...scope, recordType: "activity", recordId: "act-1" });
    expect(forActivity.totals).toEqual({ elements: 3, netVolume: 9, netArea: 30 });
    expect(forActivity.items[0]).toMatchObject({ modelName: "Riverside Tower", relationType: "represents" });

    const detail = await service.getElement({ ...scope, modelId: model.id, elementId: walls.items[0].id });
    expect(detail).toMatchObject({ properties: { Pset_WallCommon: { FireRating: "REI 120" } }, linkCount: 1 });
    expect(detail.links[0]).toMatchObject({ recordType: "activity", recordTitle: "A100 Pour slab L1" });

    await service.deleteLink({ ...scope, modelId: model.id, linkId: detail.links[0].id, actor });
    expect((await service.getElement({ ...scope, modelId: model.id, elementId: walls.items[0].id })).linkCount).toBe(0);
    expect((await service.getModel({ ...scope, modelId: model.id })).linkedCount).toBe(2);
    await expect(service.deleteLink({ ...scope, modelId: model.id, linkId: "11111111-1111-4111-8111-111111111111", actor })).rejects.toMatchObject({ code: "BIM_LINK_NOT_FOUND" });
  });

  it("versions a re-upload, supersedes the previous model and restores it when the new one is deleted", async () => {
    const first = await uploadAndParse();
    expect(first).toMatchObject({ version: 1, isCurrent: true });
    const second = await service.createModel({ ...scope, userId: actor.id, file, payload: {} });
    expect(second).toMatchObject({ version: 2, isCurrent: true });
    const list = await service.listModels({ ...scope, query: {} });
    expect(list.items.map((item) => [item.version, item.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(list.summary).toMatchObject({ count: 2, current: 1 });
    expect((await service.listModels({ ...scope, query: { current: "true" } })).items).toHaveLength(1);

    await service.deleteModel({ ...scope, modelId: second.id, actor });
    expect((await service.getModel({ ...scope, modelId: first.id })).isCurrent).toBe(true);
    await expect(service.getModel({ ...scope, modelId: second.id })).rejects.toMatchObject({ code: "BIM_MODEL_NOT_FOUND" });

    const renamed = await service.updateModel({ ...scope, modelId: first.id, payload: { name: "Structural model", discipline: "structural", notes: "IFC4 export" }, actor });
    expect(renamed).toMatchObject({ name: "Structural model", discipline: "structural", notes: "IFC4 export" });
    await expect(service.updateModel({ ...scope, modelId: first.id, payload: { name: "  " }, actor })).rejects.toMatchObject({ code: "BIM_NAME_REQUIRED" });
  });

  it("exports the filtered elements with their links and the quantity totals", async () => {
    const model = await uploadAndParse();
    const walls = await service.listElements({ ...scope, modelId: model.id, query: { typeName: "Concrete 300" } });
    await service.createLinks({ ...scope, modelId: model.id, actor, payload: { recordType: "location", recordId: "loc-1", elementIds: [walls.items[0].id] } });
    const { workbook, filename } = await service.exportElements({ ...scope, modelId: model.id, query: { ifcType: "IFCWALL" } });
    expect(filename).toBe("riverside-tower-elements.xlsx");
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Elements", "Quantities by type", "About"]);
    const sheet = workbook.getWorksheet("Elements");
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getRow(2).getCell(2).value).toBe("Wall");
    expect(sheet.getRow(2).getCell(13).value).toBe("location: L1 Level 01");
    expect(workbook.getWorksheet("Quantities by type").getRow(2).getCell(1).value).toBe("Wall");
    expect(workbook.getWorksheet("About").getRow(2).getCell(2).value).toBe("IFC4");
  });
});
