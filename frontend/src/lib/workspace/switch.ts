import type { QueryClient } from '@tanstack/react-query'
import { enterWorkspace } from '@/services/auth/api'
import type { ActiveWorkspace } from '@/services/auth/types'
import { useAuthStore } from '@/stores/auth-store'
import {
  dropApiCache,
  lockOutbox,
  outboxOwnerKey,
  setOutboxOwner,
  syncOutbox,
} from '@/lib/offline/outbox'
import { realtime } from '@/lib/realtime'
import { rememberWorkspace } from './paths'

/**
 * The switch (workspace switching doc §3), in the order that keeps one
 * workspace's data from ever reaching the other. Both the header switcher
 * and the `/o/$orgSlug` route guard go through here — the guard is what
 * makes the URL the source of truth: opening `/o/beta/…` while bound to
 * `acme` switches first and renders after, and browser Back does the reverse.
 *
 *  1. freeze — `switching=true`, the outbox locked so no replay starts;
 *  2. leave every realtime room and forget them;
 *  3. new tokens bound to the target membership (nothing is revoked);
 *  4. every cached query gone, the service worker's API cache gone;
 *  5. the outbox re-keyed to `userId:orgId` of the target, then replayed;
 *  6. the socket reconnects with the new token (the layout's effect does it
 *     on the token change; it is also asked directly so a page that keeps the
 *     same token binding for a moment cannot hear the old workspace);
 *  7. unfreeze.
 *
 * Navigation is the caller's: the guard is already on the target URL, and
 * the switcher navigates to the target workspace's home.
 */
export const switchWorkspace = async ({
  queryClient,
  orgId,
  identityToken,
}: {
  queryClient: QueryClient
  orgId: string
  identityToken?: string
}): Promise<ActiveWorkspace> => {
  const { auth } = useAuthStore.getState()
  const previous =
    auth.user && auth.workspace
      ? outboxOwnerKey(auth.user.id, auth.workspace.orgId)
      : null
  auth.setSwitching(true)
  lockOutbox()
  realtime.leaveAll()
  try {
    return await enter({ queryClient, orgId, identityToken })
  } catch (error) {
    // A refused switch (suspended there, policy) leaves the session where it
    // was; its own items may replay again.
    if (previous) await setOutboxOwner(previous)
    throw error
  } finally {
    useAuthStore.getState().auth.setSwitching(false)
  }
}

const enter = async ({
  queryClient,
  orgId,
  identityToken,
}: {
  queryClient: QueryClient
  orgId: string
  identityToken?: string
}): Promise<ActiveWorkspace> => {
  const { auth } = useAuthStore.getState()
  const session = await enterWorkspace(orgId, { identityToken })
  auth.setSession(session.user, session.tokens.accessToken, {
    workspace: session.workspace ?? null,
    memberships: session.memberships,
  })
  // Nothing fetched for the previous workspace may be shown in this one.
  queryClient.clear()
  await dropApiCache()
  const workspace = useAuthStore.getState().auth.workspace
  if (!workspace) {
    throw new Error('The workspace session did not name its workspace')
  }
  rememberWorkspace(workspace.segment)
  realtime.connect(session.tokens.accessToken)
  await setOutboxOwner(outboxOwnerKey(session.user.id, orgId))
  void syncOutbox()
  return workspace
}
