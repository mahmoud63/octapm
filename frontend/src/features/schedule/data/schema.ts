import { z } from 'zod'

export const dependencyRelationshipSchema = z.enum(['FS', 'SS', 'FF', 'SF'])

export const progressMethodSchema = z.enum([
  'percent',
  'quantity',
  'weighted_milestone',
  'inspection',
  'manual',
])

export const progressMethodConfigSchema = z
  .object({
    id: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    activityId: z.string().uuid().optional(),
    method: progressMethodSchema,
    plannedQuantity: z.number().nullable().optional(),
    quantityUnit: z.string().nullable().optional(),
    milestoneWeights: z.array(z.any()).optional(),
    inspectionRequired: z.boolean().optional(),
    evidenceRequired: z.boolean().optional(),
    notes: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .nullable()
  .optional()

export const progressSubmissionSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    activityId: z.string().uuid(),
    dailyReportId: z.string().uuid().nullable().optional(),
    method: progressMethodSchema,
    source: z.string(),
    pctComplete: z.number(),
    quantityComplete: z.number().nullable().optional(),
    quantityPlanned: z.number().nullable().optional(),
    quantityUnit: z.string().nullable().optional(),
    milestoneProgress: z.unknown().nullable().optional(),
    inspectionStatus: z.string().nullable().optional(),
    actualCost: z.number().nullable().optional(),
    actualStart: z.string().nullable().optional(),
    actualFinish: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    evidence: z.unknown().nullable().optional(),
    status: z.enum(['draft', 'submitted', 'approved', 'rejected']),
    submittedBy: z.string().nullable().optional(),
    submittedAt: z.string().nullable().optional(),
    reviewedBy: z.string().nullable().optional(),
    reviewedAt: z.string().nullable().optional(),
    rejectionReason: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    activity: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        activityCode: z.string().nullable().optional(),
        wbsCode: z.string().nullable(),
        p6ActivityId: z.string().nullable().optional(),
      })
      .optional(),
  })
  .nullable()
  .optional()

export const activityDependencySchema = z.object({
  id: z.string().optional(),
  projectId: z.string().uuid().optional(),
  predecessorId: z.string().uuid(),
  successorId: z.string().uuid(),
  relationshipType: dependencyRelationshipSchema,
  lagDays: z.number().int(),
  source: z.string().nullable().optional(),
  importSource: z.string().nullable().optional(),
  externalPredecessorRef: z.string().nullable().optional(),
  externalSuccessorRef: z.string().nullable().optional(),
  importMetadata: z.unknown().nullable().optional(),
  predecessor: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      activityCode: z.string().nullable().optional(),
      wbsCode: z.string().nullable(),
      p6ActivityId: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
})

export const procurementRiskSeveritySchema = z.enum([
  'none',
  'low',
  'medium',
  'high',
  'critical',
])

export const scheduleProcurementRiskSummarySchema = z
  .object({
    atRiskCount: z.number(),
    openCount: z.number(),
    acknowledgedCount: z.number(),
    highestSeverity: procurementRiskSeveritySchema,
    reason: z.string(),
    daysAtRisk: z.number(),
    needDate: z.string().nullable(),
    orderByDate: z.string().nullable(),
    expectedDeliveryDate: z.string().nullable(),
    items: z.array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['open', 'acknowledged', 'resolved']),
        severity: procurementRiskSeveritySchema,
        reason: z.string(),
        daysAtRisk: z.number(),
        needDate: z.string().nullable(),
        orderByDate: z.string().nullable(),
        expectedDeliveryDate: z.string().nullable(),
        source: z.string(),
        item: z.string(),
        ref: z.string().nullable(),
      })
    ),
  })
  .nullable()
  .optional()

export const scheduleRiskSummarySchema = z
  .object({
    count: z.number(),
    openCount: z.number(),
    monitoringCount: z.number(),
    submittedCount: z.number(),
    overdueCount: z.number(),
    highestSeverity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    escalationLevel: z.enum(['none', 'watch', 'escalated']),
    dueDate: z.string().nullable(),
    items: z.array(
      z.object({
        id: z.string().uuid(),
        linkId: z.string().uuid().optional(),
        ref: z.string(),
        description: z.string(),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
        status: z.enum(['open', 'monitoring', 'submitted']),
        owner: z.string().nullable(),
        dueDate: z.string().nullable(),
        escalationLevel: z.enum(['none', 'watch', 'escalated']),
        relationType: z.string(),
        scheduleImpactDays: z.number(),
        costImpact: z.number(),
        notes: z.string().nullable(),
        isOverdue: z.boolean(),
      })
    ),
  })
  .nullable()
  .optional()

