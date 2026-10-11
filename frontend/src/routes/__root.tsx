import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
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
