const { HttpError } = require("../../utils/http-error");

/**
 * Accounting provider adapters (OCTA-INT-API-026): QuickBooks Online and
 * Xero. Each adapter exposes the same surface so the accounting service
 * never branches on the provider:
 *
 *   authorizeUrl({ state, redirectUri })
 *   exchangeCode({ code, redirectUri, realmId })          → credentials
 *   refresh(credentials)                                   → credentials
 *   listAccounts(credentials)                              → [{ id, code, name, type }]
 *   ensureVendor(credentials, { name, email })             → { id }
 *   createBill(credentials, bill)                          → { id, ref }
 *   getBillStatus(credentials, billId)                     → { status, total, paidAmount, paidAt }
 *
 * `fetchImpl` is injectable so tests never touch the network. Credentials
 * carry `accessToken`, `refreshToken`, `expiresAt` and the tenant / realm.
 */

const env = (name, fallback = null) => process.env[name] || fallback;

const basicAuth = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

const readJson = async (response) => {
  const text = await response.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
};

const providerError = (provider, response, body, fallback) => {
  const message = body?.Fault?.Error?.[0]?.Detail || body?.Fault?.Error?.[0]?.Message || body?.Detail || body?.Message || body?.error_description || body?.error || body?.raw || fallback;
  const error = new HttpError(response.status >= 500 || response.status === 429 ? 503 : 502, "ACCOUNTING_PROVIDER_ERROR", `${provider}: ${String(message).slice(0, 500)}`);
  error.retryable = response.status >= 500 || response.status === 429;
  error.providerStatus = response.status;
  return error;
};

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

const oauthTokenRequest = async ({ provider, url, clientId, clientSecret, params, fetchImpl }) => {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", authorization: basicAuth(clientId, clientSecret) },
    body: new URLSearchParams(params).toString(),
  });
  const body = await readJson(response);
  if (!response.ok) throw providerError(provider, response, body, "token request failed");
  return body;
};

// ─── QuickBooks Online ─────────────────────────────────────────────────────

