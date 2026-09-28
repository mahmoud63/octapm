import { useParams, useSearch } from '@tanstack/react-router'
import { ProjectDetail } from './project-detail'

/**
 * Bridges the workspace routes (`/projects/$projectId/$module/$child`) to the
 * ProjectDetail shell. Record deep-links (status, source, recordId) travel in
 * the search string so every module URL stays shareable.
 */
/**
 * The project landing, `/o/:workspace/projects/:id` (L3, workspace switching
 * doc §7): the Overview module — controls strip, setup readiness, details —
 * rather than a redirect to the Gantt.
 */
export function ProjectOverviewPage() {
  const params = useParams({ strict: false }) as { projectId: string }
  return <ProjectDetail projectId={params.projectId} module='overview' />
}

export function ProjectDetailPage() {
  const params = useParams({ strict: false }) as {
    projectId: string
    module?: string
    child?: string
  }
  const search = useSearch({ strict: false }) as {
    status?: string
    source?: string
    recordId?: string
    pin?: string
    date?: string
    new?: string
  }

  const hasDeepLink = Boolean(
    search.status || search.source || search.recordId || search.date || search.new
  )

  return (
    <ProjectDetail
      projectId={params.projectId}
      module={params.module}
      child={params.child}
      initialTarget={
        hasDeepLink && params.module
          ? {
              module: params.module,
              child: params.child,
              status: search.status,
              source: search.source,
              recordId: search.recordId,
              pin: search.pin,
              date: search.date,
              new: search.new,
            }
          : undefined
      }
    />
  )
}
