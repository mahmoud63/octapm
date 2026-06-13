import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/features/equipment/hooks/use-equipment.ts',
    checks: [
      'useEquipmentUtilization',
      '/equipment/usage',
      'EquipmentUtilizationReport',
      'recentUsage',
    ],
  },
  {
    file: 'src/features/equipment/components/equipment-section.tsx',
    checks: [
      'Master rates and approved activity utilization',
      'Utilization by Activity',
      'Recent Approved Usage',
      'unpriced',
      'Daily report',
    ],
  },
  {
    file: 'src/features/site-reporting/components/site-reporting-dashboard.tsx',
    checks: [
      'UNLISTED_EQUIPMENT_VALUE',
      'useEquipment(projectId)',
      'equipmentId: row.equipmentId || undefined',
      '<SelectItem value={UNLISTED_EQUIPMENT_VALUE}>Unlisted</SelectItem>',
      'readOnly={Boolean(row.equipmentId)}',
    ],
  },
  {
    file: 'src/features/cost/components/cost-dashboard.tsx',
    checks: [
      "TabsTrigger value='equipment'",
      "TabsContent value='equipment'",
      'Equipment Usage History',
      "entityType='activity_equipment_usage'",
    ],
  },
  {
    file: 'src/features/projects/components/project-detail.tsx',
    checks: ["{ key: 'equipment', label: 'Equipment' }"],
  },
]

for (const assertion of assertions) {
  const source = read(assertion.file)
  for (const check of assertion.checks) {
    if (!source.includes(check)) {
      throw new Error(`${assertion.file} is missing ${check}`)
    }
  }
}

console.log('Equipment utilization UI assertions passed')
