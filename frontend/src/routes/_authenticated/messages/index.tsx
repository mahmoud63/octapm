import { createFileRoute } from '@tanstack/react-router'
import { legacyWorkspaceRedirect } from '@/lib/workspace/legacy'

type MessagesSearch = { conversationId?: string }

/** Legacy path: `/messages?conversationId=` opens under the active workspace, `/o/{workspace}/messages` (ENT-4). */
export const Route = createFileRoute('/_authenticated/messages/')({
  validateSearch: (search: Record<string, unknown>): MessagesSearch => ({
    conversationId:
      typeof search.conversationId === 'string'
        ? search.conversationId
        : undefined,
  }),
  beforeLoad: legacyWorkspaceRedirect,
})
