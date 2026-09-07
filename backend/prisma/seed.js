/**
 * Development seed.
 *
 * Gives an empty database enough coherent data to sign in and see every module
 * do something: one organisation, one user per role, one project with a small
 * schedule, its BOQ and allocations, approved progress and costs, and an active
 * baseline. Re-running it updates the same rows rather than making new ones.
 *
 *   npm run db:seed --workspace=backend
 *
 * The demo password is deliberately weak and the accounts are obviously fake,
 * because this is for a local database. Never run it against anything shared.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
// Opening stock goes in through the service, not straight into the tables, so
// the seeded balances are produced by the same ledger the product uses.
const inventoryService = require("../src/services/inventory.service");

const PASSWORD = process.env.SEED_PASSWORD || "DemoPassw0rd!";
const ORG_NAME = process.env.SEED_ORG_NAME || "OctaPM Demo Contracting";
const PROJECT_NAME = process.env.SEED_PROJECT_NAME || "Riverside Tower";

const date = (value) => new Date(`${value}T00:00:00.000Z`);

const PEOPLE = [
  ["pm", "Dana Okafor", "pm@octapm.demo", "pm"],
  ["planner", "Ravi Menon", "planner@octapm.demo", "planning_eng"],
  ["qs", "Sofia Lindqvist", "qs@octapm.demo", "qs"],
  ["cost", "Tomás Herrera", "cost@octapm.demo", "cost_controller"],
  ["procurement", "Amina Bello", "procurement@octapm.demo", "procurement"],
  ["warehouse", "Jonas Weber", "warehouse@octapm.demo", "warehouse"],
  ["site", "Priya Raman", "site@octapm.demo", "site_engineer"],
  ["finance", "Grace Mbeki", "finance@octapm.demo", "finance"],
];

// Three activities in a finish-to-start chain, so the schedule, the critical
// path and the S-curve all have something real to draw.
const ACTIVITIES = [
  {
    key: "sub",
    activityCode: "A-1000",
    name: "Substructure and raft foundation",
    wbsCode: "01.10",
    category: "structural",
    start: "2026-01-12",
    end: "2026-03-06",
    duration: 40,
    early: [0, 40],
    late: [0, 40],
    totalFloat: 0,
    budget: 1_850_000,
    isCritical: true,
    pct: 100,
    actualCost: 1_812_400,
  },
  {
    key: "frame",
    activityCode: "A-2000",
    name: "Reinforced concrete frame to level 12",
    wbsCode: "02.10",
    category: "structural",
    start: "2026-03-09",
    end: "2026-07-31",
    duration: 105,
    early: [40, 145],
    late: [40, 145],
    totalFloat: 0,
    budget: 4_260_000,
    isCritical: true,
    pct: 46,
    actualCost: 2_058_000,
  },
  {
    key: "facade",
    activityCode: "A-3000",
    name: "Unitised facade installation",
    wbsCode: "03.10",
    category: "architectural",
    start: "2026-06-15",
    end: "2026-11-27",
    duration: 120,
    early: [110, 230],
    late: [125, 245],
    totalFloat: 15,
    budget: 3_180_000,
    isCritical: false,
    pct: 8,
    actualCost: 291_500,
  },
];

const BOQ = [
  { code: "B-100", section: "Substructure", description: "Mass concrete to raft, C40/50", unit: "m3", qty: 4200, rate: 305 },
  { code: "B-200", section: "Superstructure", description: "RC frame, columns and slabs", unit: "m3", qty: 7100, rate: 480 },
  { code: "B-300", section: "Envelope", description: "Unitised curtain walling", unit: "m2", qty: 12400, rate: 245 },
];

// Which BOQ item funds which activity, and how much of it is allocated.
const ALLOCATIONS = [
  { boq: "B-100", activity: "sub", quantity: 4200, weight: 100 },
  { boq: "B-200", activity: "frame", quantity: 7100, weight: 100 },
  { boq: "B-300", activity: "facade", quantity: 12400, weight: 100 },
];

// Crews and plant per activity. Quantities are the total for the activity; the
// resource histogram spreads them across its duration, so overlapping activities
// show as a stacked peak — which is the whole point of drawing one.
const RESOURCES = [
  { activity: "sub", type: "labor", name: "Concrete gang", quantity: 640, unit: "man-days", dailyRate: 320 },
  { activity: "sub", type: "labor", name: "Steel fixers", quantity: 480, unit: "man-days", dailyRate: 345 },
  { activity: "sub", type: "equipment", name: "Crawler crane", quantity: 40, unit: "days", dailyRate: 1250 },

  { activity: "frame", type: "labor", name: "Formwork carpenters", quantity: 1680, unit: "man-days", dailyRate: 355 },
  { activity: "frame", type: "labor", name: "Steel fixers", quantity: 1260, unit: "man-days", dailyRate: 345 },
  { activity: "frame", type: "equipment", name: "Tower crane", quantity: 105, unit: "days", dailyRate: 1480 },
  { activity: "frame", type: "material", name: "Ready-mix concrete", quantity: 7100, unit: "m3", dailyRate: 0 },

  { activity: "facade", type: "labor", name: "Facade installers", quantity: 1440, unit: "man-days", dailyRate: 410 },
  { activity: "facade", type: "equipment", name: "Mast climbers", quantity: 120, unit: "days", dailyRate: 260 },
  { activity: "facade", type: "material", name: "Curtain wall units", quantity: 12400, unit: "m2", dailyRate: 0 },
];

async function upsertOrganisation() {
  const existing = await prisma.organisation.findFirst({ where: { name: ORG_NAME } });
  if (existing) {
    return prisma.organisation.update({
      where: { id: existing.id },
      data: { status: "active", plan: existing.plan || "standard" },
    });
  }
  return prisma.organisation.create({
    data: { name: ORG_NAME, status: "active", plan: "standard" },
  });
}

async function ensureSubscription(orgId) {
  if (!prisma.subscription?.upsert) return null;
  return prisma.subscription.upsert({
    where: { orgId },
    create: { orgId, status: "active", plan: "standard" },
    update: { status: "active", plan: "standard" },
  });
}

async function upsertPeople(orgId) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const people = {};
  for (const [key, name, email, role] of PEOPLE) {
    people[key] = await prisma.user.upsert({
      where: { email },
      create: { orgId, name, email, role, status: "active", passwordHash },
      // The PM doubles as the company administrator so there is a way in to the
      // company workspace without a second sign-in.
      update: { orgId, name, role, status: "active", passwordHash },
    });
  }
  await prisma.user.update({
    where: { id: people.pm.id },
    data: { isCompanyAdmin: true },
  });
  return people;
}

async function upsertProject(orgId) {
  const data = {
    type: "Commercial high-rise",
    location: "Riverside, Baton Rouge",
    clientName: "Riverside Development Partners",
    consultantName: "Hallam & Reid Engineers",
    contractorName: ORG_NAME,
    contractType: "lump_sum",
    contractNumber: "RT-2026-014",
    startDate: date("2026-01-12"),
    endDate: date("2026-11-27"),
    completionDate: date("2026-11-27"),
    baselineDate: date("2026-01-12"),
    dataDate: date("2026-06-30"),
    duration: 230,
    durationUnit: "days",
    contractValue: 9_290_000,
    defaultRetentionRate: 5,
    ldRatePerDay: 6500,
    weatherAllowanceDays: 18,
    projectCalendar: "five_day",
    reportingCutoffDay: 25,
    currency: "USD",
    status: "active",
    archivedAt: null,
    archivedBy: null,
  };

  const existing = await prisma.project.findFirst({ where: { orgId, name: PROJECT_NAME } });
  if (existing) return prisma.project.update({ where: { id: existing.id }, data });
  return prisma.project.create({ data: { orgId, name: PROJECT_NAME, ...data } });
}

async function assignEveryone(projectId, people) {
  for (const user of Object.values(people)) {
    await prisma.projectAssignment.upsert({
      where: { projectId_userId: { projectId, userId: user.id } },
      create: { projectId, userId: user.id, role: user.role },
      update: { role: user.role },
    });
  }
}

async function upsertActivities(projectId) {
  const activities = {};
  let sortOrder = 1;

  for (const spec of ACTIVITIES) {
    const data = {
      name: spec.name,
      wbsCode: spec.wbsCode,
      calendarId: "five_day",
      category: spec.category,
      startDate: date(spec.start),
      endDate: date(spec.end),
      duration: spec.duration,
      earlyStart: spec.early[0],
      earlyFinish: spec.early[1],
      baselineStart: spec.early[0],
      baselineFinish: spec.early[1],
      lateStart: spec.late[0],
      lateFinish: spec.late[1],
      totalFloat: spec.totalFloat,
      budget: spec.budget,
      isMilestone: false,
      isCritical: spec.isCritical,
      isActive: true,
      sortOrder: sortOrder++,
    };

    const existing = await prisma.activity.findFirst({
      where: { projectId, activityCode: spec.activityCode },
    });
    activities[spec.key] = existing
      ? await prisma.activity.update({ where: { id: existing.id }, data })
      : await prisma.activity.create({
          data: { projectId, activityCode: spec.activityCode, ...data },
        });
  }

  return activities;
}

async function upsertDependencies(projectId, activities) {
  const chain = [
    ["sub", "frame", "FS", 0],
    ["frame", "facade", "SS", 70],
  ];

  for (const [from, to, relationshipType, lagDays] of chain) {
    const predecessorId = activities[from].id;
    const successorId = activities[to].id;
    await prisma.activityDependency.upsert({
      where: { projectId_predecessorId_successorId: { projectId, predecessorId, successorId } },
      create: { projectId, predecessorId, successorId, relationshipType, lagDays, source: "manual" },
      update: { relationshipType, lagDays },
    });
  }
}

async function upsertBoq(projectId) {
  const items = {};
  let sortOrder = 1;

  for (const item of BOQ) {
    const data = {
      activeCodeKey: item.code,
      description: item.description,
      qty: item.qty,
      unit: item.unit,
      rate: item.rate,
      amount: item.qty * item.rate,
      section: item.section,
      isManual: true,
      isActive: true,
      baselineLocked: true,
      sortOrder: sortOrder++,
    };

    const existing = await prisma.boqItem.findFirst({
      where: { projectId, code: item.code, isActive: true },
    });
    items[item.code] = existing
      ? await prisma.boqItem.update({ where: { id: existing.id }, data })
      : await prisma.boqItem.create({ data: { projectId, code: item.code, ...data } });
  }

  return items;
}

async function upsertAllocations({ projectId, boqItems, activities, userId }) {
  const now = new Date();

  for (const spec of ALLOCATIONS) {
    const boqItem = boqItems[spec.boq];
    const activity = activities[spec.activity];
    const data = {
      quantity: spec.quantity,
      amount: Number(boqItem.rate) * spec.quantity,
      weight: spec.weight,
      source: "manual",
      status: "approved",
      isActive: true,
      notes: "Seeded demo allocation",
      submittedBy: userId,
      submittedAt: now,
      approvedBy: userId,
      approvedAt: now,
      updatedBy: userId,
    };

    const existing = await prisma.activityBoqAllocation.findFirst({
      where: { projectId, boqItemId: boqItem.id, activityId: activity.id, isActive: true },
    });
    if (existing) {
      await prisma.activityBoqAllocation.update({ where: { id: existing.id }, data });
    } else {
      await prisma.activityBoqAllocation.create({
        data: {
          projectId,
          boqItemId: boqItem.id,
          activityId: activity.id,
          createdBy: userId,
          ...data,
        },
      });
    }
  }
}

// A central store and a site store, with a bin structure deep enough to show
// what the location hierarchy is for.
const WAREHOUSES = [
  { key: "central", code: "WH-CENTRAL", name: "Central Warehouse", kind: "central", project: false },
  { key: "site", code: "WH-RIVERSIDE", name: "Riverside Site Store", kind: "site", project: true },
];

const WAREHOUSE_LOCATIONS = [
  { warehouse: "central", key: "zb", code: "B", name: "Zone B", kind: "zone" },
  { warehouse: "central", key: "a03", parent: "zb", code: "B-A03", name: "Aisle 03", kind: "aisle" },
  { warehouse: "central", key: "r06", parent: "a03", code: "B-A03-R06", name: "Rack 06", kind: "rack" },
  { warehouse: "central", key: "s2", parent: "r06", code: "B-A03-R06-S2", name: "Shelf 2", kind: "shelf" },
  { warehouse: "central", key: "b04", parent: "s2", code: "B-A03-R06-S2-B04", name: "Bin 04", kind: "bin" },
  { warehouse: "site", key: "yard", code: "YARD", name: "Open yard", kind: "zone" },
];

const INVENTORY = [
  {
    key: "cement",
    sku: "CEM-42.5N",
    barcode: "5012345678900",
    name: "Cement OPC 42.5N",
    description: "Ordinary Portland cement, 50kg bag",
    category: "Concrete",
    unit: "bag",
    manufacturer: "Riverstone Cement",
    model: "OPC-42.5N",
    specification: "BS EN 197-1 CEM I 42.5N",
    unitCost: 6.4,
    reorderLevel: 400,
    minStock: 200,
    maxStock: 4000,
    leadTimeDays: 7,
    receive: { warehouse: "central", location: "b04", quantity: 1800, unitCost: 6.4 },
  },
  {
    key: "rebar",
    sku: "RBR-T16",
    barcode: "5012345678917",
    name: "Reinforcement bar T16",
    description: "High-yield deformed bar, 12m length",
    category: "Reinforcement",
    unit: "bar",
    manufacturer: "Delta Steel",
    model: "T16-12M",
    specification: "BS 4449 Grade B500B",
    unitCost: 21.5,
    reorderLevel: 300,
    minStock: 150,
    maxStock: 2500,
    leadTimeDays: 21,
    // The first of three deliveries; the later two are in PRICE_HISTORY, which
    // is what gives the purchase price trend a line to draw.
    receive: {
      warehouse: "central",
      location: "s2",
      quantity: 640,
      unitCost: 21.5,
      agedDays: 240,
    },
  },
  {
    key: "formwork",
    sku: "FWK-PLY18",
    barcode: "5012345678924",
    name: "Formwork plywood 18mm",
    description: "Film-faced birch plywood, 2440 x 1220",
    category: "Formwork",
    unit: "sheet",
    manufacturer: "Northline Timber",
    specification: "18mm film-faced, 12 uses",
    unitCost: 34,
    reorderLevel: 120,
    minStock: 60,
    maxStock: 900,
    leadTimeDays: 14,
    receive: { warehouse: "site", location: "yard", quantity: 210, unitCost: 34 },
  },
  {
    key: "membrane",
    sku: "WPF-MEM01",
    barcode: "5012345678931",
    name: "Waterproofing membrane",
    description: "Self-adhesive bituminous membrane, 1m x 20m roll",
    category: "Waterproofing",
    unit: "roll",
    manufacturer: "Aquastop",
    specification: "1.5mm SBS modified",
    unitCost: 96,
    reorderLevel: 40,
    minStock: 20,
    maxStock: 300,
    leadTimeDays: 28,
    // Deliberately left at nothing on hand, so the low-stock and out-of-stock
    // figures on the dashboard have something real to report.
  },
  {
    key: "sealant",
    sku: "SLC-PU25",
    barcode: "5012345678948",
    name: "Polyurethane joint sealant",
    description: "600ml sausage, grey",
    category: "Sealants",
    unit: "cartridge",
    manufacturer: "Bondline",
    specification: "ISO 11600 F 25 LM",
    unitCost: 8.75,
    reorderLevel: 60,
    minStock: 30,
    maxStock: 400,
    leadTimeDays: 10,
    // Below its reorder level but not empty: the case the low-stock list is for.
    receive: { warehouse: "central", location: "s2", quantity: 24, unitCost: 8.75 },
  },
  {
    key: "scaffold",
    sku: "SCF-TUBE48",
    barcode: "5012345678955",
    name: "Scaffold tube 48.3mm",
    description: "Galvanised tube, 6m length",
    category: "Temporary works",
    unit: "length",
    manufacturer: "Northline Steel",
    specification: "EN 39, 4.0mm wall",
    unitCost: 18.4,
    reorderLevel: 100,
    minStock: 50,
    maxStock: 400,
    leadTimeDays: 35,
    // Over-ordered and untouched since: this one item is both the overstock
    // example and the slow-moving example, which is usually how it happens.
    receive: {
      warehouse: "site",
      location: "yard",
      quantity: 900,
      unitCost: 18.4,
      agedDays: 210,
    },
  },
];

/**
 * Two more deliveries of rebar, at what the supplier charged later.
 *
 * The price trend needs more than one delivery of the same item to say
 * anything, and a flat line says nothing worth reading.
 */
