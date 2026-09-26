import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  DEFAULT_CHILD,
  slugForModule,
} from '@/features/projects/lib/project-modules'

/** `/o/:workspace/projects/:id` opens the default module (schedule › gantt). */
export const Route = createFileRoute('/_authenticated/o/$orgSlug/projects/$projectId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/o/$orgSlug/projects/$projectId/$module/$child',
      params: {
        orgSlug: params.orgSlug,
        projectId: params.projectId,
        module: slugForModule('schedule'),
        child: DEFAULT_CHILD.schedule,
      },
      replace: true,
    })
  },
})
