import { type QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { currentSurface, routeForSurface, surfaceHref } from '@/lib/domains'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  // Each OctaPM host serves its own routes (domain architecture §13): the
  // admin host the platform console, the portal the external-party pages, the
  // public site the marketing pages. Anything else goes to the host it belongs
  // to. This picks screens only — the API authorizes every request itself.
  beforeLoad: ({ location }) => {
    const decision = routeForSurface(currentSurface(), location.pathname)
    if (decision.kind === 'path' && decision.to !== location.pathname) {
      throw redirect({ href: decision.to, replace: true })
    }
    if (decision.kind === 'surface') {
      const href = surfaceHref(decision.surface, `${decision.to}${location.searchStr ?? ''}`)
      // A surface with no host of its own is served right here.
      if (!href.startsWith('/')) throw redirect({ href, reloadDocument: true })
    }
  },
  component: () => {
    return (
      <>
        <NavigationProgress />
        <Outlet />
        {/* Toasts stack above the floating Ask OctaPM button (bottom right). */}
        <Toaster duration={5000} offset={{ bottom: 96, right: 24 }} mobileOffset={{ bottom: 80, right: 16 }} />
        {/* Development tooling only behind an explicit opt-in — never in a
            client build, and not on the dev server a demo might run from
            (Phase 22A). Set VITE_DEVTOOLS=true locally to enable. */}
        {import.meta.env.VITE_DEVTOOLS === 'true' && (
          <>
            <ReactQueryDevtools buttonPosition='bottom-left' />
            <TanStackRouterDevtools position='bottom-right' />
          </>
        )}
      </>
    )
  },
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})
