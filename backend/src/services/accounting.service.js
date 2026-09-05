const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const secretBox = require("../utils/secret-box");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const { PROVIDERS, PROVIDER_KEYS, getProvider, money } = require("./integrations/accounting-providers");

/**
 * Accounting connectors and ERP export (OCTA-INT-API-026).
 *
 * A connection per provider (QuickBooks Online, Xero) holds encrypted OAuth
 * tokens. Approved subcontractor payment applications become bills (vendor
 * ensured, one line per cost code through the code mapping); an hourly poll
 * reads the bill's payment status back and records the payment on the pay
 * application. Costs can also be exported as XLSX / CSV by cost code for any
 * other ERP.
 */

const RECORD_TYPE = "sub_pay_app";
const SYNC_STATUS = Object.freeze({ PENDING: "pending", SYNCED: "synced", PAID: "paid", FAILED: "failed" });
const MAX_SYNC_ATTEMPTS = 5;
const STATE_TTL_MS = 15 * 60_000;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const num = (value) => (value && typeof value === "object" && typeof value.toNumber === "function" ? value.toNumber() : Number(value || 0));
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
const tablesReady = () => Boolean(prisma.accountingConnection?.findFirst);

const redirectUri = (provider) => process.env.ACCOUNTING_REDIRECT_URI || `${(process.env.API_BASE_URL || process.env.WEB_APP_URL || "http://localhost:4000").replace(/\/$/, "")}/api/v1/integrations/accounting/${provider}/callback`;
const webAppUrl = () => (process.env.WEB_APP_URL || "http://localhost:5173").replace(/\/$/, "");

// ─── connections ───────────────────────────────────────────────────────────

const serializeConnection = (row, provider) => ({
  provider: provider.key,
  label: provider.label,
  configured: provider.isConfigured(),
  encryptionReady: secretBox.isConfigured(),
  status: row?.status || "disconnected",
  externalOrgId: row?.externalOrgId || null,
  externalOrgName: row?.externalOrgName || null,
  autoSyncPayApps: row ? Boolean(row.autoSyncPayApps) : true,
  connectedBy: row?.connectedBy || null,
  connectedAt: toIso(row?.connectedAt),
  lastSyncAt: toIso(row?.lastSyncAt),
  lastError: row?.lastError || null,
});

const listConnections = async ({ orgId }) => {
  const rows = tablesReady() ? await prisma.accountingConnection.findMany({ where: { orgId } }) : [];
  return PROVIDER_KEYS.map((key) => serializeConnection(rows.find((row) => row.provider === key) || null, PROVIDERS[key]));
};

const loadCredentials = (row) => (row?.credentialsJson ? secretBox.decrypt(row.credentialsJson) : null);

const startConnect = async ({ orgId, provider: providerKey, actor }) => {
  const provider = getProvider(providerKey);
  if (!provider.isConfigured()) throw new HttpError(409, "ACCOUNTING_NOT_CONFIGURED", `${provider.label} is not configured on this server (client id / secret)`);
  if (!secretBox.isConfigured()) throw new HttpError(409, "INTEGRATION_KEY_MISSING", "Set INTEGRATION_SECRET_KEY on the server before connecting an accounting system");
  const state = `${crypto.randomBytes(18).toString("base64url")}`;
  const pending = secretBox.encrypt({ pendingState: state, pendingUntil: new Date(Date.now() + STATE_TTL_MS).toISOString(), startedBy: actor?.id || null });
  await prisma.accountingConnection.upsert({
    where: { orgId_provider: { orgId, provider: provider.key } },
    update: { status: "pending", credentialsJson: pending, lastError: null },
    create: { orgId, provider: provider.key, status: "pending", credentialsJson: pending },
  });
  return { provider: provider.key, url: provider.authorizeUrl({ state: `${orgId}.${provider.key}.${state}`, redirectUri: redirectUri(provider.key) }) };
};

