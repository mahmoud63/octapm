'use strict';

/**
 * Writes the application's real route inventory to <work>/routes.json and
 * prints a summary: how many routes, by method, by first path segment.
 *
 *   node scripts/cert/list-routes.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const guard = require('./lib/cert-env');

// Loading the application loads its database client: make sure that is the
// certification database and nothing else.
process.env.DATABASE_URL = guard.certDatabaseUrl();
// Nothing in this process may start a worker or a scheduler.
process.env.JOB_WORKER_ENABLED = 'false';
process.env.SCHEDULERS_ENABLED = 'false';

const { buildMatcher, listRoutes } = require('./lib/routes');

const routes = listRoutes();
const tally = (key) => routes.reduce((acc, route) => ({ ...acc, [key(route)]: (acc[key(route)] || 0) + 1 }), {});
const work = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
fs.writeFileSync(path.join(work, 'routes.json'), JSON.stringify(routes));
console.log(`routes: ${routes.length}`);
console.log(`by method: ${JSON.stringify(tally((r) => r.method))}`);
console.log(`with a parameter: ${routes.filter((r) => r.path.includes('{')).length}`);
console.log(`by area: ${JSON.stringify(tally((r) => r.path.split('/')[1] || '/'))}`);
const projectAreas = routes.filter((r) => r.path.startsWith('/projects/{projectId}/')).reduce((acc, r) => {
  const area = r.path.split('/')[3];
  return { ...acc, [area]: (acc[area] || 0) + 1 };
}, {});
console.log(`project areas (${Object.keys(projectAreas).length}): ${JSON.stringify(projectAreas)}`);
const match = buildMatcher(routes);
console.log(JSON.stringify(match('GET', '/projects/abc/rfi/def')));
console.log(JSON.stringify(match('POST', '/projects/abc/ncr/def/close')));
process.exit(0);