const qbo = {
  key: "qbo",
  label: "QuickBooks Online",
  isConfigured: () => Boolean(env("QBO_CLIENT_ID") && env("QBO_CLIENT_SECRET")),
  apiBase: () => (env("QBO_ENVIRONMENT", "sandbox") === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com"),
  authorizeUrl: ({ state, redirectUri }) => {
    const params = new URLSearchParams({ client_id: env("QBO_CLIENT_ID", ""), response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: redirectUri, state });
    return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
  },
  exchangeCode: async ({ code, redirectUri, realmId, fetchImpl = globalThis.fetch }) => {
    const body = await oauthTokenRequest({ provider: "QuickBooks", url: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", clientId: env("QBO_CLIENT_ID"), clientSecret: env("QBO_CLIENT_SECRET"), params: { grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchImpl });
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + Number(body.expires_in || 3600) * 1000).toISOString(), realmId, externalOrgId: realmId, externalOrgName: null };
  },
  refresh: async (credentials, { fetchImpl = globalThis.fetch } = {}) => {
    const body = await oauthTokenRequest({ provider: "QuickBooks", url: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", clientId: env("QBO_CLIENT_ID"), clientSecret: env("QBO_CLIENT_SECRET"), params: { grant_type: "refresh_token", refresh_token: credentials.refreshToken }, fetchImpl });
    return { ...credentials, accessToken: body.access_token, refreshToken: body.refresh_token || credentials.refreshToken, expiresAt: new Date(Date.now() + Number(body.expires_in || 3600) * 1000).toISOString() };
  },
  request: async (credentials, { method = "GET", path, query = null, body = null, fetchImpl = globalThis.fetch }) => {
    const base = `${qbo.apiBase()}/v3/company/${encodeURIComponent(credentials.realmId)}`;
    const url = new URL(`${base}${path}`);
    url.searchParams.set("minorversion", "70");
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetchImpl(url.toString(), { method, headers: { authorization: `Bearer ${credentials.accessToken}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await readJson(response);
    if (!response.ok) throw providerError("QuickBooks", response, json, `request failed (${response.status})`);
    return json;
  },
  companyInfo: async (credentials, options) => {
    const json = await qbo.request(credentials, { path: `/companyinfo/${encodeURIComponent(credentials.realmId)}`, ...options });
    return { name: json.CompanyInfo?.CompanyName || null };
  },
  listAccounts: async (credentials, options) => {
    const json = await qbo.request(credentials, { path: "/query", query: { query: "select Id, Name, AcctNum, AccountType from Account where Active = true maxresults 500" }, ...options });
    return (json.QueryResponse?.Account || []).map((account) => ({ id: String(account.Id), code: account.AcctNum || null, name: account.Name, type: account.AccountType || null }));
  },
  ensureVendor: async (credentials, vendor, options) => {
    const name = String(vendor.name || "").replace(/'/g, "\\'");
    const found = await qbo.request(credentials, { path: "/query", query: { query: `select Id, DisplayName from Vendor where DisplayName = '${name}'` }, ...options });
    const existing = found.QueryResponse?.Vendor?.[0];
    if (existing) return { id: String(existing.Id), created: false };
    const created = await qbo.request(credentials, { method: "POST", path: "/vendor", body: { DisplayName: vendor.name, ...(vendor.email ? { PrimaryEmailAddr: { Address: vendor.email } } : {}) }, ...options });
    return { id: String(created.Vendor?.Id), created: true };
  },
  createBill: async (credentials, bill, options) => {
    const created = await qbo.request(credentials, {
      method: "POST",
      path: "/bill",
      body: {
        VendorRef: { value: bill.vendorId },
        TxnDate: bill.date,
        ...(bill.dueDate ? { DueDate: bill.dueDate } : {}),
        DocNumber: String(bill.ref).slice(0, 21),
        PrivateNote: bill.memo || undefined,
        ...(bill.currency ? { CurrencyRef: { value: bill.currency } } : {}),
        Line: bill.lines.map((line) => ({
          DetailType: "AccountBasedExpenseLineDetail",
          Amount: money(line.amount),
          Description: String(line.description || "").slice(0, 4000),
          AccountBasedExpenseLineDetail: { AccountRef: { value: line.accountId } },
        })),
      },
      ...options,
    });
    return { id: String(created.Bill?.Id), ref: created.Bill?.DocNumber || bill.ref };
  },
  getBillStatus: async (credentials, billId, options) => {
    const json = await qbo.request(credentials, { path: `/bill/${encodeURIComponent(billId)}`, ...options });
    const total = money(json.Bill?.TotalAmt);
    const balance = money(json.Bill?.Balance);
    const paidAmount = money(total - balance);
    const status = balance <= 0 && total > 0 ? "paid" : paidAmount > 0 ? "partial" : "open";
    return { status, total, paidAmount, paidAt: status === "paid" ? json.Bill?.MetaData?.LastUpdatedTime || null : null };
  },
};

// ─── Xero ──────────────────────────────────────────────────────────────────

const xero = {
  key: "xero",
  label: "Xero",
  isConfigured: () => Boolean(env("XERO_CLIENT_ID") && env("XERO_CLIENT_SECRET")),
  authorizeUrl: ({ state, redirectUri }) => {
    const params = new URLSearchParams({ response_type: "code", client_id: env("XERO_CLIENT_ID", ""), redirect_uri: redirectUri, scope: "openid profile email accounting.transactions accounting.contacts accounting.settings offline_access", state });
    return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
  },
  exchangeCode: async ({ code, redirectUri, fetchImpl = globalThis.fetch }) => {
    const body = await oauthTokenRequest({ provider: "Xero", url: "https://identity.xero.com/connect/token", clientId: env("XERO_CLIENT_ID"), clientSecret: env("XERO_CLIENT_SECRET"), params: { grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchImpl });
    const credentials = { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + Number(body.expires_in || 1800) * 1000).toISOString(), tenantId: null, externalOrgId: null, externalOrgName: null };
    const response = await fetchImpl("https://api.xero.com/connections", { headers: { authorization: `Bearer ${credentials.accessToken}`, accept: "application/json" } });
    const connections = await readJson(response);
    if (!response.ok) throw providerError("Xero", response, connections, "could not list organisations");
    const tenant = Array.isArray(connections) ? connections[0] : null;
    if (!tenant) throw new HttpError(400, "ACCOUNTING_NO_TENANT", "Xero: no organisation was authorised");
    return { ...credentials, tenantId: tenant.tenantId, externalOrgId: tenant.tenantId, externalOrgName: tenant.tenantName || null };
  },
  refresh: async (credentials, { fetchImpl = globalThis.fetch } = {}) => {
    const body = await oauthTokenRequest({ provider: "Xero", url: "https://identity.xero.com/connect/token", clientId: env("XERO_CLIENT_ID"), clientSecret: env("XERO_CLIENT_SECRET"), params: { grant_type: "refresh_token", refresh_token: credentials.refreshToken }, fetchImpl });
    return { ...credentials, accessToken: body.access_token, refreshToken: body.refresh_token || credentials.refreshToken, expiresAt: new Date(Date.now() + Number(body.expires_in || 1800) * 1000).toISOString() };
  },
  request: async (credentials, { method = "GET", path, query = null, body = null, fetchImpl = globalThis.fetch }) => {
    const url = new URL(`https://api.xero.com/api.xro/2.0${path}`);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetchImpl(url.toString(), { method, headers: { authorization: `Bearer ${credentials.accessToken}`, "xero-tenant-id": credentials.tenantId, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await readJson(response);
    if (!response.ok) throw providerError("Xero", response, json, `request failed (${response.status})`);
    return json;
  },
  companyInfo: async (credentials, options) => {
    const json = await xero.request(credentials, { path: "/Organisation", ...options });
    return { name: json.Organisations?.[0]?.Name || credentials.externalOrgName || null };
  },
  listAccounts: async (credentials, options) => {
    const json = await xero.request(credentials, { path: "/Accounts", query: { where: 'Status=="ACTIVE"' }, ...options });
    return (json.Accounts || []).map((account) => ({ id: account.AccountID, code: account.Code || null, name: account.Name, type: account.Type || null }));
  },
  ensureVendor: async (credentials, vendor, options) => {
    const name = String(vendor.name || "").replace(/"/g, '\\"');
    const found = await xero.request(credentials, { path: "/Contacts", query: { where: `Name=="${name}"` }, ...options });
    const existing = found.Contacts?.[0];
    if (existing) return { id: existing.ContactID, created: false };
    const created = await xero.request(credentials, { method: "POST", path: "/Contacts", body: { Contacts: [{ Name: vendor.name, ...(vendor.email ? { EmailAddress: vendor.email } : {}), IsSupplier: true }] }, ...options });
    return { id: created.Contacts?.[0]?.ContactID, created: true };
  },
  createBill: async (credentials, bill, options) => {
    const created = await xero.request(credentials, {
      method: "POST",
      path: "/Invoices",
      body: {
        Invoices: [
          {
            Type: "ACCPAY",
            Contact: { ContactID: bill.vendorId },
            Date: bill.date,
            ...(bill.dueDate ? { DueDate: bill.dueDate } : {}),
            InvoiceNumber: String(bill.ref).slice(0, 255),
            Reference: bill.memo || undefined,
            ...(bill.currency ? { CurrencyCode: bill.currency } : {}),
            Status: "AUTHORISED",
            LineItems: bill.lines.map((line) => ({ Description: String(line.description || "").slice(0, 4000), Quantity: 1, UnitAmount: money(line.amount), AccountCode: line.accountCode || undefined })),
          },
        ],
      },
      ...options,
    });
    const invoice = created.Invoices?.[0];
    return { id: invoice?.InvoiceID, ref: invoice?.InvoiceNumber || bill.ref };
  },
  getBillStatus: async (credentials, billId, options) => {
    const json = await xero.request(credentials, { path: `/Invoices/${encodeURIComponent(billId)}`, ...options });
    const invoice = json.Invoices?.[0] || {};
    const total = money(invoice.Total);
    const paidAmount = money(invoice.AmountPaid);
    const status = invoice.Status === "PAID" ? "paid" : paidAmount > 0 ? "partial" : invoice.Status === "VOIDED" || invoice.Status === "DELETED" ? "void" : "open";
    return { status, total, paidAmount, paidAt: invoice.FullyPaidOnDate || null };
  },
};

const PROVIDERS = Object.freeze({ qbo, xero });
const PROVIDER_KEYS = Object.freeze(Object.keys(PROVIDERS));

const getProvider = (key) => {
  const provider = PROVIDERS[key];
  if (!provider) throw new HttpError(400, "ACCOUNTING_PROVIDER_UNKNOWN", `Unknown accounting provider: ${key}`);
  return provider;
};

module.exports = { PROVIDERS, PROVIDER_KEYS, getProvider, money };
