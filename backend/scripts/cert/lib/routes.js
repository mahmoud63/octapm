'use strict';

/**
 * The application's real routes, read from its own Express router — not from
 * the OpenAPI document, which can lag behind — and a matcher that tells which
 * route a concrete path belongs to and what its parameters are.
 *
 * Loading the application does not start it: nothing listens, no scheduler
 * and no worker runs. It does load the application's modules, so the caller
 * must have pointed DATABASE_URL at the certification database first (the
 * certification worktree's backend/.env does).
 */

const path = require('path');

const mountPath = (layer) => {
  let source = layer.regexp.source;
  if (source === '^\\/?(?=\\/|$)') return '';
  source = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\/\?\$$/, '')
    .replace(/\\\//g, '/');
  let keyIndex = 0;
  return source
    .replace(/\(\?:\/\(\[\^\/\]\+\?\)\)/g, () => `/{${layer.keys[keyIndex++]?.name || 'param'}}`)
    .replace(/\(\[\^\/\]\+\?\)/g, () => `{${layer.keys[keyIndex++]?.name || 'param'}}`)
    .replace(/\\\./g, '.')
    .replace(/\^/g, '')
    .replace(/\$/g, '')
    .replace(/\?/g, '');
};

const normalise = (value) => value.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';

/** Every route under /api/v1 as { method, path } with {param} placeholders, path relative to /api/v1. */
const listRoutes = () => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const loaded = require(path.join(__dirname, '..', '..', '..', 'src', 'app'));
  const app = typeof loaded.createApp === 'function' ? loaded.createApp() : loaded.app || loaded;
  const out = new Map();
  const walk = (stack, prefix = '') => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const one of paths) {
          const full = normalise(`${prefix}${one}`);
          if (!full.startsWith('/api/v1')) continue;
          const relative = full.replace('/api/v1', '') || '/';
          for (const method of Object.keys(layer.route.methods)) {
            if (method === '_all') continue;
            out.set(`${method.toUpperCase()} ${relative}`, { method: method.toUpperCase(), path: relative });
          }
        }
        continue;
      }
      if (layer.name === 'router' && layer.handle?.stack) walk(layer.handle.stack, normalise(`${prefix}${mountPath(layer)}`));
    }
  };
  walk(app._router.stack);
  return [...out.values()].sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
};

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compiles route templates once; `match(method, concretePath)` returns { template, params } or null. */
const buildMatcher = (routes) => {
  const compiled = routes.map((route) => {
    const names = [];
    const pattern = route.path
      .split('/')
      .map((segment) =>
        segment.replace(/\{([^}]+)\}|[^{}]+/g, (piece, name) => {
          if (name) {
            names.push(name);
            return '([^/]+)';
          }
          return escapeRe(piece);
        })
      )
      .join('/');
    // Fewer parameters first, so a literal segment wins over a parameter (/rfi/export before /rfi/{id}).
    return { ...route, names, re: new RegExp(`^${pattern}$`), weight: names.length };
  });
  compiled.sort((a, b) => a.weight - b.weight);
  return (method, concrete) => {
    const clean = concrete.split('?')[0].replace(/\/$/, '') || '/';
    for (const route of compiled) {
      if (route.method !== method) continue;
      const hit = route.re.exec(clean);
      if (hit) return { template: route.path, method, params: Object.fromEntries(route.names.map((name, i) => [name, hit[i + 1]])) };
    }
    return null;
  };
};

module.exports = { buildMatcher, listRoutes };
