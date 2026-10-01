import { z } from 'zod'
import {
  ControlsFigureSchema,
  ControlsSectionDeniedSchema,
  ControlsStructureSchema,
  controlsCappedList,
} from '@/features/boq/data/schema'

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

// ─── PC-5: activity detail (GET /projects/:id/activities/:id/detail) ───
// The bill's side of an activity (its BOQ allocations, mapped quantity and
// every figure worked from them) is omitted by the server for a member who
// may not read the BOQ — cost readers included (E1): such a section arrives
// as `{ allowed: false, module: 'boq', reason }`, never as zeroes.
const activityDetailRow = z.object({ id: z.string() }).passthrough()
const ControlsWithheldNoteSchema = z.object({ reason: z.string() })

const activityDetailQuality = z.union([
  ControlsSectionDeniedSchema,
  z.object({ allowed: z.literal(true), items: z.array(activityDetailRow) }),
])

export const ActivityDetailSchema = z.object({
  kind: z.literal('activity'),
  id: z.string(),
  href: z.string().nullable().optional(),
  header: z.object({
    id: z.string(),
    code: z.string().nullable(),
    name: z.string(),
    p6ActivityId: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    isMilestone: z.boolean().optional(),
    isCritical: z.boolean(),
    totalFloat: z.number().nullable(),
    duration: z.number().nullable().optional(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    earlyStartDate: z.string().nullable().optional(),
    earlyFinishDate: z.string().nullable().optional(),
    lateStartDate: z.string().nullable().optional(),
    lateFinishDate: z.string().nullable().optional(),
    baselineStartDate: z.string().nullable().optional(),
    baselineFinishDate: z.string().nullable().optional(),
    actualStart: z.string().nullable().optional(),
    actualFinish: z.string().nullable().optional(),
  }),
  sections: z.object({
    structure: ControlsStructureSchema,
    mapping: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        mappedQuantity: ControlsFigureSchema,
        budget: ControlsFigureSchema,
        generatedBudget: ControlsFigureSchema,
        earnedValue: ControlsFigureSchema,
        allocations: controlsCappedList(
          z.object({
            allocationId: z.string(),
            status: z.string(),
            quantity: ControlsFigureSchema,
            amount: ControlsFigureSchema,
            authorisedQuantity: ControlsFigureSchema,
            boqItem: z.object({
              id: z.string(),
              code: z.string().nullable(),
              description: z.string().nullable(),
              unit: z.string().nullable(),
              href: z.string().nullable().optional(),
            }),
          })
        ),
      }),
    ]),
    progress: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        method: z.unknown(),
        pctComplete: ControlsFigureSchema,
        progressSource: z.string().nullable(),
        installedQuantity: ControlsFigureSchema,
        approvedHistory: controlsCappedList(activityDetailRow),
        submissions: controlsCappedList(activityDetailRow),
      }),
    ]),
    cost: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        committed: ControlsFigureSchema,
        actual: ControlsFigureSchema,
        forecast: ControlsFigureSchema,
        actualThroughDate: z.string().nullable(),
        href: z.string().nullable().optional(),
      }),
    ]),
    certification: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        certifiedAmount: ControlsFigureSchema,
        lines: controlsCappedList(activityDetailRow),
      }),
    ]),
    changes: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        // boqWithheld: always present (with no count) for a member who may
        // not read the BOQ — orders reached through an allocation link are
        // not listed, so "none" is never a claim.
        changeOrders: z.union([
          ControlsSectionDeniedSchema,
          controlsCappedList(activityDetailRow).extend({ boqWithheld: ControlsWithheldNoteSchema.optional() }),
        ]),
        changeEvents: z.union([ControlsSectionDeniedSchema, controlsCappedList(activityDetailRow)]),
      }),
    ]),
    procurement: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        note: z.string().optional(),
        packages: z.array(activityDetailRow),
        orders: z.array(activityDetailRow),
        poLines: z.array(activityDetailRow),
        longLeadItems: z.array(activityDetailRow),
        leadTimeAlerts: z.array(activityDetailRow),
      }),
    ]),
    quality: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        ncrs: activityDetailQuality,
        itps: activityDetailQuality,
        punchItems: activityDetailQuality,
      }),
    ]),
    constraints: z.object({
      allowed: z.literal(true),
      note: z.string().optional(),
      predecessors: z.array(activityDetailRow),
      successors: z.array(activityDetailRow),
      lookahead: activityDetailQuality,
    }),
    documents: z.object({
      allowed: z.literal(true),
      attachments: controlsCappedList(activityDetailRow),
      photos: controlsCappedList(activityDetailRow),
      linkedRecords: z.array(activityDetailRow),
    }),
    history: z.union([
      ControlsSectionDeniedSchema,
      z.object({
        allowed: z.literal(true),
        note: z.string().optional(),
        events: z.array(activityDetailRow),
        total: z.number(),
        boqWithheld: ControlsWithheldNoteSchema.optional(),
      }),
    ]),
  }),
})