const PRICE_HISTORY = [
  {
    ref: "Supplier delivery 2",
    item: "rebar",
    warehouse: "central",
    location: "s2",
    quantity: 180,
    unitCost: 22.4,
    agedDays: 90,
  },
  {
    // Recent enough that rebar does not also read as slow-moving stock.
    ref: "Supplier delivery 3",
    item: "rebar",
    warehouse: "central",
    location: "s2",
    quantity: 220,
    unitCost: 24.1,
    agedDays: 12,
  },
];

/**
 * What the programme needs next.
 *
 * Drives the upcoming-needs and long-lead sections of the inventory dashboard:
 * the facade glazing is sixteen weeks away from a supplier and nothing has
 * arrived, which is the kind of thing that has to be seen months early.
 */
const MATERIAL_PLAN = [
  {
    activity: "frame",
    name: "Cement OPC 42.5N",
    code: "CEM-42.5N",
    unit: "bag",
    qty: 2400,
    receivedQty: 1800,
    required: "2026-09-25",
    orderBy: "2026-09-11",
    leadWeeks: 2,
    status: "partial",
  },
  {
    activity: "facade",
    name: "Unitised glazing panel type A",
    code: "GLZ-UP-A",
    unit: "panel",
    qty: 320,
    receivedQty: 0,
    required: "2026-10-20",
    orderBy: "2026-06-28",
    leadWeeks: 16,
    status: "planned",
  },
  {
    activity: "facade",
    name: "Structural silicone",
    code: "SIL-STR",
    unit: "cartridge",
    qty: 900,
    receivedQty: 0,
    required: "2026-11-10",
    orderBy: "2026-09-15",
    leadWeeks: 8,
    status: "planned",
  },
];

