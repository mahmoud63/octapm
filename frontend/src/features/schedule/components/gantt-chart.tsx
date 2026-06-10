import { useMemo, useRef, useState } from 'react'
import {
  GripHorizontal,
  Layers,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ScheduleActivity } from '../data/schema'
import { ActivityInlineEditDialog } from './activity-inline-edit-dialog'

interface Props {
  activities: ScheduleActivity[]
  onActivityUpdate?: (
    id: string,
    patch: Partial<ScheduleActivity>
  ) => Promise<void>
  onActivityDelete?: (id: string) => Promise<void>
}

// ── Layout constants ──────────────────────────────────────────────────────────
const ROW_H = 40
const BAR_H = 18
const LABEL_W = 300
const TIMESCALE_H = 52 // two-row header
const MIN_PX = 3
const MAX_PX = 16
const DEFAULT_PX = 6
const DAYS_PER_MON = 22 // working days ≈ 1 month

// ── Semantic colours (plain hex — safe for SVG fill/stroke attributes) ────────
// Structural colours (bg, text, borders) use CSS variables via style prop
const COLOR = {
  critical: '#EF4444',
  nearCrit: '#F97316',
  normal: '#3B82F6',
  milestone: '#A855F7',
  float: '#14B8A6',
  today: '#F59E0B',
  baseline: '#94A3B8',
}

// CSS-variable shorthands for use in style={{ }} props on SVG elements
const CSS = {
  border: 'hsl(var(--border))',
  muted: 'hsl(var(--muted))',
  fg: 'hsl(var(--foreground))',
  mutedFg: 'hsl(var(--muted-foreground))',
  card: 'hsl(var(--card))',
}

// ── Helper ────────────────────────────────────────────────────────────────────
const isNearCritical = (a: ScheduleActivity) =>
  !a.isCritical &&
  !a.isMilestone &&
  a.totalFloat != null &&
  a.totalFloat >= 1 &&
  a.totalFloat <= 5

const barColor = (a: ScheduleActivity) =>
  a.isMilestone
    ? COLOR.milestone
    : a.isCritical
      ? COLOR.critical
      : isNearCritical(a)
        ? COLOR.nearCrit
        : COLOR.normal

const formatCalendarDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'

type DragState = {
  id: string
  startX: number
  origStart: number
  currentStart: number
}
type ContextMenu = { id: string; x: number; y: number }
type Tooltip = { activity: ScheduleActivity; x: number; y: number }