/** OAuth callback: validates the state, exchanges the code, stores encrypted tokens. */
const completeConnect = async ({ provider: providerKey, code, state, realmId = null, fetchImpl = globalThis.fetch }) => {
  const provider = getProvider(providerKey);
  const [orgId, statedProvider, nonce] = String(state || "").split(".");
  if (!orgId || statedProvider !== provider.key || !nonce) throw new HttpError(400, "ACCOUNTING_STATE_INVALID", "The sign-in did not start from OctaPM");
  const row = await prisma.accountingConnection.findFirst({ where: { orgId, provider: provider.key } });
  const pending = row ? loadCredentials(row) : null;
  if (!pending?.pendingState || pending.pendingState !== nonce || new Date(pending.pendingUntil) < new Date()) throw new HttpError(400, "ACCOUNTING_STATE_INVALID", "The sign-in has expired; start again from Company › Integrations");
  try {
    let credentials = await provider.exchangeCode({ code, redirectUri: redirectUri(provider.key), realmId, fetchImpl });
    let externalOrgName = credentials.externalOrgName;
    if (!externalOrgName) externalOrgName = (await provider.companyInfo(credentials, { fetchImpl }).catch(() => ({ name: null }))).name;
    credentials = { ...credentials, externalOrgName };
    await prisma.accountingConnection.update({ where: { id: row.id }, data: { status: "connected", credentialsJson: secretBox.encrypt(credentials), externalOrgId: credentials.externalOrgId || realmId || null, externalOrgName, connectedBy: pending.startedBy || null, connectedAt: new Date(), lastError: null } });
    await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.ACCOUNTING_CONNECTION || "accounting_connection", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: pending.startedBy || null, summary: { provider: provider.key, connected: true, externalOrgName } }).catch(() => null);
    return { orgId, provider: provider.key, externalOrgName, redirectTo: `${webAppUrl()}/company/integrations?connected=${provider.key}` };
  } catch (error) {
    await prisma.accountingConnection.update({ where: { id: row.id }, data: { status: "error", lastError: String(error?.message || error).slice(0, 500) } }).catch(() => null);
    throw error;
  }
};

const disconnect = async ({ orgId, provider: providerKey, actor }) => {
  const provider = getProvider(providerKey);
  const row = await prisma.accountingConnection.findFirst({ where: { orgId, provider: provider.key } });
  if (!row) return serializeConnection(null, provider);
  const updated = await prisma.accountingConnection.update({ where: { id: row.id }, data: { status: "disconnected", credentialsJson: null, externalOrgId: null, externalOrgName: null, lastError: null } });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.ACCOUNTING_CONNECTION || "accounting_connection", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { provider: provider.key, connected: false } }).catch(() => null);
  return serializeConnection(updated, provider);
};

const updateConnection = async ({ orgId, provider: providerKey, actor, payload = {} }) => {
  const provider = getProvider(providerKey);
  const row = await prisma.accountingConnection.findFirst({ where: { orgId, provider: provider.key } });
  if (!row) throw new HttpError(404, "ACCOUNTING_NOT_CONNECTED", `${provider.label} is not connected`);
  const updated = await prisma.accountingConnection.update({ where: { id: row.id }, data: { ...(payload.autoSyncPayApps !== undefined ? { autoSyncPayApps: Boolean(payload.autoSyncPayApps) } : {}) } });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.ACCOUNTING_CONNECTION || "accounting_connection", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { provider: provider.key, fields: Object.keys(payload) } }).catch(() => null);
  return serializeConnection(updated, provider);
};

/** Live credentials for a connected provider, refreshed when within 2 minutes of expiry. */
const connectedCredentials = async ({ orgId, providerKey, fetchImpl = globalThis.fetch }) => {
  const provider = getProvider(providerKey);
  const row = await prisma.accountingConnection.findFirst({ where: { orgId, provider: provider.key } });
  if (!row || row.status !== "connected") throw new HttpError(409, "ACCOUNTING_NOT_CONNECTED", `${provider.label} is not connected`);
  let credentials = loadCredentials(row);
  if (!credentials?.accessToken) throw new HttpError(409, "ACCOUNTING_NOT_CONNECTED", `${provider.label} needs to be connected again`);
  if (credentials.expiresAt && new Date(credentials.expiresAt).getTime() - Date.now() < 120_000) {
    credentials = await provider.refresh(credentials, { fetchImpl });
    await prisma.accountingConnection.update({ where: { id: row.id }, data: { credentialsJson: secretBox.encrypt(credentials) } });
  }
  return { provider, row, credentials };
};

const connectedProviders = async ({ orgId }) => {
  if (!tablesReady()) return [];
  const rows = await prisma.accountingConnection.findMany({ where: { orgId, status: "connected" } });
  return rows.map((row) => row.provider).filter((key) => PROVIDERS[key]);
};

const listExternalAccounts = async ({ orgId, provider: providerKey, fetchImpl = globalThis.fetch }) => {
  const { provider, credentials } = await connectedCredentials({ orgId, providerKey, fetchImpl });
  return provider.listAccounts(credentials, { fetchImpl });
};

// ─── cost-code mappings ────────────────────────────────────────────────────

const serializeMapping = (row) => ({ id: row.id, provider: row.provider, costCode: row.costCode, costCodeId: row.costCodeId || null, externalAccountId: row.externalAccountId || null, externalAccountName: row.externalAccountName || null, updatedAt: toIso(row.updatedAt) });

