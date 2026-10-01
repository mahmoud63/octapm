import { AxiosError } from 'axios'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  RecordQuantitiesSchema,
  type RecordQuantities,
} from '@/features/boq/data/schema'

/**
 * The five quantities and the committed quantity of one record (PC-6):
 * GET /projects/:id/boq/items/:itemId/quantities or
 * GET /projects/:id/activities/:activityId/quantities — the views contract.
 *
 * The screen draws exactly what the server proves. Three answers are not
 * data and are told apart so the drawer can say which it got:
 *   - the route is not on this server yet (404): "—", not available here;
 *   - the server refuses the whole read (403, a member without BOQ read):
 *     "—" with the server's reason, never zeroes;
 *   - any other failure: "—" with the server's message.
 * A figure withheld inside a 200 answer carries its own reason and is drawn
 * by the row.
 */
export type RecordQuantitiesKind = 'boq_item' | 'activity'

export type RecordQuantitiesRead =
  | { state: 'ok'; data: RecordQuantities }
  | { state: 'not-on-server'; reason: string }
  | { state: 'withheld'; reason: string }
  | { state: 'error'; reason: string }

export const recordQuantitiesKey = (
  projectId: string,
  kind: RecordQuantitiesKind,
  id?: string | null
) =>
  id
    ? ['record-quantities', projectId, kind, id]
    : ['record-quantities', projectId, kind]

const routeFor = (projectId: string, kind: RecordQuantitiesKind, id: string) =>
  kind === 'boq_item'
    ? `/projects/${projectId}/boq/items/${id}/quantities`
    : `/projects/${projectId}/activities/${id}/quantities`

export const QUANTITIES_NOT_ON_SERVER =
  'Quantities are not available on this server yet (the quantity views have not been deployed)'

const messageOf = (error: unknown, fallback: string) =>
  error instanceof AxiosError
    ? ((error.response?.data as { error?: { message?: string } } | undefined)
        ?.error?.message ?? fallback)
    : fallback

export const readRecordQuantities = async (
  projectId: string,
  kind: RecordQuantitiesKind,
  id: string
): Promise<RecordQuantitiesRead> => {
  try {
    const response = await apiClient.get(routeFor(projectId, kind, id))
    const parsed = RecordQuantitiesSchema.safeParse(response.data?.data)
    if (!parsed.success) {
      return {
        state: 'error',
        reason: 'The server answered in a shape this screen does not read',
      }
    }
    if (parsed.data.allowed === false) {
      return {
        state: 'withheld',
        reason: parsed.data.reason ?? 'Withheld by the server',
      }
    }
    return { state: 'ok', data: parsed.data }
  } catch (error) {
    const status =
      error instanceof AxiosError ? error.response?.status : undefined
    if (status === 404)
      return { state: 'not-on-server', reason: QUANTITIES_NOT_ON_SERVER }
    if (status === 403)
      return {
        state: 'withheld',
        reason: messageOf(error, 'Withheld by the server'),
      }
    return {
      state: 'error',
      reason: messageOf(error, 'The quantities could not be read'),
    }
  }
}

export const useRecordQuantities = (
  projectId: string,
  kind: RecordQuantitiesKind,
  id: string | null | undefined
) =>
  useQuery<RecordQuantitiesRead>({
    queryKey: recordQuantitiesKey(projectId, kind, id),
    queryFn: () => readRecordQuantities(projectId, kind, id!),
    enabled: Boolean(projectId && id),
    retry: false,
  })
