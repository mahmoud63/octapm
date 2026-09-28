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
import { useScheduleWbsRows } from '@/features/controls/structure/hooks/use-structure'

/**
 * The schedule's WBS tab.
 *
 * When the project has WbsNode rows (PC-1: populated at revision activation
 * and editable on the Structure page) the tree is always those rows, joined
 * by parent id — for everyone who can read the schedule (owner decision D3:
 * a schedule reader who may not read the BOQ receives the same outline).
 * Only a project without WbsNode rows falls back to the WBS the revision
 * snapshot carried, joined by the snapshot's own parent ids (an imported P6
 * or MS Project WBS) and, for the generator's id-less nodes, by dotted code.
 * Until the project's rows have been read nothing is drawn, so the snapshot
 * never stands in for a canonical tree that exists. Whether rows exist is
 * decided by every row, archived ones included: a project whose nodes are
 * all archived says so, and does not fall back to the snapshot. The rows
 * keep the canonical sibling order the service gives them (sortOrder, then
 * code); only the snapshot fallback is ordered by code.
 */

type FlatWbsNode = {
  id?: string
  parentId?: string | null
  // The snapshot's own ids, as the parsers write them: XER / xlsx / MSPDI
  // (wbsId, parentWbsId) and P6 XML (objectId, parentObjectId).
  wbsId?: string | number | null
  parentWbsId?: string | number | null
  objectId?: string | number | null
  parentObjectId?: string | number | null
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
  // Absent when the snapshot carried none, or when it is withheld from
  // someone who may read neither the BOQ nor the cost module (§12): never
  // read as 0.
  budget?: number
  activities: number
  responsible: string
  isPackage: boolean
  children: WbsNode[]
}

const fmtUSD = (n: number | undefined) =>
  n
    ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '—'

const toNode = (node: FlatWbsNode, key: string, level: number): WbsNode => ({
  key,
  code: String(node.code ?? ''),
  level,
  name: String(node.name || 'Unnamed'),
  duration: Number(node.duration) || 0,
  budget:
    node.budget === undefined || node.budget === null
      ? undefined
      : Number(node.budget) || 0,
  activities: Number(node.activities) || 0,
  responsible: String(node.responsible || ''),
  isPackage: Boolean(node.isPackage),
  children: [],
})

const idOf = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value).trim()
  return text || null
}

const byCode = (a: WbsNode, b: WbsNode) =>
  a.code.localeCompare(b.code, undefined, { numeric: true })

const sortDeep = (list: WbsNode[]) => {
  list.sort(byCode)
  list.forEach((node) => sortDeep(node.children))
}

/**
 * The WBS a revision snapshot carried, as a tree — the same reading
 * wbs.service's normalizeSnapshotNode gives it when the revision is
 * activated. A node with an id (wbsId / objectId) is keyed by it and hangs
 * under the node its parent id names; only a node without ids (the AI
 * generator's { code, level, name }) is placed by its dotted code, or under
 * the last node one level up. Nothing is keyed by code alone, so two nodes
 * sharing a short code ("FDN" under "CIV" and under "MEP") both appear, each
 * under its own parent.
 */
const buildTreeFromSnapshot = (nodes: FlatWbsNode[]): WbsNode[] => {
  type Entry = {
    key: string
    parentKey: string | null
    node: WbsNode
    implicit: boolean
    raw: FlatWbsNode
  }
  const entries: Entry[] = []
  const keyById = new Map<string, string>()
  nodes.forEach((raw, index) => {
    const code = idOf(raw.code)
    const id = idOf(raw.wbsId ?? raw.objectId ?? raw.id)
    if (!code && !id) return
    // A repeated id (never expected in one file) keeps its node, keyed by
    // its place in the list.
    const fresh = id !== null && !keyById.has(id)
    const key = fresh ? `id:${id}` : `at:${index}`
    if (fresh) keyById.set(id!, key)
    const label = code ?? id!
    const level = Number(raw.level) || label.split('.').length
    entries.push({
      key,
      parentKey: null,
      node: toNode({ ...raw, code: label }, key, level),
      implicit: !id,
      raw,
    })
  })

  // Parents by id first.
  const firstKeyByCode = new Map<string, string>()
  entries.forEach((entry) => {
    if (entry.implicit && !firstKeyByCode.has(entry.node.code)) {
      firstKeyByCode.set(entry.node.code, entry.key)
    }
  })
  const lastAtLevel: Entry[] = []
  for (const entry of entries) {
    const raw = entry.raw
    const parentId = entry.implicit
      ? null
      : idOf(raw.parentWbsId ?? raw.parentObjectId ?? raw.parentId)
    if (parentId && keyById.has(parentId)) {
      entry.parentKey = keyById.get(parentId)!
    } else if (entry.implicit) {
      const parts = entry.node.code.split('.')
      const prefix = parts.slice(0, -1).join('.')
      const above = entry.node.level > 1 ? lastAtLevel[entry.node.level - 2] : null
      if (prefix && firstKeyByCode.has(prefix)) entry.parentKey = firstKeyByCode.get(prefix)!
      else if (!prefix && above) entry.parentKey = above.key
    }
    lastAtLevel[entry.node.level - 1] = entry
    lastAtLevel.length = entry.node.level
  }

  // Join, refusing any parent chain that loops back on itself.
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))
  const loops = (entry: Entry) => {
    const seen = new Set<string>([entry.key])
    let parent = entry.parentKey ? byKey.get(entry.parentKey) : undefined
    while (parent) {
      if (seen.has(parent.key)) return true
      seen.add(parent.key)
      parent = parent.parentKey ? byKey.get(parent.parentKey) : undefined
    }
    return false
  }
  const roots: WbsNode[] = []
  for (const entry of entries) {
    const parent = entry.parentKey ? byKey.get(entry.parentKey) : undefined
    if (parent && parent !== entry && !loops(entry)) parent.node.children.push(entry.node)
    else roots.push(entry.node)
  }
  sortDeep(roots)
  return roots
}