const listMappings = async ({ orgId, provider = null }) => {
  if (!prisma.accountingCodeMapping?.findMany) return [];
  const rows = await prisma.accountingCodeMapping.findMany({ where: { orgId, ...(provider ? { provider } : {}) }, orderBy: [{ provider: "asc" }, { costCode: "asc" }] });
  return rows.map(serializeMapping);
};

const upsertMapping = async ({ orgId, actor, payload = {} }) => {
  const provider = getProvider(payload.provider).key;
  const costCode = trimOrNull(payload.costCode);
  if (!costCode) throw new HttpError(400, "ACCOUNTING_MAPPING_CODE", "Give the cost code (or * for the default account)");
  const externalAccountId = trimOrNull(payload.externalAccountId);
  if (!externalAccountId) throw new HttpError(400, "ACCOUNTING_MAPPING_ACCOUNT", "Pick the account in the accounting system");
  const row = await prisma.accountingCodeMapping.upsert({
    where: { orgId_provider_costCode: { orgId, provider, costCode } },
    update: { externalAccountId, externalAccountName: trimOrNull(payload.externalAccountName), costCodeId: trimOrNull(payload.costCodeId) },
    create: { orgId, provider, costCode, costCodeId: trimOrNull(payload.costCodeId), externalAccountId, externalAccountName: trimOrNull(payload.externalAccountName) },
  });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.ACCOUNTING_CONNECTION || "accounting_connection", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { provider, costCode, externalAccountId } }).catch(() => null);
  return serializeMapping(row);
};

const deleteMapping = async ({ orgId, mappingId }) => {
  const row = await prisma.accountingCodeMapping.findFirst({ where: { id: mappingId, orgId } });
  if (!row) throw new HttpError(404, "ACCOUNTING_MAPPING_NOT_FOUND", "Mapping not found");
  await prisma.accountingCodeMapping.delete({ where: { id: row.id } });
  return { deleted: true };
};

const mappingIndex = async ({ orgId, provider }) => {
  const rows = await listMappings({ orgId, provider });
  return new Map(rows.map((row) => [row.costCode, row]));
};

// ─── pay application → bill lines ──────────────────────────────────────────

/** Resolves each pay-app line to its cost code (SOV line's cost code, else its budget line's). */
const resolveLineCostCodes = async ({ lines }) => {
  const sovIds = [...new Set(lines.map((line) => line.sovLineId).filter(Boolean))];
  const sovLines = sovIds.length && prisma.commitmentSovLine?.findMany ? await prisma.commitmentSovLine.findMany({ where: { id: { in: sovIds } }, select: { id: true, costCodeId: true, budgetLineId: true, description: true } }) : [];
  const budgetIds = [...new Set(sovLines.map((row) => row.budgetLineId).filter(Boolean))];
  const budgetLines = budgetIds.length && prisma.budgetLine?.findMany ? await prisma.budgetLine.findMany({ where: { id: { in: budgetIds } }, select: { id: true, costCodeId: true } }) : [];
  const budgetById = new Map(budgetLines.map((row) => [row.id, row]));
  const projectCostCodeIds = [...new Set([...sovLines.map((row) => row.costCodeId), ...budgetLines.map((row) => row.costCodeId)].filter(Boolean))];
  const projectCostCodes = projectCostCodeIds.length && prisma.projectCostCode?.findMany ? await prisma.projectCostCode.findMany({ where: { id: { in: projectCostCodeIds } }, include: { costCode: { select: { id: true, code: true, name: true } } } }) : [];
  const codeById = new Map(projectCostCodes.map((row) => [row.id, row.costCode]));
  const sovById = new Map(sovLines.map((row) => [row.id, row]));
  return lines.map((line) => {
    const sov = line.sovLineId ? sovById.get(line.sovLineId) : null;
    const projectCostCodeId = sov?.costCodeId || (sov?.budgetLineId ? budgetById.get(sov.budgetLineId)?.costCodeId : null) || null;
    const costCode = projectCostCodeId ? codeById.get(projectCostCodeId) : null;
    return { ...line, costCode: costCode?.code || line.costCode || null, costCodeName: costCode?.name || null, costCodeId: costCode?.id || null };
  });
};

const loadPayApp = async ({ projectId, payAppId }) => {
  const row = await prisma.subPayApp.findFirst({ where: { id: payAppId, projectId }, include: { commitment: { include: { vendorCompany: true } }, lines: true, project: { select: { id: true, name: true, currency: true } } } });
  if (!row) throw new HttpError(404, "SUB_PAY_APP_NOT_FOUND", "Payment application not found");
  return row;
};

