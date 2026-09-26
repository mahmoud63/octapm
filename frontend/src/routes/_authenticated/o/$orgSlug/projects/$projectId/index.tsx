import { createFileRoute } from '@tanstack/react-router'
import { ProjectOverviewPage } from '@/features/projects/components/project-detail-page'

/**
 * `/o/:workspace/projects/:id` lands on the Overview (L3, workspace
 * switching doc §7): the controls strip and the setup readiness checklist,
 * then the project's details. The Gantt is one module away in the module
 * bar; it used to be the landing, which put a planner's working screen in
 * front of everyone who opened the project.
 */
export const Route = createFileRoute('/_authenticated/o/$orgSlug/projects/$projectId/')({
  component: ProjectOverviewPage,
})
