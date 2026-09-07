import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  GripHorizontal,
  Layers,
  LayoutGrid,
  Maximize2,
  Minimize2,
  RotateCcw,
  Scaling,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type {
  ActivityDependency,
  DependencyRelationship,
  ScheduleActivity,
} from '../data/schema'
import {
  BUILT_IN_LAYOUTS,
  DEFAULT_LAYOUT_ID,
  allLayouts,
  deleteLayout,
  findLayout,
  isSameLayout,
  loadActiveLayoutId,
  saveLayout,
  setActiveLayoutId,
  type GanttLayout,
  type HistogramGroup,
  type NamedLayout,
  type TimeScale,
} from '../lib/gantt-layouts'
import { ActivityInlineEditDialog } from './activity-inline-edit-dialog'
import { ResourcePane } from './resource-histogram'

type GanttActivity = ScheduleActivity & {
  activityCode?: string | null
}

interface Props {
  activities: ScheduleActivity[]
  /** Scopes saved layouts, and loads the resource plan for the histogram. */
  projectId: string
  projectStartDate?: string | null
  projectEndDate?: string | null
  dataDate?: string | null
  onActivityUpdate?: (
    id: string,
    patch: Partial<ScheduleActivity>
  ) => Promise<void>
  onActivityDelete?: (id: string) => Promise<void>
}

type DragState = {
  id: string
  startX: number
  origStart: number
  currentStart: number
}

type ContextMenu = { id: string; x: number; y: number }
type Tooltip = { activity: GanttActivity; x: number; y: number }

type WbsNode = {
  key: string
  code: string
  name: string
  level: number
  children: Map<string, WbsNode>
  activities: GanttActivity[]
  allActivities: GanttActivity[]
  minOrder: number
}

type ActivityRow = {
  type: 'activity'
  id: string
  level: number
  activity: GanttActivity
  activityCode: string
  name: string
  duration: number
  startDate: Date | null
  finishDate: Date | null
  baselineStartDate: Date | null
  baselineFinishDate: Date | null
  pctComplete: number
  isCritical: boolean
  isMilestone: boolean
  totalFloat: number | null
}

type SummaryRow = {
  type: 'summary'
  id: string
  key: string
  level: number
  code: string
  name: string
  expanded: boolean
  activityCount: number
  duration: number
  startDate: Date | null
  finishDate: Date | null
  baselineStartDate: Date | null
  baselineFinishDate: Date | null
  pctComplete: number
  isCritical: boolean
}

type ScheduleRow = ActivityRow | SummaryRow
type IndexedRow = ScheduleRow & { index: number }

type DateTick = {
  key: string
  date: Date
  x: number
  width?: number
}

type TimelineModel = {
  start: Date
  end: Date
  totalDays: number
  width: number
  dataDate: Date
  scale: TimeScale
  monthTicks: DateTick[]
  weekTicks: DateTick[]
  dayTicks: DateTick[]
  weekendBands: DateTick[]
}

type ActivityGeometry = {
  activity: GanttActivity
  row: IndexedRow
  startX: number
  finishX: number
  y: number
}

type Connector = {
  key: string
  path: string
  color: string
  marker: string
}

type ConnectorDependency = Pick<
  ActivityDependency,
  'predecessorId' | 'relationshipType' | 'lagDays'
> & {
  predecessor?: ActivityDependency['predecessor']
}

const ROW_H = 32
const BAR_H = 14
const HEADER_H = 76
const OVERSCAN = 16
// Low enough that "fit to window" can genuinely fit a multi-year programme
// rather than stopping short and leaving the tail off-screen.
const MIN_PX = 1
const MAX_PX = 24
const DEFAULT_SCALE: TimeScale = 'week'
const SCALE_SETTINGS = {
  // bucketDays sizes one histogram column, so it lines up with the minor tick
  // of the timescale above it rather than floating free of the header.
  day: { label: 'Day', pxPerDay: 18, dayStep: 1, weekStep: 1, bucketDays: 1 },
  week: { label: 'Week', pxPerDay: 10, dayStep: 2, weekStep: 1, bucketDays: 7 },
  month: { label: 'Month', pxPerDay: 5, dayStep: 7, weekStep: 1, bucketDays: 7 },
  quarter: {
    label: 'Quarter',
    pxPerDay: 3,
    dayStep: 14,
    weekStep: 4,
    bucketDays: 30,
  },
} satisfies Record<
  TimeScale,
  {
    label: string
    pxPerDay: number
    dayStep: number
    weekStep: number
    bucketDays: number
  }
>
const DEFAULT_PX = SCALE_SETTINGS[DEFAULT_SCALE].pxPerDay
const DAY_MS = 24 * 60 * 60 * 1000

const GRID_COLUMNS = [
  { key: 'id', label: 'Activity ID', width: 120 },
  { key: 'name', label: 'Activity Name', width: 280 },
  { key: 'procurement', label: 'Proc Risk', width: 112 },
  { key: 'duration', label: 'Original Duration', width: 96 },
  { key: 'start', label: 'Start', width: 94 },
  { key: 'finish', label: 'Finish', width: 94 },
  // Total float is how a planner reads criticality at a glance; P6 carries it
  // next to the dates and so should this.
  { key: 'totalFloat', label: 'Total Float', width: 84 },
  { key: 'baselineStart', label: 'BL Project Start', width: 103 },
  { key: 'baselineFinish', label: 'BL Project Finish', width: 103 },
] as const

const GRID_W = GRID_COLUMNS.reduce((sum, column) => sum + column.width, 0)
const GRID_TEMPLATE = GRID_COLUMNS.map((col) => `${col.width}px`).join(' ')
/** How far left the grid/timeline splitter can be dragged. */
const GRID_MIN_W = 220

/** Where the splitter can rest: on a column edge, never through one. */
const GRID_STOPS = GRID_COLUMNS.reduce<number[]>((stops, column) => {
  stops.push((stops[stops.length - 1] ?? 0) + column.width)
  return stops
}, []).filter((stop) => stop >= GRID_MIN_W)

/** Nearest column edge to a dragged position. */
const snapGridWidth = (width: number) =>
  GRID_STOPS.reduce((best, stop) =>
    Math.abs(stop - width) < Math.abs(best - width) ? stop : best
  )

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const COLORS = {
  critical: '#dc2626',
  nearCritical: '#ea580c',
  normal: '#2563eb',
  progress: '#16a34a',
  milestone: '#7c3aed',
  baseline: '#64748b',
  dataDate: '#0284c7',
  connector: '#64748b',
  float: '#14b8a6',
  procurement: '#f97316',
}

const PROCUREMENT_RISK_BADGE = {
  none: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  low: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  medium:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  critical: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
} as const

const CSS = {
  border: 'var(--border)',
  muted: 'var(--muted)',
  mutedFg: 'var(--muted-foreground)',
  fg: 'var(--foreground)',
  card: 'var(--card)',
  background: 'var(--background)',
}

const isNearCritical = (activity: GanttActivity) =>
  !activity.isCritical &&
  !activity.isMilestone &&
  activity.totalFloat != null &&
  activity.totalFloat >= 1 &&
  activity.totalFloat <= 5

const barColor = (activity: GanttActivity) =>
  activity.isMilestone
    ? COLORS.milestone
    : activity.isCritical
      ? COLORS.critical
      : isNearCritical(activity)
        ? COLORS.nearCritical
        : COLORS.normal

const startOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate())

const parseDate = (value?: string | null) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return startOfDay(parsed)
}

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10)

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

const addMonths = (date: Date, months: number) =>
  new Date(date.getFullYear(), date.getMonth() + months, 1)

const diffDays = (start: Date, end: Date) =>
  Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS)

const minDate = (dates: Array<Date | null>) => {
  const valid = dates.filter(Boolean) as Date[]
  if (!valid.length) return null
  return valid.reduce((min, date) => (date < min ? date : min), valid[0])
}

const maxDate = (dates: Array<Date | null>) => {
  const valid = dates.filter(Boolean) as Date[]
  if (!valid.length) return null
  return valid.reduce((max, date) => (date > max ? date : max), valid[0])
}

const startOfWeek = (date: Date) => {
  const day = date.getDay()
  const mondayOffset = (day + 6) % 7
  return addDays(date, -mondayOffset)
}

const endOfWeek = (date: Date) => addDays(startOfWeek(date), 6)

const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1)