/** Bill lines for a pay application: work by cost code, materials on site, retention and back-charges as negatives. */
const billLinesFor = async ({ payApp, mappings, provider }) => {
  const lines = await resolveLineCostCodes({ lines: payApp.lines || [] });
  const byCode = new Map();
  for (const line of lines) {
    const amount = money(num(line.thisPeriodAmount) + num(line.materialsOnSite));
    if (!amount) continue;
    const key = line.costCode || "(unmapped)";
    const entry = byCode.get(key) || { costCode: line.costCode, costCodeName: line.costCodeName, amount: 0, descriptions: [] };
    entry.amount = money(entry.amount + amount);
    if (line.description && entry.descriptions.length < 5) entry.descriptions.push(line.description);
    byCode.set(key, entry);
  }
  const fallback = mappings.get("*") || null;
  const missing = [];
  const billLines = [...byCode.values()].map((entry) => {
    const mapping = (entry.costCode && mappings.get(entry.costCode)) || fallback;
    if (!mapping) missing.push(entry.costCode || "(no cost code)");
    return { description: `${payApp.ref} · ${entry.costCode ? `${entry.costCode} ${entry.costCodeName || ""}`.trim() : "Work this period"}${entry.descriptions.length ? ` · ${entry.descriptions.join(", ")}` : ""}`.slice(0, 500), amount: entry.amount, costCode: entry.costCode, accountId: mapping?.externalAccountId || null, accountCode: mapping?.externalAccountId || null, accountName: mapping?.externalAccountName || null };
  });
  const retention = money(num(payApp.retentionThisPeriod));
  if (retention) billLines.push({ description: `${payApp.ref} · Retention withheld`, amount: -retention, costCode: "retention", accountId: (mappings.get("retention") || fallback)?.externalAccountId || null, accountCode: (mappings.get("retention") || fallback)?.externalAccountId || null, accountName: (mappings.get("retention") || fallback)?.externalAccountName || null });
  if (retention && !mappings.get("retention") && !fallback) missing.push("retention");
  const backCharges = money(num(payApp.backCharges));
  if (backCharges) billLines.push({ description: `${payApp.ref} · Back-charges${payApp.backChargesNote ? ` (${payApp.backChargesNote})` : ""}`.slice(0, 500), amount: -backCharges, costCode: "back_charges", accountId: (mappings.get("back_charges") || fallback)?.externalAccountId || null, accountCode: (mappings.get("back_charges") || fallback)?.externalAccountId || null, accountName: (mappings.get("back_charges") || fallback)?.externalAccountName || null });
  if (backCharges && !mappings.get("back_charges") && !fallback) missing.push("back_charges");
  const total = money(billLines.reduce((sum, line) => sum + line.amount, 0));
  return { lines: billLines, total, missing: [...new Set(missing)], provider };
};

// ─── syncs ─────────────────────────────────────────────────────────────────

