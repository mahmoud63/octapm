import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { AxiosError } from 'axios'
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'
import { useAuthStore } from '@/stores/auth-store'
import { handleServerError } from '@/lib/handle-server-error'
import { isSessionRevokedError, onSessionEnded } from '@/services/api/client'
// Types meta.reportsOwnError on every mutation (the handler below reads it).
import '@/lib/mutation-meta'
import {
  lockOutbox,
  onOutboxSynced,
  outboxOwnerKey,
  setOutboxOwner,
  startOutbox,
} from '@/lib/offline/outbox'
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
  },
  // Every failed mutation is toasted once, in the server's words — unless
  // the mutation handles its failure itself: one with an onError of its own
  // (which, as the default-option this replaces, stands in for this
  // handler), or one whose caller catches mutateAsync and toasts the same
  // sentence (meta.reportsOwnError, lib/mutation-meta.ts). Before, the
  // budget line dialog and the IPC workbook showed each refusal twice.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.reportsOwnError || mutation.options.onError) return
      // An ended session is not an error to toast: the request layer has
      // already sent the person to sign in again (D-ID-1 Q6).
      if (isSessionRevokedError(error)) return
      handleServerError(error)

      if (error instanceof AxiosError) {
        if (error.response?.status === 304) {
          toast.error('Content not modified!')
        }
      }
    },
  }),
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

// Everything fetched belongs to the person who is signed in, in the workspace
// they are signed in to. Whenever the identity changes — sign-in, sign-out, or
// a refresh that installs another person's session — or the membership the
// token is bound to changes (a workspace switch, ENT-4), the cache is emptied
// (Phase 21D, CX21-456 / CX21-467; workspace switching doc §3, step 5).
const membershipKey = (state: ReturnType<typeof useAuthStore.getState>) =>
  state.auth.workspace
    ? `${state.auth.workspace.orgId}:${state.auth.workspace.membershipId ?? ''}`
    : null
useAuthStore.subscribe((state, previous) => {
  if (state.auth.user?.id !== previous.auth.user?.id) {
    queryClient.clear()
    return
  }
  const before = membershipKey(previous)
  const after = membershipKey(state)
  if (before && after && before !== after) queryClient.clear()
})

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// A session the server revoked (401 SESSION_REVOKED: a password reset, an
// account close or an administrator's MFA reset since the token was minted)
// ends like an expired one — one toast, then the sign-in page — never a
// stream of error toasts (D-ID-1 Q6). The request layer has already emptied
// the store; this only decides where the person lands.
onSessionEnded(() => {
  toast.error('Your session has ended. Please sign in again.', {
    id: 'session-expired',
  })
  if (router.state.location.pathname.startsWith('/sign-in')) return
  const redirect = `${router.history.location.href}`
  router.navigate({ to: '/sign-in', search: { redirect } })
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
// The outbox replays only for the workspace the session is bound to
// (workspace switching doc §4, rule 3): it starts once a session names its
// workspace, keyed `userId:orgId`, and never before. Items queued before this
// wave carry no owner and are claimed by the first owner set on this browser;
// another person's items are dropped, another workspace's are kept locked.
let outboxOwner: string | null = null
const followSession = (state: ReturnType<typeof useAuthStore.getState>) => {
  const { user, workspace } = state.auth
  const owner = user && workspace ? outboxOwnerKey(user.id, workspace.orgId) : null
  if (owner === outboxOwner) return
  outboxOwner = owner
  if (!owner) {
    lockOutbox()
    return
  }
  void setOutboxOwner(owner).then(() => startOutbox())
}
useAuthStore.subscribe(followSession)
followSession(useAuthStore.getState())
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
