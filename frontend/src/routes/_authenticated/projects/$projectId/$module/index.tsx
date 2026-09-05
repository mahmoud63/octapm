import { createFileRoute, notFound } from '@tanstack/react-router'
import { ProjectDetailPage } from '@/features/projects/components/project-detail-page'
import { moduleFromSlug } from '@/features/projects/lib/project-modules'

/** One workspace module, e.g. `/projects/:id/site-reporting`. */
export const Route = createFileRoute(
  '/_authenticated/projects/$projectId/$module/'
)({
  beforeLoad: ({ params }) => {
    if (!moduleFromSlug(params.module)) throw notFound()
  },
  component: ProjectDetailPage,
})
