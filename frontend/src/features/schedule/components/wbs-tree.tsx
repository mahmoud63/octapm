import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Package } from 'lucide-react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useWbsNodes } from '@/features/controls/structure/hooks/use-structure'

/**
 * The schedule's WBS tab.
 *
 * When the project has WbsNode rows (PC-1: populated at revision activation
 * and editable on the Structure page) the tree is those rows, joined by
 * parent id. Otherwise it falls back to the WBS the revision snapshot
 * carried, split on "." as before — older projects keep their tab.
 */

type FlatWbsNode = {
  id?: string
  parentId?: string | null
  code?: string
  level?: number
  name?: string
  duration?: number
  budget?: number
  activities?: number
  responsible?: string
  isPackage?: boolean
}

type WbsNode = {
  key: string
  code: string
  level: number
  name: string
  duration: number
  budget: number
  activities: number
  responsible: string
  isPackage: boolean
  children: WbsNode[]
}

const fmtUSD = (n: number) =>
  n
    ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '—'

const toNode = (node: FlatWbsNode, key: string, level: number): WbsNode => ({
  key,
  code: String(node.code ?? ''),
  level,
  name: String(node.name || 'Unnamed'),
  duration: Number(node.duration) || 0,
  budget: Number(node.budget) || 0,
  activities: Number(node.activities) || 0,
  responsible: String(node.responsible || ''),
  isPackage: Boolean(node.isPackage),
  children: [],
})

