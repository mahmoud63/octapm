'use strict';

/**
 * The HTTP client every certification driver and attack uses.
 *
 * It talks to the certification API only: the base address comes from
 * CERT_API_BASE (default http://localhost:5190) and is refused unless it is a
 * local address on a port other than the shared development API's.
 *
 * Two ways to ask:
 *   call(...)   returns the unwrapped `data`, throws ApiError on a refusal —
 *               for drivers, where a refusal is a failure of the run;
 *   send(...)   returns { status, body, headers, text } and never throws on a
 *               status — for attacks, where the status is the answer.
 *
 * A session is a person acting in one company: `as(email, orgId?)`. A person
 * with one company signs in straight to it; a person with several chooses
 * with the identity token, as the product's own clients do.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const BASE = (process.env.CERT_API_BASE || 'http://localhost:5190').replace(/\/$/, '');
const parsedBase = new URL(BASE);
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsedBase.hostname)) {
  throw new Error(`CERT_API_BASE ${BASE} is not a local address: certification drivers never call a remote API.`);
}
if (parsedBase.port === '5000') {
  throw new Error('CERT_API_BASE names port 5000, the shared development API: certification drivers never call it.');
}
const API = `${BASE}/api/v1`;

/** Access tokens live 15 minutes; mint again well before. */
const TOKEN_TTL_MS = 8 * 60_000;

const password = () => {
  const value = process.env.CERT_PASSWORD;
  if (!value) throw new Error('CERT_PASSWORD is not set.');
  return value;
};

const describeDetails = (details) => {
  if (!details) return '';
  const list = Array.isArray(details) ? details : details.errors || details.fields;
  if (Array.isArray(list)) {
    return ` :: ${list.map((d) => `${d.path ?? d.param ?? d.field ?? '?'}=${JSON.stringify(d.value)} (${d.msg ?? d.message ?? 'invalid'})`).join('; ')}`;
  }
  return ` :: ${JSON.stringify(details).slice(0, 400)}`;
};

class ApiError extends Error {
  constructor(method, route, status, body) {
    const code = body?.error?.code ?? '(no code)';
    const message = body?.error?.message ?? '(no message)';
    super(`${method} ${route} -> ${status} ${code}: ${message}${describeDetails(body?.error?.details)}`);
    this.name = 'ApiError';
    this.method = method;
    this.route = route;
    this.status = status;
    this.code = code;
    this.serverMessage = message;
    this.details = body?.error?.details ?? null;
    this.body = body;
  }
}

const parse = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * The request corpus. When CERT_CAPTURE_DIR is set (the loaders set it), every
 * request is appended to <dir>/<pid>.jsonl: who asked, what, with which body,
 * and what came back. The cross-company attacks replay the successful ones as
 * somebody from another company, with the same valid body. Tokens and
 * passwords are never written.
 */
let captureFile = null;
const capture = (entry) => {
  const dir = process.env.CERT_CAPTURE_DIR;
  if (!dir) return;
  if (!captureFile) {
    fs.mkdirSync(dir, { recursive: true });
    captureFile = path.join(dir, `${process.pid}.jsonl`);
  }
  fs.appendFileSync(captureFile, `${JSON.stringify(entry)}\n`);
};
const SECRET_KEYS = /password|secret|token/i;
const scrub = (value) => {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '(withheld)' : scrub(v)]));
  }
  return value;
};

/** One raw request. Never throws on a status. */
const raw = async (method, route, options = {}) => {
  const res = await rawUncaptured(method, route, options);
  if (process.env.CERT_CAPTURE_DIR && !route.startsWith('/auth/')) {
    const data = res.body && typeof res.body === 'object' ? res.body.data : null;
    capture({
      at: Date.now(),
      actor: options.actor || null,
      org: options.org || null,
      method,
      route,
      ...(options.json !== undefined ? { json: scrub(typeof options.json === 'string' ? parse(options.json) : options.json) } : {}),
      ...(options.file ? { file: options.file } : {}),
      status: res.status,
      id: data && typeof data === 'object' ? data.id ?? data.item?.id ?? null : null,
    });
  }
  return res;
};

