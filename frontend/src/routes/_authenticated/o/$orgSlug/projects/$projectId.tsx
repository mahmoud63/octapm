import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import {
  DEFAULT_CHILD,
  isModuleWithChildren,
  moduleFromSlug,
  slugForModule,
} from '@/features/projects/lib/project-modules'

/**
 * Legacy deep-links used `?module=&child=` on the project root. They are
 * redirected to the module routes so old bookmarks and notification links keep
 * working (OCTA-FE-ROUTES-008).
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

export const Route = createFileRoute('/_authenticated/o/$orgSlug/projects/$projectId')({
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
  beforeLoad: ({ params, search }) => {
    const module = moduleFromSlug(search.module)
    if (!module) return
    const child =
      search.child ??
      (isModuleWithChildren(module) ? DEFAULT_CHILD[module] : undefined)
    const rest = {
      status: search.status,
      source: search.source,
      recordId: search.recordId,
      pin: search.pin,
      date: search.date,
      new: search.new,
    }
    if (child && isModuleWithChildren(module)) {
      throw redirect({
        to: '/o/$orgSlug/projects/$projectId/$module/$child',
        params: {
          orgSlug: params.orgSlug,
          projectId: params.projectId,
          module: slugForModule(module),
          child,
        },
        search: rest,
        replace: true,
      })
    }
    throw redirect({
      to: '/o/$orgSlug/projects/$projectId/$module',
      params: {
        orgSlug: params.orgSlug,
        projectId: params.projectId,
        module: slugForModule(module),
      },
      search: rest,
      replace: true,
    })
  },
  component: Outlet,
})