export type ActivityDetail = z.infer<typeof ActivityDetailSchema>

// ─── PC-6: progress provenance, quantity progress entries, planned / installed ───
// (core contract: quantity-progress.service installedByActivity /
//  plannedQuantityFor and the provenance the progress serializers carry.)
// A daily log, a site capture or an import never changes official progress
// by itself (OCTAPM_PROGRESS_MEASUREMENT §3): it makes pending entries that
// a progress approver approves through the one writer. Every official and
// every pending figure says where it came from — PROGRESS SOURCE. Typed from
// the contract, every field optional: a server without the field reads as
// the older `approvedProgressSource` string, or as "—".
const withheldNote = z
  .union([z.object({ reason: z.string() }).passthrough(), z.boolean()])
  .nullable()
  .optional()

export const progressSourceSchema = z
  .object({
    // manual | mobile | daily_log | daily_report | import | submission
    source: z.string().nullable().optional(),
    // The server's own sentence, when it sends one, wins over anything
    // the screen could put together.
    label: z.string().nullable().optional(),
    // installed_over_planned | typed_pct | milestones | inspection
    basis: z.string().nullable().optional(),
    method: z.string().nullable().optional(),
    submissionId: z.string().nullable().optional(),
    submittedBy: z.string().nullable().optional(),
    submittedByName: z.string().nullable().optional(),
    submittedAt: z.string().nullable().optional(),
    approvedBy: z.string().nullable().optional(),
    approvedByName: z.string().nullable().optional(),
    approvedAt: z.string().nullable().optional(),
    importId: z.string().nullable().optional(),
    importDocumentId: z.string().nullable().optional(),
    importFileName: z.string().nullable().optional(),
    dailyLogId: z.string().nullable().optional(),
    dailyLogDate: z.string().nullable().optional(),
    dailyLogIds: z.array(z.string()).nullable().optional(),
    dailyLogDates: z.array(z.string()).nullable().optional(),
    entryCount: z.number().nullable().optional(),
  })
  .passthrough()

