import { createFileRoute } from '@tanstack/react-router'
import { legacyProjectRedirect } from '@/lib/workspace/legacy'

/**
 * Legacy project path (ENT-4): `/projects/:id/…` — every notification and
 * comment link minted before this wave, every bookmark, and the typed
 * in-app navigations across the product — opens the same page under the
 * workspace that owns the project, `/o/{workspace}/projects/:id/…`. A
 * project of another of the person's workspaces offers the switch; one of
 * no workspace of theirs is not found. The `?module=&child=` shape of the
 * older deep-links is carried along and resolved by the workspace route.
 */
type ProjectSearch = {
  module?: string
  child?: string
  status?: string
  source?: string
  recordId?: string
  pin?: string
  date?: string
  /** Open a module's create dialog on arrival (`?new=rfi`, `?new=change_order`, `?new=direct_cost`) — Phase 22A quick actions. */
  new?: string
}

export const Route = createFileRoute('/_authenticated/projects/$projectId')({
  validateSearch: (search: Record<string, unknown>): ProjectSearch => ({
    module: typeof search.module === 'string' ? search.module : undefined,
    child: typeof search.child === 'string' ? search.child : undefined,
    status: typeof search.status === 'string' ? search.status : undefined,
    source: typeof search.source === 'string' ? search.source : undefined,
    recordId: typeof search.recordId === 'string' ? search.recordId : undefined,
    pin: typeof search.pin === 'string' ? search.pin : undefined,
    date: typeof search.date === 'string' ? search.date : undefined,
    new: typeof search.new === 'string' ? search.new : undefined,
  }),
  beforeLoad: ({ params, location, context }) =>
    legacyProjectRedirect({
      projectId: params.projectId,
      location,
      queryClient: context.queryClient,
    }),
})
