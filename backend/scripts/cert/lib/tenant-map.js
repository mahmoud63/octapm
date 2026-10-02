'use strict';

/**
 * Which company owns each row of each table — worked out from the schema, not
 * from a hand-kept list, so a table added later is covered without anyone
 * remembering to add it.
 *
 * For every model the map gives a route to the owning organisation:
 *   - the model has an `orgId` column                → direct;
 *   - it has a `projectId` column                    → through Project.orgId;
 *   - it has a required parent whose route is known  → through that parent
 *     (resolved repeatedly, so a line of a line of a document is found).
 * A model with no route is reported as unowned: either global by design
 * (migrations, rate-limit buckets) or a gap worth looking at.
 *
 * `ownerSql(model)` returns a SELECT of (id, org) for the model's rows.
 */

const { Prisma } = require('@prisma/client');

const MODELS = Prisma.dmmf.datamodel.models;
const byName = new Map(MODELS.map((m) => [m.name, m]));
const tableOf = (model) => model.dbName || model.name;
const columnOf = (model, fieldName) => {
  const field = model.fields.find((f) => f.name === fieldName);
  return field?.dbName || fieldName;
};
const q = (name) => `"${name}"`;

const hasScalar = (model, name) => model.fields.some((f) => f.name === name && f.kind === 'scalar');
const idField = (model) => model.fields.find((f) => f.isId);

/** The route from each model to its organisation: { kind, via?, fk?, parent? }. */
const buildRoutes = () => {
  const routes = new Map();
  routes.set('Organisation', { kind: 'self' });
  for (const model of MODELS) {
    if (model.name === 'Organisation') continue;
    if (hasScalar(model, 'orgId')) routes.set(model.name, { kind: 'orgId' });
    else if (hasScalar(model, 'organisationId')) routes.set(model.name, { kind: 'orgId', column: 'organisationId' });
    else if (hasScalar(model, 'projectId') && model.name !== 'Project') routes.set(model.name, { kind: 'projectId' });
  }
  // Parents: a relation this model holds the foreign key of. Required ones first.
  let grew = true;
  while (grew) {
    grew = false;
    for (const model of MODELS) {
      if (routes.has(model.name)) continue;
      const parents = model.fields
        .filter((f) => f.kind === 'object' && f.relationFromFields?.length === 1 && routes.has(f.type) && f.type !== model.name)
        .sort((a, b) => Number(b.isRequired) - Number(a.isRequired));
      if (!parents.length) continue;
      const parent = parents[0];
      routes.set(model.name, { kind: 'parent', parent: parent.type, fk: parent.relationFromFields[0], required: parent.isRequired });
      grew = true;
    }
  }
  return routes;
};

const ROUTES = buildRoutes();

/** SELECT id::text AS id, <org>::text AS org FROM the model's table (org may be null for optional parents). */
const ownerSql = (modelName, depth = 0) => {
  const model = byName.get(modelName);
  const route = ROUTES.get(modelName);
  const pk = idField(model);
  if (!model || !route || !pk || depth > 8) return null;
  const table = q(tableOf(model));
  const id = `${table}.${q(pk.dbName || pk.name)}::text`;
  if (route.kind === 'self') return `select ${id} as id, ${id} as org from ${table}`;
  if (route.kind === 'orgId') return `select ${id} as id, ${table}.${q(columnOf(model, route.column || 'orgId'))}::text as org from ${table}`;
  if (route.kind === 'projectId') {
    return `select ${id} as id, p."orgId"::text as org from ${table} left join "Project" p on p.id = ${table}.${q(columnOf(model, 'projectId'))}`;
  }
  const parent = byName.get(route.parent);
  const parentSql = ownerSql(route.parent, depth + 1);
  if (!parentSql) return null;
  return `select ${id} as id, o.org as org from ${table} left join (${parentSql}) o on o.id = ${table}.${q(columnOf(model, route.fk))}::text`;
};

/** Models with an id and a route, and the ones without. */
const ownedModels = () => MODELS.filter((m) => ROUTES.has(m.name) && idField(m)).map((m) => m.name);
const unownedModels = () => MODELS.filter((m) => !ROUTES.has(m.name)).map((m) => m.name);
const routeOf = (modelName) => ROUTES.get(modelName) || null;
const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

module.exports = { MODELS, byName, columnOf, idField, ownedModels, ownerSql, routeOf, snake, tableOf, unownedModels };