const serializeSync = (row) => ({
  id: row.id,
  projectId: row.projectId,
  project: row.project ? { id: row.project.id, name: row.project.name } : null,
  provider: row.provider,
  providerLabel: PROVIDERS[row.provider]?.label || row.provider,
  recordType: row.recordType,
  recordId: row.recordId,
  externalId: row.externalId || null,
  externalRef: row.externalRef || null,
  externalVendorId: row.externalVendorId || null,
  status: row.status,
  amount: num(row.amount),
  currency: row.currency || null,
  attempts: row.attempts || 0,
  lastError: row.lastError || null,
  syncedAt: toIso(row.syncedAt),
  paidAt: toIso(row.paidAt),
  paidAmount: row.paidAmount === null || row.paidAmount === undefined ? null : num(row.paidAmount),
  requestedBy: row.requestedBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const listSyncs = async ({ orgId, projectId = null, status = null, recordId = null, limit = 100 }) => {
  if (!prisma.accountingSync?.findMany) return [];
  const rows = await prisma.accountingSync.findMany({ where: { orgId, ...(projectId ? { projectId } : {}), ...(status ? { status } : {}), ...(recordId ? { recordId } : {}) }, include: { project: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" }, take: Math.min(500, Math.max(1, Number(limit) || 100)) });
  return rows.map(serializeSync);
};

const enqueueSync = async ({ orgId, projectId, syncId, requestedBy }) => {
  const jobService = require("../jobs/job.service");
  return jobService.enqueueJob({ orgId, projectId, type: jobService.JOB_TYPES.ACCOUNTING_SYNC, payload: { syncId }, requestedBy: requestedBy || null, maxAttempts: MAX_SYNC_ATTEMPTS }).catch((error) => {
    console.error("[accounting] enqueue failed", error?.message || error);
    return null;
  });
};

/** Queues a bill for an approved pay application (manual: an accounting approver; auto: on approval). */
const queuePayAppSync = async ({ orgId, projectId, payAppId, provider: providerKey = null, actor = null }) => {
  const payApp = await loadPayApp({ projectId, payAppId });
  if (!["approved", "paid"].includes(payApp.status)) throw new HttpError(409, "ACCOUNTING_NOT_APPROVED", "Only approved applications can be sent to accounting");
  const providers = providerKey ? [getProvider(providerKey).key] : await connectedProviders({ orgId });
  if (!providers.length) throw new HttpError(409, "ACCOUNTING_NOT_CONNECTED", "Connect QuickBooks Online or Xero under Company › Integrations first");
  const results = [];
  for (const provider of providers) {
    const existing = await prisma.accountingSync.findFirst({ where: { provider, recordType: RECORD_TYPE, recordId: payApp.id } });
    if (existing && [SYNC_STATUS.SYNCED, SYNC_STATUS.PAID].includes(existing.status)) {
      results.push(serializeSync(existing));
      continue;
    }
    const row = existing
      ? await prisma.accountingSync.update({ where: { id: existing.id }, data: { status: SYNC_STATUS.PENDING, lastError: null, requestedBy: actor?.id || existing.requestedBy, amount: money(num(payApp.netThisPeriod)) } })
      : await prisma.accountingSync.create({ data: { orgId, projectId, provider, recordType: RECORD_TYPE, recordId: payApp.id, status: SYNC_STATUS.PENDING, amount: money(num(payApp.netThisPeriod)), currency: payApp.commitment?.currency || payApp.project?.currency || null, requestedBy: actor?.id || null } });
    await enqueueSync({ orgId, projectId, syncId: row.id, requestedBy: actor?.id || null });
    results.push(serializeSync(row));
  }
  await auditService.recordEvent({ orgId, projectId, entityType: RECORD_TYPE, entityId: payApp.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: payApp.ref, accounting: providers, queued: true } }).catch(() => null);
  return results;
};

/** Called after a pay application is approved: queues it when a connection auto-syncs. */
const maybeQueueOnApproval = async ({ orgId, projectId, payAppId, actor = null }) => {
  if (!tablesReady()) return null;
  const rows = await prisma.accountingConnection.findMany({ where: { orgId, status: "connected", autoSyncPayApps: true } });
  const providers = rows.map((row) => row.provider).filter((key) => PROVIDERS[key]);
  if (!providers.length) return null;
  const results = [];
  for (const provider of providers) results.push(...(await queuePayAppSync({ orgId, projectId, payAppId, provider, actor }).catch((error) => {
    console.warn("[accounting] auto-sync skipped", error?.message || error);
    return [];
  })));
  return results;
};

const markSyncFailed = async ({ row, error, dead }) => {
  await prisma.accountingSync.update({ where: { id: row.id }, data: { status: dead ? SYNC_STATUS.FAILED : SYNC_STATUS.PENDING, attempts: { increment: 1 }, lastError: String(error?.message || error).slice(0, 1000) } });
  if (dead) {
    await notificationService.createNotifications({ orgId: row.orgId, projectId: row.projectId, actorId: null, recipientRoles: ["finance", "pm"], recipientUserIds: row.requestedBy ? [row.requestedBy] : [], category: notificationService.NOTIFICATION_CATEGORIES?.COMMERCIAL || "commercial", event: "accounting.sync_failed", title: `Bill could not be created in ${PROVIDERS[row.provider]?.label || row.provider}`, message: String(error?.message || error).slice(0, 500), priority: "high", entityType: RECORD_TYPE, entityId: row.recordId, dedupeKeyBase: `accounting.sync_failed:${row.id}:${row.attempts + 1}` }).catch(() => null);
  }
};

/** Job handler: create the vendor bill for one sync row. */
const runSyncJob = async ({ payload = {}, fetchImpl = globalThis.fetch } = {}) => {
  const row = await prisma.accountingSync.findUnique({ where: { id: payload.syncId } });
  if (!row) return { skipped: "missing" };
  if ([SYNC_STATUS.SYNCED, SYNC_STATUS.PAID].includes(row.status)) return { skipped: row.status };
  try {
    const { provider, credentials, row: connection } = await connectedCredentials({ orgId: row.orgId, providerKey: row.provider, fetchImpl });
    const payApp = await loadPayApp({ projectId: row.projectId, payAppId: row.recordId });
    const mappings = await mappingIndex({ orgId: row.orgId, provider: provider.key });
    const bill = await billLinesFor({ payApp, mappings, provider: provider.key });
    if (bill.missing.length) {
      const error = new HttpError(409, "ACCOUNTING_MAPPING_MISSING", `Map cost code${bill.missing.length === 1 ? "" : "s"} ${bill.missing.join(", ")} to a ${provider.label} account (or add a * default) under Company › Integrations`);
      error.retryable = false;
      throw error;
    }
    if (!bill.lines.length) {
      const error = new HttpError(409, "ACCOUNTING_EMPTY_BILL", `${payApp.ref} has nothing to bill this period`);
      error.retryable = false;
      throw error;
    }
    const vendorName = payApp.commitment?.vendorCompany?.name || payApp.commitment?.vendorName || "Subcontractor";
    const vendor = await provider.ensureVendor(credentials, { name: vendorName, email: payApp.commitment?.vendorCompany?.email || null }, { fetchImpl });
    const created = await provider.createBill(credentials, { vendorId: vendor.id, ref: `${payApp.ref}`, date: day(payApp.approvedAt || payApp.periodEnd), dueDate: payApp.dueDate ? day(payApp.dueDate) : null, memo: `${payApp.project?.name || ""} · ${payApp.commitment?.ref || ""} · ${payApp.periodLabel || ""}`.trim(), currency: payApp.commitment?.currency || null, lines: bill.lines }, { fetchImpl });
    const updated = await prisma.accountingSync.update({ where: { id: row.id }, data: { status: SYNC_STATUS.SYNCED, externalId: created.id, externalRef: created.ref || null, externalVendorId: vendor.id, amount: bill.total, syncedAt: new Date(), lastError: null, attempts: { increment: 1 } } });
    await prisma.accountingConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date(), lastError: null } }).catch(() => null);
    await auditService.recordEvent({ orgId: row.orgId, projectId: row.projectId, entityType: RECORD_TYPE, entityId: row.recordId, action: auditService.ACTIONS.UPDATED, actorId: row.requestedBy || null, summary: { ref: payApp.ref, accounting: provider.key, bill: created.id, billRef: created.ref, amount: bill.total } }).catch(() => null);
    await notificationService.createNotifications({ orgId: row.orgId, projectId: row.projectId, actorId: null, recipientRoles: ["finance"], recipientUserIds: row.requestedBy ? [row.requestedBy] : [], category: notificationService.NOTIFICATION_CATEGORIES?.COMMERCIAL || "commercial", event: "accounting.synced", title: `${payApp.ref} posted to ${provider.label}`, message: `Bill ${created.ref || created.id} for ${bill.total.toLocaleString()} ${payApp.commitment?.currency || ""}`.trim(), priority: "normal", entityType: RECORD_TYPE, entityId: row.recordId, dedupeKeyBase: `accounting.synced:${row.id}` }).catch(() => null);
    return { synced: true, billId: created.id, total: bill.total, sync: serializeSync(updated) };
  } catch (error) {
    const retryable = error?.retryable === true;
    const dead = !retryable || row.attempts + 1 >= MAX_SYNC_ATTEMPTS;
    await markSyncFailed({ row, error, dead });
    const failure = new Error(`Accounting sync ${row.id}: ${error?.message || error}`);
    failure.retryable = !dead;
    failure.code = error?.code || "ACCOUNTING_SYNC_FAILED";
    throw failure;
  }
};

const retrySync = async ({ orgId, projectId = null, syncId, actor }) => {
  const row = await prisma.accountingSync.findFirst({ where: { id: syncId, orgId, ...(projectId ? { projectId } : {}) } });
  if (!row) throw new HttpError(404, "ACCOUNTING_SYNC_NOT_FOUND", "Sync not found");
  if ([SYNC_STATUS.SYNCED, SYNC_STATUS.PAID].includes(row.status)) return serializeSync(row);
  const updated = await prisma.accountingSync.update({ where: { id: row.id }, data: { status: SYNC_STATUS.PENDING, attempts: 0, lastError: null, requestedBy: actor?.id || row.requestedBy } });
  await enqueueSync({ orgId, projectId: row.projectId, syncId: row.id, requestedBy: actor?.id || null });
  return serializeSync(updated);
};

/** Reads payment status back from the accounting system and records payments on the pay applications. */
const pollPayments = async ({ orgId, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) => {
  if (!prisma.accountingSync?.findMany) return { checked: 0, paid: 0 };
  const rows = await prisma.accountingSync.findMany({ where: { orgId, status: SYNC_STATUS.SYNCED, externalId: { not: null } }, take: 200 });
  let checked = 0;
  let paid = 0;
  const credentialsByProvider = new Map();
  for (const row of rows) {
    try {
      if (!credentialsByProvider.has(row.provider)) credentialsByProvider.set(row.provider, await connectedCredentials({ orgId, providerKey: row.provider, fetchImpl }));
      const { provider, credentials } = credentialsByProvider.get(row.provider);
      const status = await provider.getBillStatus(credentials, row.externalId, { fetchImpl });
      checked += 1;
      if (status.status !== "paid") continue;
      const payApp = await prisma.subPayApp.findFirst({ where: { id: row.recordId }, select: { id: true, projectId: true, status: true, netThisPeriod: true, paidAmount: true } });
      if (!payApp) continue;
      const remaining = money(num(payApp.netThisPeriod) - num(payApp.paidAmount));
      if (remaining > 0) {
        await require("./sub-pay-app.service").recordPayment({ orgId, projectId: payApp.projectId, payAppId: payApp.id, payload: { amount: remaining, paidAt: status.paidAt || now(), method: provider.label, reference: row.externalRef || row.externalId, note: `Paid in ${provider.label}` }, actor: null });
      }
      await prisma.accountingSync.update({ where: { id: row.id }, data: { status: SYNC_STATUS.PAID, paidAt: status.paidAt ? new Date(status.paidAt) : now(), paidAmount: money(status.paidAmount || status.total) } });
      paid += 1;
    } catch (error) {
      await prisma.accountingSync.update({ where: { id: row.id }, data: { lastError: String(error?.message || error).slice(0, 1000) } }).catch(() => null);
    }
  }
  return { checked, paid };
};

const runPollJob = async ({ payload = {}, fetchImpl = globalThis.fetch } = {}) => pollPayments({ orgId: payload.orgId, fetchImpl });

/** Hourly: one poll job per organisation with a connected provider. */
const queuePollJobs = async () => {
  if (!tablesReady()) return { queued: 0 };
  const jobService = require("../jobs/job.service");
  const rows = await prisma.accountingConnection.findMany({ where: { status: "connected" }, select: { orgId: true }, distinct: ["orgId"] });
  let queued = 0;
  for (const row of rows) {
    await jobService.enqueueJob({ orgId: row.orgId, type: jobService.JOB_TYPES.ACCOUNTING_POLL, payload: { orgId: row.orgId }, maxAttempts: 2 }).then(() => (queued += 1)).catch(() => null);
  }
  return { queued };
};

// ─── ERP export by cost code ───────────────────────────────────────────────

const payAppsForExport = async ({ orgId, projectId = null, from = null, to = null }) => {
  const where = { orgId, status: { in: ["approved", "paid"] }, ...(projectId ? { projectId } : {}), ...(from || to ? { approvedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`) } : {}) } } : {}) };
  return prisma.subPayApp.findMany({ where, include: { commitment: { include: { vendorCompany: { select: { id: true, name: true } } } }, lines: true, project: { select: { id: true, name: true, currency: true } } }, orderBy: [{ approvedAt: "asc" }, { ref: "asc" }] });
};

/** Rows for the export: one per pay-application line, plus retention and back-charge rows. */
const exportRows = async ({ orgId, projectId = null, from = null, to = null, provider = null }) => {
  const payApps = await payAppsForExport({ orgId, projectId, from, to });
  const mappings = provider ? await mappingIndex({ orgId, provider }) : new Map();
  const fallback = mappings.get("*") || null;
  const rows = [];
  for (const payApp of payApps) {
    const lines = await resolveLineCostCodes({ lines: payApp.lines || [] });
    const vendor = payApp.commitment?.vendorCompany?.name || payApp.commitment?.vendorName || "";
    const base = { project: payApp.project?.name || "", vendor, commitment: payApp.commitment?.ref || "", payApp: payApp.ref, period: payApp.periodLabel || "", approvedAt: day(payApp.approvedAt), status: payApp.status, currency: payApp.commitment?.currency || payApp.project?.currency || "" };
    for (const line of lines) {
      const amount = money(num(line.thisPeriodAmount) + num(line.materialsOnSite));
      if (!amount) continue;
      const mapping = (line.costCode && mappings.get(line.costCode)) || fallback;
      rows.push({ ...base, costCode: line.costCode || "", costCodeName: line.costCodeName || "", externalAccount: mapping?.externalAccountId || "", externalAccountName: mapping?.externalAccountName || "", description: line.description || "", kind: "work", amount });
    }
    const retention = money(num(payApp.retentionThisPeriod));
    if (retention) rows.push({ ...base, costCode: "retention", costCodeName: "Retention withheld", externalAccount: (mappings.get("retention") || fallback)?.externalAccountId || "", externalAccountName: (mappings.get("retention") || fallback)?.externalAccountName || "", description: "Retention withheld this period", kind: "retention", amount: -retention });
    const backCharges = money(num(payApp.backCharges));
    if (backCharges) rows.push({ ...base, costCode: "back_charges", costCodeName: "Back-charges", externalAccount: (mappings.get("back_charges") || fallback)?.externalAccountId || "", externalAccountName: (mappings.get("back_charges") || fallback)?.externalAccountName || "", description: payApp.backChargesNote || "Back-charges", kind: "back_charge", amount: -backCharges });
  }
  const byCode = new Map();
  for (const row of rows) {
    const key = `${row.currency}|${row.costCode}`;
    const entry = byCode.get(key) || { costCode: row.costCode, costCodeName: row.costCodeName, externalAccount: row.externalAccount, externalAccountName: row.externalAccountName, currency: row.currency, amount: 0, rows: 0 };
    entry.amount = money(entry.amount + row.amount);
    entry.rows += 1;
    byCode.set(key, entry);
  }
  return { rows, summary: [...byCode.values()].sort((a, b) => String(a.costCode).localeCompare(String(b.costCode))), payApps: payApps.length };
};

const EXPORT_COLUMNS = [
  { key: "project", label: "Project" },
  { key: "vendor", label: "Vendor" },
  { key: "commitment", label: "Commitment" },
  { key: "payApp", label: "Pay application" },
  { key: "period", label: "Period" },
  { key: "approvedAt", label: "Approved" },
  { key: "status", label: "Status" },
  { key: "costCode", label: "Cost code" },
  { key: "costCodeName", label: "Cost code name" },
  { key: "externalAccount", label: "Account" },
  { key: "externalAccountName", label: "Account name" },
  { key: "kind", label: "Kind" },
  { key: "description", label: "Description" },
  { key: "currency", label: "Currency" },
  { key: "amount", label: "Amount" },
];

const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const renderExport = async ({ orgId, projectId = null, from = null, to = null, provider = null, format = "xlsx" }) => {
  const data = await exportRows({ orgId, projectId, from, to, provider });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const lines = [EXPORT_COLUMNS.map((column) => csvCell(column.label)).join(","), ...data.rows.map((row) => EXPORT_COLUMNS.map((column) => csvCell(row[column.key])).join(","))];
    return { buffer: Buffer.from(`﻿${lines.join("\r\n")}`, "utf8"), fileName: `accounting-export-${stamp}.csv`, mimeType: "text/csv; charset=utf-8", rows: data.rows.length };
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OctaPM";
  const detail = workbook.addWorksheet("Costs");
  detail.columns = EXPORT_COLUMNS.map((column) => ({ header: column.label, key: column.key, width: column.key === "description" ? 48 : column.key === "amount" ? 16 : 20 }));
  detail.getRow(1).font = { bold: true };
  for (const row of data.rows) detail.addRow(row);
  detail.getColumn("amount").numFmt = "#,##0.00";
  const summary = workbook.addWorksheet("By cost code");
  summary.columns = [{ header: "Cost code", key: "costCode", width: 18 }, { header: "Name", key: "costCodeName", width: 32 }, { header: "Account", key: "externalAccount", width: 18 }, { header: "Account name", key: "externalAccountName", width: 28 }, { header: "Currency", key: "currency", width: 10 }, { header: "Lines", key: "rows", width: 8 }, { header: "Amount", key: "amount", width: 16 }];
  summary.getRow(1).font = { bold: true };
  for (const row of data.summary) summary.addRow(row);
  summary.getColumn("amount").numFmt = "#,##0.00";
  const about = workbook.addWorksheet("About");
  about.addRow(["Generated", new Date().toISOString()]);
  about.addRow(["Pay applications", data.payApps]);
  about.addRow(["Provider mapping", provider || "none"]);
  about.addRow(["From", from || ""]);
  about.addRow(["To", to || ""]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, fileName: `accounting-export-${stamp}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", rows: data.rows.length };
};

module.exports = {
  RECORD_TYPE,
  SYNC_STATUS,
  PROVIDER_KEYS,
  listConnections,
  startConnect,
  completeConnect,
  disconnect,
  updateConnection,
  connectedProviders,
  listExternalAccounts,
  listMappings,
  upsertMapping,
  deleteMapping,
  resolveLineCostCodes,
  billLinesFor,
  listSyncs,
  queuePayAppSync,
  maybeQueueOnApproval,
  runSyncJob,
  retrySync,
  pollPayments,
  runPollJob,
  queuePollJobs,
  exportRows,
  renderExport,
};
