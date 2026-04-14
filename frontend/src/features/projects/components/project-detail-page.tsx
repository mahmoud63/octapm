import { useParams } from '@tanstack/react-router'
import { ProjectDetail } from './project-detail'

export function ProjectDetailPage() {
  const { projectId } = useParams({
    from: '/_authenticated/projects/$projectId',
  })

  return <ProjectDetail projectId={projectId} />
}
