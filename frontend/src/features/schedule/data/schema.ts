import { z } from 'zod'

export const scheduleActivitySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  wbsCode: z.string().nullable(),
  category: z.string().nullable(),
  duration: z.number(),
  earlyStart: z.number().nullable(),
  earlyFinish: z.number().nullable(),
  baselineStart: z.number().int().nullable().optional(),
  baselineFinish: z.number().int().nullable().optional(),
  lateStart: z.number().nullable(),
  lateFinish: z.number().nullable(),
  totalFloat: z.number().nullable(),
  actualCost: z.number().nullable().optional(),
  actualStart: z.string().nullable().optional(),
  actualFinish: z.string().nullable().optional(),
  budget: z.number(),
  generatedBudget: z.number().optional(),
  allocatedBoqQuantity: z.number().optional(),
  allocatedBoqAmount: z.number().optional(),
  allocatedBoqWeight: z.number().optional(),
  approvedAllocationCount: z.number().optional(),
  isMilestone: z.boolean(),
  isCritical: z.boolean(),
  predecessors: z.string().nullable(),
  batchId: z.string().nullable().optional(),
  pctComplete: z.number(),
  status: z.enum(['todo', 'in_progress', 'complete', 'delayed']),
  sortOrder: z.number(),
  createdAt: z.string(),
})

export const riskSchema = z.object({
  ref: z.string(),
  description: z.string(),
  probability: z.string(),
  impact: z.string(),
  severity: z.string(),
  mitigation: z.string(),
  phase: z.string().optional(),
})

export const milestoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  day: z.number(),
  dateStr: z.string().optional(),
  phase: z.string().optional(),
  critical: z.boolean().optional(),
  description: z.string().optional(),
})

export const scheduleRevisionSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  activityCount: z.number(),
  criticalCount: z.number(),
  totalBudget: z.number(),
  generatedTotalBudget: z.number().optional(),
  unallocatedBoqAmount: z.number().optional(),
  createdAt: z.string(),
  projectSummary: z.any().nullable(),
  risks: z.array(z.any()).nullable(),
  milestones: z.array(z.any()).nullable(),
  wbs: z.array(z.any()).nullable(),
  resourceSummary: z.array(z.any()).nullable(),
  longLeadItems: z.array(z.any()).nullable(),
  assumptions: z.array(z.any()).nullable(),
  criticalPath: z.array(z.any()).nullable(),
})

export const projectScheduleSchema = z.object({
  revision: scheduleRevisionSchema,
  activities: z.array(scheduleActivitySchema),
})

export type ScheduleActivity = z.infer<typeof scheduleActivitySchema>
export type ScheduleRevision = z.infer<typeof scheduleRevisionSchema>
export type ProjectSchedule = z.infer<typeof projectScheduleSchema>
export type Risk = z.infer<typeof riskSchema>
export type Milestone = z.infer<typeof milestoneSchema>