/**
 * CERT_INPROCESS=1: requests go to the product's Express application loaded in
 * this process from the working tree (on the certification database), not to
 * a running server — so a proof, and a mutation proof, exercise exactly the
 * code on disk.
 */
let inprocessApp = null;
const inprocess = () => {
  if (!inprocessApp) {
    // eslint-disable-next-line global-require
    const guard = require('./cert-env');
    process.env.DATABASE_URL = guard.certDatabaseUrl();
    for (const name of ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'EXCEPTIONS_ENGINE_ENABLED']) process.env[name] = 'false';
    // eslint-disable-next-line global-require
    inprocessApp = require('../../../src/app').createApp();
  }
  return inprocessApp;
};

const rawInprocess = async (method, route, { token = null, json, form, headers = {}, binary = false } = {}) => {
  // eslint-disable-next-line global-require
  const request = require('supertest');
  let req = request(inprocess())[method.toLowerCase()](`/api/v1${route}`);
  for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
  if (token) req = req.set('authorization', `Bearer ${token}`);
  if (json !== undefined) {
    req = req.set('content-type', 'application/json').send(typeof json === 'string' ? json : JSON.stringify(json));
  } else if (form) {
    for (const [key, value] of form.entries()) {
      if (value && typeof value === 'object' && typeof value.arrayBuffer === 'function') {
        req = req.attach(key, Buffer.from(await value.arrayBuffer()), { filename: value.name || 'file', contentType: value.type || 'application/octet-stream' });
      } else {
        req = req.field(key, String(value));
      }
    }
  }
  if (binary) req = req.buffer(true).parse((res, done) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))); });
  const res = await req;
  const headerBag = { get: (name) => res.headers[String(name).toLowerCase()] ?? null };
  if (binary && res.status >= 200 && res.status < 300) return { status: res.status, headers: headerBag, buffer: res.body, body: null, text: null };
  const text = binary ? Buffer.from(res.body || '').toString('utf8') : res.text;
  return { status: res.status, headers: headerBag, text, body: parse(text) };
};

const rawUncaptured = async (method, route, options = {}) => {
  if (process.env.CERT_INPROCESS === '1' && !route.startsWith('http')) return rawInprocess(method, route, options);
  const { token = null, json, form, headers = {}, binary = false } = options;
  const url = route.startsWith('http') ? route : `${API}${route}`;
  const init = { method, headers: { ...headers } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = typeof json === 'string' ? json : JSON.stringify(json);
  } else if (form) {
    init.body = form;
  }
  const res = await fetch(url, init);
  if (binary && res.ok) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, buffer, body: null, text: null };
  }
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: parse(text) };
};

// ── sessions ───────────────────────────────────────────────────────────────

const sessions = new Map();

/** Signs a person in to one company. Returns { token, orgId, user, memberships }. */
const signIn = async (email, orgId = null, { client = null } = {}) => {
  const headers = client ? { 'x-octapm-client': client } : {};
  const res = await raw('POST', '/auth/login', { json: { email, password: password() }, headers });
  if (res.status !== 200) throw new ApiError('POST', '/auth/login', res.status, res.body);
  const data = res.body?.data || {};
  if (data.tokens?.accessToken) {
    const boundOrg = data.user?.orgId || null;
    if (orgId && boundOrg && boundOrg !== orgId) throw new Error(`${email} was signed in to ${boundOrg}, not ${orgId}`);
    return { token: data.tokens.accessToken, refreshToken: data.tokens.refreshToken || null, orgId: boundOrg, user: data.user, memberships: null };
  }
  if (data.chooseWorkspace && data.identityToken) {
    const target = orgId || data.memberships?.[0]?.orgId;
    if (!target) throw new Error(`${email} must choose a company and none was named`);
    const chosen = await raw('POST', `/auth/workspaces/${target}/session`, { token: data.identityToken, headers });
    if (chosen.status !== 200) throw new ApiError('POST', `/auth/workspaces/${target}/session`, chosen.status, chosen.body);
    const session = chosen.body?.data || {};
    return {
      token: session.tokens?.accessToken,
      refreshToken: session.tokens?.refreshToken || null,
      orgId: target,
      user: session.user,
      identityToken: data.identityToken,
      memberships: data.memberships,
    };
  }
  throw new Error(`${email}: sign-in answered 200 with neither a session nor a choice of company: ${JSON.stringify(Object.keys(data))}`);
};

