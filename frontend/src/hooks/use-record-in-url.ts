import { useCallback, useEffect, useState } from 'react'

/**
 * Keeps the open record in the address bar.
 *
 * Every register in the product could be opened *from* a link — a notification,
 * a comment, a message — but none of them produced one: opening a record left
 * the URL on the module, so it could not be copied to a colleague and a refresh
 * lost it. This is the other half of that contract.
 *
 * The URL is edited with `replaceState` rather than through the router: opening
 * a dialog is not a navigation, and pushing history would turn Back into "close
 * the dialog" a dozen times over.
 */
export function useRecordInUrl(
  source: string,
  initialRecordId?: string | null,
): [string | null, (recordId: string | null) => void] {
  const [recordId, setRecordId] = useState<string | null>(() => {
    if (initialRecordId) return initialRecordId
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    // Only claim the record if it was addressed to this register.
    return params.get('source') === source ? params.get('recordId') : null
  })

  // Reflect whatever the panel decides back into the address bar.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const current = url.searchParams.get('source') === source ? url.searchParams.get('recordId') : null
    if (current === recordId) return

    if (recordId) {
      url.searchParams.set('recordId', recordId)
      url.searchParams.set('source', source)
    } else {
      url.searchParams.delete('recordId')
      url.searchParams.delete('source')
    }
    window.history.replaceState(window.history.state, '', url.toString())
  }, [recordId, source])

  // A link arriving while the register is already open — a notification clicked
  // in another tab, or the browser's Back button.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => {
      const params = new URLSearchParams(window.location.search)
      setRecordId(params.get('source') === source ? params.get('recordId') : null)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [source])

  return [recordId, useCallback((next: string | null) => setRecordId(next), [])]
}
