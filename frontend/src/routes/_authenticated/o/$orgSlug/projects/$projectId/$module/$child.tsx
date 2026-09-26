import { createFileRoute, notFound } from '@tanstack/react-router'
import { ProjectDetailPage } from '@/features/projects/components/project-detail-page'
import { moduleFromSlug } from '@/features/projects/lib/project-modules'

/** A module sub-tab, e.g. `/projects/:id/quality/ncr` or `/projects/:id/schedule/gantt`. */
export const Route = createFileRoute(
  '/_authenticated/o/$orgSlug/projects/$projectId/$module/$child'
)({
  beforeLoad: ({ params }) => {
    if (!moduleFromSlug(params.module)) throw notFound()
  },
  component: ProjectDetailPage,
})