/** A cached access token for a person in a company. */
const tokenFor = async (email, orgId = null) => {
  const key = `${email}|${orgId || ''}`;
  const cached = sessions.get(key);
  if (cached && Date.now() - cached.minted < TOKEN_TTL_MS) return cached.token;
  const session = await signIn(email, orgId);
  if (!session.token) throw new Error(`${email}: no access token after sign-in`);
  sessions.set(key, { token: session.token, minted: Date.now(), session });
  return session.token;
};

const forget = (email = null) => {
  if (!email) return sessions.clear();
  for (const key of [...sessions.keys()]) if (key.startsWith(`${email}|`)) sessions.delete(key);
  return undefined;
};

// ── asking ─────────────────────────────────────────────────────────────────

const multipart = ({ field = 'file', filename, contentType = 'application/octet-stream', body, fields = {} }) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  if (body !== undefined) form.append(field, new Blob([body], { type: contentType }), filename);
  return form;
};

/** A person acting in a company. `who` is { email, orgId? } or an email. */
const as = (who, orgIdArg = null) => {
  const email = typeof who === 'string' ? who : who.email;
  const orgId = typeof who === 'string' ? orgIdArg : who.orgId || orgIdArg;
  const send = async (method, route, payload, options = {}) =>
    raw(method, route, { token: options.token === undefined ? await tokenFor(email, orgId) : options.token, json: payload, actor: email, org: orgId, ...options });
  const call = async (method, route, payload, options = {}) => {
    const res = await send(method, route, payload, options);
    if (res.status < 200 || res.status >= 300) throw new ApiError(method, route, res.status, res.body);
    if (res.body === undefined) throw new Error(`${method} ${route} -> ${res.status} but the body was not JSON: ${String(res.text).slice(0, 200)}`);
    return res.body?.data;
  };
  return {
    email,
    orgId,
    token: () => tokenFor(email, orgId),
    send,
    call,
    GET: (route) => call('GET', route),
    POST: (route, payload = {}) => call('POST', route, payload),
    PATCH: (route, payload = {}) => call('PATCH', route, payload),
    PUT: (route, payload = {}) => call('PUT', route, payload),
    DELETE: (route) => call('DELETE', route),
    upload: (method, route, file) =>
      call(method, route, undefined, {
        form: multipart(file),
        // What the corpus keeps of an upload: the field names and the file's name and type, not its bytes.
        file: { field: file.field || 'file', filename: file.filename, contentType: file.contentType || 'application/octet-stream', fields: file.fields || {}, bytes: file.body ? Buffer.byteLength(file.body) : 0 },
      }),
    download: async (route) => {
      const res = await raw('GET', route, { token: await tokenFor(email, orgId), binary: true, actor: email, org: orgId });
      if (res.status !== 200) throw new ApiError('GET', route, res.status, res.body);
      return res.buffer;
    },
  };
};

/** Runs `worker` over `items`, `limit` at a time, keeping the order of results. */
const pool = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

module.exports = { API, BASE, ApiError, TOKEN_TTL_MS, as, forget, multipart, pool, raw, signIn, tokenFor };