export const quantityProgressEntrySchema = z
  .object({
    id: z.string(),
    activityId: z.string().nullable().optional(),
    boqItemId: z.string().nullable().optional(),
    boqItem: z
      .object({
        id: z.string().optional(),
        code: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        unitCode: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    allocationId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    location: z
      .object({
        id: z.string().optional(),
        name: z.string().nullable().optional(),
        code: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    unitCode: z.string().nullable().optional(),
    // Withheld from a member who may not read the BOQ: absent, with the reason.
    quantity: z.number().nullable().optional(),
    withheld: withheldNote,
    date: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    submissionId: z.string().nullable().optional(),
    dailyLogId: z.string().nullable().optional(),
    dailyLogDate: z.string().nullable().optional(),
    dailyLogQuantityId: z.string().nullable().optional(),
    clientRequestId: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    createdBy: z.string().nullable().optional(),
    createdByName: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    approvedBy: z.string().nullable().optional(),
    approvedAt: z.string().nullable().optional(),
    rejectedAt: z.string().nullable().optional(),
    rejectionReason: z.string().nullable().optional(),
    progressSource: progressSourceSchema.nullable().optional(),
  })
  .passthrough()

/** The entries a submission bundles — or the server's reason for sending none. */
export const quantityEntriesListSchema = z.union([
  z.array(quantityProgressEntrySchema),
  z
    .object({
      allowed: z.literal(false),
      module: z.string().optional(),
      reason: z.string(),
    })
    .passthrough(),
  z
    .object({
      items: z.array(quantityProgressEntrySchema),
      total: z.number().optional(),
      withheld: withheldNote,
    })
    .passthrough(),
])

/** installedByActivity: one figure per BOQ item in its own unit, never summed. */
export const activityInstalledQuantitySchema = z
  .object({
    installed: z
      .array(
        z
          .object({
            boqItemId: z.string().nullable().optional(),
            code: z.string().nullable().optional(),
            description: z.string().nullable().optional(),
            unitCode: z.string().nullable().optional(),
            quantity: z.number().nullable().optional(),
            entries: z.number().nullable().optional(),
            withheld: withheldNote,
          })
          .passthrough()
      )
      .nullable()
      .optional(),
    asOf: z.string().nullable().optional(),
    basis: z.string().nullable().optional(),
    truth: z.string().nullable().optional(),
    withheld: withheldNote,
    notAvailable: withheldNote,
  })
  .passthrough()

/** plannedQuantityFor: { planned, unitCode, basis: method_config | approved_allocations | none }. */
export const activityPlannedQuantitySchema = z
  .object({
    planned: z.number().nullable().optional(),
    value: z.number().nullable().optional(),
    unitCode: z.string().nullable().optional(),
    basis: z.string().nullable().optional(),
    items: z
      .array(
        z
          .object({
            boqItemId: z.string().nullable().optional(),
            code: z.string().nullable().optional(),
            unitCode: z.string().nullable().optional(),
            quantity: z.number().nullable().optional(),
          })
          .passthrough()
      )
      .nullable()
      .optional(),
    withheld: withheldNote,
    notAvailable: withheldNote,
  })
  .passthrough()

/**
 * What the activity and submission payloads carry once core is on the server
 * (every field optional — the screen reads them off the raw payload and
 * falls back to the older string fields).
 */
export const activityProgressExtrasSchema = z
  .object({
    progressSource: progressSourceSchema.nullable().optional(),
    installedQuantity: activityInstalledQuantitySchema.nullable().optional(),
    plannedQuantity: activityPlannedQuantitySchema.nullable().optional(),
    pendingQuantityEntries: quantityEntriesListSchema.nullable().optional(),
  })
  .passthrough()

export const submissionExtrasSchema = z
  .object({
    progressSource: progressSourceSchema.nullable().optional(),
    quantityEntries: quantityEntriesListSchema.nullable().optional(),
    entries: quantityEntriesListSchema.nullable().optional(),
    entryCount: z.number().nullable().optional(),
    submittedByName: z.string().nullable().optional(),
    dailyLogDate: z.string().nullable().optional(),
    dailyLogDates: z.array(z.string()).nullable().optional(),
  })
  .passthrough()

/** GET /projects/:id/activities/:activityId/allocated-items — the daily log's item picker. */
export const allocatedItemSchema = z
  .object({
    boqItemId: z.string().nullable().optional(),
    id: z.string().nullable().optional(),
    allocationId: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    unitCode: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    quantity: z.number().nullable().optional(),
    allocatedQuantity: z.number().nullable().optional(),
    status: z.string().nullable().optional(),
    boqItem: z
      .object({
        id: z.string().optional(),
        code: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        unitCode: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

export const allocatedItemsResponseSchema = z.union([
  z.array(allocatedItemSchema),
  z
    .object({
      items: z.array(allocatedItemSchema).optional(),
      allowed: z.boolean().optional(),
      module: z.string().optional(),
      reason: z.string().optional(),
      withheld: withheldNote,
    })
    .passthrough(),
])

export type ProgressSource = z.infer<typeof progressSourceSchema>
export type QuantityProgressEntry = z.infer<typeof quantityProgressEntrySchema>
export type QuantityEntriesList = z.infer<typeof quantityEntriesListSchema>
export type ActivityInstalledQuantity = z.infer<
  typeof activityInstalledQuantitySchema
>
export type ActivityPlannedQuantity = z.infer<
  typeof activityPlannedQuantitySchema
>
export type ActivityProgressExtras = z.infer<typeof activityProgressExtrasSchema>
export type SubmissionExtras = z.infer<typeof submissionExtrasSchema>
export type AllocatedItem = z.infer<typeof allocatedItemSchema>
export type AllocatedItemsResponse = z.infer<typeof allocatedItemsResponseSchema>

type WithheldNote = z.infer<typeof withheldNote>

/** A withheld / not-available note's reason, whatever shape the server used. */
export const withheldReason = (
  note: WithheldNote | undefined,
  fallback: string
): string | null => {
  if (!note) return null
  if (typeof note === 'object' && 'reason' in note) return note.reason
  return fallback
}

/** The allocated items of a response, and the reason when the server sent none. */
export const allocatedItemsOf = (
  response: AllocatedItemsResponse | null | undefined
): { items: AllocatedItem[]; reason: string | null } => {
  if (!response) return { items: [], reason: null }
  if (Array.isArray(response)) return { items: response, reason: null }
  if (response.allowed === false)
    return { items: [], reason: response.reason ?? 'Withheld by the server' }
  return {
    items: response.items ?? [],
    reason: withheldReason(
      response.withheld,
      response.reason ?? 'Withheld by the server'
    ),
  }
}

/** The entries of a bundle, and the reason when the server withheld them. */
export const quantityEntriesOf = (
  list: QuantityEntriesList | null | undefined
): { entries: QuantityProgressEntry[]; reason: string | null } => {
  if (!list) return { entries: [], reason: null }
  if (Array.isArray(list)) return { entries: list, reason: null }
  const denied = list as { allowed?: boolean; reason?: string }
  if (denied.allowed === false)
    return { entries: [], reason: denied.reason ?? 'Withheld by the server' }
  const capped = list as {
    items?: QuantityProgressEntry[]
    withheld?: WithheldNote
  }
  if (Array.isArray(capped.items))
    return {
      entries: capped.items,
      reason: withheldReason(capped.withheld, 'Withheld by the server'),
    }
  return { entries: [], reason: null }
}
