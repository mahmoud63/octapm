const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

/**
 * Company workspace masters (OCTA-ADM-COMPANY-007): directory, vendors, cost
 * codes and equipment defined once per organisation and reused on every
 * project. Company admins (or PMs) administer them; every project member may
 * read them for pickers.
 */

const COST_CODE_CATEGORIES = Object.freeze([
  "labour",
  "material",
  "equipment",
  "subcontract",
  "indirect",
  "overhead",
  "contingency",
  "other",
]);
const RATE_TYPES = Object.freeze(["hourly", "daily"]);
const STATUSES = Object.freeze(["active", "archived"]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => value?.toISOString?.() || value || null;
const toNumber = (value) => (value === null || value === undefined ? 0 : Number(value) || 0);

const normalizeTrades = (value) => {
  if (value === undefined) return undefined;
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());
  // De-duplicate case-insensitively, keeping the first spelling.
  const seen = new Set();
  const out = [];
  for (const item of list.map((entry) => String(entry).trim()).filter(Boolean)) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 30);
};

const recordOrgAudit = async ({
  tx = prisma,
  orgId,
  actorId = null,
  actorRole = null,
  entityType,
  entityId,
  action,
  metadata = {},
}) => {
  if (!tx.authAuditEvent?.create) return null;
  return tx.authAuditEvent.create({
    data: { orgId, actorId, actorRole, entityType, entityId, action, metadataJson: metadata },
  });
};

// ─── Directory ──────────────────────────────────────────────────────────────

const serializeCompany = (company) => ({
  id: company.id,
  orgId: company.orgId,
  name: company.name,
  legalName: company.legalName ?? null,
  tradeName: company.tradeName ?? null,
  registrationNumber: company.registrationNumber ?? null,
  taxNumber: company.taxNumber ?? null,
  type: company.type,
  email: company.email ?? null,
  phone: company.phone ?? null,
  website: company.website ?? null,
  address: company.address ?? null,
  contactName: company.contactName ?? null,
  isVendor: Boolean(company.isVendor),
  trades: company.trades || [],
  vendorProfile: company.vendorProfileJson || {},
  status: company.status,
  memberCount: company._count?.memberships ?? 0,
  projectCount: company._count?.projectParties ?? 0,
  supplierCount: company._count?.procurementSuppliers ?? 0,
  createdAt: toIso(company.createdAt),
  updatedAt: toIso(company.updatedAt),
});

const companyCounts = { _count: { select: { memberships: true, projectParties: true, procurementSuppliers: true } } };

const listDirectory = async ({ orgId, query = {} }) => {
  const where = { orgId };
  if (query.status && ["active", "inactive"].includes(query.status)) where.status = query.status;
  if (query.search) {
    where.OR = [
      { name: { contains: String(query.search), mode: "insensitive" } },
      { tradeName: { contains: String(query.search), mode: "insensitive" } },
      { email: { contains: String(query.search), mode: "insensitive" } },
    ];
  }
  if (query.vendorsOnly) where.isVendor = true;

  const [companies, userCount, activeUserCount] = await Promise.all([
    prisma.company.findMany({
      where,
      include: companyCounts,
      orderBy: [{ name: "asc" }],
      take: 500,
    }),
    prisma.user.count({ where: { orgId } }),
    prisma.user.count({ where: { orgId, status: "active" } }),
  ]);

  return {
    items: companies.map(serializeCompany),
    summary: {
      companies: companies.length,
      vendors: companies.filter((company) => company.isVendor).length,
      users: userCount,
      activeUsers: activeUserCount,
    },
  };
};

// ─── Vendors ────────────────────────────────────────────────────────────────

const listVendors = async ({ orgId, query = {} }) => {
  const where = { orgId, isVendor: true };
  if (!query.includeInactive) where.status = "active";
  if (query.trade) where.trades = { has: String(query.trade) };
  if (query.search) where.name = { contains: String(query.search), mode: "insensitive" };
  const rows = await prisma.company.findMany({
    where,
    include: companyCounts,
    orderBy: [{ name: "asc" }],
    take: 500,
  });
  const trades = {};
  for (const row of rows) for (const trade of row.trades || []) trades[trade] = (trades[trade] || 0) + 1;
  return {
    items: rows.map(serializeCompany),
    summary: {
      total: rows.length,
      trades: Object.entries(trades)
        .sort((a, b) => b[1] - a[1])
        .map(([trade, count]) => ({ trade, count })),
    },
  };
};

