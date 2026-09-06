import { createFileRoute } from '@tanstack/react-router'
import { MessagesPage } from '@/features/messages/messages-page'

type MessagesSearch = { conversationId?: string }

/** Messages (OCTA-COMM-CONV-042): `/messages?conversationId=`. */
export const Route = createFileRoute('/_authenticated/messages/')({
  validateSearch: (search: Record<string, unknown>): MessagesSearch => ({
    conversationId:
      typeof search.conversationId === 'string'
        ? search.conversationId
        : undefined,
  }),
  component: function MessagesRoute() {
    const { conversationId } = Route.useSearch()
    return <MessagesPage conversationId={conversationId ?? null} />
  },
})
