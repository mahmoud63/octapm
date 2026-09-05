import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const exists = (path) => existsSync(resolve(root, path))

// ── Routes and layout ───────────────────────────────────────────────────
;['route', 'index', 'directory', 'vendors', 'cost-codes', 'equipment', 'templates', 'permissions'].forEach(
  (name) => assert.ok(exists(`src/routes/_authenticated/company/${name}.tsx`), `company route ${name} exists`)
)
const layout = read('src/features/company/index.tsx')
assert.match(layout, /useIsCompanyAdmin\(\)/, 'company workspace gated on company admin')
assert.match(layout, /<Navigate to='\/' replace \/>/, 'non-admins are redirected')
;['/company/directory', '/company/vendors', '/company/cost-codes', '/company/equipment', '/company/templates', '/company/permissions'].forEach(
  (href) => assert.ok(layout.includes(`href: '${href}'`), `layout links ${href}`)
)
const sidebar = read('src/components/layout/data/sidebar-data.ts')
assert.match(sidebar, /url: '\/company\/directory'/, 'sidebar links to the company workspace')

// ── Hooks call the company API ──────────────────────────────────────────
const hooks = read('src/features/company/hooks/use-company.ts')
;[
  "'/company/directory'",
  "'/company/vendors'",
  "'/company/vendors/migration-report'",
  "'/company/cost-codes'",
  "'/company/cost-codes/import'",
  "'/company/equipment'",
  "'/company/project-templates'",
  '/company/project-templates/${templateId}/create-project',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))

// ── Pages ───────────────────────────────────────────────────────────────
assert.match(read('src/features/company/vendors.tsx'), /uat-vendor-new/, 'vendor page has a create action')
assert.match(read('src/features/company/vendors.tsx'), /Consolidation report/, 'vendor page exposes the migration report')
assert.match(read('src/features/company/cost-codes.tsx'), /uat-cost-code-import/, 'cost codes can be imported')
assert.match(read('src/features/company/equipment.tsx'), /uat-company-equipment-save/, 'equipment masters can be added')
const templates = read('src/features/company/templates.tsx')
assert.match(templates, /parseLocations/, 'template locations parsed from an outline')
assert.match(templates, /permissionTemplateId/, 'template parties carry permission templates')
assert.match(read('src/features/company/permissions.tsx'), /PermissionTemplatesPage/, 'permissions page reuses the template editor')

// ── Reuse on projects ───────────────────────────────────────────────────
const createDialog = read('src/features/projects/components/project-create-dialog.tsx')
assert.match(createDialog, /uat-project-template-picker/, 'new project dialog offers templates')
assert.match(
  createDialog,
  /createFromTemplate\.mutateAsync\(\{\s*templateId,\s*payload,?\s*\}\)/,
  'template creation goes through the template endpoint'
)
const equipment = read('src/features/equipment/components/equipment-section.tsx')
assert.match(equipment, /uat-equipment-master-picker/, 'project equipment picks from the company list')
assert.match(equipment, /companyEquipmentId/, 'project equipment sends the master id')
const materials = read('src/features/materials/components/materials-section.tsx')
assert.match(materials, /company-vendor-names/, 'material supplier field suggests company vendors')

// ── Backend contract ────────────────────────────────────────────────────
const routes = read('../backend/src/routes/company-workspace.js')
;['/directory', '/vendors', '/vendors/migration-report', '/cost-codes/import', '/equipment', '/project-templates/:id/create-project'].forEach(
  (path) => assert.ok(routes.includes(`"${path}"`), `backend route ${path}`)
)
assert.match(routes, /requireCompanyAdmin/, 'writes gated to company admins')
const migration = read('../backend/prisma/migrations/20260905210000_add_company_workspace/migration.sql')
assert.match(migration, /"isVendor"/, 'vendor flag added')
assert.match(migration, /UPDATE "ProcurementSupplier" s SET "companyId"/, 'suppliers linked to vendors')
assert.match(migration, /CREATE TABLE "ProjectTemplate"/, 'project templates table')
assert.match(migration, /CREATE TABLE "CostCode"/, 'cost code table')
assert.match(migration, /CREATE TABLE "CompanyEquipment"/, 'equipment master table')

console.log('company-workspace-ui: ok')