const vendorData = (payload = {}, existing = null) => {
  const data = {};
  const fields = ["legalName", "tradeName", "registrationNumber", "taxNumber", "email", "phone", "website", "address", "contactName"];
  for (const field of fields) if (payload[field] !== undefined) data[field] = trimOrNull(payload[field]);
  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "VENDOR_NAME_REQUIRED", "Vendor name is required");
    data.name = name;
  }
  const trades = normalizeTrades(payload.trades ?? payload.tradeCategories);
  if (trades !== undefined) data.trades = trades;
  if (payload.vendorProfile !== undefined || payload.leadTimeReliability !== undefined || payload.paymentTerms !== undefined || payload.notes !== undefined) {
    const current = { ...(existing?.vendorProfileJson || {}), ...(payload.vendorProfile || {}) };
    if (payload.leadTimeReliability !== undefined) current.leadTimeReliability = payload.leadTimeReliability === null ? null : Number(payload.leadTimeReliability);
    if (payload.paymentTerms !== undefined) current.paymentTerms = trimOrNull(payload.paymentTerms);
    if (payload.notes !== undefined) current.notes = trimOrNull(payload.notes);
    data.vendorProfileJson = current;
  }
  if (payload.status !== undefined) {
    if (!["active", "inactive"].includes(payload.status)) {
      throw new HttpError(400, "VENDOR_STATUS_INVALID", "status must be active or inactive");
    }
    data.status = payload.status;
  }
  return data;
};

const createVendor = async ({ orgId, payload = {}, actorId = null, actorRole = null }) => {
  const data = vendorData({ ...payload, name: payload.name });
  const company = await prisma.$transaction(async (tx) => {
    const existing = await tx.company.findFirst({
      where: { orgId, name: { equals: data.name, mode: "insensitive" } },
      include: companyCounts,
    });
    const row = existing
      ? await tx.company.update({
          where: { id: existing.id },
          data: { ...data, isVendor: true, type: existing.type === "external" ? "vendor" : existing.type },
          include: companyCounts,
        })
      : await tx.company.create({
          data: { orgId, type: "vendor", isVendor: true, ...data },
          include: companyCounts,
        });
    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "vendor",
      entityId: row.id,
      action: existing ? "promoted" : "created",
      metadata: { name: row.name, trades: row.trades },
    });
    return row;
  });
  return serializeCompany(company);
};

const updateVendor = async ({ orgId, vendorId, payload = {}, actorId = null, actorRole = null }) => {
  const existing = await prisma.company.findFirst({ where: { id: vendorId, orgId } });
  if (!existing) throw new HttpError(404, "VENDOR_NOT_FOUND", "Vendor not found");
  const data = vendorData(payload, existing);
  if (payload.isVendor !== undefined) data.isVendor = Boolean(payload.isVendor);
  const company = await prisma.$transaction(async (tx) => {
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await tx.company.findFirst({
        where: { orgId, id: { not: vendorId }, name: { equals: data.name, mode: "insensitive" } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, "VENDOR_DUPLICATE_NAME", "A company with this name already exists");
    }
    const row = await tx.company.update({ where: { id: vendorId }, data, include: companyCounts });
    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "vendor",
      entityId: vendorId,
      action: "updated",
      metadata: { fields: Object.keys(data) },
    });
    return row;
  });
  return serializeCompany(company);
};

/**
 * De-duplication report after the supplier → vendor migration: vendors that
 * absorbed suppliers from several projects, and suppliers still unlinked.
 */
