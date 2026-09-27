import { z } from 'zod'

export const activityStatusSchema = z.enum([
  'todo',
  'in_progress',
  'complete',
  'delayed',
])

export const activitySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  // Two different identifiers: the code OctaPM gives an activity, and the one
  // it arrived with from P6. An imported activity has only the second, so a
  // picker that shows neither leaves the planner nothing to recognise.
  activityCode: z.string().nullable().optional(),
  p6ActivityId: z.string().nullable().optional(),
  wbsCode: z.string().nullable(),
  category: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  // Withheld (omitted) from a member who may read neither the BOQ nor the
  // cost module; the allocated* figures from one who may not read the BOQ.
  budget: z.number().optional(),
  allocatedBoqQuantity: z.number().optional(),
  allocatedBoqAmount: z.number().optional(),
  allocatedBoqWeight: z.number().optional(),
  approvedAllocationCount: z.number().optional(),
  isMilestone: z.boolean(),
  pctComplete: z.number(),
  status: activityStatusSchema,
  assignedEngineers: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string(),
    })
  ),
  createdAt: z.string(),
})

export type Activity = z.infer<typeof activitySchema>

export const createActivitySchema = z
  .object({
    name: z.string().min(1, 'Activity name is required'),
    category: z.string().optional(),
    wbsCode: z.string().optional(),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    engineerIds: z
      .array(z.string().uuid())
      .min(1, 'At least one engineer must be assigned'),
    budget: z
      .number({ error: 'Budget must be a number' })
      .min(0, 'Budget cannot be negative')
      .optional(),
    isMilestone: z.boolean().default(false),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  })

export type CreateActivityInput = z.infer<typeof createActivitySchema>