/**
 * WbsNode rows carry ids and parent ids: the hierarchy is explicit. The
 * rows arrive in the canonical order (wbs.service: depth first, siblings by
 * sortOrder, then code), and each list keeps the order its rows came in —
 * no re-sort — so the tab shows the siblings as the Structure page does.
 */
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
  showBudget: boolean
}

function WbsRow({ node, depth, expanded, toggle, showBudget }: RowProps) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.key)

  return (
    <>
      <tr
        className='border-b hover:bg-muted/25'
        data-testid={`uat-schedule-wbs-row-${node.code}`}
        data-depth={depth}
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
        {showBudget && <td className='p-2 text-right text-xs'>{fmtUSD(node.budget)}</td>}
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
            showBudget={showBudget}
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
  const {
    data: structure,
    isLoading: structureLoading,
    isError: structureFailed,
  } = useScheduleWbsRows(projectId ?? '', {
    enabled: Boolean(projectId),
  })
  // Any row, archived or not, makes the tree the project's own (D3).
  const fromRows = Boolean(structure && structure.items.length > 0)
  const activeRows = useMemo(
    () => (structure?.items ?? []).filter((row) => row.status !== 'archived'),
    [structure]
  )
  const allArchived = fromRows && activeRows.length === 0

  const source = useMemo<FlatWbsNode[]>(
    () =>
      fromRows
        ? activeRows.map((row) => ({
            id: row.id,
            parentId: row.parentId,
            code: row.code,
            level: row.depth + 1,
            name: row.name,
            activities: row.activityCount,
            isPackage: row.isPackage,
          }))
        : nodes || [],
    [fromRows, activeRows, nodes]
  )

  const tree = useMemo(
    () => (fromRows ? buildTreeFromRows(source) : buildTreeFromSnapshot(source)),
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
  // The rollup is a chart of budgets: with none to chart (none carried, or
  // withheld) it is not drawn, rather than drawn as bars of $0k.
  const hasBudgets = topLevelData.some((node) => node.budget !== undefined)
  // The project's WbsNode rows carry no budget (nothing rolls one up, and a
  // rolled-up budget is not a figure this tab may invent), so the rows view
  // has no Budget column rather than a column of dashes that would read as
  // "withheld" or "none". Its activity counts are each node's own.
  const showBudget = !fromRows
  const columnCount = showBudget ? 6 : 5

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

  // The canonical tree decides: while it is being read, or if it cannot be
  // read, the revision's snapshot is not offered in its place.
  if (projectId && structureLoading) {
    return (
      <p className='p-6 text-center text-sm text-muted-foreground' data-testid='uat-schedule-wbs-loading'>
        Loading the project WBS…
      </p>
    )
  }
  if (projectId && structureFailed) {
    return (
      <p className='p-6 text-center text-sm text-muted-foreground' data-testid='uat-schedule-wbs-error'>
        The project WBS could not be loaded. Reload the page to try again.
      </p>
    )
  }

  return (
    <div className='space-y-4' data-testid='uat-schedule-wbs' data-source={fromRows ? 'wbs-nodes' : 'snapshot'}>
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
              {showBudget && <th className='p-2 text-right font-medium'>Budget</th>}
              <th
                className='p-2 text-right font-medium'
                title={
                  fromRows
                    ? 'Activities filed directly under the node, not under its children'
                    : undefined
                }
              >
                {fromRows ? 'Activities (direct)' : 'Activities'}
              </th>
              <th className='p-2 text-left font-medium'>Responsible</th>
            </tr>
          </thead>
          <tbody>
            {tree.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className='p-6 text-center text-muted-foreground'
                >
                  {allArchived ? (
                    <span data-testid='uat-schedule-wbs-all-archived'>
                      All WBS nodes are archived. Restore or add nodes under
                      Project Controls › Structure.
                    </span>
                  ) : (
                    'No WBS data available.'
                  )}
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
                  showBudget={showBudget}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {!fromRows && hasBudgets && (
        <div
          className='rounded-md border p-3'
          data-testid='uat-schedule-wbs-rollup'
        >
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
