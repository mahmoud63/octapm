import { z } from 'zod'
import { hasMoneyPrecision, MONEY_PRECISION_MESSAGE } from '@/lib/money'

const positiveMoneyInputSchema = z
  .number()
  .positive()
  .refine(hasMoneyPrecision, MONEY_PRECISION_MESSAGE)

export const BoqActivitySchema = z.object({
  id: z.string(),
  allocationId: z.string().optional(),
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
  source: z.string().optional(),
  allocationStatus: z
    .enum(['draft', 'submitted', 'approved', 'rejected'])
    .optional(),
  sortOrder: z.number(),
})

export const BoqItemSchema = z.object({
  id: z.string(),
  revisionId: z.string().nullable().optional(),
  code: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  rate: z.number(),
  amount: z.number(),
  isManual: z.boolean(),
  isActive: z.boolean().optional(),
  baselineLocked: z.boolean().optional(),
  sortOrder: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  activeAllocatedQuantity: z.number().optional(),
  activeAllocatedAmount: z.number().optional(),
  approvedAllocatedQuantity: z.number().optional(),
  approvedAllocatedAmount: z.number().optional(),
  pendingAllocatedAmount: z.number().optional(),
  scheduledQuantity: z.number().optional(),
  scheduledValue: z.number().optional(),
  unscheduledQuantity: z.number().optional(),
  unscheduledValue: z.number().optional(),
  earnedValue: z.number().optional(),
  certifiedValue: z.number().optional(),
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
  scheduledValue: z.number().optional(),
  unscheduledValue: z.number().optional(),
  earnedValue: z.number().optional(),
  certifiedValue: z.number().optional(),
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
  scheduledQuantity: z.number(),
  scheduledValue: z.number(),
  unscheduledQuantity: z.number(),
  unscheduledValue: z.number(),
  earnedValue: z.number(),
  certifiedValue: z.number(),
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
  scheduledQuantity: z.number(),
  scheduledValue: z.number(),
  unscheduledQuantity: z.number(),
  unscheduledValue: z.number(),
  earnedValue: z.number(),
  certifiedValue: z.number(),
  unallocatedQuantity: z.number(),
  unallocatedAmount: z.number(),
  items: z.array(AllocationSummaryItemSchema),
})

export const BoqBaselineStateSchema = z.object({
  locked: z.boolean(),
  source: z.enum(['schedule_baseline', 'boq_revision']).nullable(),
  scheduleRevisionId: z.string().nullable(),
  boqRevisionId: z.string().nullable(),
  revisionNumber: z.number().nullable(),
  label: z.string().nullable(),
  lockedAt: z.string().nullable(),
})

export const BoqRevisionSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  revisionNumber: z.number(),
  label: z.string().nullable(),
  status: z.enum([
    'imported',
    'comparison_only',
    'under_review',
    'approved',
    'baselined',
    'superseded',
  ]),
  baselineLocked: z.boolean(),
  lockedAt: z.string().nullable().optional(),
  lockedBy: z.string().nullable().optional(),
  itemCount: z.number(),
  addedCount: z.number(),
  updatedCount: z.number(),
  removedCount: z.number(),
  unchangedCount: z.number(),
  blockedCount: z.number(),
  totalAmount: z.number(),
  sourceDocumentId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const ProjectBoqSchema = z.object({
  projectId: z.string(),
  hasUploadedBoq: z.boolean(),
  uploadedAt: z.string().nullable(),
  items: z.array(BoqItemSchema),
  financial: BoqFinancialSummarySchema.nullable(),
  allocationSummary: AllocationSummarySchema.optional(),
  baseline: BoqBaselineStateSchema.optional(),
  currentRevision: BoqRevisionSummarySchema.nullable().optional(),
  latestRevision: BoqRevisionSummarySchema.nullable().optional(),
  revisions: z.array(BoqRevisionSummarySchema).optional(),
})

