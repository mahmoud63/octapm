'use strict';

/**
 * L28 — is the unscoped-bulk-write guard part of the production runtime?
 *
 * A configuration lead, verified by READING: no server is started, no database
 * is touched, no product module that opens a connection is loaded. The only
 * product module required is src/__live__/bulk-write-guard.js, for its pure
 * `isUnscoped` function (it requires nothing until installBulkWriteGuard()
 * is called, and this script never calls it).
 *
 *   1. Where is a guard installed?  Every reference in backend/src, the
 *      Prisma client construction (config/db.js, jobs/scheduler-leader.js),
 *      the generator's preview features, and whether the image even ships
 *      the guard's file (.dockerignore).
 *   2. What the guard's own rule refuses and what it lets through.
 *   3. What it would have to protect: every updateMany / deleteMany /
 *      updateManyAndReturn call in the product, by the shape of its `where`.
 *
 * exit 0 = a guard (or Prisma's strictUndefinedChecks) is in the runtime that
 *          serves requests; exit 2 = it is not.
 *
 *   --list   also print every bulk write whose filter has no fixed part
 */

const fs = require('fs');
const path = require('path');

const LEAD = 'L28';
const BACKEND = path.join(__dirname, '..', '..', '..');
const REPO = path.join(BACKEND, '..');
const SRC = path.join(BACKEND, 'src');
const rel = (file) => path.relative(REPO, file).replace(/\\/g, '/');
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const isTestPath = (file) => /[\\/](__tests__|__live__|__mocks__)[\\/]/.test(file) || /\.(test|spec)\.js$/.test(file);
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
};
const all = walk(SRC);
const runtime = all.filter((file) => !isTestPath(file));