const vendorMigrationReport = async ({ orgId }) => {
  const suppliers = await prisma.procurementSupplier.findMany({
    where: { project: { orgId } },
    select: {
      id: true,
      name: true,
      projectId: true,
      companyId: true,
      status: true,
      project: { select: { name: true } },
      company: { select: { id: true, name: true } },
    },
    orderBy: [{ name: "asc" }],
  });
  const byCompany = new Map();
  const unlinked = [];
  for (const supplier of suppliers) {
    if (!supplier.companyId) {
      unlinked.push({
        supplierId: supplier.id,
        name: supplier.name,
        projectId: supplier.projectId,
        projectName: supplier.project?.name || null,
      });
      continue;
    }
    if (!byCompany.has(supplier.companyId)) {
      byCompany.set(supplier.companyId, { companyId: supplier.companyId, name: supplier.company?.name || supplier.name, suppliers: [] });
    }
    byCompany.get(supplier.companyId).suppliers.push({
      supplierId: supplier.id,
      name: supplier.name,
      projectId: supplier.projectId,
      projectName: supplier.project?.name || null,
      status: supplier.status,
    });
  }
  const merged = [...byCompany.values()].filter((entry) => entry.suppliers.length > 1);
  return {
    summary: {
      suppliers: suppliers.length,
      linked: suppliers.length - unlinked.length,
      unlinked: unlinked.length,
      vendors: byCompany.size,
      mergedVendors: merged.length,
    },
    merged,
    unlinked,
  };
};

// ─── Cost codes ─────────────────────────────────────────────────────────────

const serializeCostCode = (row) => ({
  id: row.id,
  orgId: row.orgId,
  code: row.code,
  name: row.name,
  description: row.description ?? null,
  category: row.category,
  parentId: row.parentId ?? null,
  sortOrder: row.sortOrder,
  status: row.status,
  childCount: row._count?.children ?? 0,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const costCodeData = (payload = {}, { requireAll = false } = {}) => {
  const data = {};
  if (payload.code !== undefined || requireAll) {
    const code = trimOrNull(payload.code);
    if (!code) throw new HttpError(400, "COST_CODE_REQUIRED", "code is required");
    data.code = code.toUpperCase();
  }
  if (payload.name !== undefined || requireAll) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "COST_CODE_NAME_REQUIRED", "name is required");
    data.name = name;
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description);
  if (payload.category !== undefined) {
    const category = String(payload.category || "other").toLowerCase();
    if (!COST_CODE_CATEGORIES.includes(category)) {
      throw new HttpError(400, "COST_CODE_CATEGORY_INVALID", `category must be one of ${COST_CODE_CATEGORIES.join(", ")}`);
    }
    data.category = category;
  }
  if (payload.parentId !== undefined) data.parentId = trimOrNull(payload.parentId);
  if (payload.sortOrder !== undefined) data.sortOrder = Math.trunc(Number(payload.sortOrder)) || 0;
  if (payload.status !== undefined) {
    if (!STATUSES.includes(payload.status)) throw new HttpError(400, "COST_CODE_STATUS_INVALID", "status must be active or archived");
    data.status = payload.status;
  }
  return data;
};

