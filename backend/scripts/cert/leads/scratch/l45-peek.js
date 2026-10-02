'use strict';
/** L45 scratch: read-only peek at the 028 inventory (parties) and the party permission profiles. */
const fs = require('fs');
const path = require('path');

const inv = JSON.parse(fs.readFileSync('C:/Temp/octapm-cert/state/inventory/028.json', 'utf8'));
for (const [code, p] of Object.entries(inv.projects || {})) {
  console.log(code, p.id, 'parties=', JSON.stringify(p.refs?.parties), 'keys=', Object.keys(p).join(','));
}

const perms = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'shared', 'permissions.json'), 'utf8'));
const CF_MODULES = ['rfi', 'submittal', 'punch', 'inspection', 'ncr', 'safety', 'document_control', 'change_order', 'commitment', 'sub_pay_app', 'ipc', 'task', 'risk', 'procurement', 'meeting', 'progress', 'schedule'];
const walk = (node, trail = []) => {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object' && value.modules && typeof value.modules === 'object' && !Array.isArray(value.modules)) {
      const read = CF_MODULES.filter((m) => (value.modules[m]?.actions || []).includes('read'));
      const update = CF_MODULES.filter((m) => (value.modules[m]?.actions || []).includes('update'));
      console.log(`${trail.concat(key).join('.')}\n   read: ${read.join(', ') || '(none)'}\n   update: ${update.join(', ') || '(none)'}`);
    } else walk(value, trail.concat(key));
  }
};
walk(perms);
