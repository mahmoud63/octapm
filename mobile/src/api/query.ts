/**
 * Server state, cached and refreshed on the app's terms.
 *
 * Reads are fresh for a minute and kept for a day, so a screen the person
 * has already seen draws instantly and refreshes behind them. Retries happen
 * only for failures that retrying can fix — a lost connection, a slow server —
 * never for a refused permission or a missing record. Offline, queries serve
 * what they have rather than failing.
 */
import { QueryClient } from '@tanstack/react-query'
import { isAppError } from '@/api/errors'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60_000,
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: false,
      retry: (count, error) => count < 2 && (isAppError(error) ? error.retryable : true),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 0,
    },
  },
})

/**
 * Query keys, in one place, so that "everything about project X" can be
 * invalidated — or removed — as a unit when the person switches project.
 */
export const keys = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  project: (projectId: string) => ['project', projectId] as const,
  projectScoped: (projectId: string, ...rest: readonly unknown[]) => ['project', projectId, ...rest] as const,
  needsYou: (projectId?: string) => ['needs-you', projectId ?? 'all'] as const,
  notifications: ['notifications'] as const,
  search: (term: string) => ['search', term] as const,
}

/** Drop every cached record of a project. Called when the person leaves it. */
export function forgetProject(projectId: string) {
  queryClient.removeQueries({ queryKey: keys.project(projectId) })
  queryClient.removeQueries({ queryKey: keys.needsYou(projectId) })
}

/** Drop everything. Called on sign-out, before the tokens are cleared. */
export function forgetEverything() {
  queryClient.clear()
}