const formatGridDate = (date: Date | null) => {
  if (!date) return '-'
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${date.getFullYear()}`
}

const formatMonthLabel = (date: Date) =>
  `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`

const formatWeekLabel = (date: Date) =>
  `${MONTHS_SHORT[date.getMonth()]} ${String(date.getDate()).padStart(2, '0')}`

const formatDayLabel = (date: Date) => String(date.getDate())

const formatCalendarDate = (value?: string | null) =>
  formatGridDate(parseDate(value))

const titleCase = (value: string) =>
  value
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))

const formatProcurementReason = (value?: string | null) =>
  value ? titleCase(value) : 'On Track'

const getProcurementRisk = (activity: GanttActivity) => {
  const risk = activity.procurementRiskSummary
  if (!risk || risk.atRiskCount <= 0) return null
  return risk
}

const getActivityCode = (activity: GanttActivity, index = 0) =>
  activity.activityCode ||
  activity.p6ActivityId ||
  `ACT-${String(index + 1).padStart(4, '0')}`

const formatLagLabel = (lagDays?: number | null) => {
  const lag = Math.round(Number(lagDays) || 0)
  if (lag === 0) return ''
  return lag > 0 ? `+${lag}d` : `${lag}d`
}

const dependencyRef = (dependency: ConnectorDependency) =>
  dependency.predecessor?.activityCode ||
  dependency.predecessor?.p6ActivityId ||
  dependency.predecessorId.slice(0, 8)

const formatDependencyLabel = (dependency: ConnectorDependency) =>
  `${dependencyRef(dependency)} ${dependency.relationshipType}${formatLagLabel(
    dependency.lagDays
  )}`

const formatActivityDependencies = (activity: GanttActivity) => {
  if (activity.dependencies?.length) {
    return activity.dependencies.map(formatDependencyLabel).join(', ')
  }
  return activity.predecessors || '-'
}

const getActivityStart = (activity: GanttActivity, projectStart: Date | null) =>
  parseDate(activity.earlyStartDate) ||
  (projectStart && activity.earlyStart != null
    ? addDays(projectStart, activity.earlyStart)
    : null)

const getActivityFinish = (
  activity: GanttActivity,
  projectStart: Date | null
) =>
  parseDate(activity.earlyFinishDate) ||
  (projectStart && activity.earlyFinish != null
    ? addDays(projectStart, activity.earlyFinish)
    : null) ||
  (projectStart && activity.earlyStart != null
    ? addDays(
        projectStart,
        activity.earlyStart + Math.max(1, activity.duration)
      )
    : null)

const getBaselineStart = (activity: GanttActivity, projectStart: Date | null) =>
  parseDate(activity.baselineStartDate) ||
  (projectStart && activity.baselineStart != null
    ? addDays(projectStart, activity.baselineStart)
    : null)

const getBaselineFinish = (
  activity: GanttActivity,
  projectStart: Date | null
) =>
  parseDate(activity.baselineFinishDate) ||
  (projectStart && activity.baselineFinish != null
    ? addDays(projectStart, activity.baselineFinish)
    : null)

const resolveProjectStart = (
  activities: GanttActivity[],
  projectStartDate?: string | null
) =>
  parseDate(projectStartDate) ||
  minDate(
    activities.flatMap((activity) => [
      parseDate(activity.earlyStartDate),
      parseDate(activity.baselineStartDate),
      parseDate(activity.actualStart),
    ])
  )

const resolveDataDateCandidate = (
  _activities: GanttActivity[],
  dataDate?: string | null
) =>
  parseDate(dataDate) || startOfDay(new Date())

const resolveDisplayDataDate = (
  candidate: Date,
  rangeStart: Date,
  rangeEnd: Date
) => {
  if (candidate >= rangeStart && candidate <= rangeEnd) return candidate

  const today = startOfDay(new Date())
  if (today >= rangeStart && today <= rangeEnd) return today

  const span = Math.max(1, diffDays(rangeStart, rangeEnd))
  return addDays(rangeStart, Math.min(30, Math.floor(span * 0.35)))
}

const wbsSegmentsFor = (activity: GanttActivity) => {
  const rawWbs = activity.wbsCode?.trim()
  if (rawWbs && rawWbs.includes('.')) {
    const parts = rawWbs.split('.').filter(Boolean)
    const summaryParts = parts.length > 1 ? parts.slice(0, -1) : parts
    return summaryParts.map((_, index) => {
      const code = parts.slice(0, index + 1).join('.')
      return { code, name: `WBS ${code}` }
    })
  }

  const category = activity.category?.trim()
  if (category) {
    return [{ code: category, name: titleCase(category) }]
  }

  if (rawWbs) {
    return [{ code: rawWbs, name: `WBS ${rawWbs}` }]
  }

  return [{ code: 'project-work', name: 'Project Work' }]
}

const createWbsNode = (
  key: string,
  code: string,
  name: string,
  level: number
): WbsNode => ({
  key,
  code,
  name,
  level,
  children: new Map(),
  activities: [],
  allActivities: [],
  minOrder: Number.POSITIVE_INFINITY,
})

const sortActivities = (activities: GanttActivity[]) =>
  [...activities].sort((a, b) => {
    const orderDelta = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    if (orderDelta !== 0) return orderDelta
    return (a.earlyStart ?? 0) - (b.earlyStart ?? 0)
  })

const insertActivity = (
  root: WbsNode,
  activity: GanttActivity,
  activityIndex: number
) => {
  const order = activity.sortOrder ?? activityIndex
  const chain = wbsSegmentsFor(activity)
  let node = root

  root.allActivities.push(activity)
  root.minOrder = Math.min(root.minOrder, order)

  chain.forEach((segment, index) => {
    const key = `${node.key}/${segment.code}`
    if (!node.children.has(key)) {
      node.children.set(
        key,
        createWbsNode(key, segment.code, segment.name, index + 1)
      )
    }
    const child = node.children.get(key)
    if (!child) return
    child.allActivities.push(activity)
    child.minOrder = Math.min(child.minOrder, order)
    node = child
  })

  node.activities.push(activity)
}

const buildActivityRow = (
  activity: GanttActivity,
  level: number,
  projectStart: Date | null,
  activityIndex: number
): ActivityRow => ({
  type: 'activity',
  id: `activity:${activity.id}`,
  level,
  activity,
  activityCode: getActivityCode(activity, activityIndex),
  name: activity.name,
  duration: activity.duration,
  startDate: getActivityStart(activity, projectStart),
  finishDate: getActivityFinish(activity, projectStart),
  baselineStartDate: getBaselineStart(activity, projectStart),
  baselineFinishDate: getBaselineFinish(activity, projectStart),
  pctComplete: activity.pctComplete ?? 0,
  isCritical: activity.isCritical,
  isMilestone: activity.isMilestone,
  totalFloat: activity.totalFloat ?? null,
})

const buildSummaryRow = (
  node: WbsNode,
  collapsedRows: Set<string>,
  projectStart: Date | null
): SummaryRow => {
  const starts = node.allActivities.map((activity) =>
    getActivityStart(activity, projectStart)
  )
  const finishes = node.allActivities.map((activity) =>
    getActivityFinish(activity, projectStart)
  )
  const baselineStarts = node.allActivities.map((activity) =>
    getBaselineStart(activity, projectStart)
  )
  const baselineFinishes = node.allActivities.map((activity) =>
    getBaselineFinish(activity, projectStart)
  )
  const pctTotal = node.allActivities.reduce(
    (sum, activity) => sum + (activity.pctComplete ?? 0),
    0
  )
  const id = `summary:${node.key}`

  return {
    type: 'summary',
    id,
    key: node.key,
    level: node.level,
    code: node.code,
    name: node.name,
    expanded: !collapsedRows.has(id),
    activityCount: node.allActivities.length,
    duration: node.allActivities.reduce(
      (sum, activity) => sum + (activity.duration ?? 0),
      0
    ),
    startDate: minDate(starts),
    finishDate: maxDate(finishes),
    baselineStartDate: minDate(baselineStarts),
    baselineFinishDate: maxDate(baselineFinishes),
    pctComplete: node.allActivities.length
      ? Math.round(pctTotal / node.allActivities.length)
      : 0,
    isCritical: node.allActivities.some(
      (activity) => activity.isCritical && !activity.isMilestone
    ),
  }
}

const buildRows = (
  activities: GanttActivity[],
  collapsedRows: Set<string>,
  projectStart: Date | null
) => {
  const sortedActivities = sortActivities(activities)
  const root = createWbsNode('root', 'PROJECT', 'Project Schedule', 0)

  sortedActivities.forEach((activity, index) =>
    insertActivity(root, activity, index)
  )

  const rows: ScheduleRow[] = []
  const activityIndex = new Map<string, number>()
  sortedActivities.forEach((activity, index) =>
    activityIndex.set(activity.id, index)
  )

  const visit = (node: WbsNode) => {
    const summary = buildSummaryRow(node, collapsedRows, projectStart)
    rows.push(summary)
    if (!summary.expanded) return

    const children = [...node.children.values()].sort(
      (a, b) => a.minOrder - b.minOrder
    )
    children.forEach(visit)

    sortActivities(node.activities).forEach((activity) => {
      rows.push(
        buildActivityRow(
          activity,
          node.level + 1,
          projectStart,
          activityIndex.get(activity.id) ?? 0
        )
      )
    })
  }

  visit(root)

  return rows
}

const buildTicks = (
  start: Date,
  end: Date,
  pxPerDay: number,
  width: number,
  scale: TimeScale
) => {
  const settings = SCALE_SETTINGS[scale]
  const monthTicks: DateTick[] = []
  for (let date = startOfMonth(start); date <= end; date = addMonths(date, 1)) {
    const next = addMonths(date, 1)
    const x = Math.max(0, diffDays(start, date) * pxPerDay)
    const x2 = Math.min(width, diffDays(start, next) * pxPerDay)
    monthTicks.push({
      key: `month:${date.getFullYear()}-${date.getMonth()}`,
      date,
      x,
      width: Math.max(1, x2 - x),
    })
  }

  const weekTicks: DateTick[] = []
  for (
    let date = startOfWeek(start);
    date <= end;
    date = addDays(date, 7 * settings.weekStep)
  ) {
    const x = Math.max(0, diffDays(start, date) * pxPerDay)
    weekTicks.push({ key: `week:${toIsoDate(date)}`, date, x })
  }

  const dayTicks: DateTick[] = []
  for (let date = start; date <= end; date = addDays(date, settings.dayStep)) {
    dayTicks.push({
      key: `day:${toIsoDate(date)}`,
      date,
      x: diffDays(start, date) * pxPerDay,
    })
  }

  const weekendBands: DateTick[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (date.getDay() === 0 || date.getDay() === 6) {
      weekendBands.push({
        key: `weekend:${toIsoDate(date)}`,
        date,
        x: diffDays(start, date) * pxPerDay,
        width: pxPerDay,
      })
    }
  }

  return { monthTicks, weekTicks, dayTicks, weekendBands }
}

const buildTimeline = (
  activities: GanttActivity[],
  projectStart: Date | null,
  projectEndDate: string | null | undefined,
  dataDateCandidate: Date,
  pxPerDay: number,
  scale: TimeScale
): TimelineModel => {
  const starts = activities.flatMap((activity) => [
    getActivityStart(activity, projectStart),
    getBaselineStart(activity, projectStart),
  ])
  const finishes = activities.flatMap((activity) => [
    getActivityFinish(activity, projectStart),
    getBaselineFinish(activity, projectStart),
  ])
  const rangeStart =
    minDate([projectStart, ...starts]) || startOfDay(new Date())
  const rangeFinish =
    maxDate([parseDate(projectEndDate), ...finishes]) || addDays(rangeStart, 90)
  const displayDataDate = resolveDisplayDataDate(
    dataDateCandidate,
    rangeStart,
    rangeFinish
  )
  const start = startOfWeek(
    addDays(minDate([rangeStart, displayDataDate]) || rangeStart, -3)
  )
  const finishBase = maxDate([rangeFinish, displayDataDate]) || rangeFinish
  let end = endOfWeek(addDays(finishBase, 14))

  if (diffDays(start, end) < 45) {
    end = addDays(start, 60)
  }

  const totalDays = Math.max(1, diffDays(start, end) + 1)
  // A modest floor only, so it never collapses to nothing — a large floor
  // would stop "fit to window" from ever actually fitting.
  const width = Math.max(320, totalDays * pxPerDay)
  return {
    start,
    end,
    totalDays,
    width,
    dataDate: displayDataDate,
    scale,
    ...buildTicks(start, end, pxPerDay, width, scale),
  }
}

const dateToX = (
  timeline: TimelineModel,
  date: Date | null,
  pxPerDay: number
) => (date ? diffDays(timeline.start, date) * pxPerDay : 0)

const getBarWidth = (
  start: Date | null,
  finish: Date | null,
  pxPerDay: number,
  fallbackDuration = 1
) => {
  if (start && finish) {
    return Math.max(8, (diffDays(start, finish) + 1) * pxPerDay)
  }
  return Math.max(8, Math.max(1, fallbackDuration) * pxPerDay)
}

const parsePredecessorRefs = (activity: GanttActivity) =>
  (activity.predecessors ?? '')
    .split(',')
    .map((raw) => raw.trim().split(/\s+/)[0])
    .filter(Boolean)

const endpointX = (geometry: ActivityGeometry, side: 'start' | 'finish') =>
  side === 'start' ? geometry.startX : geometry.finishX

const relationshipSides = (
  relationship: DependencyRelationship
): { predecessor: 'start' | 'finish'; successor: 'start' | 'finish' } => {
  if (relationship === 'SS') return { predecessor: 'start', successor: 'start' }
  if (relationship === 'FF')
    return { predecessor: 'finish', successor: 'finish' }
  if (relationship === 'SF')
    return { predecessor: 'start', successor: 'finish' }
  return { predecessor: 'finish', successor: 'start' }
}

const connectorPath = (x1: number, y1: number, x2: number, y2: number) => {
  const runout = x2 >= x1 ? 14 : -14
  const mid = x2 >= x1 ? Math.max(x1 + runout, (x1 + x2) / 2) : x1 + runout
  return `M${x1},${y1} H${mid} V${y2} H${x2}`
}

const buildConnectors = (geometries: ActivityGeometry[]) => {
  const byRef = new Map<string, ActivityGeometry>()
  geometries.forEach((geometry) => {
    const activity = geometry.activity
    ;[
      activity.id,
      activity.activityCode,
      activity.p6ActivityId,
      activity.wbsCode,
    ].forEach((ref) => {
      if (ref) byRef.set(ref, geometry)
    })
  })

  const connectors: Connector[] = []
  geometries.forEach((successorGeometry) => {
    const successor = successorGeometry.activity
    const structured = successor.dependencies ?? []
    const refs: ConnectorDependency[] =
      structured.length > 0
        ? structured
        : parsePredecessorRefs(successor).map(
            (ref): ConnectorDependency => ({
              predecessorId: ref,
              relationshipType: 'FS',
              lagDays: 0,
            })
          )

    refs.forEach((dependency, index) => {
      const predecessorGeometry =
        byRef.get(dependency.predecessorId) ||
        byRef.get(dependency.predecessor?.activityCode ?? '') ||
        byRef.get(dependency.predecessor?.p6ActivityId ?? '') ||
        byRef.get(dependency.predecessor?.wbsCode ?? '')
      if (!predecessorGeometry) return

      const sides = relationshipSides(dependency.relationshipType)
      const x1 = endpointX(predecessorGeometry, sides.predecessor)
      const x2 = endpointX(successorGeometry, sides.successor)
      const y1 = predecessorGeometry.y
      const y2 = successorGeometry.y
      const critical =
        predecessorGeometry.activity.isCritical && successor.isCritical

      connectors.push({
        key: `${predecessorGeometry.activity.id}:${successor.id}:${index}`,
        path: connectorPath(x1, y1, x2, y2),
        color: critical ? COLORS.critical : COLORS.connector,
        marker: critical ? 'url(#arrow-critical)' : 'url(#arrow-normal)',
      })
    })
  })

  return connectors
}

export function GanttChart({
  activities,
  projectId,
  projectStartDate,
  projectEndDate,
  dataDate,
  onActivityUpdate,
  onActivityDelete,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [localOverrides, setLocalOverrides] = useState<
    Record<string, { earlyStart: number }>
  >({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showBaseline, setShowBaseline] = useState(true)
  const [timeScale, setTimeScale] = useState<TimeScale>(DEFAULT_SCALE)
  const [pxPerDay, setPxPerDay] = useState(DEFAULT_PX)
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(
    () => new Set()
  )
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(640)
  const [fullscreen, setFullscreen] = useState(false)
  // The grid/timeline splitter, as in P6: dragging it left hides the trailing
  // columns and hands the space to the bars.
  const [gridWidth, setGridWidth] = useState(GRID_W)
  const splitDrag = useRef<{ startX: number; startWidth: number } | null>(null)
  const splitInitialised = useRef(false)
  const [showHistogram, setShowHistogram] = useState(false)
  const [histogramGroup, setHistogramGroup] = useState<HistogramGroup>('type')
  const [layouts, setLayouts] = useState<NamedLayout[]>(BUILT_IN_LAYOUTS)
  const [activeLayoutId, setActiveLayout] = useState(DEFAULT_LAYOUT_ID)
  const canEditActivities = Boolean(onActivityUpdate || onActivityDelete)
  const sourceActivities = activities as GanttActivity[]
  const dataDateMissing = !parseDate(dataDate)

  const projectStart = useMemo(
    () => resolveProjectStart(sourceActivities, projectStartDate),
    [projectStartDate, sourceActivities]
  )

  const displayed = useMemo(
    () =>
      sourceActivities.map((activity) => {
        const override = localOverrides[activity.id]
        if (!override) return activity

        const earlyStart = override.earlyStart
        const earlyFinish = earlyStart + (activity.duration || 0)
        return {
          ...activity,
          earlyStart,
          earlyFinish,
          earlyStartDate: projectStart
            ? toIsoDate(addDays(projectStart, earlyStart))
            : activity.earlyStartDate,
          earlyFinishDate: projectStart
            ? toIsoDate(addDays(projectStart, earlyFinish))
            : activity.earlyFinishDate,
        }
      }),
    [localOverrides, projectStart, sourceActivities]
  )

  const dataDateCandidate = useMemo(
    () => resolveDataDateCandidate(displayed, dataDate),
    [dataDate, displayed]
  )

  const rows = useMemo(
    () => buildRows(displayed, collapsedRows, projectStart),
    [collapsedRows, displayed, projectStart]
  )

  const timeline = useMemo(
    () =>
      buildTimeline(
        displayed,
        projectStart,
        projectEndDate,
        dataDateCandidate,
        pxPerDay,
        timeScale
      ),
    [
      dataDateCandidate,
      displayed,
      projectEndDate,
      projectStart,
      pxPerDay,
      timeScale,
    ]
  )

  const totalHeight = rows.length * ROW_H
  const contentWidth = gridWidth + timeline.width

  const visibleRows = useMemo(() => {
    const bodyTop = Math.max(0, scrollTop - HEADER_H)
    const first = Math.max(0, Math.floor(bodyTop / ROW_H) - OVERSCAN)
    const last = Math.min(
      rows.length,
      Math.ceil((bodyTop + viewportHeight) / ROW_H) + OVERSCAN
    )

    return rows
      .slice(first, last)
      .map((row, offset) => ({ ...row, index: first + offset }))
  }, [rows, scrollTop, viewportHeight])

  const editingActivity = useMemo(
    () =>
      editingId ? (displayed.find((a) => a.id === editingId) ?? null) : null,
    [displayed, editingId]
  )

  // Every activity with its dates, not just the rows currently on screen: the
  // histogram is a picture of the whole project, and it must not change shape
  // as you scroll.
  const histogramActivities = useMemo(
    () =>
      displayed.map((activity) => ({
        id: activity.id,
        start: getActivityStart(activity, projectStart),
        finish: getActivityFinish(activity, projectStart),
      })),
    [displayed, projectStart]
  )

  const nCritical = displayed.filter(
    (activity) => activity.isCritical && !activity.isMilestone
  ).length
  const nNearCritical = displayed.filter(isNearCritical).length
  const nMilestone = displayed.filter((activity) => activity.isMilestone).length

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const update = () => {
      setViewportHeight(element.clientHeight || 640)

      // The bars are the point of a Gantt chart. If the full column set would
      // leave them a sliver, start with the splitter closed far enough that
      // most of the width belongs to the timeline — the same balance P6 opens
      // with. Only once, so a width the planner chose is never overridden.
      if (!splitInitialised.current && element.clientWidth > 0) {
        splitInitialised.current = true
        const budget = element.clientWidth * 0.6
        if (GRID_W > budget) {
          // Land on a column edge, and never past the budget — a snap that
          // rounded up would put the bars back in a sliver.
          const fits = GRID_STOPS.filter((stop) => stop <= budget)
          setGridWidth(fits.length ? fits[fits.length - 1] : GRID_STOPS[0])
        }
      }
    }
    update()

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  // Escape leaves full screen, which is what anyone who has used a maximised
  // view expects — and the only way out if the toolbar scrolls away.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    // The page behind must not scroll while the chart owns the window.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen])

  /** Drags the splitter between the activity table and the bars. */
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = splitDrag.current
      if (!drag) return
      const next = drag.startWidth + (event.clientX - drag.startX)
      // Snap to a column edge so a column is never cut down the middle.
      setGridWidth(snapGridWidth(Math.min(GRID_W, Math.max(GRID_MIN_W, next))))
    }
    const onUp = () => {
      splitDrag.current = null
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  /** The current arrangement, in the shape a saved layout stores. */
  const currentLayout = (): GanttLayout => ({
    timeScale,
    pxPerDay,
    gridWidth,
    showBaseline,
    showHistogram,
    histogramGroup,
    collapsed: [...collapsedRows],
  })

  const applyLayout = (entry: NamedLayout) => {
    const { layout } = entry
    setTimeScale(layout.timeScale)
    setPxPerDay(layout.pxPerDay)
    setShowBaseline(layout.showBaseline)
    setShowHistogram(layout.showHistogram)
    setHistogramGroup(layout.histogramGroup)
    setCollapsedRows(new Set(layout.collapsed))
    if (layout.gridWidth != null) {
      setGridWidth(Math.min(GRID_W, Math.max(GRID_MIN_W, layout.gridWidth)))
      // A layout that names a width owns it; do not let the first measure of
      // the viewport overwrite what the planner saved.
      splitInitialised.current = true
    }
    setActiveLayout(entry.id)
    setActiveLayoutId(projectId, entry.id)
  }

  // Restore the layout this project was last left in.
  useEffect(() => {
    if (!projectId) return
    const available = allLayouts(projectId)
    setLayouts(available)
    const wanted = loadActiveLayoutId(projectId)
    const entry = available.find((item) => item.id === wanted)
    if (!entry || entry.id === DEFAULT_LAYOUT_ID) {
      setActiveLayout(entry?.id ?? DEFAULT_LAYOUT_ID)
      return
    }
    applyLayout(entry)
    // Applying once on mount is the point; re-running would fight the planner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const handleSaveLayout = () => {
    const suggestion =
      layouts.find((entry) => entry.id === activeLayoutId && !entry.builtIn)?.name ?? ''
    const name = window.prompt('Save this layout as', suggestion)
    if (name == null) return

    const saved = saveLayout(projectId, name, currentLayout())
    if (!saved) {
      toast.error(
        name.trim()
          ? 'This browser would not store the layout.'
          : 'Give the layout a name.'
      )
      return
    }
    setLayouts(allLayouts(projectId))
    setActiveLayout(saved.id)
    setActiveLayoutId(projectId, saved.id)
    toast.success(`Layout "${saved.name}" saved`)
  }

  const handleDeleteLayout = (entry: NamedLayout) => {
    deleteLayout(projectId, entry.id)
    setLayouts(allLayouts(projectId))
    if (activeLayoutId === entry.id) {
      const fallback = findLayout(projectId, DEFAULT_LAYOUT_ID)
      if (fallback) applyLayout(fallback)
    }
    toast.success(`Layout "${entry.name}" deleted`)
  }

  const activeLayout = layouts.find((entry) => entry.id === activeLayoutId)
  const activeLayoutName = activeLayout?.name ?? 'Layout'
  // Say when the view has drifted from the layout it was opened from, so the
  // name in the toolbar never claims something that is no longer true.
  const layoutModified = activeLayout
    ? !isSameLayout(activeLayout.layout, currentLayout())
    : false

  /** Scales the timeline so the whole project fits the visible width. */
  const fitToWindow = () => {
    const element = viewportRef.current
    if (!element) return
    const available = element.clientWidth - gridWidth - 24
    if (available <= 0) return
    const next = available / Math.max(1, timeline.totalDays)
    setPxPerDay(Math.min(MAX_PX, Math.max(MIN_PX, Math.round(next * 10) / 10)))
  }

  const commitDrag = async (state: DragState) => {
    if (!onActivityUpdate || state.currentStart === state.origStart) return
    const base = sourceActivities.find((activity) => activity.id === state.id)
    if (!base) return

    setSavingId(state.id)
    try {
      await onActivityUpdate(state.id, {
        earlyStart: state.currentStart,
        earlyFinish: state.currentStart + (base.duration || 0),
      })
      setLocalOverrides((prev) => {
        const next = { ...prev }
        delete next[state.id]
        return next
      })
    } catch {
      toast.error('Failed to update activity')
    } finally {
      setSavingId(null)
    }
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging || !editMode) return
    const deltaDays = Math.round((event.clientX - dragging.startX) / pxPerDay)
    const nextStart = Math.max(0, dragging.origStart + deltaDays)
    setDragging((prev) => (prev ? { ...prev, currentStart: nextStart } : prev))
    setLocalOverrides((prev) => ({
      ...prev,
      [dragging.id]: { earlyStart: nextStart },
    }))
  }

  const handleMouseUp = async () => {
    if (!dragging) return
    const state = dragging
    setDragging(null)
    await commitDrag(state)
  }

  const openContextMenu = (
    event: React.MouseEvent,
    activity: GanttActivity
  ) => {
    if (!editMode || !canEditActivities) return
    event.preventDefault()
    const rect = viewportRef.current?.getBoundingClientRect()
    setSelectedRowId(`activity:${activity.id}`)
    setCtxMenu({
      id: activity.id,
      x: event.clientX - (rect?.left ?? 0) + scrollLeft,
      y: event.clientY - (rect?.top ?? 0) + scrollTop,
    })
  }

  const showTooltip = (
    event: React.MouseEvent<SVGElement>,
    activity: GanttActivity
  ) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({
      activity,
      x: event.clientX - rect.left + scrollLeft + 12,
      y: event.clientY - rect.top + scrollTop - 8,
    })
  }

  const handleMilestone = async (id: string) => {
    if (!onActivityUpdate) return
    setSavingId(id)
    try {
      await onActivityUpdate(id, { isMilestone: true })
    } catch {
      toast.error('Failed to update activity')
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
      toast.error('Failed to delete activity')
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
      toast.error('Failed to save activity')
    } finally {
      setSavingId(null)
    }
  }

  const toggleSummaryRow = (rowId: string) => {
    setCollapsedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  if (displayed.length === 0) {
    return (
      <div className='flex items-center justify-center rounded-md border bg-card py-16 text-sm text-muted-foreground'>
        No activities to display.
      </div>
    )
  }

  return (
    <div
      data-testid='primavera-gantt'
      data-fullscreen={fullscreen ? 'true' : 'false'}
      className={cn(
        'space-y-3',
        // Full screen is the working mode: the whole window, nothing else.
        fullscreen &&
          'fixed inset-0 z-50 flex flex-col overflow-hidden bg-background p-3'
      )}
    >
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2'>
        <div className='flex flex-wrap items-center gap-2'>
          {canEditActivities && (
            <Button
              size='sm'
              variant={editMode ? 'default' : 'outline'}
              onClick={() => {
                setEditMode((prev) => !prev)
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
            onClick={() => setShowBaseline((prev) => !prev)}
          >
            <Layers className='mr-1.5 h-3.5 w-3.5' />
            Baseline
          </Button>
          <Button
            size='sm'
            variant={showHistogram ? 'secondary' : 'outline'}
            onClick={() => setShowHistogram((prev) => !prev)}
            aria-pressed={showHistogram}
            data-testid='primavera-gantt-resources'
          >
            <BarChart3 className='mr-1.5 h-3.5 w-3.5' />
            Resources
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size='sm'
                variant='outline'
                data-testid='primavera-gantt-layouts'
              >
                <LayoutGrid className='mr-1.5 h-3.5 w-3.5' />
                <span className='max-w-32 truncate'>{activeLayoutName}</span>
                {layoutModified && (
                  <span
                    className='ms-1 text-interactive'
                    title='Changed since this layout was applied'
                    data-testid='primavera-gantt-layout-modified'
                  >
                    •
                  </span>
                )}
                <ChevronDown className='ml-1 h-3.5 w-3.5 opacity-60' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='w-64'>
              <DropdownMenuLabel className='text-xs text-muted-foreground'>
                Layouts
              </DropdownMenuLabel>
              {layouts.map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  onClick={() => applyLayout(entry)}
                  data-testid={`primavera-gantt-layout-${entry.id}`}
                  className='group'
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5',
                      entry.id === activeLayoutId ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className='flex-1 truncate'>{entry.name}</span>
                  {!entry.builtIn && (
                    <button
                      type='button'
                      aria-label={`Delete layout ${entry.name}`}
                      className='opacity-0 transition-opacity group-hover:opacity-100 hover:text-error'
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        handleDeleteLayout(entry)
                      }}
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                    </button>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSaveLayout}
                data-testid='primavera-gantt-layout-save'
              >
                Save this layout as…
              </DropdownMenuItem>
              <p className='px-2 py-1.5 text-[11px] leading-snug text-muted-foreground'>
                Saved layouts are kept in this browser, for this project.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className='flex items-center gap-1 rounded-md border bg-muted/30 p-1'>
            {(Object.keys(SCALE_SETTINGS) as TimeScale[]).map((scale) => (
              <Button
                key={scale}
                type='button'
                size='sm'
                variant={timeScale === scale ? 'secondary' : 'ghost'}
                className='h-7 px-2 text-xs'
                onClick={() => {
                  setTimeScale(scale)
                  setPxPerDay(SCALE_SETTINGS[scale].pxPerDay)
                }}
              >
                {SCALE_SETTINGS[scale].label}
              </Button>
            ))}
          </div>
          {dataDateMissing && (
            <span className='inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300'>
              <AlertTriangle className='h-3.5 w-3.5' />
              Data date not set; using today
            </span>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-1.5'>
          {[
            { label: 'Activities', value: displayed.length, className: '' },
            { label: 'Critical', value: nCritical, className: 'text-red-600' },
            {
              label: 'Near Crit',
              value: nNearCritical,
              className: 'text-orange-600',
            },
            {
              label: 'Milestones',
              value: nMilestone,
              className: 'text-purple-600',
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className='min-w-20 rounded-md border bg-muted/25 px-2 py-1 text-center'
            >
              <div
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  stat.className
                )}
              >
                {stat.value}
              </div>
              <div className='text-[10px] text-muted-foreground'>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        <div className='flex items-center gap-1 rounded-md border bg-muted/30 p-1'>
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            disabled={pxPerDay <= MIN_PX}
            onClick={() => setPxPerDay((value) => Math.max(MIN_PX, value - 1))}
            aria-label='Zoom out'
            title='Zoom out'
          >
            <ZoomOut className='h-3.5 w-3.5' />
          </Button>
          <span className='w-16 text-center font-mono text-[11px] text-muted-foreground'>
            {pxPerDay}px/day
          </span>
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            disabled={pxPerDay >= MAX_PX}
            onClick={() => setPxPerDay((value) => Math.min(MAX_PX, value + 1))}
            aria-label='Zoom in'
            title='Zoom in'
          >
            <ZoomIn className='h-3.5 w-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            onClick={fitToWindow}
            aria-label='Fit the schedule to the window'
            title='Fit to window'
            data-testid='primavera-gantt-fit'
          >
            <Scaling className='h-3.5 w-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            onClick={() => {
              setTimeScale(DEFAULT_SCALE)
              setPxPerDay(DEFAULT_PX)
              setGridWidth(GRID_W)
            }}
            aria-label='Reset zoom'
            title='Reset zoom'
          >
            <RotateCcw className='h-3.5 w-3.5' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            onClick={() => setFullscreen((value) => !value)}
            aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
            aria-pressed={fullscreen}
            title={fullscreen ? 'Leave full screen (Esc)' : 'Full screen'}
            data-testid='primavera-gantt-fullscreen'
          >
            {fullscreen ? (
              <Minimize2 className='h-3.5 w-3.5' />
            ) : (
              <Maximize2 className='h-3.5 w-3.5' />
            )}
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        data-testid='primavera-gantt-viewport'
        className={cn(
          'relative overflow-auto rounded-md border bg-card shadow-sm',
          fullscreen && 'min-h-0 flex-1'
        )}
        style={
          fullscreen
            ? undefined
            : // Grow with the window rather than stopping at a fixed height:
              // a planner reading a schedule wants the rows, not the whitespace
              // under them.
              { maxHeight: 'clamp(420px, calc(100vh - 260px), 1200px)' }
        }
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop)
          setScrollLeft(event.currentTarget.scrollLeft)
          setCtxMenu(null)
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          void handleMouseUp()
          setTooltip(null)
        }}
        onClick={() => setCtxMenu(null)}
      >
        <div
          className='relative flex'
          style={{
            minWidth: contentWidth,
            height: HEADER_H + totalHeight,
          }}
        >
          <ScheduleGrid
            rows={visibleRows}
            totalHeight={totalHeight}
            width={gridWidth}
            onSplitStart={(event) => {
              splitDrag.current = {
                startX: event.clientX,
                startWidth: gridWidth,
              }
              document.body.style.userSelect = 'none'
            }}
            hoveredRowId={hoveredRowId}
            selectedRowId={selectedRowId}
            savingId={savingId}
            canEditActivities={canEditActivities}
            onHover={setHoveredRowId}
            onSelect={setSelectedRowId}
            onToggleSummary={toggleSummaryRow}
            onEditActivity={setEditingId}
            onContextMenu={openContextMenu}
          />

          <div
            className='relative shrink-0'
            style={{ width: timeline.width, height: HEADER_H + totalHeight }}
          >
            <TimelineHeader timeline={timeline} pxPerDay={pxPerDay} />
            <GanttCanvas
              rows={visibleRows}
              totalHeight={totalHeight}
              timeline={timeline}
              pxPerDay={pxPerDay}
              showBaseline={showBaseline}
              hoveredRowId={hoveredRowId}
              selectedRowId={selectedRowId}
              savingId={savingId}
              editMode={editMode}
              canUpdateActivities={Boolean(onActivityUpdate)}
              draggingId={dragging?.id ?? null}
              onHover={setHoveredRowId}
              onSelect={setSelectedRowId}
              onTooltip={showTooltip}
              onContextMenu={openContextMenu}
              onDragStart={(event, activity) => {
                if (!editMode || !onActivityUpdate || activity.isMilestone) {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                setSelectedRowId(`activity:${activity.id}`)
                setDragging({
                  id: activity.id,
                  startX: event.clientX,
                  origStart: activity.earlyStart ?? 0,
                  currentStart: activity.earlyStart ?? 0,
                })
              }}
            />
          </div>
        </div>

        {tooltip && !dragging && (
          <ActivityTooltip
            tooltip={tooltip}
            chartWidth={timeline.width}
            scrollLeft={scrollLeft}
            viewportWidth={viewportRef.current?.clientWidth ?? 900}
          />
        )}

        {ctxMenu && canEditActivities && (
          <div
            className='absolute z-50 min-w-44 rounded-md border bg-popover py-1 text-popover-foreground shadow-xl'
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
            onClick={(event) => event.stopPropagation()}
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
                className='flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30'
                onClick={() => handleDelete(ctxMenu.id)}
              >
                Delete activity
              </button>
            )}
          </div>
        )}
      </div>

      {/*
       * The resource pane, under the bars and pinned there — the way P6 keeps
       * its histogram in a bottom pane. It scrolls sideways with the timeline
       * but not up and down with the rows, so the demand profile stays in view
       * while you read the schedule above it.
       */}
      {showHistogram && (
        <ResourcePane
          projectId={projectId}
          activities={histogramActivities}
          timelineStart={timeline.start}
          totalDays={timeline.totalDays}
          width={timeline.width}
          pxPerDay={pxPerDay}
          bucketDays={SCALE_SETTINGS[timeScale].bucketDays}
          legendWidth={gridWidth}
          group={histogramGroup}
          onGroupChange={setHistogramGroup}
          scrollLeft={scrollLeft}
        />
      )}

      <GanttLegend showBaseline={showBaseline} dataDate={timeline.dataDate} />

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

function ScheduleGrid({
  rows,
  totalHeight,
  width,
  onSplitStart,
  hoveredRowId,
  selectedRowId,
  savingId,
  canEditActivities,
  onHover,
  onSelect,
  onToggleSummary,
  onEditActivity,
  onContextMenu,
}: {
  rows: IndexedRow[]
  totalHeight: number
  width: number
  onSplitStart: (event: React.MouseEvent) => void
  hoveredRowId: string | null
  selectedRowId: string | null
  savingId: string | null
  canEditActivities: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onToggleSummary: (id: string) => void
  onEditActivity: (id: string) => void
  onContextMenu: (event: React.MouseEvent, activity: GanttActivity) => void
}) {
  return (
    <div
      data-testid='primavera-gantt-grid'
      // Clipped, not shrunk: dragging the splitter left hides the trailing
      // columns whole rather than squeezing every column illegibly narrow.
      className='sticky left-0 z-30 shrink-0 overflow-hidden border-r bg-card shadow-[8px_0_18px_rgba(15,23,42,0.08)]'
      style={{ width, height: HEADER_H + totalHeight }}
    >
      <div
        className='sticky top-0 z-40 grid border-b bg-muted/70 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur'
        style={{
          gridTemplateColumns: GRID_TEMPLATE,
          height: HEADER_H,
          width: GRID_W,
        }}
      >
        {GRID_COLUMNS.map((column) => (
          <div
            key={column.key}
            className='flex items-end border-r px-2 pb-2 last:border-r-0'
          >
            {column.label}
          </div>
        ))}
      </div>

      <div className='relative' style={{ height: totalHeight }}>
        {rows.map((row) => (
          <ScheduleGridRow
            key={row.id}
            row={row}
            hovered={hoveredRowId === row.id}
            selected={selectedRowId === row.id}
            saving={row.type === 'activity' && savingId === row.activity.id}
            canEditActivities={canEditActivities}
            onHover={onHover}
            onSelect={onSelect}
            onToggleSummary={onToggleSummary}
            onEditActivity={onEditActivity}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>

      {/* The splitter. Sticky so it stays reachable however far down you are. */}
      <div
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize the activity table'
        data-testid='primavera-gantt-splitter'
        onMouseDown={onSplitStart}
        className='group sticky top-0 z-50 float-right h-full w-2 cursor-col-resize'
        style={{ marginTop: -(HEADER_H + totalHeight), marginRight: -2 }}
      >
        <div className='mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-interactive' />
      </div>
    </div>
  )
}

function ScheduleGridRow({
  row,
  hovered,
  selected,
  saving,
  canEditActivities,
  onHover,
  onSelect,
  onToggleSummary,
  onEditActivity,
  onContextMenu,
}: {
  row: IndexedRow
  hovered: boolean
  selected: boolean
  saving: boolean
  canEditActivities: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onToggleSummary: (id: string) => void
  onEditActivity: (id: string) => void
  onContextMenu: (event: React.MouseEvent, activity: GanttActivity) => void
}) {
  const rowClass = cn(
    'absolute left-0 grid border-b text-xs transition-colors',
    row.type === 'summary'
      ? 'bg-muted/55 font-semibold text-foreground'
      : row.index % 2 === 0
        ? 'bg-card'
        : 'bg-muted/15',
    hovered && 'bg-blue-50 dark:bg-blue-950/25',
    selected && 'bg-amber-50 dark:bg-amber-950/25'
  )

  return (
    <div
      className={rowClass}
      style={{
        top: row.index * ROW_H,
        height: ROW_H,
        width: GRID_W,
        gridTemplateColumns: GRID_TEMPLATE,
      }}
      onMouseEnter={() => onHover(row.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => {
        if (row.type === 'activity' && canEditActivities) {
          onEditActivity(row.activity.id)
        }
      }}
      onContextMenu={(event) => {
        if (row.type === 'activity') onContextMenu(event, row.activity)
      }}
    >
      <GridCell className='font-mono text-[11px] text-muted-foreground'>
        {row.type === 'summary' ? row.code : row.activityCode}
      </GridCell>
      <GridCell>
        <div
          className='flex min-w-0 items-center gap-1.5'
          style={{ paddingLeft: Math.min(row.level * 16, 64) }}
        >
          {row.type === 'summary' ? (
            <button
              type='button'
              className='flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-background'
              onClick={(event) => {
                event.stopPropagation()
                onToggleSummary(row.id)
              }}
              aria-label={row.expanded ? 'Collapse WBS row' : 'Expand WBS row'}
              title={row.expanded ? 'Collapse WBS row' : 'Expand WBS row'}
            >
              {row.expanded ? (
                <ChevronDown className='h-3.5 w-3.5' />
              ) : (
                <ChevronRight className='h-3.5 w-3.5' />
              )}
            </button>
          ) : (
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-sm',
                row.isMilestone
                  ? 'rotate-45 bg-purple-600'
                  : row.isCritical
                    ? 'bg-red-600'
                    : isNearCritical(row.activity)
                      ? 'bg-orange-500'
                      : 'bg-blue-600'
              )}
            />
          )}
          <span className='truncate' title={row.name}>
            {row.name}
          </span>
          {row.type === 'summary' && (
            <span className='ml-auto shrink-0 font-mono text-[10px] text-muted-foreground'>
              {row.activityCount}
            </span>
          )}
          {saving && (
            <span className='font-mono text-[10px] text-muted-foreground'>
              ...
            </span>
          )}
        </div>
      </GridCell>
      <GridCell>
        {row.type === 'activity' && getProcurementRisk(row.activity) ? (
          <span
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              PROCUREMENT_RISK_BADGE[
                getProcurementRisk(row.activity)?.highestSeverity ?? 'none'
              ]
            )}
            title={formatProcurementReason(
              getProcurementRisk(row.activity)?.reason
            )}
          >
            <AlertTriangle className='h-3 w-3 shrink-0' />
            <span className='truncate'>
              {getProcurementRisk(row.activity)?.highestSeverity}
              {getProcurementRisk(row.activity)?.atRiskCount
                ? ` (${getProcurementRisk(row.activity)?.atRiskCount})`
                : ''}
            </span>
          </span>
        ) : (
          <span className='text-[10px] text-muted-foreground'>-</span>
        )}
      </GridCell>
      <GridCell className='justify-end font-mono text-[11px]'>
        {row.duration}d
      </GridCell>
      <GridCell className='font-mono text-[11px]'>
        {formatGridDate(row.startDate)}
      </GridCell>
      <GridCell className='font-mono text-[11px]'>
        {formatGridDate(row.finishDate)}
      </GridCell>
      <GridCell
        className={cn(
          'justify-end font-mono text-[11px]',
          // Zero float is the critical path; negative float is a schedule that
          // no longer works. Both are read at a glance, so colour them.
          row.type === 'activity' &&
            row.totalFloat != null &&
            row.totalFloat < 0 &&
            'font-semibold text-error',
          row.type === 'activity' &&
            row.totalFloat === 0 &&
            'font-semibold text-error'
        )}
      >
        {row.type === 'activity' && row.totalFloat != null
          ? `${row.totalFloat}d`
          : '-'}
      </GridCell>
      <GridCell className='font-mono text-[11px] text-muted-foreground'>
        {formatGridDate(row.baselineStartDate)}
      </GridCell>
      <GridCell className='font-mono text-[11px] text-muted-foreground'>
        {formatGridDate(row.baselineFinishDate)}
      </GridCell>
    </div>
  )
}

function GridCell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center border-r px-2 last:border-r-0',
        className
      )}
    >
      {children}
    </div>
  )
}

function TimelineHeader({
  timeline,
  pxPerDay,
}: {
  timeline: TimelineModel
  pxPerDay: number
}) {
  return (
    <div
      data-testid='primavera-gantt-timeline-header'
      className='sticky top-0 z-20 border-b bg-card'
      style={{ height: HEADER_H, width: timeline.width }}
    >
      <svg width={timeline.width} height={HEADER_H} className='block'>
        <rect
          width={timeline.width}
          height={HEADER_H}
          style={{ fill: CSS.card }}
        />

        {timeline.monthTicks.map((tick, index) => (
          <g key={tick.key}>
            <rect
              x={tick.x}
              y={0}
              width={tick.width}
              height={26}
              style={{ fill: index % 2 ? CSS.muted : CSS.card }}
              opacity={index % 2 ? 0.55 : 1}
            />
            <line
              x1={tick.x}
              y1={0}
              x2={tick.x}
              y2={HEADER_H}
              style={{ stroke: CSS.border }}
              strokeWidth={1}
            />
            {/* Zoomed out far enough and there is no room for a label; a
                shortened one beats an overlapping one, and none beats both. */}
            {(tick.width ?? 0) >= 30 && (
              <text
                x={tick.x + Math.max(6, (tick.width ?? 0) / 2)}
                y={17}
                textAnchor={(tick.width ?? 0) > 72 ? 'middle' : 'start'}
                fontSize={11}
                fontWeight={700}
                style={{ fill: CSS.fg }}
                fontFamily='system-ui, sans-serif'
              >
                {(tick.width ?? 0) > 72
                  ? formatMonthLabel(tick.date)
                  : MONTHS_SHORT[tick.date.getMonth()]}
              </text>
            )}
          </g>
        ))}

        {timeline.weekTicks.map((tick) => (
          <g key={tick.key}>
            <line
              x1={tick.x}
              y1={26}
              x2={tick.x}
              y2={HEADER_H}
              style={{ stroke: CSS.border }}
              strokeWidth={0.8}
            />
            {pxPerDay * 7 >= 38 && (
              <text
                x={tick.x + 4}
                y={43}
                fontSize={9}
                style={{ fill: CSS.mutedFg }}
                fontFamily='ui-monospace, SFMono-Regular, Menlo, monospace'
              >
                {formatWeekLabel(tick.date)}
              </text>
            )}
          </g>
        ))}

        {timeline.dayTicks.map((tick) => (
          <g key={tick.key}>
            <line
              x1={tick.x}
              y1={52}
              x2={tick.x}
              y2={HEADER_H}
              style={{ stroke: CSS.border }}
              strokeWidth={0.5}
              opacity={0.75}
            />
            {pxPerDay >= 5 && (
              <text
                x={tick.x + Math.max(2, pxPerDay / 2)}
                y={69}
                textAnchor='middle'
                fontSize={8}
                style={{ fill: CSS.mutedFg }}
                fontFamily='ui-monospace, SFMono-Regular, Menlo, monospace'
              >
                {formatDayLabel(tick.date)}
              </text>
            )}
          </g>
        ))}

        <line
          x1={0}
          y1={26}
          x2={timeline.width}
          y2={26}
          style={{ stroke: CSS.border }}
          strokeWidth={1}
        />
        <line
          x1={0}
          y1={52}
          x2={timeline.width}
          y2={52}
          style={{ stroke: CSS.border }}
          strokeWidth={1}
        />
      </svg>
    </div>
  )
}

function GanttCanvas({
  rows,
  totalHeight,
  timeline,
  pxPerDay,
  showBaseline,
  hoveredRowId,
  selectedRowId,
  savingId,
  editMode,
  canUpdateActivities,
  draggingId,
  onHover,
  onSelect,
  onTooltip,
  onContextMenu,
  onDragStart,
}: {
  rows: IndexedRow[]
  totalHeight: number
  timeline: TimelineModel
  pxPerDay: number
  showBaseline: boolean
  hoveredRowId: string | null
  selectedRowId: string | null
  savingId: string | null
  editMode: boolean
  canUpdateActivities: boolean
  draggingId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onTooltip: (
    event: React.MouseEvent<SVGElement>,
    activity: GanttActivity
  ) => void
  onContextMenu: (event: React.MouseEvent, activity: GanttActivity) => void
  onDragStart: (
    event: React.MouseEvent<SVGGElement>,
    activity: GanttActivity
  ) => void
}) {
  const geometries = useMemo(
    () =>
      rows
        .filter(
          (row): row is IndexedRow & ActivityRow => row.type === 'activity'
        )
        .map((row) => {
          const startX = dateToX(timeline, row.startDate, pxPerDay)
          const width = row.isMilestone
            ? 0
            : getBarWidth(row.startDate, row.finishDate, pxPerDay, row.duration)
          return {
            activity: row.activity,
            row,
            startX,
            finishX: startX + Math.max(8, width),
            y: row.index * ROW_H + ROW_H / 2,
          }
        }),
    [pxPerDay, rows, timeline]
  )

  const connectors = useMemo(() => buildConnectors(geometries), [geometries])
  const dataDateX = dateToX(timeline, timeline.dataDate, pxPerDay)

  return (
    <svg
      data-testid='primavera-gantt-canvas'
      width={timeline.width}
      height={totalHeight}
      className='absolute left-0 block'
      style={{ top: HEADER_H, background: CSS.background }}
    >
      <defs>
        <marker
          id='arrow-normal'
          markerWidth='8'
          markerHeight='8'
          refX='7'
          refY='4'
          orient='auto'
          markerUnits='strokeWidth'
        >
          <path d='M0,0 L8,4 L0,8 z' fill={COLORS.connector} />
        </marker>
        <marker
          id='arrow-critical'
          markerWidth='8'
          markerHeight='8'
          refX='7'
          refY='4'
          orient='auto'
          markerUnits='strokeWidth'
        >
          <path d='M0,0 L8,4 L0,8 z' fill={COLORS.critical} />
        </marker>
      </defs>

      <TimelineGrid timeline={timeline} totalHeight={totalHeight} />
      <SelectionLayer
        rows={rows}
        width={timeline.width}
        hoveredRowId={hoveredRowId}
        selectedRowId={selectedRowId}
      />
      <DependencyLayer connectors={connectors} />

      {rows.map((row) => (
        <GanttRowBar
          key={row.id}
          row={row}
          timeline={timeline}
          pxPerDay={pxPerDay}
          showBaseline={showBaseline}
          saving={row.type === 'activity' && savingId === row.activity.id}
          editMode={editMode}
          canUpdateActivities={canUpdateActivities}
          dragging={row.type === 'activity' && draggingId === row.activity.id}
          onHover={onHover}
          onSelect={onSelect}
          onTooltip={onTooltip}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
        />
      ))}

      {dataDateX >= 0 && dataDateX <= timeline.width && (
        <g pointerEvents='none'>
          <line
            x1={dataDateX}
            y1={0}
            x2={dataDateX}
            y2={totalHeight}
            stroke={COLORS.dataDate}
            strokeWidth={2}
            strokeDasharray='6 4'
          />
          <rect
            x={Math.max(2, dataDateX - 34)}
            y={4}
            width={68}
            height={18}
            rx={3}
            fill={COLORS.dataDate}
          />
          <text
            x={dataDateX}
            y={17}
            textAnchor='middle'
            fontSize={9}
            fontWeight={700}
            fill='white'
            fontFamily='system-ui, sans-serif'
          >
            Data Date
          </text>
        </g>
      )}
    </svg>
  )
}

function TimelineGrid({
  timeline,
  totalHeight,
}: {
  timeline: TimelineModel
  totalHeight: number
}) {
  return (
    <g pointerEvents='none'>
      {timeline.weekendBands.map((band) => (
        <rect
          key={band.key}
          x={band.x}
          y={0}
          width={band.width}
          height={totalHeight}
          style={{ fill: CSS.muted }}
          opacity={0.22}
        />
      ))}

      {timeline.weekTicks.map((tick) => (
        <line
          key={tick.key}
          x1={tick.x}
          y1={0}
          x2={tick.x}
          y2={totalHeight}
          style={{ stroke: CSS.border }}
          strokeWidth={0.7}
        />
      ))}

      {timeline.monthTicks.map((tick) => (
        <line
          key={tick.key}
          x1={tick.x}
          y1={0}
          x2={tick.x}
          y2={totalHeight}
          style={{ stroke: CSS.border }}
          strokeWidth={1.2}
        />
      ))}
    </g>
  )
}

function SelectionLayer({
  rows,
  width,
  hoveredRowId,
  selectedRowId,
}: {
  rows: IndexedRow[]
  width: number
  hoveredRowId: string | null
  selectedRowId: string | null
}) {
  return (
    <g pointerEvents='none'>
      {rows.map((row) => (
        <g key={row.id}>
          <rect
            x={0}
            y={row.index * ROW_H}
            width={width}
            height={ROW_H}
            style={{
              fill:
                row.id === selectedRowId
                  ? 'rgba(245, 158, 11, 0.12)'
                  : row.id === hoveredRowId
                    ? 'rgba(37, 99, 235, 0.09)'
                    : row.type === 'summary'
                      ? 'rgba(100, 116, 139, 0.12)'
                      : row.index % 2 === 0
                        ? 'transparent'
                        : 'rgba(100, 116, 139, 0.05)',
            }}
          />
          <line
            x1={0}
            y1={(row.index + 1) * ROW_H}
            x2={width}
            y2={(row.index + 1) * ROW_H}
            style={{ stroke: CSS.border }}
            strokeWidth={0.6}
          />
        </g>
      ))}
    </g>
  )
}

function DependencyLayer({ connectors }: { connectors: Connector[] }) {
  return (
    <g fill='none' pointerEvents='none'>
      {connectors.map((connector) => (
        <path
          key={connector.key}
          d={connector.path}
          stroke={connector.color}
          strokeWidth={1.25}
          strokeLinejoin='round'
          strokeLinecap='round'
          opacity={0.72}
          markerEnd={connector.marker}
        />
      ))}
    </g>
  )
}

function GanttRowBar({
  row,
  timeline,
  pxPerDay,
  showBaseline,
  saving,
  editMode,
  canUpdateActivities,
  dragging,
  onHover,
  onSelect,
  onTooltip,
  onContextMenu,
  onDragStart,
}: {
  row: IndexedRow
  timeline: TimelineModel
  pxPerDay: number
  showBaseline: boolean
  saving: boolean
  editMode: boolean
  canUpdateActivities: boolean
  dragging: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  onTooltip: (
    event: React.MouseEvent<SVGElement>,
    activity: GanttActivity
  ) => void
  onContextMenu: (event: React.MouseEvent, activity: GanttActivity) => void
  onDragStart: (
    event: React.MouseEvent<SVGGElement>,
    activity: GanttActivity
  ) => void
}) {
  const y = row.index * ROW_H + ROW_H / 2
  const startX = dateToX(timeline, row.startDate, pxPerDay)
  const width =
    row.type === 'activity' && row.isMilestone
      ? 0
      : getBarWidth(row.startDate, row.finishDate, pxPerDay, row.duration)
  const baselineStartX = dateToX(timeline, row.baselineStartDate, pxPerDay)
  const baselineWidth = getBarWidth(
    row.baselineStartDate,
    row.baselineFinishDate,
    pxPerDay,
    row.duration
  )

  if (row.type === 'summary') {
    return (
      <g
        onMouseEnter={() => onHover(row.id)}
        onMouseLeave={() => onHover(null)}
        onClick={() => onSelect(row.id)}
      >
        {showBaseline && row.baselineStartDate && row.baselineFinishDate && (
          <rect
            x={baselineStartX}
            y={y + 8}
            width={baselineWidth}
            height={3}
            fill={COLORS.baseline}
            opacity={0.65}
            rx={1}
          />
        )}
        {row.startDate && row.finishDate && (
          <g>
            <rect
              x={startX}
              y={y - 5}
              width={width}
              height={8}
              style={{ fill: CSS.fg }}
              opacity={0.92}
              rx={1}
            />
            <rect
              x={startX}
              y={y - 8}
              width={2}
              height={14}
              style={{ fill: CSS.fg }}
              opacity={0.92}
            />
            <rect
              x={startX + width - 2}
              y={y - 8}
              width={2}
              height={14}
              style={{ fill: CSS.fg }}
              opacity={0.92}
            />
            {row.pctComplete > 0 && (
              <rect
                x={startX}
                y={y - 3}
                width={Math.max(2, width * (row.pctComplete / 100))}
                height={4}
                fill={COLORS.progress}
                rx={1}
              />
            )}
          </g>
        )}
      </g>
    )
  }

  const activity = row.activity
  const currentColor = barColor(activity)
  const progressWidth = Math.max(0, width * ((activity.pctComplete ?? 0) / 100))
  const procurementRisk = getProcurementRisk(activity)

  if (row.isMilestone) {
    const size = 8
    return (
      <g
        onMouseEnter={() => onHover(row.id)}
        onMouseLeave={() => {
          onHover(null)
        }}
        onMouseMove={(event) => onTooltip(event, activity)}
        onClick={() => onSelect(row.id)}
        onContextMenu={(event) => onContextMenu(event, activity)}
        style={{ cursor: 'pointer' }}
      >
        {showBaseline && row.baselineStartDate && (
          <polygon
            points={`${baselineStartX},${y + 10 - 5} ${baselineStartX + 5},${y + 10} ${baselineStartX},${y + 10 + 5} ${baselineStartX - 5},${y + 10}`}
            fill={COLORS.baseline}
            opacity={0.62}
          />
        )}
        <polygon
          points={`${startX},${y - size} ${startX + size},${y} ${startX},${y + size} ${startX - size},${y}`}
          fill={currentColor}
          stroke='white'
          strokeWidth={1}
          opacity={activity.pctComplete >= 100 ? 1 : 0.92}
        />
        {procurementRisk && (
          <g pointerEvents='none'>
            <circle
              cx={startX + 16}
              cy={y}
              r={6}
              fill={COLORS.procurement}
              stroke='white'
              strokeWidth={1}
            />
            <text
              x={startX + 16}
              y={y + 3.5}
              textAnchor='middle'
              fontSize={9}
              fontWeight={800}
              fill='white'
              fontFamily='system-ui, sans-serif'
            >
              !
            </text>
          </g>
        )}
      </g>
    )
  }

  return (
    <g
      onMouseEnter={() => onHover(row.id)}
      onMouseLeave={() => onHover(null)}
      onMouseMove={(event) => onTooltip(event, activity)}
      onMouseDown={(event) => onDragStart(event, activity)}
      onClick={() => onSelect(row.id)}
      onContextMenu={(event) => onContextMenu(event, activity)}
      style={{
        cursor:
          editMode && canUpdateActivities
            ? dragging
              ? 'grabbing'
              : 'grab'
            : 'pointer',
      }}
    >
      {showBaseline && row.baselineStartDate && row.baselineFinishDate && (
        <rect
          x={baselineStartX}
          y={y + 8}
          width={baselineWidth}
          height={4}
          fill={COLORS.baseline}
          opacity={0.65}
          rx={1}
        />
      )}

      {row.totalFloat != null && row.totalFloat > 0 && (
        <rect
          x={startX + width}
          y={y + 3}
          width={row.totalFloat * pxPerDay}
          height={3}
          fill={COLORS.float}
          opacity={0.32}
          rx={1}
        />
      )}

      <rect
        x={startX}
        y={y - BAR_H / 2}
        width={width}
        height={BAR_H}
        fill={currentColor}
        opacity={0.9}
        rx={2}
      />
      {progressWidth > 0 && (
        <rect
          x={startX}
          y={y - BAR_H / 2 + 3}
          width={progressWidth}
          height={BAR_H - 6}
          fill={COLORS.progress}
          opacity={0.9}
          rx={1}
        />
      )}
      {activity.isCritical && (
        <line
          x1={startX}
          y1={y + BAR_H / 2 - 1}
          x2={startX + width}
          y2={y + BAR_H / 2 - 1}
          stroke='#7f1d1d'
          strokeWidth={2}
          opacity={0.55}
        />
      )}
      {procurementRisk && (
        <g pointerEvents='none'>
          <circle
            cx={startX + width + 10}
            cy={y}
            r={6}
            fill={COLORS.procurement}
            stroke='white'
            strokeWidth={1}
          />
          <text
            x={startX + width + 10}
            y={y + 3.5}
            textAnchor='middle'
            fontSize={9}
            fontWeight={800}
            fill='white'
            fontFamily='system-ui, sans-serif'
          >
            !
          </text>
        </g>
      )}
      {width > 54 && (
        <text
          x={startX + width / 2}
          y={y + 3}
          textAnchor='middle'
          fontSize={9}
          fontWeight={700}
          fill='white'
          fontFamily='ui-monospace, SFMono-Regular, Menlo, monospace'
          pointerEvents='none'
        >
          {activity.pctComplete ?? 0}%
        </text>
      )}
      {saving && (
        <text
          x={startX + width + 5}
          y={y + 4}
          fontSize={10}
          style={{ fill: CSS.mutedFg }}
          fontFamily='ui-monospace, SFMono-Regular, Menlo, monospace'
        >
          ...
        </text>
      )}
    </g>
  )
}

function ActivityTooltip({
  tooltip,
  chartWidth,
  scrollLeft,
  viewportWidth,
}: {
  tooltip: Tooltip
  chartWidth: number
  scrollLeft: number
  viewportWidth: number
}) {
  const activity = tooltip.activity
  const procurementRisk = getProcurementRisk(activity)
  const left = Math.min(
    tooltip.x,
    scrollLeft + Math.min(viewportWidth - 260, chartWidth - 260)
  )

  return (
    <div
      className='pointer-events-none absolute z-50 w-64 rounded-md border bg-popover text-popover-foreground shadow-xl'
      style={{
        left: Math.max(scrollLeft + 8, left),
        top: Math.max(8, tooltip.y - (procurementRisk ? 154 : 116)),
      }}
    >
      <div className='border-b px-3 py-2'>
        <p className='line-clamp-2 text-xs leading-tight font-semibold'>
          {activity.name}
        </p>
        <p className='mt-0.5 font-mono text-[10px] text-muted-foreground'>
          {getActivityCode(activity)}
        </p>
      </div>
      <div className='grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 text-[10px]'>
        <span className='text-muted-foreground'>Start</span>
        <span className='font-mono font-medium'>
          {formatCalendarDate(activity.earlyStartDate)}
        </span>
        <span className='text-muted-foreground'>Finish</span>
        <span className='font-mono font-medium'>
          {formatCalendarDate(activity.earlyFinishDate)}
        </span>
        <span className='text-muted-foreground'>BL Start</span>
        <span className='font-mono font-medium'>
          {formatCalendarDate(activity.baselineStartDate)}
        </span>
        <span className='text-muted-foreground'>BL Finish</span>
        <span className='font-mono font-medium'>
          {formatCalendarDate(activity.baselineFinishDate)}
        </span>
        <span className='text-muted-foreground'>Duration</span>
        <span className='font-mono font-medium'>{activity.duration}d</span>
        <span className='text-muted-foreground'>Float</span>
        <span
          className={cn(
            'font-mono font-medium',
            activity.isCritical
              ? 'text-red-600'
              : isNearCritical(activity)
                ? 'text-orange-600'
                : ''
          )}
        >
          {activity.totalFloat ?? '-'}d
        </span>
        <span className='text-muted-foreground'>Progress</span>
        <span className='font-mono font-medium'>{activity.pctComplete}%</span>
        <span className='text-muted-foreground'>Predecessors</span>
        <span
          className='truncate font-mono font-medium'
          title={formatActivityDependencies(activity)}
        >
          {formatActivityDependencies(activity)}
        </span>
        {procurementRisk && (
          <>
            <span className='text-muted-foreground'>Proc Risk</span>
            <span className='font-mono font-medium text-orange-600'>
              {procurementRisk.highestSeverity} ({procurementRisk.atRiskCount})
            </span>
            <span className='text-muted-foreground'>Need</span>
            <span className='font-mono font-medium'>
              {formatCalendarDate(procurementRisk.needDate)}
            </span>
            <span className='text-muted-foreground'>Order By</span>
            <span className='font-mono font-medium'>
              {formatCalendarDate(procurementRisk.orderByDate)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function GanttLegend({
  showBaseline,
  dataDate,
}: {
  showBaseline: boolean
  dataDate: Date
}) {
  const items = [
    { color: COLORS.critical, label: 'Critical Path' },
    { color: COLORS.nearCritical, label: 'Near Critical' },
    { color: COLORS.normal, label: 'Current Activity' },
    { color: COLORS.progress, label: 'Progress' },
    { color: COLORS.milestone, label: 'Milestone' },
    { color: COLORS.float, label: 'Total Float' },
    { color: COLORS.procurement, label: 'Procurement Risk' },
    { color: COLORS.dataDate, label: `Data Date ${formatGridDate(dataDate)}` },
    ...(showBaseline ? [{ color: COLORS.baseline, label: 'Baseline' }] : []),
  ]

  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-card px-3 py-2'>
      {items.map((item) => (
        <span
          key={item.label}
          className='flex items-center gap-1.5 text-[11px] text-muted-foreground'
        >
          <span
            className='inline-block h-2.5 w-2.5 shrink-0 rounded-sm'
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}
