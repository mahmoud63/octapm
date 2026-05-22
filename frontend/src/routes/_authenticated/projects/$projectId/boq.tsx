import { createFileRoute } from '@tanstack/react-router'
import { BoqPage } from '@/features/boq/components/boq-page'

export const Route = createFileRoute('/_authenticated/projects/$projectId/boq')({
  component: BoqPageRoute,
})

function BoqPageRoute() {
  const { projectId } = Route.useParams()
  return <BoqPage projectId={projectId} />
}
