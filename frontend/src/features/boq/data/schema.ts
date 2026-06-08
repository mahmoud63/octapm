import { z } from 'zod'

export const BoqActivitySchema = z.object({
  id: z.string(),
  boqItemId: z.string(),
  activityCode: z.string(),
  activityName: z.string(),
  unit: z.string().nullable(),
  quantity: z.number(),
  rate: z.number(),
  budget: z.number(),
  dependencyType: z.string().nullable(),
  predecessorCode: z.string().nullable(),
  isManual: z.boolean(),
  sortOrder: z.number(),
})

export const BoqItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  rate: z.number(),
  amount: z.number(),
  isManual: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string().optional(),
  activeAllocatedQuantity: z.number().optional(),
  activeAllocatedAmount: z.number().optional(),
  approvedAllocatedQuantity: z.number().optional(),
  approvedAllocatedAmount: z.number().optional(),
  pendingAllocatedAmount: z.number().optional(),
  unallocatedQuantity: z.number().optional(),
  unallocatedAmount: z.number().optional(),
  activities: z.array(BoqActivitySchema),
})

export const ExtraServiceSchema = z.object({
  label: z.string(),
  percentage: z.number(),
  value: z.number().optional(),
})

export const BoqFinancialSummarySchema = z.object({
  subtotal1: z.number(),
  extraServices: z.array(ExtraServiceSchema),
  subtotal2: z.number(),
  totalProjectCost: z.number(),
})

export const ActivityBoqAllocationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  boqItemId: z.string(),
  activityId: z.string(),
  quantity: z.number(),
  amount: z.number(),
  weight: z.number(),
  source: z.string(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']),
  isActive: z.boolean(),
  notes: z.string().nullable().optional(),
  submittedBy: z.string().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  rejectedBy: z.string().nullable().optional(),
  rejectedAt: z.string().nullable().optional(),
  rejectedReason: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  boqItem: z
    .object({
      id: z.string(),
      code: z.string(),
      description: z.string(),
      unit: z.string().nullable(),
      quantity: z.number(),
      rate: z.number(),
      amount: z.number(),
      sortOrder: z.number(),
    })
    .nullable(),
  activity: z
    .object({
      id: z.string(),
      activityId: z.string(),
      name: z.string(),
      wbsCode: z.string().nullable(),
      category: z.string().nullable(),
      sortOrder: z.number(),
    })
    .nullable(),
})

export const AllocationSummaryItemSchema = z.object({
  boqItemId: z.string(),
  code: z.string(),
  description: z.string(),
  quantity: z.number(),
  amount: z.number(),
  activeAllocatedQuantity: z.number(),
  activeAllocatedAmount: z.number(),
  approvedAllocatedQuantity: z.number(),
  approvedAllocatedAmount: z.number(),
  pendingAllocatedAmount: z.number(),
  unallocatedQuantity: z.number(),
  unallocatedAmount: z.number(),
})

export const AllocationSummarySchema = z.object({
  totalBoqQuantity: z.number(),
  totalBoqAmount: z.number(),
  activeAllocatedQuantity: z.number(),
  activeAllocatedAmount: z.number(),
  approvedAllocatedQuantity: z.number(),
  approvedAllocatedAmount: z.number(),
  pendingAllocatedAmount: z.number(),
  unallocatedQuantity: z.number(),
  unallocatedAmount: z.number(),
  items: z.array(AllocationSummaryItemSchema),
})

export const ProjectBoqSchema = z.object({
  projectId: z.string(),
  hasUploadedBoq: z.boolean(),
  uploadedAt: z.string().nullable(),
  items: z.array(BoqItemSchema),
  financial: BoqFinancialSummarySchema.nullable(),
  allocationSummary: AllocationSummarySchema.optional(),
})

export const CreateBoqItemInputSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1).max(255),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  rate: z.number().positive(),
  activityName: z.string().min(1).max(255),
  activityCode: z.string().min(1).max(20),
})

export const CreateBoqActivityInputSchema = z.object({
  activityName: z.string().min(1).max(255),
  unit: z.string().min(1),
  quantity: z.number().positive(),
  rate: z.number().positive(),
  dependencyType: z.enum(['FS', 'SS']).nullable().optional(),
  predecessorCode: z.string().nullable().optional(),
})

export const UpdateBoqActivityInputSchema = z.object({
  activityCode: z.string().min(1).max(20).optional(),
  activityName: z.string().min(1).max(255).optional(),
  unit: z.string().min(1).optional(),
  quantity: z.number().positive().optional(),
  rate: z.number().nonnegative().optional(),
  dependencyType: z.enum(['FS', 'SS']).nullable().optional(),
  predecessorCode: z.string().nullable().optional(),
})

export type BoqActivity = z.infer<typeof BoqActivitySchema>
export type BoqItemWithActivities = z.infer<typeof BoqItemSchema>
export type BoqFinancialSummary = z.infer<typeof BoqFinancialSummarySchema>
export type ActivityBoqAllocation = z.infer<
  typeof ActivityBoqAllocationSchema
>
export type AllocationSummary = z.infer<typeof AllocationSummarySchema>
export type ProjectBoq = z.infer<typeof ProjectBoqSchema>
export type ExtraService = z.infer<typeof ExtraServiceSchema>
export type CreateBoqItemInput = z.infer<typeof CreateBoqItemInputSchema>
export type CreateBoqActivityInput = z.infer<typeof CreateBoqActivityInputSchema>
export type UpdateBoqActivityInput = z.infer<typeof UpdateBoqActivityInputSchema>