const listCostCodes = async ({ orgId, query = {} }) => {
  const where = { orgId };
  if (!query.includeArchived) where.status = "active";
  if (query.category && COST_CODE_CATEGORIES.includes(query.category)) where.category = query.category;
  if (query.search) {
    where.OR = [
      { code: { contains: String(query.search), mode: "insensitive" } },
      { name: { contains: String(query.search), mode: "insensitive" } },
    ];
  }
  const rows = await prisma.costCode.findMany({
    where,
    include: { _count: { select: { children: true } } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    take: 2000,
  });
  return { items: rows.map(serializeCostCode), summary: { total: rows.length } };
};

const assertParentCostCode = async ({ tx, orgId, parentId, selfId = null }) => {
  if (!parentId) return;
  if (selfId && parentId === selfId) throw new HttpError(400, "COST_CODE_PARENT_INVALID", "A cost code cannot be its own parent");
  const parent = await tx.costCode.findFirst({ where: { id: parentId, orgId }, select: { id: true } });
  if (!parent) throw new HttpError(404, "COST_CODE_PARENT_NOT_FOUND", "Parent cost code not found");
};

const createCostCode = async ({ orgId, payload = {}, actorId = null, actorRole = null }) => {
  const data = costCodeData(payload, { requireAll: true });
  const row = await prisma.$transaction(async (tx) => {
    await assertParentCostCode({ tx, orgId, parentId: data.parentId });
    const clash = await tx.costCode.findFirst({ where: { orgId, code: data.code }, select: { id: true } });
    if (clash) throw new HttpError(409, "COST_CODE_DUPLICATE", `Cost code ${data.code} already exists`);
    const created = await tx.costCode.create({
      data: { orgId, category: "other", ...data, createdBy: actorId, updatedBy: actorId },
      include: { _count: { select: { children: true } } },
    });
    await recordOrgAudit({ tx, orgId, actorId, actorRole, entityType: "cost_code", entityId: created.id, action: "created", metadata: { code: created.code } });
    return created;
  });
  return serializeCostCode(row);
};

const updateCostCode = async ({ orgId, costCodeId, payload = {}, actorId = null, actorRole = null }) => {
  const existing = await prisma.costCode.findFirst({ where: { id: costCodeId, orgId } });
  if (!existing) throw new HttpError(404, "COST_CODE_NOT_FOUND", "Cost code not found");
  const data = costCodeData(payload);
  const row = await prisma.$transaction(async (tx) => {
    await assertParentCostCode({ tx, orgId, parentId: data.parentId, selfId: costCodeId });
    if (data.code && data.code !== existing.code) {
      const clash = await tx.costCode.findFirst({ where: { orgId, code: data.code, id: { not: costCodeId } }, select: { id: true } });
      if (clash) throw new HttpError(409, "COST_CODE_DUPLICATE", `Cost code ${data.code} already exists`);
    }
    const updated = await tx.costCode.update({
      where: { id: costCodeId },
      data: { ...data, updatedBy: actorId },
      include: { _count: { select: { children: true } } },
    });
    await recordOrgAudit({ tx, orgId, actorId, actorRole, entityType: "cost_code", entityId: costCodeId, action: "updated", metadata: { fields: Object.keys(data) } });
    return updated;
  });
  return serializeCostCode(row);
};

/** Bulk upsert by code (CSV import). Parents are matched by code in the same batch or existing rows. */
const importCostCodes = async ({ orgId, rows = [], actorId = null, actorRole = null }) => {
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, "COST_CODE_ROWS_REQUIRED", "Provide at least one row");
  if (rows.length > 2000) throw new HttpError(400, "COST_CODE_ROWS_TOO_MANY", "Import at most 2000 rows at a time");
  const normalized = rows.map((row, index) => {
    const data = costCodeData(
      { code: row.code, name: row.name, description: row.description, category: row.category ?? "other", sortOrder: row.sortOrder ?? index },
      { requireAll: true },
    );
    return { ...data, parentCode: trimOrNull(row.parentCode)?.toUpperCase() || null };
  });

  const result = await prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    const idByCode = new Map();
    const existingRows = await tx.costCode.findMany({ where: { orgId }, select: { id: true, code: true } });
    for (const row of existingRows) idByCode.set(row.code, row.id);

    for (const row of normalized) {
      const { parentCode, ...data } = row;
      const existingId = idByCode.get(data.code);
      const saved = existingId
        ? await tx.costCode.update({ where: { id: existingId }, data: { ...data, updatedBy: actorId } })
        : await tx.costCode.create({ data: { orgId, ...data, createdBy: actorId, updatedBy: actorId } });
      if (existingId) updated += 1;
      else created += 1;
      idByCode.set(saved.code, saved.id);
    }
    // Second pass wires parents once every code has an id.
    for (const row of normalized) {
      if (!row.parentCode) continue;
      const parentId = idByCode.get(row.parentCode) || null;
      await tx.costCode.update({ where: { id: idByCode.get(row.code) }, data: { parentId } });
    }
    await recordOrgAudit({ tx, orgId, actorId, actorRole, entityType: "cost_code", entityId: "import", action: "imported", metadata: { created, updated } });
    return { created, updated };
  });
  return result;
};

// ─── Equipment masters ──────────────────────────────────────────────────────

