import { createFileRoute } from '@tanstack/react-router'
import { ProjectDetailPage } from '@/features/projects/components/project-detail-page'

type ProjectDetailSearch = {
  module?: string
  child?: string
  status?: string
  source?: string
  recordId?: string
}

export const Route = createFileRoute('/_authenticated/projects/$projectId')({
  validateSearch: (search: Record<string, unknown>): ProjectDetailSearch => ({
    module: typeof search.module === 'string' ? search.module : undefined,
    child: typeof search.child === 'string' ? search.child : undefined,
    status: typeof search.status === 'string' ? search.status : undefined,
    source: typeof search.source === 'string' ? search.source : undefined,
    recordId: typeof search.recordId === 'string' ? search.recordId : undefined,
  }),
  component: ProjectDetailPage,
})
