import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  BoqItemDetailSchema,
  type BoqItemDetail,
} from '@/features/boq/data/schema'
import {
  ActivityDetailSchema,
  type ActivityDetail,
} from '@/features/schedule/data/schema'

/**
 * The BOQ item and activity detail reads (PC-5). Each is one request the
 * server composes from the services that own every figure, and gates section
 * by section — the drawers render what comes back and never fill a withheld
 * section in.
 *
 * The keys are prefixed by project so a change to the project's allocations
 * (use-boq invalidateAllocationConsumers, use-mapping
 * invalidateMappingConsumers) refreshes every open drawer at once.
 */
export const boqItemDetailKey = (projectId: string, itemId?: string | null) =>
  itemId ? ['boq-item-detail', projectId, itemId] : ['boq-item-detail', projectId]

export const activityDetailKey = (projectId: string, activityId?: string | null) =>
  activityId ? ['activity-detail', projectId, activityId] : ['activity-detail', projectId]

export const useBoqItemDetail = (projectId: string, itemId: string | null) =>
  useQuery<BoqItemDetail>({
    queryKey: boqItemDetailKey(projectId, itemId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/boq/items/${itemId}/detail`)
        .then((response) => BoqItemDetailSchema.parse(response.data.data)),
    enabled: Boolean(projectId && itemId),
    retry: false,
  })

export const useActivityDetail = (projectId: string, activityId: string | null) =>
  useQuery<ActivityDetail>({
    queryKey: activityDetailKey(projectId, activityId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/activities/${activityId}/detail`)
        .then((response) => ActivityDetailSchema.parse(response.data.data)),
    enabled: Boolean(projectId && activityId),
    retry: false,
  })

/**
 * How a register opens a record's detail: the page that hosts the drawers
 * (useControlsDetailDrawers) provides it, and an opener far down a table —
 * a Gantt row, a mapping cell — asks for it instead of having callbacks
 * threaded through every layer. Outside a host there is no opener, and the
 * affordance is not drawn.
 */
export type ControlsDetailOpener = {
  openBoqItem: (itemId: string) => void
  openActivity: (activityId: string) => void
}

export const ControlsDetailContext = createContext<ControlsDetailOpener | null>(null)

export const useControlsDetailOpener = () => useContext(ControlsDetailContext)
