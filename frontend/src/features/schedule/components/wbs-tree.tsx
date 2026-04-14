import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'

type FlatWbsNode = {
  code?: string
  level?: number
  name?: string
  duration?: number
  budget?: number
  activities?: number
  responsible?: string
}

type WbsNode = {
  code: string
  level: number
  name: string
  duration: number
  budget: number
  activities: number
  responsible: string
  children: WbsNode[]
}

const fmtUSD = (n: number) =>
  n
    ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '—'

const buildTree = (nodes: FlatWbsNode[]): WbsNode[] => {
  const sorted = [...nodes]
    .filter((node) => node.code)
    .sort((a, b) =>
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
    )

  const map = new Map<string, WbsNode>()
  sorted.forEach((node) => {
    const code = String(node.code)
    map.set(code, {
      code,
      level: Number(node.level) || code.split('.').length,
      name: String(node.name || 'Unnamed'),
      duration: Number(node.duration) || 0,
      budget: Number(node.budget) || 0,
      activities: Number(node.activities) || 0,
      responsible: String(node.responsible || ''),
      children: [],
    })
  })

  const roots: WbsNode[] = []
  map.forEach((node) => {
    const parts = node.code.split('.')
    if (parts.length <= 1) {
      roots.push(node)
      return
    }

    const parentCode = parts.slice(0, -1).join('.')
    const parent = map.get(parentCode)
    if (!parent) {
      roots.push(node)
      return
    }

    parent.children.push(node)
  })

  return roots
}

const collectCodes = (nodes: WbsNode[]): string[] => {
  const codes: string[] = []
  const walk = (node: WbsNode) => {
    codes.push(node.code)
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return codes
}

type RowProps = {
  node: WbsNode
  depth: number
  expanded: Set<string>
  toggle: (code: string) => void
}

function WbsRow({ node, depth, expanded, toggle }: RowProps) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.code)

  return (
    <>
      <tr className='border-b hover:bg-muted/25'>
        <td className='p-2' style={{ paddingLeft: `${depth * 20 + 8}px` }}>
          <div className='flex items-center gap-1'>
            {hasChildren ? (
              <button
                className='rounded p-0.5 hover:bg-muted'
                onClick={() => toggle(node.code)}
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
          {node.name}
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
            key={child.code}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
          />
        ))}
    </>
  )
}

export function WbsTree({ nodes }: { nodes: FlatWbsNode[] }) {
  const tree = useMemo(() => buildTree(nodes || []), [nodes])
  const topLevelData = useMemo(
    () =>
      (nodes || [])
        .filter((node) => {
          const code = String(node.code || '')
          return code && !code.includes('.')
        })
        .map((node) => ({
          name: String(node.name || 'Unnamed').slice(0, 24),
          budget: Number(node.budget) || 0,
        })),
    [nodes]
  )

  const initialExpanded = useMemo(() => {
    const rootCodes = tree.map((node) => node.code)
    return new Set(rootCodes)
  }, [tree])

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)

  const toggle = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  return (
    <div className='space-y-4'>
      <div className='flex gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={() => setExpanded(new Set(collectCodes(tree)))}
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
                  key={node.code}
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
    </div>
  )
}
