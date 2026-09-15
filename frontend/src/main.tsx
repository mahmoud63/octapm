import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { AxiosError } from 'axios'
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'
import { useAuthStore } from '@/stores/auth-store'
import { handleServerError } from '@/lib/handle-server-error'
import { onOutboxSynced, startOutbox } from '@/lib/offline/outbox'
import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
// Generated Routes
import { routeTree } from './routeTree.gen'
// Styles
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.log({ failureCount, error })

        if (failureCount >= 0 && import.meta.env.DEV) return false
        if (failureCount > 3 && import.meta.env.PROD) return false

        return !(
          error instanceof AxiosError &&
          [401, 403].includes(error.response?.status ?? 0)
        )
      },
      refetchOnWindowFocus: import.meta.env.PROD,
      staleTime: 10 * 1000, // 10s
    },
    mutations: {
      onError: (error) => {
        handleServerError(error)

        if (error instanceof AxiosError) {
          if (error.response?.status === 304) {
            toast.error('Content not modified!')
          }
        }
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof AxiosError) {
        if (error.response?.status === 401) {
          // A 401 with nobody signed in is the tail of a deliberate sign-out,
          // not an expired session (Phase 22A).
          if (!useAuthStore.getState().auth.user) return
          // one toast however many requests answered 401 together
          toast.error('Session expired!', { id: 'session-expired' })
          useAuthStore.getState().auth.reset()
          const redirect = `${router.history.location.href}`
          router.navigate({ to: '/sign-in', search: { redirect } })
        }
        if (error.response?.status === 500) {
          toast.error('Internal Server Error!')
          // Only navigate to error page in production to avoid disrupting HMR in development
          if (import.meta.env.PROD) {
            router.navigate({ to: '/500' })
          }
        }
        if (error.response?.status === 403) {
          // router.navigate("/forbidden", { replace: true });
        }
      }
    },
  }),
})

// Everything fetched belongs to the person who is signed in. Whenever the
// identity changes — sign-in, sign-out, or a refresh that installs another
// person's session — the cache is emptied (Phase 21D, CX21-456 / CX21-467).
useAuthStore.subscribe((state, previous) => {
  if (state.auth.user?.id !== previous.auth.user?.id) queryClient.clear()
})

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Installable app shell + offline outbox (OCTA-MOB-PWA-018).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () =>
      toast('A new version of OctaPM is ready', {
        duration: Infinity,
        action: { label: 'Reload', onClick: () => void updateSW(true) },
      }),
    onOfflineReady: () => toast.success('OctaPM is ready to work offline'),
  })
}
startOutbox()
onOutboxSynced((projectIds) => {
  toast.success(
    projectIds.length === 1
      ? 'Offline changes uploaded'
      : `Offline changes uploaded for ${projectIds.length} projects`
  )
  void queryClient.invalidateQueries()
})

// The printed footer carries the portal address, so take it from the running
// origin rather than hardcoding a domain that would be wrong per deployment.
document.documentElement.style.setProperty(
  '--octa-print-url',
  `'${window.location.host}'`
)

// Render the app
const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <RouterProvider router={router} />
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