export const criticalPathExplanationSchema = z
  .object({
    projectFinish: z.number().optional(),
    criticalActivityCount: z.number().optional(),
    dependencyCount: z.number().optional(),
    calendars: z.array(z.string()).optional(),
    chain: z
      .array(
        z.object({
          activityId: z.string(),
          ref: z.string().nullable(),
          name: z.string(),
          calendarId: z.string().nullable().optional(),
          duration: z.number().nullable().optional(),
          earlyStart: z.number().nullable().optional(),
          earlyFinish: z.number().nullable().optional(),
          lateStart: z.number().nullable().optional(),
          lateFinish: z.number().nullable().optional(),
          totalFloat: z.number().nullable().optional(),
          driver: z
            .object({
              predecessorId: z.string().nullable().optional(),
              predecessorRef: z.string().nullable().optional(),
              relationshipType: z.string().nullable().optional(),
              lagDays: z.number().nullable().optional(),
              reason: z.string(),
            })
            .optional(),
        })
      )
      .optional(),
    floatDrivers: z
      .array(
        z.object({
          activityId: z.string(),
          ref: z.string().nullable(),
          name: z.string(),
          calendarId: z.string().nullable().optional(),
          totalFloat: z.number().nullable().optional(),
          driver: z
            .object({
              successorId: z.string().nullable().optional(),
              successorRef: z.string().nullable().optional(),
              relationshipType: z.string().nullable().optional(),
              lagDays: z.number().nullable().optional(),
              reason: z.string(),
            })
            .optional(),
        })
      )
      .optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .optional(),
  })
  .nullable()
  .optional()

