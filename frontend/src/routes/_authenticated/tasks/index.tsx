import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { legacyWorkspaceRedirect } from '@/lib/workspace/legacy'
import { priorities, statuses } from '@/features/tasks/data/data'

const taskSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(10),
  status: z
    .array(z.enum(statuses.map((status) => status.value)))
    .optional()
    .catch([]),
  priority: z
    .array(z.enum(priorities.map((priority) => priority.value)))
    .optional()
    .catch([]),
  filter: z.string().optional().catch(''),
  /** A task deep link (`/tasks?recordId=`) opens that task. */
  recordId: z.string().optional().catch(undefined),
  /** Arrive with the create drawer open (`/tasks?new=task`, Phase 22A quick actions). */
  new: z.string().optional().catch(undefined),
})

/** Legacy path: the same page under the active workspace, `/o/{workspace}/tasks` (ENT-4). */
export const Route = createFileRoute('/_authenticated/tasks/')({
  validateSearch: taskSearchSchema,
  beforeLoad: legacyWorkspaceRedirect,
})
