import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

/**
 * How long a sheet takes to leave the screen. React Native's Modal slides
 * out over 300 ms on every platform; the trap it holds on focus lives until
 * that finishes.
 */
export const SHEET_EXIT_MS = 350

/**
 * Navigate only once a sheet has really gone.
 *
 * Closing a sheet and pushing a route in the same breath is a trap on the
 * web: the navigator freezes the screen being left while its sheet is still
 * sliding out, and the sheet's focus trap then steals focus on the screen
 * that was pushed, so inputs there lose every keystroke. Asking for the
 * route here defers the push until the sheet is closed and its exit
 * animation has had time to finish.
 */
export function useNavigateAfterClose(open: boolean) {
  const router = useRouter()
  const [pending, setPending] = useState<{ route: string; replace: boolean } | null>(null)

  useEffect(() => {
    if (!pending || open) return
    const timer = setTimeout(() => {
      setPending(null)
      if (pending.replace) router.replace(pending.route as never)
      else router.push(pending.route as never)
    }, SHEET_EXIT_MS)
    return () => clearTimeout(timer)
  }, [pending, open, router])

  return (route: string, options: { replace?: boolean } = {}) => setPending({ route, replace: !!options.replace })
}