const serializeCompanyEquipment = (row) => ({
  id: row.id,
  orgId: row.orgId,
  name: row.name,
  category: row.category ?? null,
  rateType: row.rateType,
  rate: toNumber(row.rate),
  notes: row.notes ?? null,
  status: row.status,
  projectCount: row._count?.equipment ?? 0,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const equipmentData = (payload = {}, { requireAll = false } = {}) => {
  const data = {};
  if (payload.name !== undefined || requireAll) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "EQUIPMENT_NAME_REQUIRED", "name is required");
    data.name = name;
  }
  if (payload.category !== undefined) data.category = trimOrNull(payload.category);
  if (payload.rateType !== undefined) {
    if (!RATE_TYPES.includes(payload.rateType)) throw new HttpError(400, "INVALID_RATE_TYPE", 'rateType must be "hourly" or "daily"');
    data.rateType = payload.rateType;
  }
  if (payload.rate !== undefined) {
    const rate = Number(payload.rate);
    if (!Number.isFinite(rate) || rate < 0) throw new HttpError(400, "EQUIPMENT_RATE_INVALID", "rate must be zero or positive");
    data.rate = Math.round(rate * 100) / 100;
  }
  if (payload.notes !== undefined) data.notes = trimOrNull(payload.notes);
  if (payload.status !== undefined) {
    if (!STATUSES.includes(payload.status)) throw new HttpError(400, "EQUIPMENT_STATUS_INVALID", "status must be active or archived");
    data.status = payload.status;
  }
  return data;
};

const equipmentCounts = { _count: { select: { equipment: true } } };

const listCompanyEquipment = async ({ orgId, query = {} }) => {
  const where = { orgId };
  if (!query.includeArchived) where.status = "active";
  if (query.search) where.name = { contains: String(query.search), mode: "insensitive" };
  const rows = await prisma.companyEquipment.findMany({ where, include: equipmentCounts, orderBy: [{ name: "asc" }], take: 1000 });
  return { items: rows.map(serializeCompanyEquipment), summary: { total: rows.length } };
};

const createCompanyEquipment = async ({ orgId, payload = {}, actorId = null, actorRole = null }) => {
  const data = equipmentData(payload, { requireAll: true });
  const row = await prisma.$transaction(async (tx) => {
    const clash = await tx.companyEquipment.findFirst({ where: { orgId, name: { equals: data.name, mode: "insensitive" } }, select: { id: true } });
    if (clash) throw new HttpError(409, "EQUIPMENT_DUPLICATE", `${data.name} is already in the equipment list`);
    const created = await tx.companyEquipment.create({
      data: { orgId, rateType: "daily", ...data, createdBy: actorId, updatedBy: actorId },
      include: equipmentCounts,
    });
    await recordOrgAudit({ tx, orgId, actorId, actorRole, entityType: "company_equipment", entityId: created.id, action: "created", metadata: { name: created.name } });
    return created;
  });
  return serializeCompanyEquipment(row);
};

const updateCompanyEquipment = async ({ orgId, equipmentId, payload = {}, actorId = null, actorRole = null }) => {
  const existing = await prisma.companyEquipment.findFirst({ where: { id: equipmentId, orgId } });
  if (!existing) throw new HttpError(404, "EQUIPMENT_NOT_FOUND", "Equipment not found");
  const data = equipmentData(payload);
  const row = await prisma.$transaction(async (tx) => {
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await tx.companyEquipment.findFirst({ where: { orgId, id: { not: equipmentId }, name: { equals: data.name, mode: "insensitive" } }, select: { id: true } });
      if (clash) throw new HttpError(409, "EQUIPMENT_DUPLICATE", `${data.name} is already in the equipment list`);
    }
    const updated = await tx.companyEquipment.update({ where: { id: equipmentId }, data: { ...data, updatedBy: actorId }, include: equipmentCounts });
    await recordOrgAudit({ tx, orgId, actorId, actorRole, entityType: "company_equipment", entityId: equipmentId, action: "updated", metadata: { fields: Object.keys(data) } });
    return updated;
  });
  return serializeCompanyEquipment(row);
};

module.exports = {
  COST_CODE_CATEGORIES,
  RATE_TYPES,
  createCompanyEquipment,
  createCostCode,
  createVendor,
  importCostCodes,
  listCompanyEquipment,
  listCostCodes,
  listDirectory,
  listVendors,
  serializeCompany,
  updateCompanyEquipment,
  updateCostCode,
  updateVendor,
  vendorMigrationReport,
};