/**
 * Clears what the end-to-end suite left behind.
 *
 * The goods-receipt tests raise their own purchase order every run — a receipt
 * cannot be un-posted, so a test that ate into shared data would behave
 * differently the second time. That is the right trade for the tests and the
 * wrong one for the demo database, where the orders pile up and crowd the real
 * ones off the inventory dashboard. Re-seeding is what sweeps them up.
 *
 * Matched on the prefixes the tests use and nothing else.
 */
async function purgeTestResidue(orgId) {
  const orders = await prisma.procurementOrder.findMany({
    where: {
      OR: [
        // Goods-receipt tests raise their own order per run.
        { ref: { startsWith: "PO-E2E-" } },
        // Purchase-order lifecycle tests do the same.
        { ref: { startsWith: "PO-LC-" } },
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  if (orderIds.length) {
    await prisma.deliveryReceiptLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.deliveryReceipt.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.procurementPoLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.procurementOrder.deleteMany({ where: { id: { in: orderIds } } });
  }

  const items = await prisma.inventoryItem.findMany({
    where: { orgId, OR: [{ sku: { startsWith: "E2E-" } }, { sku: { startsWith: "LC-" } }] },
    select: { id: true },
  });
  const itemIds = items.map((item) => item.id);
  if (itemIds.length) {
    await prisma.stockTransaction.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockBalance.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
  }

  // Scope-matrix tests raise a throwaway subcontract so the "first read seeds
  // the starter rows" case is not fighting a matrix an earlier test rewrote.
  // Matched on the title, because commitment refs are auto-numbered by the
  // service rather than taken from the request.
  const fixtures = await prisma.commitment.deleteMany({
    where: { orgId, title: { in: ["Scope matrix fixture", "Closeout fixture"] } },
  });

  if (orderIds.length || itemIds.length || fixtures.count) {
    console.log(
      `  cleared ${orderIds.length} test purchase orders, ${itemIds.length} test items and ${fixtures.count} test commitments`
    );
  }
}

/**
 * Moves a movement back in time.
 *
 * Demo data posted all at once looks like a store that opened this morning.
 * The dashboard reads dates — how long stock has sat, what the price was doing
 * — and needs a history to read.
 */
async function backdate(transactionId, days) {
  const occurredAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await prisma.stockTransaction.update({
    where: { id: transactionId },
    data: { occurredAt },
  });
}

async function upsertInventory({ orgId, projectId, activities, userId }) {
  await purgeTestResidue(orgId);

  const warehouses = {};
  for (const spec of WAREHOUSES) {
    const data = {
      name: spec.name,
      kind: spec.kind,
      projectId: spec.project ? projectId : null,
      status: "active",
      updatedBy: userId,
    };
    const existing = await prisma.warehouse.findFirst({ where: { orgId, code: spec.code } });
    warehouses[spec.key] = existing
      ? await prisma.warehouse.update({ where: { id: existing.id }, data })
      : await prisma.warehouse.create({
          data: { orgId, code: spec.code, createdBy: userId, ...data },
        });
  }

  const locations = {};
  for (const spec of WAREHOUSE_LOCATIONS) {
    const warehouse = warehouses[spec.warehouse];
    const parent = spec.parent ? locations[spec.parent] : null;
    const existing = await prisma.warehouseLocation.findFirst({
      where: { warehouseId: warehouse.id, code: spec.code },
    });
    const data = {
      name: spec.name,
      kind: spec.kind,
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      status: "active",
      updatedBy: userId,
    };
    let row = existing
      ? await prisma.warehouseLocation.update({ where: { id: existing.id }, data })
      : await prisma.warehouseLocation.create({
          data: { orgId, warehouseId: warehouse.id, code: spec.code, path: "", createdBy: userId, ...data },
        });
    row = await prisma.warehouseLocation.update({
      where: { id: row.id },
      data: { path: parent ? `${parent.path}/${row.id}` : row.id },
    });
    locations[spec.key] = row;
  }

  const items = {};
  for (const spec of INVENTORY) {
    const { key, receive, ...fields } = spec;
    const existing = await prisma.inventoryItem.findFirst({ where: { orgId, sku: spec.sku } });
    const data = { ...fields, qrCode: spec.sku, status: "active", updatedBy: userId };
    items[key] = existing
      ? await prisma.inventoryItem.update({ where: { id: existing.id }, data })
      : await prisma.inventoryItem.create({ data: { orgId, createdBy: userId, ...data } });

    if (!receive) continue;
    // Only stock an item the first time it is seeded: re-running the seed must
    // not keep piling stock onto the same shelf.
    const already = await prisma.stockTransaction.findFirst({
      where: { orgId, itemId: items[key].id, type: "receipt" },
    });
    if (already) continue;

    const movement = await inventoryService.receiveStock({
      orgId,
      user: { id: userId, role: "warehouse" },
      payload: {
        itemId: items[key].id,
        warehouseId: warehouses[receive.warehouse].id,
        locationId: locations[receive.location].id,
        quantity: receive.quantity,
        unitCost: receive.unitCost,
        reference: "Opening stock",
      },
    });
    if (receive.agedDays) await backdate(movement.id, receive.agedDays);
  }

  // Later deliveries of the same item, so the purchase price trend has a line
  // to draw rather than a single point.
  for (const spec of PRICE_HISTORY) {
    const already = await prisma.stockTransaction.findFirst({
      where: { orgId, itemId: items[spec.item].id, reference: spec.ref },
    });
    if (already) continue;

    const movement = await inventoryService.receiveStock({
      orgId,
      user: { id: userId, role: "warehouse" },
      payload: {
        itemId: items[spec.item].id,
        warehouseId: warehouses[spec.warehouse].id,
        locationId: locations[spec.location].id,
        quantity: spec.quantity,
        unitCost: spec.unitCost,
        reference: spec.ref,
      },
    });
    await backdate(movement.id, spec.agedDays);
  }

  // One issue to site, so the ledger, the activity and the cost have a worked
  // example rather than an empty table.
  const issued = await prisma.stockTransaction.findFirst({ where: { orgId, type: "issue" } });
  if (!issued) {
    await inventoryService.issueStock({
      orgId,
      user: { id: userId, role: "warehouse" },
      payload: {
        itemId: items.cement.id,
        warehouseId: warehouses.central.id,
        locationId: locations.b04.id,
        quantity: 240,
        projectId,
        activityId: activities.sub.id,
        reference: "Foundation pour 1",
      },
    });
  }

  await upsertMaterialPlan({ projectId, activities, userId });

  return { warehouses, items };
}

/** What each activity needs and when it has to be ordered to arrive in time. */
async function upsertMaterialPlan({ projectId, activities, userId }) {
  for (const spec of MATERIAL_PLAN) {
    const data = {
      code: spec.code,
      unit: spec.unit,
      qty: spec.qty,
      plannedQty: spec.qty,
      receivedQty: spec.receivedQty,
      requiredDate: date(spec.required),
      orderByDate: date(spec.orderBy),
      leadWeeks: spec.leadWeeks,
      status: spec.status,
      updatedBy: userId,
    };
    const existing = await prisma.activityMaterial.findFirst({
      where: { projectId, activityId: activities[spec.activity].id, name: spec.name },
    });
    if (existing) {
      await prisma.activityMaterial.update({ where: { id: existing.id }, data });
    } else {
      await prisma.activityMaterial.create({
        data: {
          projectId,
          activityId: activities[spec.activity].id,
          name: spec.name,
          createdBy: userId,
          ...data,
        },
      });
    }
  }
}

/**
 * Two purchase orders, so both halves of the flow have something real.
 *
 * PO-0001 is still outstanding: scan it in the warehouse and walk a delivery
 * through goods receipt. PO-0002 is the brief's own example — 1,000 ordered,
 * 950 accepted, 50 rejected, and a supplier invoice for the full 1,000 — so
 * the three-way match opens with a discrepancy worth arguing about.
 */
async function upsertPurchaseOrders({ orgId, projectId, activities, items, userId }) {
  const supplier = await prisma.procurementSupplier.upsert({
    where: { projectId_name: { projectId, name: "Riverstone Cement" } },
    create: { projectId, name: "Riverstone Cement", status: "approved" },
    update: {},
  });

  const orders = {};
  for (const spec of [
    {
      key: "open",
      ref: "PO-0001",
      item: "Formwork and reinforcement",
      status: "issued",
      lines: [
        { activity: "frame", item: items.rebar, qty: 400, cost: 21.5 },
        { activity: "frame", item: items.formwork, qty: 150, cost: 34 },
      ],
    },
    {
      key: "billed",
      ref: "PO-0002",
      item: "Cement supply",
      status: "received",
      received: true,
      lines: [{ activity: "sub", item: items.cement, qty: 1000, cost: 6.4, accepted: 950, rejected: 50 }],
    },
  ]) {
    const value = spec.lines.reduce((sum, line) => sum + line.qty * line.cost, 0);
    const existing = await prisma.procurementOrder.findFirst({ where: { projectId, ref: spec.ref } });
    const data = {
      item: spec.item,
      supplierId: supplier.id,
      supplier: supplier.name,
      status: spec.status,
      value,
      warehouseStatus: spec.received ? "received" : "not_received",
      orderDate: date("2026-01-05"),
      promisedDate: date("2026-02-02"),
      updatedBy: userId,
    };
    const order = existing
      ? await prisma.procurementOrder.update({ where: { id: existing.id }, data })
      : await prisma.procurementOrder.create({
          data: { projectId, ref: spec.ref, createdBy: userId, ...data },
        });
    orders[spec.key] = order;

    let lineNumber = 1;
    for (const line of spec.lines) {
      const lineData = {
        projectId,
        supplierId: supplier.id,
        activityId: activities[line.activity].id,
        inventoryItemId: line.item.id,
        itemCode: line.item.sku,
        description: line.item.name,
        unit: line.item.unit,
        orderedQty: line.qty,
        receivedQty: line.accepted ?? 0,
        rejectedQty: line.rejected ?? 0,
        unitCost: line.cost,
        status: line.accepted ? "received" : "ordered",
      };
      const existingLine = await prisma.procurementPoLine.findFirst({
        where: { orderId: order.id, lineNumber },
      });
      if (existingLine) {
        await prisma.procurementPoLine.update({ where: { id: existingLine.id }, data: lineData });
      } else {
        await prisma.procurementPoLine.create({
          data: { orderId: order.id, lineNumber, ...lineData },
        });
      }
      lineNumber += 1;
    }
  }

  // The supplier invoice for the full 1,000, against a delivery of 950.
  const billedLines = await prisma.procurementPoLine.findMany({
    where: { orderId: orders.billed.id },
    orderBy: [{ lineNumber: "asc" }],
  });
  const existingInvoice = await prisma.directCost.findFirst({
    where: { projectId, ref: "SI-0001" },
  });
  const invoiceData = {
    type: "invoice",
    vendorName: supplier.name,
    invoiceNumber: "RC-88213",
    purchaseOrderId: orders.billed.id,
    description: "Cement supply against PO-0002",
    costDate: date("2026-03-10"),
    status: "pending",
    subtotal: 6400,
    total: 6400,
    updatedBy: userId,
  };
  const invoice = existingInvoice
    ? await prisma.directCost.update({ where: { id: existingInvoice.id }, data: invoiceData })
    : await prisma.directCost.create({
        data: { orgId, projectId, number: 1, ref: "SI-0001", createdBy: userId, ...invoiceData },
      });

  const existingInvoiceLine = await prisma.directCostLine.findFirst({
    where: { directCostId: invoice.id },
  });
  const invoiceLineData = {
    description: "Cement OPC 42.5N",
    poLineId: billedLines[0].id,
    activityId: activities.sub.id,
    costType: "material",
    quantity: 1000,
    unit: "bag",
    unitCost: 6.4,
    amount: 6400,
  };
  if (existingInvoiceLine) {
    await prisma.directCostLine.update({
      where: { id: existingInvoiceLine.id },
      data: invoiceLineData,
    });
  } else {
    await prisma.directCostLine.create({
      data: { orgId, projectId, directCostId: invoice.id, ...invoiceLineData },
    });
  }

  return orders;
}

/**
 * An executed subcontract, so the money-going-out spine has something real.
 *
 * A schedule of values tied to activities, and an approved change order that
 * raises one of its lines — which is the "unless an authorised contract
 * modification exists" case the over-billing rule turns on. Without this the
 * commitments register, pay applications and the scope matrix all open empty.
 */
async function upsertSubcontract({ orgId, projectId, activities, boqItems, userId }) {
  // A full vendor profile, because the agreement is assembled from it: name,
  // registered name, registration and tax numbers, address and contact all
  // print on the contract without anybody retyping them.
  const vendorProfile = {
    type: "external",
    isVendor: true,
    trades: ["Concrete", "Formwork", "Reinforcement"],
    legalName: "Meridian Concrete Services LLC",
    registrationNumber: "LA-7741208",
    taxNumber: "72-4419006",
    address: "1840 Industrial Parkway, Baton Rouge, LA 70805",
    contactName: "Ana Silva",
    email: "contracts@meridian.example",
    phone: "+1 225 555 0142",
    status: "active",
  };
  const vendor = await prisma.company.upsert({
    where: { orgId_name: { orgId, name: "Meridian Concrete Services" } },
    create: { orgId, name: "Meridian Concrete Services", ...vendorProfile },
    update: vendorProfile,
  });

  const existing = await prisma.commitment.findFirst({
    where: { projectId, ref: "SC-0001" },
  });
  const data = {
    type: "subcontract",
    title: "Reinforced concrete frame — labour and plant",
    description: "Frame to level 12, including formwork, reinforcement fixing and pours.",
    vendorCompanyId: vendor.id,
    status: "executed",
    currency: "USD",
    retentionRate: 10,
    paymentTerms: "30 days from certification",
    // Required cover with no certificate on file yet: the state a fresh
    // subcontract is actually in, and what the agreement's readiness list and
    // the pay-app compliance gate are both there to catch.
    insuranceJson: [
      { type: "general_liability", required: true, documentId: null, note: "USD 5m each occurrence" },
      { type: "workers_compensation", required: true, documentId: null, note: "Statutory" },
      { type: "auto", required: false, documentId: null, note: null },
    ],
    startDate: date("2026-03-09"),
    endDate: date("2026-07-31"),
    executedAt: date("2026-03-02"),
    executedBy: userId,
    approvedAt: date("2026-02-24"),
    approvedBy: userId,
    updatedBy: userId,
  };

  const commitment = existing
    ? await prisma.commitment.update({ where: { id: existing.id }, data })
    : await prisma.commitment.create({
        data: { orgId, projectId, number: 1, ref: "SC-0001", createdBy: userId, ...data },
      });

  const lines = [
    {
      lineNumber: 1,
      description: "Formwork to columns and slabs",
      activity: "frame",
      boq: "B-200",
      unit: "m2",
      qty: 9400,
      rate: 62,
    },
    {
      lineNumber: 2,
      description: "Reinforcement fixing",
      activity: "frame",
      boq: "B-200",
      unit: "tonne",
      qty: 640,
      rate: 410,
    },
    {
      lineNumber: 3,
      description: "Concrete placing and finishing",
      activity: "frame",
      boq: "B-200",
      unit: "m3",
      qty: 7100,
      rate: 48,
    },
  ];

  const sovLines = {};
  for (const line of lines) {
    const lineData = {
      orgId,
      projectId,
      description: line.description,
      activityId: activities[line.activity].id,
      boqItemId: boqItems[line.boq]?.id ?? null,
      unit: line.unit,
      qty: line.qty,
      rate: line.rate,
      amount: line.qty * line.rate,
      sortOrder: line.lineNumber - 1,
    };
    const found = await prisma.commitmentSovLine.findFirst({
      where: { commitmentId: commitment.id, lineNumber: line.lineNumber },
    });
    sovLines[line.lineNumber] = found
      ? await prisma.commitmentSovLine.update({ where: { id: found.id }, data: lineData })
      : await prisma.commitmentSovLine.create({
          data: { commitmentId: commitment.id, lineNumber: line.lineNumber, ...lineData },
        });
  }

  // An approved change order that raises line 1: the subcontractor may bill
  // past the original scheduled amount because this authorises it.
  const existingCo = await prisma.commitmentChangeOrder.findFirst({
    where: { commitmentId: commitment.id, number: 1 },
  });
  const coData = {
    title: "Additional formwork to transfer slab",
    description: "Client-instructed thickening at level 3.",
    status: "approved",
    value: 74_400,
    linesJson: [
      {
        sovLineId: sovLines[1].id,
        description: "Additional formwork to transfer slab",
        activityId: activities.frame.id,
        amount: 74_400,
      },
    ],
    submittedAt: date("2026-04-08"),
    approvedAt: date("2026-04-15"),
    approvedBy: userId,
    updatedBy: userId,
  };
  if (existingCo) {
    await prisma.commitmentChangeOrder.update({ where: { id: existingCo.id }, data: coData });
  } else {
    await prisma.commitmentChangeOrder.create({
      data: {
        orgId,
        projectId,
        commitmentId: commitment.id,
        number: 1,
        ref: `${commitment.ref}-CO01`,
        createdBy: userId,
        ...coData,
      },
    });
  }

  return commitment;
}

async function upsertResources(projectId, activities) {
  for (const spec of RESOURCES) {
    const activity = activities[spec.activity];
    const data = {
      resourceType: spec.type,
      quantity: spec.quantity,
      unit: spec.unit,
      dailyRate: spec.dailyRate || null,
      totalCost: spec.dailyRate ? spec.quantity * spec.dailyRate : null,
    };

    const existing = await prisma.resourceAllocation.findFirst({
      where: { projectId, activityId: activity.id, resourceName: spec.name },
    });
    if (existing) {
      await prisma.resourceAllocation.update({ where: { id: existing.id }, data });
    } else {
      await prisma.resourceAllocation.create({
        data: { projectId, activityId: activity.id, resourceName: spec.name, ...data },
      });
    }
  }
}

async function upsertProgressAndCost({ projectId, activities, userId }) {
  const now = new Date();

  for (const spec of ACTIVITIES) {
    const activity = activities[spec.key];

    const progress = {
      pctComplete: spec.pct,
      actualCost: spec.actualCost,
      progressMethod: "percent",
      source: "manual",
      status: "approved",
      approvedBy: userId,
      approvedAt: now,
      notes: "Seeded approved progress",
      updatedBy: userId,
      updatedAt: now,
    };

    const existingProgress = await prisma.activityProgress.findFirst({
      where: { activityId: activity.id, status: "approved" },
      orderBy: { updatedAt: "desc" },
    });
    if (existingProgress) {
      await prisma.activityProgress.update({ where: { id: existingProgress.id }, data: progress });
    } else {
      await prisma.activityProgress.create({ data: { activityId: activity.id, ...progress } });
    }

    // A plausible seven-category split of the activity's budget, with actuals
    // tracking the progress percentage.
    const budget = spec.budget;
    const cost = {
      labour: Math.round(budget * 0.32),
      material: Math.round(budget * 0.41),
      equipment: Math.round(budget * 0.11),
      subcontract: Math.round(budget * 0.09),
      indirect: Math.round(budget * 0.03),
      overhead: Math.round(budget * 0.03),
      contingency: Math.round(budget * 0.01),
      budget,
      committed: Math.round(budget * 0.86),
      actual: spec.actualCost,
      actualThroughDate: date("2026-06-30"),
      forecast: Math.round(budget * 1.02),
    };

    const existingCost = await prisma.costRecord.findFirst({
      where: { projectId, activityId: activity.id },
    });
    if (existingCost) {
      await prisma.costRecord.update({ where: { id: existingCost.id }, data: cost });
    } else {
      await prisma.costRecord.create({ data: { projectId, activityId: activity.id, ...cost } });
    }
  }
}

async function upsertBaseline({ projectId, userId }) {
  await prisma.scheduleRevision.updateMany({ where: { projectId }, data: { isActive: false } });

  const data = {
    activityCount: ACTIVITIES.length,
    criticalCount: ACTIVITIES.filter((a) => a.isCritical).length,
    totalBudget: ACTIVITIES.reduce((sum, a) => sum + a.budget, 0),
    snapshotJson: {
      projectSummary: "Seeded demo baseline for Riverside Tower.",
      risks: [],
      milestones: [],
      wbs: [
        { code: "01", name: "Substructure", level: 1 },
        { code: "02", name: "Superstructure", level: 1 },
        { code: "03", name: "Envelope", level: 1 },
      ],
      resourceSummary: [],
      longLeadItems: [],
      assumptions: [],
      criticalPath: ACTIVITIES.filter((a) => a.isCritical).map((a) => a.activityCode),
    },
    source: "seed",
    isActive: true,
    status: "approved",
    approvedBy: userId,
    approvedAt: new Date(),
    activationComment: "Seeded active baseline.",
  };

  const existing = await prisma.scheduleRevision.findFirst({
    where: { projectId, label: "Demo Baseline" },
  });
  if (existing) return prisma.scheduleRevision.update({ where: { id: existing.id }, data });
  return prisma.scheduleRevision.create({ data: { projectId, label: "Demo Baseline", ...data } });
}

async function main() {
  const org = await upsertOrganisation();
  await ensureSubscription(org.id);
  const people = await upsertPeople(org.id);
  const project = await upsertProject(org.id);
  await assignEveryone(project.id, people);

  const activities = await upsertActivities(project.id);
  await upsertDependencies(project.id, activities);
  const boqItems = await upsertBoq(project.id);
  await upsertAllocations({
    projectId: project.id,
    boqItems,
    activities,
    userId: people.pm.id,
  });
  await upsertResources(project.id, activities);
  await upsertSubcontract({
    orgId: org.id,
    projectId: project.id,
    activities,
    boqItems,
    userId: people.pm.id,
  });
  const { items: inventoryItems } = await upsertInventory({
    orgId: org.id,
    projectId: project.id,
    activities,
    userId: people.warehouse.id,
  });
  await upsertPurchaseOrders({
    orgId: org.id,
    projectId: project.id,
    activities,
    items: inventoryItems,
    userId: people.procurement.id,
  });
  await upsertProgressAndCost({ projectId: project.id, activities, userId: people.pm.id });
  await upsertBaseline({ projectId: project.id, userId: people.pm.id });

  console.log(`Seeded "${ORG_NAME}" / "${PROJECT_NAME}"`);
  console.log(`  organisation  ${org.id}`);
  console.log(`  project       ${project.id}`);
  console.log(`  activities    ${Object.keys(activities).length}`);
  console.log(`  BOQ items     ${Object.keys(boqItems).length}`);
  console.log("");
  console.log(`Sign in with any of these — password "${PASSWORD}":`);
  for (const [, name, email, role] of PEOPLE) {
    console.log(`  ${email.padEnd(26)} ${role.padEnd(16)} ${name}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
