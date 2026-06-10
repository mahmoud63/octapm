import { useParams, useSearch } from '@tanstack/react-router'
import { ProjectDetail } from './project-detail'

export function ProjectDetailPage() {
  const { projectId } = useParams({
    from: '/_authenticated/projects/$projectId',
  })
  const search = useSearch({ from: '/_authenticated/projects/$projectId' })

  return (
    <ProjectDetail
      projectId={projectId}
      initialTarget={
        search.module
          ? { module: search.module, child: search.child }
          : undefined
      }
    />
  )
}
