import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  DEFAULT_CHILD,
  slugForModule,
} from '@/features/projects/lib/project-modules'

/** `/projects/:id` opens the default module (schedule › gantt). */
export const Route = createFileRoute('/_authenticated/projects/$projectId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/projects/$projectId/$module/$child',
      params: {
        projectId: params.projectId,
        module: slugForModule('schedule'),
        child: DEFAULT_CHILD.schedule,
      },
      replace: true,
    })
  },
})