export const scheduleActivitySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  activityCode: z.string().nullable(),
  p6ActivityId: z.string().nullable().optional(),
  wbsCode: z.string().nullable(),
  calendarId: z.string().nullable().optional(),
  category: z.string().nullable(),
  duration: z.number(),
  earlyStart: z.number().nullable(),
  earlyFinish: z.number().nullable(),
  earlyStartDate: z.string().nullable().optional(),
  earlyFinishDate: z.string().nullable().optional(),
  baselineStart: z.number().int().nullable().optional(),
  baselineFinish: z.number().int().nullable().optional(),
  baselineStartDate: z.string().nullable().optional(),
  baselineFinishDate: z.string().nullable().optional(),
  lateStart: z.number().nullable(),
  lateFinish: z.number().nullable(),
  lateStartDate: z.string().nullable().optional(),
  lateFinishDate: z.string().nullable().optional(),
  totalFloat: z.number().nullable(),
  actualCost: z.number().nullable().optional(),
  actualStart: z.string().nullable().optional(),
  actualFinish: z.string().nullable().optional(),
  // The BOQ figures and the activity budget built from them are withheld
  // (omitted) from a member who may not read the BOQ — reading the cost
  // module does not change this (owner decision E1, 2026-09-28).
  budget: z.number().optional(),
  generatedBudget: z.number().optional(),
  allocatedBoqQuantity: z.number().optional(),
  allocatedBoqAmount: z.number().optional(),
  allocatedBoqWeight: z.number().optional(),
  approvedAllocationCount: z.number().optional(),
  isMilestone: z.boolean(),
  isCritical: z.boolean(),
  predecessors: z.string().nullable(),
  dependencies: z.array(activityDependencySchema).default([]),
  batchId: z.string().nullable().optional(),
  pctComplete: z.number(),
  approvedProgressUpdatedAt: z.string().nullable().optional(),
  approvedProgressSource: z.string().nullable().optional(),
  progressMethod: z.string().optional(),
  progressMethodConfig: progressMethodConfigSchema,
  procurementRiskSummary: scheduleProcurementRiskSummarySchema,
  projectRiskSummary: scheduleRiskSummarySchema,
  pendingProgress: progressSubmissionSchema,
  progressApprovalStatus: z.string().optional(),
  assignedEngineers: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        email: z.string(),
      })
    )
    .default([]),
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
  totalBudget: z.number().optional(),
  dataDate: z.string().nullable().optional(),
  generatedTotalBudget: z.number().optional(),
  unallocatedBoqAmount: z.number().optional(),
  source: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  status: z
    .enum([
      'draft',
      'under_review',
      'approved',
      'rejected',
      'baselined',
      'superseded',
    ])
    .default('draft'),
  submittedBy: z.string().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  reviewComment: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  approvalComment: z.string().nullable().optional(),
  rejectedBy: z.string().nullable().optional(),
  rejectedAt: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  baselinedBy: z.string().nullable().optional(),
  baselinedAt: z.string().nullable().optional(),
  baselineComment: z.string().nullable().optional(),
  supersededBy: z.string().nullable().optional(),
  supersededAt: z.string().nullable().optional(),
  activatedBy: z.string().nullable().optional(),
  activatedAt: z.string().nullable().optional(),
  activationComment: z.string().nullable().optional(),
  previousActiveRevisionId: z.string().nullable().optional(),
  rolledBackBy: z.string().nullable().optional(),
  rolledBackAt: z.string().nullable().optional(),
  rollbackReason: z.string().nullable().optional(),
  mapping: z.record(z.string(), z.unknown()).nullable().optional(),
  activationAudit: z.record(z.string(), z.unknown()).nullable().optional(),
  readiness: z
    .object({
      revisionId: z.string().nullable(),
      status: z.string(),
      ready: z.boolean(),
      checkedAt: z.string(),
      blockingCount: z.number(),
      // D5: ready/blockingCount answer for the approval; these for the
      // baseline lock (BOQ allocation coverage included).
      baselineReady: z.boolean().optional(),
      baselineBlockingCount: z.number().optional(),
      checks: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          requiredFor: z.array(z.string()).optional(),
          passed: z.boolean(),
          severity: z.string(),
          message: z.string(),
          details: z.record(z.string(), z.unknown()).optional(),
          // What puts a failing check right, by where the revision stands
          // (the server's words): the page (`where`, a parenthesis when
          // `inline`), the step (`next`), the sentence (`text`) and the
          // permission the step needs (`module.action`). null when passed.
          fix: z
            .object({
              where: z.string(),
              inline: z.boolean(),
              next: z.string(),
              text: z.string(),
              permission: z.string(),
            })
            .nullable()
            .optional(),
        })
      ),
    })
    .nullable()
    .optional(),
  statusTransitionLog: z.array(z.any()).optional(),
  createdAt: z.string(),
  projectSummary: z.any().nullable(),
  risks: z.array(z.any()).nullable(),
  milestones: z.array(z.any()).nullable(),
  wbs: z.array(z.any()).nullable(),
  resourceSummary: z.array(z.any()).nullable(),
  longLeadItems: z.array(z.any()).nullable(),
  assumptions: z.array(z.any()).nullable(),
  criticalPath: z.array(z.any()).nullable(),
  criticalPathExplanation: criticalPathExplanationSchema,
})

export const projectScheduleSchema = z.object({
  dataDate: z.string().nullable().optional(),
  revision: scheduleRevisionSchema,
  // A newer revision staged beside the active one, reviewed on the page
  // beside it (its own readiness, judged on its snapshot).
  candidateRevision: scheduleRevisionSchema.nullable().optional(),
  activities: z.array(scheduleActivitySchema),
})

export type ScheduleActivity = z.infer<typeof scheduleActivitySchema>
export type ProgressMethod = z.infer<typeof progressMethodSchema>
export type ProgressSubmission = z.infer<typeof progressSubmissionSchema>
export type ActivityDependency = z.infer<typeof activityDependencySchema>
export type DependencyRelationship = z.infer<
  typeof dependencyRelationshipSchema
>
export type CriticalPathExplanation = z.infer<
  typeof criticalPathExplanationSchema
>
export type ScheduleRevision = z.infer<typeof scheduleRevisionSchema>
export type ProjectSchedule = z.infer<typeof projectScheduleSchema>
export type Risk = z.infer<typeof riskSchema>
export type Milestone = z.infer<typeof milestoneSchema>
