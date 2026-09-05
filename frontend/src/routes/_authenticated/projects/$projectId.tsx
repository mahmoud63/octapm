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
}

export const Route = createFileRoute('/_authenticated/projects/$projectId')({
  validateSearch: (search: Record<string, unknown>): ProjectSearch => ({
    module: typeof search.module === 'string' ? search.module : undefined,
    child: typeof search.child === 'string' ? search.child : undefined,
    status: typeof search.status === 'string' ? search.status : undefined,
    source: typeof search.source === 'string' ? search.source : undefined,
    recordId: typeof search.recordId === 'string' ? search.recordId : undefined,
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
    }
    if (child && isModuleWithChildren(module)) {
      throw redirect({
        to: '/projects/$projectId/$module/$child',
        params: {
          projectId: params.projectId,
          module: slugForModule(module),
          child,
        },
        search: rest,
        replace: true,
      })
    }
    throw redirect({
      to: '/projects/$projectId/$module',
      params: { projectId: params.projectId, module: slugForModule(module) },
      search: rest,
      replace: true,
    })
  },
  component: Outlet,
})
