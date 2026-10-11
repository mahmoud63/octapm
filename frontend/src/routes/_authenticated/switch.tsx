import { createFileRoute } from '@tanstack/react-router'
import { safeInternalPath } from '@/lib/domains'
import { SwitchOffer } from '@/features/home/switch-offer'

type SwitchSearch = {
  /** The workspace segment the link belongs to. */
  to: string
  /** Where to go inside it, a legacy path with its search string. */
  next: string
  name?: string
  project?: string
}

/**
 * A link into another of the person's workspaces (deep-link rule §108): the
 * switch is offered, never made silently, so nobody finds themselves in a
 * different company's workspace because a colleague sent a link.
 */
export const Route = createFileRoute('/_authenticated/switch')({
  validateSearch: (search: Record<string, unknown>): SwitchSearch => ({
    to: typeof search.to === 'string' ? search.to : '',
    // Only a path inside this application (never //host or a scheme): the
    // offer's button navigates to it (open-redirect protection).
    next: safeInternalPath(search.next) ?? '/',
    name: typeof search.name === 'string' ? search.name : undefined,
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
  component: function SwitchRoute() {
    const search = Route.useSearch()
    return <SwitchOffer {...search} />
  },
})
