import { createFileRoute } from '@tanstack/react-router'
import { ProjectDetailPage } from '@/features/projects/components/project-detail-page'

type ProjectDetailSearch = {
  module?: string
  child?: string
}

export const Route = createFileRoute('/_authenticated/projects/$projectId')({
  validateSearch: (search: Record<string, unknown>): ProjectDetailSearch => ({
    module: typeof search.module === 'string' ? search.module : undefined,
    child: typeof search.child === 'string' ? search.child : undefined,
  }),
  component: ProjectDetailPage,
})
