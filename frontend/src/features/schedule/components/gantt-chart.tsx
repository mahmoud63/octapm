import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GripHorizontal,
  Layers,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type {
  ActivityDependency,
  DependencyRelationship,
  ScheduleActivity,
} from '../data/schema'
import { ActivityInlineEditDialog } from './activity-inline-edit-dialog'

type GanttActivity = ScheduleActivity & {
  activityCode?: string | null
}

interface Props {
  activities: ScheduleActivity[]
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

type TimeScale = 'day' | 'week' | 'month' | 'quarter'

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
const MIN_PX = 3
const MAX_PX = 24
const DEFAULT_SCALE: TimeScale = 'week'
const SCALE_SETTINGS = {
  day: { label: 'Day', pxPerDay: 18, dayStep: 1, weekStep: 1 },
  week: { label: 'Week', pxPerDay: 10, dayStep: 2, weekStep: 1 },
  month: { label: 'Month', pxPerDay: 5, dayStep: 7, weekStep: 1 },
  quarter: { label: 'Quarter', pxPerDay: 3, dayStep: 14, weekStep: 4 },
} satisfies Record<
  TimeScale,
  { label: string; pxPerDay: number; dayStep: number; weekStep: number }
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
  { key: 'baselineStart', label: 'BL Project Start', width: 103 },
  { key: 'baselineFinish', label: 'BL Project Finish', width: 103 },
] as const

const GRID_W = GRID_COLUMNS.reduce((sum, column) => sum + column.width, 0)
const GRID_TEMPLATE = GRID_COLUMNS.map((col) => `${col.width}px`).join(' ')

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
  const width = Math.max(720, totalDays * pxPerDay)
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
  const contentWidth = GRID_W + timeline.width

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

  const nCritical = displayed.filter(
    (activity) => activity.isCritical && !activity.isMilestone
  ).length
  const nNearCritical = displayed.filter(isNearCritical).length
  const nMilestone = displayed.filter((activity) => activity.isMilestone).length

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const update = () => setViewportHeight(element.clientHeight || 640)
    update()

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

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
    <div className='space-y-3'>
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
            onClick={() => {
              setTimeScale(DEFAULT_SCALE)
              setPxPerDay(DEFAULT_PX)
            }}
            aria-label='Reset zoom'
            title='Reset zoom'
          >
            <RotateCcw className='h-3.5 w-3.5' />
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        data-testid='primavera-gantt-viewport'
        className='relative overflow-auto rounded-md border bg-card shadow-sm'
        style={{ maxHeight: 680 }}
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
      className='sticky left-0 z-30 shrink-0 border-r bg-card shadow-[8px_0_18px_rgba(15,23,42,0.08)]'
      style={{ width: GRID_W, height: HEADER_H + totalHeight }}
    >
      <div
        className='sticky top-0 z-40 grid border-b bg-muted/70 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur'
        style={{ gridTemplateColumns: GRID_TEMPLATE, height: HEADER_H }}
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
            <text
              x={tick.x + Math.max(8, (tick.width ?? 0) / 2)}
              y={17}
              textAnchor={(tick.width ?? 0) > 72 ? 'middle' : 'start'}
              fontSize={11}
              fontWeight={700}
              style={{ fill: CSS.fg }}
              fontFamily='system-ui, sans-serif'
            >
              {formatMonthLabel(tick.date)}
            </text>
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
            <text
              x={tick.x + 4}
              y={43}
              fontSize={9}
              style={{ fill: CSS.mutedFg }}
              fontFamily='ui-monospace, SFMono-Regular, Menlo, monospace'
            >
              {formatWeekLabel(tick.date)}
            </text>
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