// ── Component ─────────────────────────────────────────────────────────────────
export function GanttChart({
  activities,
  onActivityUpdate,
  onActivityDelete,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [localOverrides, setLocal] = useState<
    Record<string, { earlyStart: number }>
  >({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showBaseline, setBaseline] = useState(false)
  const [px, setPx] = useState(DEFAULT_PX)
  const canEditActivities = Boolean(onActivityUpdate || onActivityDelete)

  // Merge drag overrides into displayed activities
  const displayed = useMemo(
    () =>
      activities.map((a) => {
        const ov = localOverrides[a.id]
        if (!ov) return a
        return {
          ...a,
          earlyStart: ov.earlyStart,
          earlyFinish: ov.earlyStart + (a.duration || 0),
        }
      }),
    [activities, localOverrides]
  )

  const maxDay = useMemo(
    () => Math.max(...displayed.map((a) => a.earlyFinish ?? 0), 30),
    [displayed]
  )
  const chartW = maxDay * px + 80
  const totalH = displayed.length * ROW_H

  // Stats
  const nCritical = displayed.filter(
    (a) => a.isCritical && !a.isMilestone
  ).length
  const nNearCrit = displayed.filter(isNearCritical).length
  const nMilestone = displayed.filter((a) => a.isMilestone).length

  // Timescale ticks
  const monthTicks = useMemo(() => {
    const t: number[] = []
    for (let d = 0; d <= maxDay + DAYS_PER_MON; d += DAYS_PER_MON) t.push(d)
    return t
  }, [maxDay])

  const weekTicks = useMemo(() => {
    const t: number[] = []
    for (let d = 0; d <= maxDay + 5; d += 5) t.push(d)
    return t
  }, [maxDay])

  // Geometry helpers
  const bx = (a: ScheduleActivity) => (a.earlyStart ?? 0) * px
  const bw = (a: ScheduleActivity) => Math.max(8, (a.duration || 0) * px)
  const by = (i: number) => TIMESCALE_H + i * ROW_H + (ROW_H - BAR_H) / 2

  // Activity id → index map for arrows
  const actMap = useMemo(() => {
    const m = new Map<string, { act: ScheduleActivity; idx: number }>()
    displayed.forEach((a, idx) => {
      m.set(a.id, { act: a, idx })
      if (a.wbsCode) m.set(a.wbsCode, { act: a, idx })
    })
    return m
  }, [displayed])

  // Dependency arrows
  const arrows = useMemo(() => {
    type Arrow = {
      x1: number
      y1: number
      x2: number
      y2: number
      color: string
      marker: string
    }
    const lines: Arrow[] = []
    displayed.forEach((succ, si) => {
      const dependencyRefs =
        succ.dependencies?.length > 0
          ? succ.dependencies.map((dependency) => dependency.predecessorId)
          : (succ.predecessors ?? '')
              .split(',')
              .map((raw) => raw.trim().split(/\s+/)[0])
              .filter(Boolean)

      dependencyRefs.forEach((predCode) => {
        const pred = actMap.get(predCode)
        if (!pred) return
        const { act: pa, idx: pi } = pred
        const x1 =
          (pa.earlyStart ?? 0) * px + Math.max(8, (pa.duration || 0) * px)
        const y1 = TIMESCALE_H + pi * ROW_H + ROW_H / 2
        const x2 = (succ.earlyStart ?? 0) * px
        const y2 = TIMESCALE_H + si * ROW_H + ROW_H / 2
        const color =
          succ.isCritical && pa.isCritical
            ? COLOR.critical
            : isNearCritical(succ) && isNearCritical(pa)
              ? COLOR.nearCrit
              : COLOR.normal
        const marker =
          succ.isCritical && pa.isCritical
            ? 'url(#mk-crit)'
            : isNearCritical(succ)
              ? 'url(#mk-near)'
              : 'url(#mk-fs)'
        lines.push({ x1, y1, x2, y2, color, marker })
      })
    })
    return lines
  }, [displayed, actMap, px])

  const editingActivity = useMemo(
    () =>
      editingId ? (displayed.find((a) => a.id === editingId) ?? null) : null,
    [displayed, editingId]
  )

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const commitDrag = async (state: DragState) => {
    if (!onActivityUpdate || state.currentStart === state.origStart) return
    const base = activities.find((a) => a.id === state.id)
    if (!base) return
    setSavingId(state.id)
    try {
      await onActivityUpdate(state.id, {
        earlyStart: state.currentStart,
        earlyFinish: state.currentStart + (base.duration || 0),
      })
      setLocal((prev) => {
        const n = { ...prev }
        delete n[state.id]
        return n
      })
    } catch {
      toast.error('Failed to update activity')
    } finally {
      setSavingId(null)
    }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging || !editMode) return
    const deltaDays = Math.round((e.clientX - dragging.startX) / px)
    const nextStart = Math.max(0, dragging.origStart + deltaDays)
    setDragging((prev) => (prev ? { ...prev, currentStart: nextStart } : prev))
    setLocal((prev) => ({ ...prev, [dragging.id]: { earlyStart: nextStart } }))
  }

  const onMouseUp = async () => {
    if (!dragging) return
    const state = dragging
    setDragging(null)
    await commitDrag(state)
  }

  // ── Context menu actions ───────────────────────────────────────────────────
  const openCtx = (e: React.MouseEvent, a: ScheduleActivity) => {
    if (!editMode || !canEditActivities) return
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    setCtxMenu({
      id: a.id,
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    })
  }

  const handleMilestone = async (id: string) => {
    if (!onActivityUpdate) return
    setSavingId(id)
    try {
      await onActivityUpdate(id, { isMilestone: true })
    } catch {
      toast.error('Failed')
    } finally {
      setSavingId(null)
      setCtxMenu(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!onActivityDelete || !window.confirm('Delete this activity?')) return
    setSavingId(id)
    try {
      await onActivityDelete(id)
    } catch {
      toast.error('Failed')
    } finally {
      setSavingId(null)
      setCtxMenu(null)
    }
  }

  const handleDialogSave = async (patch: Partial<ScheduleActivity>) => {
    if (!editingActivity || !onActivityUpdate) return
    setSavingId(editingActivity.id)
    try {
      await onActivityUpdate(editingActivity.id, patch)
      setEditingId(null)
    } catch {
      toast.error('Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  // ── Tooltip handler ────────────────────────────────────────────────────────
  const showTooltip = (
    e: React.MouseEvent<SVGElement>,
    a: ScheduleActivity
  ) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({
      activity: a,
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 8,
    })
  }

  if (displayed.length === 0) {
    return (
      <div className='flex items-center justify-center py-16 text-sm text-muted-foreground'>
        No activities to display.
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className='flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3'>
        {/* Left: actions */}
        <div className='flex items-center gap-2'>
          {canEditActivities && (
            <Button
              size='sm'
              variant={editMode ? 'default' : 'outline'}
              onClick={() => {
                setEditMode((p) => !p)
                setCtxMenu(null)
                setDragging(null)
              }}
              disabled={!!savingId}
            >
              <GripHorizontal className='mr-1.5 h-3.5 w-3.5' />
              {editMode ? 'Done Editing' : 'Edit'}
            </Button>
          )}
          <Button
            size='sm'
            variant={showBaseline ? 'secondary' : 'outline'}
            onClick={() => setBaseline((p) => !p)}
          >
            <Layers className='mr-1.5 h-3.5 w-3.5' />
            Baseline
          </Button>
        </div>

        {/* Centre: stats */}
        <div className='flex items-center gap-1'>
          {[
            {
              label: 'Total',
              value: displayed.length,
              color: 'text-foreground',
            },
            { label: 'Critical', value: nCritical, color: 'text-red-500' },
            { label: 'Near-Crit', value: nNearCrit, color: 'text-orange-500' },
            {
              label: 'Milestones',
              value: nMilestone,
              color: 'text-purple-500',
            },
          ].map((s) => (
            <div
              key={s.label}
              className='flex min-w-15 flex-col items-center rounded-lg border bg-muted/30 px-3 py-1'
            >
              <span className={`text-sm font-bold tabular-nums ${s.color}`}>
                {s.value}
              </span>
              <span className='text-[10px] text-muted-foreground'>
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Right: zoom */}
        <div className='flex items-center gap-1 rounded-lg border bg-muted/40 p-1'>
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            disabled={px <= MIN_PX}
            onClick={() => setPx((v) => Math.max(MIN_PX, v - 1))}
          >
            <ZoomOut className='h-3.5 w-3.5' />
          </Button>
          <span className='w-14 text-center text-[11px] font-medium text-muted-foreground select-none'>
            {px}px/day
          </span>
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            disabled={px >= MAX_PX}
            onClick={() => setPx((v) => Math.min(MAX_PX, v + 1))}
          >
            <ZoomIn className='h-3.5 w-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            onClick={() => setPx(DEFAULT_PX)}
          >
            <RotateCcw className='h-3.5 w-3.5' />
          </Button>
        </div>
      </div>

      {editMode && (
        <p className='px-1 text-xs text-muted-foreground'>
          Drag bars to shift start day · Right-click for quick actions
        </p>
      )}

      {/* ── Chart container ──────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className='relative overflow-auto rounded-xl border bg-card'
        style={{ maxHeight: 620 }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          onMouseUp()
          setTooltip(null)
        }}
        onClick={() => setCtxMenu(null)}
      >
        <div style={{ display: 'flex', minWidth: LABEL_W + chartW }}>
          {/* ── Left label panel ─────────────────────────────────────────────── */}
          <div
            className='sticky left-0 z-20 bg-card'
            style={{
              width: LABEL_W,
              flexShrink: 0,
              borderRight: `1px solid ${CSS.border}`,
            }}
          >
            {/* Header row */}
            <div
              className='flex items-center justify-between border-b bg-muted/50 px-3'
              style={{ height: TIMESCALE_H }}
            >
              <span className='text-[10px] font-semibold tracking-widest text-muted-foreground uppercase'>
                Activity / WBS
              </span>
              <span className='font-mono text-[10px] text-muted-foreground'>
                dur · %
              </span>
            </div>

            {/* Rows */}
            {displayed.map((a, i) => {
              const hov = hoveredId === a.id
              const color = a.isMilestone
                ? 'text-purple-600 dark:text-purple-400'
                : a.isCritical
                  ? 'text-red-600 dark:text-red-400'
                  : isNearCritical(a)
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-foreground'

              return (
                <div
                  key={a.id}
                  onMouseEnter={() => setHoveredId(a.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    height: ROW_H,
                    borderBottom: `1px solid ${CSS.border}`,
                  }}
                  className={`flex items-center gap-2 px-2 transition-colors ${hov ? 'bg-blue-50/60 dark:bg-blue-950/20' : i % 2 === 0 ? '' : 'bg-muted/20'}`}
                >
                  {/* type indicator dot */}
                  <span className='shrink-0'>
                    {a.isMilestone ? (
                      <span className='text-xs leading-none text-purple-500'>
                        ◆
                      </span>
                    ) : a.isCritical ? (
                      <span className='inline-block h-2 w-2 rounded-full bg-red-500' />
                    ) : isNearCritical(a) ? (
                      <span className='inline-block h-2 w-2 rounded-full bg-orange-400' />
                    ) : (
                      <span className='inline-block h-2 w-2 rounded-full bg-blue-400/50' />
                    )}
                  </span>

                  {/* Name + WBS */}
                  <div className='min-w-0 flex-1'>
                    <p
                      className={`truncate text-[11px] leading-tight font-semibold ${color}`}
                      title={a.name}
                    >
                      {a.name}
                    </p>
                    <p className='truncate text-[10px] text-muted-foreground'>
                      {a.wbsCode ?? '—'}
                    </p>
                  </div>

                  {/* Duration + % */}
                  <div className='shrink-0 text-right'>
                    <p className='font-mono text-[10px] font-medium text-foreground'>
                      {a.duration}d
                    </p>
                    <p className='text-[10px] text-muted-foreground'>
                      {a.pctComplete}%
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── SVG chart area ──────────────────────────────────────────────── */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <svg
              width={chartW}
              height={TIMESCALE_H + totalH + 4}
              style={{ display: 'block', userSelect: 'none' }}
            >
              <defs>
                {/* Arrow markers */}
                {[
                  { id: 'mk-fs', fill: COLOR.normal },
                  { id: 'mk-crit', fill: COLOR.critical },
                  { id: 'mk-near', fill: COLOR.nearCrit },
                ].map(({ id, fill }) => (
                  <marker
                    key={id}
                    id={id}
                    markerWidth='6'
                    markerHeight='6'
                    refX='5'
                    refY='3'
                    orient='auto'
                  >
                    <path d='M0,0 L0,6 L6,3 z' fill={fill} opacity='0.85' />
                  </marker>
                ))}

                {/* Critical diagonal stripe */}
                <pattern
                  id='stripe-crit'
                  patternUnits='userSpaceOnUse'
                  width='6'
                  height='6'
                  patternTransform='rotate(40)'
                >
                  <line
                    x1='0'
                    y1='0'
                    x2='0'
                    y2='6'
                    stroke='white'
                    strokeWidth='2'
                    opacity='0.18'
                  />
                </pattern>

                {/* Bar gradients */}
                {[
                  { id: 'grad-crit', from: '#F87171', to: '#DC2626' },
                  { id: 'grad-near', from: '#FB923C', to: '#EA580C' },
                  { id: 'grad-normal', from: '#60A5FA', to: '#2563EB' },
                  { id: 'grad-ms', from: '#C084FC', to: '#9333EA' },
                ].map(({ id, from, to }) => (
                  <linearGradient key={id} id={id} x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%' stopColor={from} />
                    <stop offset='100%' stopColor={to} />
                  </linearGradient>
                ))}
              </defs>

              {/* ── Timescale background ── */}
              <rect
                x={0}
                y={0}
                width={chartW}
                height={TIMESCALE_H}
                style={{ fill: CSS.muted }}
              />

              {/* Week band shading */}
              {weekTicks.map((d, i) =>
                i % 2 === 1 ? (
                  <rect
                    key={`wb-${d}`}
                    x={d * px}
                    y={TIMESCALE_H}
                    width={5 * px}
                    height={totalH}
                    fill='rgba(0,0,0,0.018)'
                  />
                ) : null
              )}

              {/* Month columns + labels */}
              {monthTicks.map((d, i) => (
                <g key={`mt-${i}`}>
                  {/* Separator */}
                  <line
                    x1={d * px}
                    y1={0}
                    x2={d * px}
                    y2={TIMESCALE_H + totalH}
                    style={{ stroke: CSS.border }}
                    strokeWidth={i === 0 ? 0 : 1}
                  />

                  {/* Month label (top row) */}
                  <rect
                    x={d * px}
                    y={0}
                    width={DAYS_PER_MON * px}
                    height={26}
                    fill='transparent'
                  />
                  <text
                    x={d * px + (DAYS_PER_MON * px) / 2}
                    y={17}
                    textAnchor='middle'
                    fontSize={10}
                    fontWeight={600}
                    style={{ fill: CSS.fg }}
                    fontFamily='system-ui, sans-serif'
                  >
                    Month {i + 1}
                  </text>

                  {/* Separator between rows */}
                  <line
                    x1={d * px}
                    y1={26}
                    x2={d * px + DAYS_PER_MON * px}
                    y2={26}
                    style={{ stroke: CSS.border }}
                    strokeWidth={0.5}
                  />

                  {/* Week sub-ticks (bottom row) */}
                  {[0, 5, 10, 15, 20].map((offset) => {
                    const wd = d + offset
                    if (wd > maxDay + 5) return null
                    return (
                      <g key={`wk-${wd}`}>
                        <line
                          x1={wd * px}
                          y1={27}
                          x2={wd * px}
                          y2={TIMESCALE_H}
                          style={{ stroke: CSS.border }}
                          strokeWidth={0.5}
                        />
                        <text
                          x={wd * px + 3}
                          y={TIMESCALE_H - 5}
                          fontSize={8}
                          style={{ fill: CSS.mutedFg }}
                          fontFamily='monospace'
                        >
                          W{Math.floor(wd / 5) + 1}
                        </text>
                      </g>
                    )
                  })}
                </g>
              ))}

              {/* Timescale bottom border */}
              <line
                x1={0}
                y1={TIMESCALE_H}
                x2={chartW}
                y2={TIMESCALE_H}
                style={{ stroke: CSS.border }}
                strokeWidth={1.5}
              />

              {/* Row dividers */}
              {displayed.map((_, i) => (
                <line
                  key={`rd-${i}`}
                  x1={0}
                  y1={TIMESCALE_H + (i + 1) * ROW_H}
                  x2={chartW}
                  y2={TIMESCALE_H + (i + 1) * ROW_H}
                  style={{ stroke: CSS.border }}
                  strokeWidth={0.5}
                />
              ))}

              {/* Today line */}
              {maxDay > 30 && (
                <g>
                  <rect
                    x={30 * px - 1}
                    y={TIMESCALE_H}
                    width={2}
                    height={totalH}
                    fill={COLOR.today}
                    opacity={0.5}
                  />
                  <rect
                    x={30 * px - 18}
                    y={TIMESCALE_H + 2}
                    width={36}
                    height={14}
                    fill={COLOR.today}
                    rx={3}
                    opacity={0.9}
                  />
                  <text
                    x={30 * px}
                    y={TIMESCALE_H + 12}
                    textAnchor='middle'
                    fontSize={8}
                    fontWeight={700}
                    fill='white'
                    fontFamily='system-ui'
                  >
                    TODAY
                  </text>
                </g>
              )}

              {/* Dependency arrows */}
              {arrows.map((ln, i) => {
                const mid = Math.max(ln.x1 + 8, (ln.x1 + ln.x2) / 2)
                const d = `M${ln.x1},${ln.y1} H${mid} V${ln.y2} H${ln.x2}`
                return (
                  <path
                    key={i}
                    d={d}
                    fill='none'
                    stroke={ln.color}
                    strokeWidth={1.2}
                    opacity={0.45}
                    markerEnd={ln.marker}
                  />
                )
              })}

              {/* Activity bars */}
              {displayed.map((a, i) => {
                const x = bx(a)
                const w = bw(a)
                const y = by(i)
                const hov = hoveredId === a.id
                const tf = a.totalFloat ?? 0

                const gradId = a.isMilestone
                  ? 'grad-ms'
                  : a.isCritical
                    ? 'grad-crit'
                    : isNearCritical(a)
                      ? 'grad-near'
                      : 'grad-normal'

                // Milestone diamond
                if (a.isMilestone) {
                  const mx = (a.earlyStart ?? 0) * px
                  const my = TIMESCALE_H + i * ROW_H + ROW_H / 2
                  const s = hov ? 9 : 7
                  return (
                    <g
                      key={a.id}
                      onMouseEnter={() => setHoveredId(a.id)}
                      onMouseLeave={() => {
                        setHoveredId(null)
                        setTooltip(null)
                      }}
                      onMouseMove={(e) => showTooltip(e, a)}
                      onContextMenu={(e) => openCtx(e, a)}
                      style={{ cursor: 'pointer' }}
                    >
                      <polygon
                        points={`${mx},${my - s} ${mx + s},${my} ${mx},${my + s} ${mx - s},${my}`}
                        fill={`url(#grad-ms)`}
                        stroke='white'
                        strokeWidth={1.2}
                        opacity={hov ? 1 : 0.9}
                      />
                    </g>
                  )
                }

                return (
                  <g
                    key={a.id}
                    onMouseEnter={() => setHoveredId(a.id)}
                    onMouseLeave={() => {
                      setHoveredId(null)
                      setTooltip(null)
                    }}
                    onMouseMove={(e) => showTooltip(e, a)}
                    onMouseDown={(e) => {
                      if (!editMode || !onActivityUpdate || a.isMilestone)
                        return
                      e.preventDefault()
                      e.stopPropagation()
                      setDragging({
                        id: a.id,
                        startX: e.clientX,
                        origStart: a.earlyStart ?? 0,
                        currentStart: a.earlyStart ?? 0,
                      })
                    }}
                    onContextMenu={(e) => openCtx(e, a)}
                    style={{
                      cursor:
                        editMode && onActivityUpdate && !a.isMilestone
                          ? dragging?.id === a.id
                            ? 'grabbing'
                            : 'grab'
                          : 'default',
                    }}
                  >
                    {/* Baseline strip */}
                    {showBaseline && a.baselineStart != null && (
                      <rect
                        x={(a.baselineStart ?? 0) * px}
                        y={y - 6}
                        width={Math.max(
                          4,
                          ((a.baselineFinish ?? 0) - (a.baselineStart ?? 0)) *
                            px
                        )}
                        height={4}
                        fill={COLOR.baseline}
                        opacity={0.65}
                        rx={1}
                      />
                    )}

                    {/* Float bar */}
                    {tf > 0 && (
                      <rect
                        x={x + w}
                        y={y + 4}
                        width={tf * px}
                        height={BAR_H - 8}
                        fill={COLOR.float}
                        opacity={0.25}
                        rx={2}
                      />
                    )}

                    {/* Progress underlay */}
                    {a.pctComplete > 0 && (
                      <rect
                        x={x}
                        y={y}
                        width={w * (a.pctComplete / 100)}
                        height={BAR_H}
                        fill={barColor(a)}
                        opacity={0.35}
                        rx={3}
                      />
                    )}

                    {/* Main bar */}
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={BAR_H}
                      fill={`url(#${gradId})`}
                      stroke='rgba(255,255,255,0.25)'
                      strokeWidth={0.8}
                      opacity={hov ? 1 : 0.82}
                      rx={3}
                    />

                    {/* Critical stripe overlay */}
                    {a.isCritical && (
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={BAR_H}
                        fill='url(#stripe-crit)'
                        rx={3}
                      />
                    )}

                    {/* Duration label */}
                    {w > 30 && (
                      <text
                        x={x + w / 2}
                        y={y + BAR_H / 2 + 4}
                        textAnchor='middle'
                        fontSize={8}
                        fontWeight={700}
                        fontFamily='monospace'
                        fill='white'
                        style={{ pointerEvents: 'none' }}
                      >
                        {a.duration}d
                      </text>
                    )}

                    {/* Saving spinner dots */}
                    {savingId === a.id && (
                      <text
                        x={x + w + 4}
                        y={y + BAR_H / 2 + 3}
                        fontSize={9}
                        style={{ fill: CSS.mutedFg }}
                      >
                        ⋯
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>

            {/* ── HTML Tooltip overlay ──────────────────────────────────────── */}
            {tooltip && !dragging && (
              <div
                className='pointer-events-none absolute z-50 max-w-55 rounded-lg border bg-popover text-popover-foreground shadow-xl'
                style={{
                  left: Math.min(tooltip.x, chartW - 230),
                  top: Math.max(4, tooltip.y - 80),
                }}
              >
                <div className='border-b px-3 py-2'>
                  <p className='line-clamp-2 text-[11px] leading-tight font-semibold'>
                    {tooltip.activity.name}
                  </p>
                  {tooltip.activity.wbsCode && (
                    <p className='mt-0.5 font-mono text-[10px] text-muted-foreground'>
                      {tooltip.activity.wbsCode}
                    </p>
                  )}
                </div>
                <div className='grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 text-[10px]'>
                  <span className='text-muted-foreground'>Start</span>
                  <span className='font-mono font-medium'>
                    d{tooltip.activity.earlyStart ?? '—'}
                  </span>
                  <span className='text-muted-foreground'>Start Date</span>
                  <span className='font-mono font-medium'>
                    {formatCalendarDate(tooltip.activity.earlyStartDate)}
                  </span>
                  <span className='text-muted-foreground'>Finish</span>
                  <span className='font-mono font-medium'>
                    d{tooltip.activity.earlyFinish ?? '—'}
                  </span>
                  <span className='text-muted-foreground'>Finish Date</span>
                  <span className='font-mono font-medium'>
                    {formatCalendarDate(tooltip.activity.earlyFinishDate)}
                  </span>
                  <span className='text-muted-foreground'>Duration</span>
                  <span className='font-mono font-medium'>
                    {tooltip.activity.duration}d
                  </span>
                  <span className='text-muted-foreground'>Float</span>
                  <span
                    className={`font-mono font-medium ${tooltip.activity.isCritical ? 'text-red-500' : isNearCritical(tooltip.activity) ? 'text-orange-500' : ''}`}
                  >
                    {tooltip.activity.isCritical
                      ? '0d ⚠'
                      : isNearCritical(tooltip.activity)
                        ? `${tooltip.activity.totalFloat}d ⚠`
                        : `${tooltip.activity.totalFloat ?? '—'}d`}
                  </span>
                  <span className='text-muted-foreground'>Progress</span>
                  <span className='font-mono font-medium'>
                    {tooltip.activity.pctComplete}%
                  </span>
                  {tooltip.activity.budget != null &&
                    tooltip.activity.budget > 0 && (
                      <>
                        <span className='text-muted-foreground'>Budget</span>
                        <span className='font-mono font-medium'>
                          ${tooltip.activity.budget.toLocaleString()}
                        </span>
                      </>
                    )}
                </div>
                {/* Status pill */}
                <div className='border-t px-3 py-1.5'>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                      tooltip.activity.isCritical
                        ? 'bg-red-100 text-red-700'
                        : isNearCritical(tooltip.activity)
                          ? 'bg-orange-100 text-orange-700'
                          : tooltip.activity.isMilestone
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {tooltip.activity.isCritical
                      ? 'CRITICAL'
                      : isNearCritical(tooltip.activity)
                        ? 'NEAR-CRITICAL'
                        : tooltip.activity.isMilestone
                          ? 'MILESTONE'
                          : 'NON-CRITICAL'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Context menu ──────────────────────────────────────────────────── */}
        {ctxMenu && canEditActivities && (
          <div
            className='absolute z-50 min-w-44 rounded-lg border bg-popover py-1 shadow-xl'
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className='px-3 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'>
              Actions
            </p>
            {onActivityUpdate && (
              <>
                <button
                  className='flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted'
                  onClick={() => {
                    setEditingId(ctxMenu.id)
                    setCtxMenu(null)
                  }}
                >
                  Edit details
                </button>
                <button
                  className='flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted'
                  onClick={() => handleMilestone(ctxMenu.id)}
                >
                  Mark as milestone
                </button>
              </>
            )}
            {onActivityUpdate && onActivityDelete && (
              <div className='my-1 border-t' />
            )}
            {onActivityDelete && (
              <button
                className='flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50'
                onClick={() => handleDelete(ctxMenu.id)}
              >
                Delete activity
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <div className='flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-2.5'>
        {[
          { color: COLOR.critical, label: 'Critical Path' },
          { color: COLOR.nearCrit, label: 'Near-Critical (TF 1-5d)' },
          { color: COLOR.normal, label: 'Non-Critical' },
          { color: COLOR.milestone, label: 'Milestone' },
          { color: COLOR.float, label: 'Total Float' },
          { color: COLOR.today, label: 'Today' },
          ...(showBaseline
            ? [{ color: COLOR.baseline, label: 'Baseline' }]
            : []),
        ].map(({ color, label }) => (
          <span
            key={label}
            className='flex items-center gap-1.5 text-[11px] text-muted-foreground'
          >
            <span
              style={{
                background: color,
                width: 10,
                height: 10,
                borderRadius: 2,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {label}
          </span>
        ))}
        <span className='ml-auto text-[11px] text-muted-foreground italic'>
          Hover for details
        </span>
      </div>

      {/* ── Edit dialog ─────────────────────────────────────────────────────── */}
      {onActivityUpdate && (
        <ActivityInlineEditDialog
          key={editingActivity?.id ?? 'none'}
          open={!!editingActivity}
          onOpenChange={(open) => {
            if (!open) setEditingId(null)
          }}
          activity={editingActivity}
          activities={displayed}
          onSave={handleDialogSave}
          isSaving={!!savingId}
        />
      )}
    </div>
  )
}