export const CreateBoqItemInputSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1).max(255),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  rate: positiveMoneyInputSchema,
  // activityId attaches the row to an activity already on the programme;
  // activityName creates one for it; neither leaves the row unallocated, to be
  // split across activities afterwards. Never both.
  activityId: z.string().uuid().optional(),
  activityName: z.string().min(1).max(255).optional(),
})

export const CreateBoqActivityInputSchema = z.object({
  activityId: z.string().uuid().optional(),
  activityName: z.string().min(1).max(255).optional(),
  unit: z.string().min(1),
  quantity: z.number().positive(),
  rate: positiveMoneyInputSchema,
  dependencyType: z.enum(['FS', 'SS']).nullable().optional(),
  predecessorCode: z.string().nullable().optional(),
})

export const UpdateBoqActivityInputSchema = z.object({
  activityName: z.string().min(1).max(255).optional(),
  unit: z.string().min(1).optional(),
  quantity: z.number().positive().optional(),
  rate: positiveMoneyInputSchema.optional(),
  dependencyType: z.enum(['FS', 'SS']).nullable().optional(),
  predecessorCode: z.string().nullable().optional(),
  allocationId: z.string().optional(),
})

export type BoqActivity = z.infer<typeof BoqActivitySchema>
export type BoqItemWithActivities = z.infer<typeof BoqItemSchema>
export type BoqFinancialSummary = z.infer<typeof BoqFinancialSummarySchema>
export type ActivityBoqAllocation = z.infer<typeof ActivityBoqAllocationSchema>
export type AllocationSummary = z.infer<typeof AllocationSummarySchema>
export type BoqBaselineState = z.infer<typeof BoqBaselineStateSchema>
export type BoqRevisionSummary = z.infer<typeof BoqRevisionSummarySchema>
export type BoqRevisionStatus = BoqRevisionSummary['status']
export type ProjectBoq = z.infer<typeof ProjectBoqSchema>
export type ExtraService = z.infer<typeof ExtraServiceSchema>
export type CreateBoqItemInput = z.infer<typeof CreateBoqItemInputSchema>
export type CreateBoqActivityInput = z.infer<
  typeof CreateBoqActivityInputSchema
>
export type UpdateBoqActivityInput = z.infer<
  typeof UpdateBoqActivityInputSchema
>

// ─── PC-5: BOQ item detail (GET /projects/:id/boq/items/:itemId/detail) ───
// Every figure says where it comes from (the three truths, OCTAPM_PROJECT_
// CONTROL_MODEL §3). A figure no service can prove yet is `notAvailable` and
// names the wave that brings it; a section the viewer may not read is
// `{ allowed: false, module, reason }` with no data — the server omits it.
export const ControlsFigureSchema = z.object({
  value: z.number().nullable(),
  truth: z.enum(['source', 'derived', 'projection']).nullable(),
  basis: z.string(),
  derivedFrom: z.array(z.record(z.string(), z.unknown())).optional(),
  notAvailable: z.boolean().optional(),
  wave: z.string().optional(),
})

export const ControlsSectionDeniedSchema = z.object({
  allowed: z.literal(false),
  module: z.string(),
  reason: z.string(),
})

/** A capped list: its first rows, how many there are, and where the rest live. */
export const controlsCappedList = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number(),
    viewAll: z.string().nullable().optional(),
  })

const ControlsStructureRefSchema = z
  .object({
    id: z.string(),
    code: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
    href: z.string().nullable().optional(),
  })
  .nullable()

export const ControlsStructureSchema = z.object({
  allowed: z.literal(true),
  wbsCode: z.string().nullable().optional(),
  wbs: ControlsStructureRefSchema,
  location: ControlsStructureRefSchema,
  costCode: ControlsStructureRefSchema,
  costCodeNote: z.string().optional(),
})

const looseRow = z.object({ id: z.string() }).passthrough()