// ── 1. Where is a guard installed? ──────────────────────────────────────────
console.log('1. Where a guard is installed\n');
const mentions = [];
for (const file of all) {
  const text = read(file);
  const pattern = /installBulkWriteGuard|bulk-write-guard|\$extends\(|\$use\(/g;
  let match;
  while ((match = pattern.exec(text))) mentions.push({ file, line: lineOf(text, match.index), what: match[0], test: isTestPath(file), text: text.split('\n')[lineOf(text, match.index) - 1].trim() });
}
for (const item of mentions) console.log(`   ${item.test ? '[test only]' : '[RUNTIME]  '} ${rel(item.file)}:${item.line}  ${item.text.slice(0, 150)}`);
const runtimeMentions = mentions.filter((item) => !item.test);
console.log(`   => references outside test folders: ${runtimeMentions.length}`);

const dbJs = read(path.join(SRC, 'config', 'db.js')) || '';
const dbBuilds = [...dbJs.matchAll(/new PrismaClient\([^)]*\)/g)].map((match) => `config/db.js:${lineOf(dbJs, match.index)} ${match[0]}`);
console.log(`\n   The client every service uses (backend/src/config/db.js): ${dbBuilds.join(' | ') || 'no construction found'}`);
console.log(`   config/db.js extends or wraps that client: ${/\$extends\(|\$use\(|bulk-write-guard/.test(dbJs) ? 'YES' : 'no — a plain PrismaClient'}`);

const entryPoints = ['index.js', 'worker.js', 'app.js'].map((name) => [name, read(path.join(SRC, name)) || '']);
for (const [name, text] of entryPoints) console.log(`   backend/src/${name} installs a guard: ${/bulk-write-guard|installBulkWriteGuard/.test(text) ? 'YES' : 'no'}`);

const schema = read(path.join(BACKEND, 'prisma', 'schema.prisma')) || '';
const generator = (/generator client \{[\s\S]*?\}/.exec(schema) || [''])[0];
const strictUndefined = /strictUndefinedChecks/.test(generator);
console.log(`   prisma/schema.prisma generator: ${generator.replace(/\s+/g, ' ')}`);
console.log(`   Prisma's own "strictUndefinedChecks" preview feature (an undefined in a filter throws): ${strictUndefined ? 'ENABLED' : 'not enabled'}`);

const dockerignore = read(path.join(REPO, '.dockerignore')) || '';
const liveExcluded = /^\*\*\/__live__\s*$/m.test(dockerignore);
console.log(`   .dockerignore excludes **/__live__ from the image: ${liveExcluded ? 'YES — the guard file is not even present in the production image' : 'no'}`);

const liveConfig = read(path.join(BACKEND, 'jest.live.config.js')) || '';
console.log(`   the one installer: src/__live__/enable-live.js, loaded by jest.live.config.js setupFiles: ${/enable-live\.js/.test(liveConfig)} (the Jest process of \`npm run test:live\` only; an API that a live test spawns is a separate, unguarded process)`);

const databaseLevel = [];
const migrations = path.join(BACKEND, 'prisma', 'migrations');
if (fs.existsSync(migrations)) {
  for (const dir of fs.readdirSync(migrations)) {
    const sql = read(path.join(migrations, dir, 'migration.sql'));
    if (sql && /ROW LEVEL SECURITY|CREATE POLICY/i.test(sql)) databaseLevel.push(dir);
  }
}
console.log(`   database level: migrations that enable row-level security or create a policy: ${databaseLevel.length ? databaseLevel.join(', ') : 'none'}`);

// ── 2. What the guard's rule refuses ────────────────────────────────────────
console.log('\n2. What the guard refuses, by its own rule (src/__live__/bulk-write-guard.js isUnscoped)\n');
let isUnscoped = null;
try {
  ({ isUnscoped } = require(path.join(SRC, '__live__', 'bulk-write-guard.js')));
} catch (error) {
  console.log(`   the guard module could not be loaded: ${error.message}`);
}
if (isUnscoped) {
  const samples = [
    ['updateMany({ data })                                          (no where)', undefined],
    ['where: {}', {}],
    ['where: { orgId: undefined }', { orgId: undefined }],
    ['where: { orgId: undefined, userId: undefined }               (the 2026-09-26 incident)', { orgId: undefined, userId: undefined }],
    ['where: { orgId: undefined, status: "trialing" }              (tenant key lost, another filter present)', { orgId: undefined, status: 'trialing' }],
    ['where: { orgId: undefined, projectId: undefined, id: { in: [] } }', { orgId: undefined, projectId: undefined, id: { in: [] } }],
    ['where: { AND: [{ orgId: undefined }] }', { AND: [{ orgId: undefined }] }],
    ['where: { orgId: { equals: undefined } }', { orgId: { equals: undefined } }],
    ['where: { id: { in: undefined } }', { id: { in: undefined } }],
    ['where: { orgId: "o1", userId: "u1" }                         (a scoped write)', { orgId: 'o1', userId: 'u1' }],
  ];
  for (const [label, where] of samples) console.log(`   ${isUnscoped(where) ? 'REFUSED     ' : 'lets through'}  ${label}`);
  console.log('   (Prisma drops an undefined filter value, so every "lets through" row above with an undefined tenant key runs across all companies: the guard, even where installed, catches only a filter with nothing left in it. Raw SQL and update/delete by unique key are outside it; a unique key that is undefined makes Prisma throw.)');
}

// ── 3. What it would have to protect ────────────────────────────────────────
/** Text from `open` (the index of an opening bracket) to its match. */
const balanced = (text, open) => {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i += 1; i < text.length && text[i] !== ch; i += 1) if (text[i] === '\\') i += 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else if (pairs[ch]) {
      stack.push(pairs[ch]);
    } else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return text.slice(open, i + 1);
    }
  }
  return null;
};
/** The parts of `inner` separated by commas that are not inside brackets or strings. */
const topLevel = (inner) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i += 1; i < inner.length && inner[i] !== ch; i += 1) if (inner[i] === '\\') i += 1;
    } else if ('({['.includes(ch)) depth += 1;
    else if (')}]'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((part) => part.replace(/\/\/[^\n]*/g, '').trim()).filter(Boolean);
};
/** A value that can never be `undefined`: a literal, an object or array literal, `new X`, a template, a named constant (STATUS.PENDING). */
const fixed = (value) => /^(['"`]|-?\d|true\b|false\b|null\b|\{|\[|new\s)/.test(value) || /^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)*$/.test(value);

const sites = [];
for (const file of runtime) {
  const text = read(file);
  const pattern = /\.(updateMany|deleteMany|updateManyAndReturn)\(/g;
  let match;
  while ((match = pattern.exec(text))) {
    const call = balanced(text, match.index + match[0].length - 1);
    if (!call) continue;
    const site = { file, line: lineOf(text, match.index), operation: match[1], shape: null, where: null, tenantKey: false };
    const argument = call.slice(1, -1).trim();
    if (!argument) site.shape = 'no argument';
    else if (!argument.startsWith('{')) site.shape = 'argument built elsewhere';
    else {
      const properties = topLevel(balanced(argument, 0).slice(1, -1));
      const whereProperty = properties.find((property) => /^where\b/.test(property));
      if (!whereProperty) site.shape = properties.some((property) => property.startsWith('...')) ? 'argument built elsewhere' : 'no where';
      else {
        const value = whereProperty.replace(/^where\s*:?\s*/, '');
        site.where = value.replace(/\s+/g, ' ');
        if (!value || !value.startsWith('{')) site.shape = 'where built elsewhere';
        else {
          const entries = topLevel(balanced(value, 0).slice(1, -1));
          if (!entries.length) site.shape = 'empty where';
          else {
            const judged = entries.map((entry) => {
              if (entry.startsWith('...')) return { key: entry, fixed: false, spread: true };
              const colon = entry.indexOf(':');
              if (colon === -1) return { key: entry, fixed: false };
              return { key: entry.slice(0, colon).trim(), fixed: fixed(entry.slice(colon + 1).trim()) };
            });
            site.tenantKey = judged.some((entry) => /^(orgId|organisationId|organizationId)$/.test(entry.key));
            site.shape = judged.some((entry) => entry.fixed) ? 'has a fixed part' : 'every value is a variable';
          }
        }
      }
    }
    sites.push(site);
  }
}

console.log(`\n3. What a guard would protect: ${sites.length} bulk writes in ${new Set(sites.map((site) => site.file)).size} runtime files of backend/src (tests excluded)\n`);
const shapes = ['no argument', 'no where', 'empty where', 'every value is a variable', 'has a fixed part', 'where built elsewhere', 'argument built elsewhere'];
const meaning = {
  'no argument': 'table-wide by construction',
  'no where': 'table-wide by construction',
  'empty where': 'table-wide by construction',
  'every value is a variable': 'becomes table-wide if every one of those variables is undefined — only the guard would stop it',
  'has a fixed part': 'never table-wide, but a tenant key that is undefined still widens it across companies — the guard does not look',
  'where built elsewhere': 'not judged here',
  'argument built elsewhere': 'not judged here',
};
for (const shape of shapes) {
  const group = sites.filter((site) => site.shape === shape);
  if (!group.length) continue;
  console.log(`   ${String(group.length).padStart(4)}  ${shape.padEnd(27)} ${meaning[shape]}`);
}
const literalWheres = sites.filter((site) => ['every value is a variable', 'has a fixed part'].includes(site.shape));
console.log(`\n   of the ${literalWheres.length} written out in place, ${literalWheres.filter((site) => site.tenantKey).length} name orgId at the top of the filter and ${literalWheres.filter((site) => !site.tenantKey).length} do not (they filter by a record id, a parent id or a status)`);
const exposed = sites.filter((site) => ['no argument', 'no where', 'empty where', 'every value is a variable'].includes(site.shape));
if (process.argv.includes('--list')) {
  console.log('\n   Bulk writes with no fixed part in the filter:');
  for (const site of exposed) console.log(`     ${rel(site.file)}:${site.line}  ${site.operation}  ${site.shape}  ${site.where ? site.where.slice(0, 140) : ''}`);
} else {
  console.log(`   (${exposed.length} have no fixed part in the filter; --list prints them)`);
}

// ── Verdict ─────────────────────────────────────────────────────────────────
const guardedRuntime = /\$extends\(|\$use\(|bulk-write-guard/.test(dbJs) || entryPoints.some(([, text]) => /bulk-write-guard|installBulkWriteGuard/.test(text)) || strictUndefined;
console.log('');
if (guardedRuntime) {
  process.exitCode = 0;
  console.log(`VERDICT ${LEAD}: NOT_REPRODUCED — the client that serves requests is guarded (${strictUndefined ? 'strictUndefinedChecks' : 'an extension or an installed guard'}); read section 2 for what its rule still lets through.`);
} else {
  process.exitCode = 2;
  console.log(`VERDICT ${LEAD}: CONFIRMED — nothing in the production runtime refuses a bulk write whose filter came out empty: config/db.js builds a plain PrismaClient, the guard is installed only inside the live-test Jest process and its file is excluded from the image, and ${exposed.length} of ${sites.length} product bulk writes have no fixed part in their filter.`);
}