/** Snapshot nodes carry no ids: the dotted code is the hierarchy. */
const buildTreeFromCodes = (nodes: FlatWbsNode[]): WbsNode[] => {
  const sorted = [...nodes]
    .filter((node) => node.code)
    .sort((a, b) =>
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
    )

  const map = new Map<string, WbsNode>()
  sorted.forEach((node) => {
    const code = String(node.code)
    map.set(code, toNode(node, code, Number(node.level) || code.split('.').length))
  })

  const roots: WbsNode[] = []
  map.forEach((node) => {
    const parts = node.code.split('.')
    const parent = parts.length > 1 ? map.get(parts.slice(0, -1).join('.')) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  return roots
}

/** WbsNode rows carry ids and parent ids: the hierarchy is explicit. */
const buildTreeFromRows = (nodes: FlatWbsNode[]): WbsNode[] => {
  const map = new Map<string, WbsNode>()
  nodes.forEach((node) => {
    if (!node.id) return
    map.set(node.id, toNode(node, node.id, Number(node.level) || 1))
  })
  const roots: WbsNode[] = []
  nodes.forEach((node) => {
    if (!node.id) return
    const built = map.get(node.id)!
    const parent = node.parentId ? map.get(node.parentId) : null
    if (parent) parent.children.push(built)
    else roots.push(built)
  })
  const byCode = (a: WbsNode, b: WbsNode) =>
    a.code.localeCompare(b.code, undefined, { numeric: true })
  const sortDeep = (list: WbsNode[]) => {
    list.sort(byCode)
    list.forEach((node) => sortDeep(node.children))
  }
  sortDeep(roots)
  return roots
}

const collectKeys = (nodes: WbsNode[]): string[] => {
  const keys: string[] = []
  const walk = (node: WbsNode) => {
    keys.push(node.key)
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return keys
}

type RowProps = {
  node: WbsNode
  depth: number
  expanded: Set<string>
  toggle: (key: string) => void
}

function WbsRow({ node, depth, expanded, toggle }: RowProps) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.key)

  return (
    <>
      <tr
        className='border-b hover:bg-muted/25'
        data-testid={`uat-schedule-wbs-row-${node.code}`}
      >
        <td className='p-2' style={{ paddingLeft: `${depth * 20 + 8}px` }}>
          <div className='flex items-center gap-1'>
            {hasChildren ? (
              <button
                className='rounded p-0.5 hover:bg-muted'
                onClick={() => toggle(node.key)}
                aria-label={`Toggle ${node.name}`}
              >
                {isOpen ? (
                  <ChevronDown className='h-3.5 w-3.5 text-muted-foreground' />
                ) : (
                  <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                )}
              </button>
            ) : (
              <span className='w-4' />
            )}
            <span className='font-mono text-xs'>{node.code}</span>
          </div>
        </td>
        <td className='p-2' style={{ fontWeight: depth === 0 ? 600 : 400 }}>
          <span className='inline-flex items-center gap-2'>
            {node.name}
            {node.isPackage && (
              <Badge variant='secondary' className='gap-1 text-[10px]'>
                <Package className='h-3 w-3' /> Package
              </Badge>
            )}
          </span>
        </td>
        <td className='p-2 text-right text-xs'>
          {node.duration ? `${node.duration}d` : '—'}
        </td>
        <td className='p-2 text-right text-xs'>{fmtUSD(node.budget)}</td>
        <td className='p-2 text-right text-xs'>{node.activities || '—'}</td>
        <td className='p-2 text-xs text-muted-foreground'>
          {node.responsible || '—'}
        </td>
      </tr>

      {hasChildren &&
        isOpen &&
        node.children.map((child) => (
          <WbsRow
            key={child.key}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
          />
        ))}
    </>
  )
}

export function WbsTree({
  nodes,
  projectId,
}: {
  nodes: FlatWbsNode[]
  projectId?: string
}) {
  const { data: structure } = useWbsNodes(projectId ?? '', {
    enabled: Boolean(projectId),
  })
  const fromRows = Boolean(structure && structure.items.length > 0)

  const source = useMemo<FlatWbsNode[]>(
    () =>
      fromRows
        ? structure!.items.map((row) => ({
            id: row.id,
            parentId: row.parentId,
            code: row.code,
            level: row.depth + 1,
            name: row.name,
            activities: row.activityCount,
            isPackage: row.isPackage,
          }))
        : nodes || [],
    [fromRows, structure, nodes]
  )

  const tree = useMemo(
    () => (fromRows ? buildTreeFromRows(source) : buildTreeFromCodes(source)),
    [fromRows, source]
  )
  const topLevelData = useMemo(
    () =>
      tree.map((node) => ({
        name: node.name.slice(0, 24),
        budget: node.budget,
      })),
    [tree]
  )

  const initialExpanded = useMemo(
    () => new Set(tree.map((node) => node.key)),
    [tree]
  )

  // The roots start open. The tree's keys change with its source — snapshot
  // codes until the project's WbsNode rows arrive, row ids after — so a
  // choice the viewer made is kept only for the source it was made on; the
  // other source starts open again rather than with every root collapsed
  // under keys that no longer exist.
  const [chosen, setChosen] = useState<{
    fromRows: boolean
    keys: Set<string>
  } | null>(null)
  const expanded =
    chosen && chosen.fromRows === fromRows ? chosen.keys : initialExpanded
  const setExpanded = (keys: Set<string>) => setChosen({ fromRows, keys })

  const toggle = (key: string) => {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpanded(next)
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={() => setExpanded(new Set(collectKeys(tree)))}
        >
          Expand All
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => setExpanded(new Set())}
        >
          Collapse All
        </Button>
        <span className='text-xs text-muted-foreground'>
          {fromRows
            ? 'Project WBS (edit it under Project Controls › Structure).'
            : 'WBS as carried by the schedule revision.'}
        </span>
      </div>

      <div className='overflow-x-auto rounded-md border'>
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
            {tree.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className='p-6 text-center text-muted-foreground'
                >
                  No WBS data available.
                </td>
              </tr>
            ) : (
              tree.map((node) => (
                <WbsRow
                  key={node.key}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  toggle={toggle}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {!fromRows && (
        <div className='rounded-md border p-3'>
          <p className='mb-2 text-sm font-semibold'>
            Top-Level WBS Budget Rollup
          </p>
          <ResponsiveContainer width='100%' height={220}>
            <BarChart data={topLevelData} layout='vertical'>
              <XAxis
                type='number'
                tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
              />
              <YAxis
                type='category'
                dataKey='name'
                width={180}
                tick={{ fontSize: 11 }}
              />
              <Tooltip formatter={(v) => fmtUSD(Number(v || 0))} />
              <Bar dataKey='budget' fill='#3B82F6' radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
