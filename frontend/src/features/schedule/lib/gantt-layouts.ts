import { apiClient } from '@/services/api/client'

/**
 * Saved Gantt layouts.
 *
 * A planner sets the chart up once — which columns, how wide the table, what
 * timescale, baseline on or off, resources shown — and expects to find it that
 * way tomorrow, to keep more than one arrangement, and to hand a good one to
 * the rest of the team. That is what P6 calls a layout.
 *
 * Layouts live on the server, scoped to the project. A `private` layout is the
 * author's own; a `project` one is visible to everyone who can open the
 * project. Which layout *you* last had open is a per-device preference and
 * stays in this browser — it is not worth a round trip, and it should not
 * follow you onto a shared site terminal.
 */

export type TimeScale = 'day' | 'week' | 'month' | 'quarter'
export type HistogramGroup = 'type' | 'resource'
export type LayoutVisibility = 'private' | 'project'

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
  layout: GanttLayout
  /** Built-in layouts ship with the product and cannot be edited. */
  builtIn?: boolean
  visibility?: LayoutVisibility
  ownerName?: string | null
  isOwner?: boolean
  canManage?: boolean
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

/** Fills in anything a layout saved by an older build is missing. */
const normalise = (layout: Partial<GanttLayout> | undefined): GanttLayout => ({
  ...BASE,
  ...layout,
  collapsed: Array.isArray(layout?.collapsed) ? layout.collapsed : [],
})

type LayoutResponse = {
  id: string
  name: string
  visibility: LayoutVisibility
  layout: Partial<GanttLayout>
  ownerName?: string | null
  isOwner?: boolean
  canManage?: boolean
}

const fromApi = (row: LayoutResponse): NamedLayout => ({
  id: row.id,
  name: row.name,
  visibility: row.visibility,
  ownerName: row.ownerName ?? null,
  isOwner: Boolean(row.isOwner),
  canManage: Boolean(row.canManage),
  layout: normalise(row.layout),
})

export async function fetchLayouts(projectId: string): Promise<NamedLayout[]> {
  const response = await apiClient.get(`/projects/${projectId}/schedule/layouts`)
  const items: LayoutResponse[] = response.data?.data?.items ?? []
  return [...BUILT_IN_LAYOUTS, ...items.map(fromApi)]
}

export async function saveLayout(
  projectId: string,
  name: string,
  layout: GanttLayout,
  visibility: LayoutVisibility
): Promise<NamedLayout> {
  const response = await apiClient.post(
    `/projects/${projectId}/schedule/layouts`,
    { name, layout, visibility }
  )
  return fromApi(response.data.data)
}

export async function updateLayoutVisibility(
  projectId: string,
  layoutId: string,
  visibility: LayoutVisibility
): Promise<NamedLayout> {
  const response = await apiClient.patch(
    `/projects/${projectId}/schedule/layouts/${layoutId}`,
    { visibility }
  )
  return fromApi(response.data.data)
}

export async function deleteLayout(projectId: string, layoutId: string) {
  await apiClient.delete(`/projects/${projectId}/schedule/layouts/${layoutId}`)
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

// --- Which layout this browser last had open ------------------------------
// A per-device preference, not shared state. Storage is best-effort: a blocked
// or full store must never break the chart.

const activeKey = (projectId: string) => `octa.gantt.layout.${projectId}`

export function loadActiveLayoutId(projectId: string): string {
  try {
    return window.localStorage.getItem(activeKey(projectId)) || DEFAULT_LAYOUT_ID
  } catch {
    return DEFAULT_LAYOUT_ID
  }
}

export function setActiveLayoutId(projectId: string, id: string) {
  try {
    window.localStorage.setItem(activeKey(projectId), id)
  } catch {
    // A browser that will not store the preference still shows the chart.
  }
}
