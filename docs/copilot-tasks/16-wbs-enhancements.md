# Task 16 — WBS: Hierarchy Collapse/Expand & Budget Rollup Chart

## Gaps Covered
- WBS displayed as flat list; no hierarchy collapse/expand
- No WBS budget rollup chart

## BRD Refs
- FR-201: WBS hierarchy from P6 import / AI generation

## DB Schema Changes
None — WBS data lives in `ScheduleRevision.snapshotJson`. Consider persisting to a `WbsNode` table for better manipulation, but for now use the snapshot data.

Optionally add `WbsNode` model:
```prisma
model WbsNode {
  id          String  @id @default(uuid())
  projectId   String
  code        String
  level       Int     @default(1)
  name        String
  duration    Int?
  budget      Float   @default(0)
  activities  Int     @default(0)
  responsible String?
  parentCode  String?

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
}
```

Add `wbsNodes WbsNode[]` to `Project`. Run migration: `npx prisma migrate dev --name add_wbs_node`

Seed from schedule generation similar to how risks and long lead items are seeded.

## Frontend Changes

### New file: `frontend/src/features/schedule/components/wbs-tree.tsx`

#### Collapsible WBS Tree Component
```tsx
import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface WbsNode {
  code: string
  level: number
  name: string
  duration?: number
  budget?: number
  activities?: number
  responsible?: string
  children?: WbsNode[]
}

function buildTree(flatNodes: WbsNode[]): WbsNode[] {
  // Build tree from flat list by comparing code prefixes
  // Level 1 nodes are roots; level 2 nodes are children of level 1, etc.
  // Match by code prefix: "1.2.1" is child of "1.2"
  const roots: WbsNode[] = []
  const nodeMap = new Map<string, WbsNode>()

  const sorted = [...flatNodes].sort((a, b) => a.code.localeCompare(b.code))
  for (const node of sorted) {
    nodeMap.set(node.code, { ...node, children: [] })
  }

  for (const node of sorted) {
    const parts = node.code.split('.')
    if (parts.length === 1) {
      roots.push(nodeMap.get(node.code)!)
    } else {
      const parentCode = parts.slice(0, -1).join('.')
      const parent = nodeMap.get(parentCode)
      if (parent) {
        parent.children = parent.children || []
        parent.children.push(nodeMap.get(node.code)!)
      } else {
        roots.push(nodeMap.get(node.code)!)
      }
    }
  }
  return roots
}

function WbsRow({ node, depth = 0 }: { node: WbsNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children && node.children.length > 0
  const fmtUSD = (n: number) => n ? '$' + Number(n).toLocaleString() : '—'

  return (
    <>
      <tr className='border-b hover:bg-muted/25'>
        <td className='p-2' style={{ paddingLeft: `${depth * 20 + 8}px` }}>
          <div className='flex items-center gap-1'>
            {hasChildren ? (
              <button onClick={() => setOpen(o => !o)} className='text-muted-foreground'>
                {open ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
              </button>
            ) : (
              <span className='w-4' />
            )}
            <span className='font-mono text-xs'>{node.code}</span>
          </div>
        </td>
        <td className='p-2 font-medium' style={{ fontWeight: depth === 0 ? 600 : 400 }}>{node.name}</td>
        <td className='p-2 text-right text-xs'>{node.duration ? `${node.duration}d` : '—'}</td>
        <td className='p-2 text-right text-xs'>{fmtUSD(node.budget || 0)}</td>
        <td className='p-2 text-right text-xs'>{node.activities ?? '—'}</td>
        <td className='p-2 text-xs text-muted-foreground'>{node.responsible || '—'}</td>
      </tr>
      {open && hasChildren && node.children!.map(child => (
        <WbsRow key={child.code} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

export function WbsTree({ nodes }: { nodes: WbsNode[] }) {
  const tree = useMemo(() => buildTree(nodes), [nodes])
  const [allOpen, setAllOpen] = useState(false)

  return (
    <div>
      <div className='mb-2 flex gap-2'>
        <Button size='sm' variant='outline' onClick={() => setAllOpen(true)}>Expand All</Button>
        <Button size='sm' variant='outline' onClick={() => setAllOpen(false)}>Collapse All</Button>
      </div>
      <div className='rounded-md border overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>WBS Code</th>
              <th className='p-2 text-left font-medium'>Name</th>
              <th className='p-2 text-right font-medium'>Duration</th>
              <th className='p-2 text-right font-medium'>Budget</th>
              <th className='p-2 text-right font-medium'>Activities</th>
              <th className='p-2 text-left font-medium'>Responsible</th>
            </tr>
          </thead>
          <tbody>
            {tree.map(node => <WbsRow key={node.code} node={node} depth={0} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

#### Budget Rollup Bar Chart
Below the tree, add a horizontal bar chart using Recharts showing budget by top-level WBS phase:
```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const topLevelData = nodes
  .filter(n => n.level === 1 || !n.code.includes('.'))
  .map(n => ({ name: n.name.slice(0, 20), budget: n.budget || 0 }))

<ResponsiveContainer width='100%' height={200}>
  <BarChart data={topLevelData} layout='vertical'>
    <XAxis type='number' tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
    <YAxis type='category' dataKey='name' width={140} tick={{ fontSize: 11 }} />
    <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
    <Bar dataKey='budget' fill='#3B82F6' radius={[0, 4, 4, 0]} />
  </BarChart>
</ResponsiveContainer>
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Replace the existing flat WBS table with `<WbsTree nodes={revision.wbs || []} />` and the budget chart.

## Acceptance Criteria
- [ ] WBS renders as collapsible tree; level 1 nodes expanded by default
- [ ] Expand All / Collapse All buttons work
- [ ] Budget rollup bar chart shows budget by top-level phase
- [ ] Children nodes indented by 20px per level
- [ ] Parent nodes in bold; leaf nodes normal weight
