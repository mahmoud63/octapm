/**
 * Saved Gantt layouts.
 *
 * A planner sets the chart up once — which columns, how wide the table, what
 * timescale, baseline on or off, resources shown — and expects to find it that
 * way tomorrow, and to be able to keep more than one arrangement for different
 * jobs. That is what P6 calls a layout, and this is the same idea.
 *
 * Layouts live in this browser, per project. They are not shared between
 * people or devices; moving them to the server is a separate piece of work,
 * and the interface says where they are stored so nobody is surprised.
 */

export type TimeScale = 'day' | 'week' | 'month' | 'quarter'
export type HistogramGroup = 'type' | 'resource'

export type GanttLayout = {
  timeScale: TimeScale
  pxPerDay: number
  /** Width of the activity table, i.e. where the splitter rests. */
  gridWidth: number | null
  showBaseline: boolean
  showHistogram: boolean
  histogramGroup: HistogramGroup
  /** WBS rows that are collapsed, by row id. */
  collapsed: string[]
}

export type NamedLayout = {
  id: string
  name: string
  builtIn?: boolean
  layout: GanttLayout
}

const BASE: GanttLayout = {
  timeScale: 'week',
  pxPerDay: 10,
  gridWidth: null,
  showBaseline: true,
  showHistogram: false,
  histogramGroup: 'type',
  collapsed: [],
}

/**
 * The arrangements worth having out of the box. Deliberately few: a long list
 * of presets is someone else's opinion, and the point is to save your own.
 */
export const BUILT_IN_LAYOUTS: NamedLayout[] = [
  {
    id: 'builtin:classic',
    name: 'Classic schedule',
    builtIn: true,
    layout: { ...BASE },
  },
  {
    id: 'builtin:bars',
    name: 'Bars and dates',
    builtIn: true,
    layout: {
      ...BASE,
      timeScale: 'month',
      pxPerDay: 5,
      // Activity ID and name only: the whole width goes to the bars.
      gridWidth: 400,
      showBaseline: false,
    },
  },
  {
    id: 'builtin:resources',
    name: 'Resource review',
    builtIn: true,
    layout: {
      ...BASE,
      timeScale: 'month',
      pxPerDay: 5,
      gridWidth: 400,
      showHistogram: true,
      histogramGroup: 'type',
    },
  },
]

export const DEFAULT_LAYOUT_ID = BUILT_IN_LAYOUTS[0].id

const listKey = (projectId: string) => `octa.gantt.layouts.${projectId}`
const activeKey = (projectId: string) => `octa.gantt.layout.${projectId}`

/** Storage is best-effort: a blocked or full store must never break the chart. */
const read = (key: string) => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Fills in anything a layout saved by an older build is missing. */
const normalise = (layout: Partial<GanttLayout> | undefined): GanttLayout => ({
  ...BASE,
  ...layout,
  collapsed: Array.isArray(layout?.collapsed) ? layout!.collapsed : [],
})

export function loadSavedLayouts(projectId: string): NamedLayout[] {
  const raw = read(listKey(projectId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string')
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        layout: normalise(entry.layout),
      }))
  } catch {
    return []
  }
}

export function allLayouts(projectId: string): NamedLayout[] {
  return [...BUILT_IN_LAYOUTS, ...loadSavedLayouts(projectId)]
}

export function findLayout(projectId: string, id: string): NamedLayout | null {
  return allLayouts(projectId).find((entry) => entry.id === id) ?? null
}

/** Saves under a name, replacing a saved layout of the same name. */
export function saveLayout(
  projectId: string,
  name: string,
  layout: GanttLayout
): NamedLayout | null {
  const trimmed = name.trim()
  if (!trimmed) return null

  const saved = loadSavedLayouts(projectId)
  const existing = saved.find(
    (entry) => entry.name.toLowerCase() === trimmed.toLowerCase()
  )
  const entry: NamedLayout = {
    id: existing?.id ?? `layout:${Date.now().toString(36)}`,
    name: trimmed,
    layout: normalise(layout),
  }

  const next = existing
    ? saved.map((item) => (item.id === entry.id ? entry : item))
    : [...saved, entry]

  return write(listKey(projectId), JSON.stringify(next)) ? entry : null
}

export function deleteLayout(projectId: string, id: string) {
  const next = loadSavedLayouts(projectId).filter((entry) => entry.id !== id)
  write(listKey(projectId), JSON.stringify(next))
}

/**
 * Whether the view still matches the layout it was opened from.
 *
 * The table width is only compared when the layout actually names one: a
 * layout that leaves it open lets the chart size the table to the window, and
 * that is not the planner having changed anything.
 */
export function isSameLayout(saved: GanttLayout, current: GanttLayout): boolean {
  if (saved.gridWidth != null && saved.gridWidth !== current.gridWidth) return false
  return (
    saved.timeScale === current.timeScale &&
    saved.pxPerDay === current.pxPerDay &&
    saved.showBaseline === current.showBaseline &&
    saved.showHistogram === current.showHistogram &&
    saved.histogramGroup === current.histogramGroup &&
    saved.collapsed.length === current.collapsed.length &&
    saved.collapsed.every((id) => current.collapsed.includes(id))
  )
}

export function loadActiveLayoutId(projectId: string): string {
  return read(activeKey(projectId)) || DEFAULT_LAYOUT_ID
}

export function setActiveLayoutId(projectId: string, id: string) {
  write(activeKey(projectId), id)
}