export const BoqItemDetailSchema = z.object({
  kind: z.literal('boq_item'),
  id: z.string(),
  href: z.string().nullable().optional(),
  header: z.object({
    id: z.string(),
    code: z.string(),
    description: z.string().nullable().optional(),
    section: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    supersededAt: z.string().nullable().optional(),
    revision: z
      .object({
        id: z.string(),
        revisionNumber: z.number().nullable().optional(),
        label: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    baselineLock: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
  sections: z.object({
    structure: ControlsStructureSchema,
    mapping: z.object({
      allowed: z.literal(true),
      mappingRule: z.string(),
      mappingState: z.string().nullable(),
      allocationCount: z.number(),
      allocations: controlsCappedList(
        z.object({
          allocationId: z.string(),
          status: z.string(),
          basis: z.string().nullable().optional(),
          quantity: ControlsFigureSchema,
          amount: ControlsFigureSchema,
          authorisedQuantity: ControlsFigureSchema,
          activity: z
            .object({
              id: z.string(),
              code: z.string().nullable(),
              name: z.string(),
              // Sent only to a schedule reader; anyone else gets id, code and
              // name, href null and `schedule: { allowed: false, ... }`.
              startDate: z.string().nullable().optional(),
              endDate: z.string().nullable().optional(),
              isCritical: z.boolean().optional(),
              totalFloat: z.number().nullable().optional(),
              isActive: z.boolean().optional(),
              pctComplete: ControlsFigureSchema.nullable().optional(),
              progressSource: z.string().nullable().optional(),
              href: z.string().nullable().optional(),
              schedule: ControlsSectionDeniedSchema.optional(),
            })
            .nullable(),
        })
      ),
    }),
    quantities: z.object({
      allowed: z.literal(true),
      unit: z.string().nullable(),
      unitCode: z.string().nullable().optional(),
      original: ControlsFigureSchema,
      current: ControlsFigureSchema,
      authorised: ControlsFigureSchema,
      approvedVariation: ControlsFigureSchema,
      mapped: ControlsFigureSchema.nullable(),
      unallocated: ControlsFigureSchema.nullable(),
      installed: ControlsFigureSchema,
      paid: ControlsFigureSchema,
      forecast: ControlsFigureSchema,
    }),
    money: z.object({
      allowed: z.literal(true),
      rate: ControlsFigureSchema,
      amount: ControlsFigureSchema,
      approvedAllocated: ControlsFigureSchema.nullable(),
      earnedValue: ControlsFigureSchema.nullable(),
      forecast: ControlsFigureSchema,
    }),
    certification: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        certifiedQuantity: ControlsFigureSchema,
        certifiedAmount: ControlsFigureSchema.nullable(),
        lines: controlsCappedList(looseRow),
      }),
    ]),
    commitments: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        committed: ControlsFigureSchema,
        lines: controlsCappedList(looseRow),
      }),
    ]),
    changes: z.union([
      ControlsSectionDeniedSchema,
      z.object({ allowed: z.literal(true), changeOrders: controlsCappedList(looseRow) }),
    ]),
    procurement: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        note: z.string().optional(),
        poLines: controlsCappedList(looseRow),
      }),
    ]),
    readiness: z.object({
      allowed: z.literal(true),
      basis: z.string().optional(),
      flags: z.array(z.record(z.string(), z.unknown())),
      notItemised: z.array(z.record(z.string(), z.unknown())),
      note: z.string().nullable().optional(),
    }),
    history: z.union([
      ControlsSectionDeniedSchema,
      z.object({ allowed: z.literal(true), events: z.array(looseRow) }).passthrough(),
    ]),
    documents: z.object({
      allowed: z.literal(true),
      attachments: controlsCappedList(looseRow),
    }),
  }),
})

export type ControlsFigure = z.infer<typeof ControlsFigureSchema>
export type ControlsSectionDenied = z.infer<typeof ControlsSectionDeniedSchema>
export type ControlsStructure = z.infer<typeof ControlsStructureSchema>
export type BoqItemDetail = z.infer<typeof BoqItemDetailSchema>
