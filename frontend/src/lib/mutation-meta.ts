/**
 * How a mutation tells the app-wide error handler (main.tsx) to leave its
 * failure alone.
 *
 * A failed mutation is toasted once by main.tsx's MutationCache handler, in
 * the server's words. A caller that catches `mutateAsync` and toasts the
 * same sentence itself — the budget line dialog, the IPC workbook's
 * Certify — showed the refusal twice. Such a mutation carries
 * `meta: REPORTS_OWN_ERROR`; the handler skips it, and the caller's toast is
 * the one the person reads. A mutation without the meta (and without an
 * `onError` of its own) is handled as before.
 */
export const REPORTS_OWN_ERROR = { reportsOwnError: true } as const

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { reportsOwnError?: boolean }
  }
}
