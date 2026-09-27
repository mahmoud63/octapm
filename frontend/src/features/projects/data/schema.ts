import { z } from 'zod'
import { hasMoneyPrecision, MONEY_PRECISION_MESSAGE } from '@/lib/money'

const projectStatusSchema = z.enum([
  'active',
  'on_hold',
  'completed',
  'cancelled',
  'archived',
])

const durationUnitSchema = z.enum(['days', 'weeks', 'months'])
const projectAccessSchema = z
  .object({
    role: z.string().nullable().optional(),
    effectiveRole: z.string().nullable().optional(),
    assignmentRole: z.string().nullable().optional(),
    orgRole: z.string().nullable().optional(),
    scope: z.string().nullable().optional(),
    partyRole: z.string().nullable().optional(),
    partyAccess: z
      .array(
        z.object({
          projectPartyId: z.string(),
          companyId: z.string(),
          companyName: z.string().nullable().optional(),
          role: z.string(),
          accessLevel: z.string().optional(),
          permissionProfile: z.string().nullable().optional(),
          memberRole: z.string().nullable().optional(),
        })
      )
      .optional(),
  })
  .optional()

export const contractTypeValues = [
  'lump_sum',
  'unit_rate',
  'remeasurement',
  'cost_plus',
  'design_build',
  'epc',
  'other',
] as const

export const projectCalendarValues = [
  'five_day',
  'six_day',
  'seven_day',
  'custom',
] as const

export const contractTypeSchema = z.enum(contractTypeValues)
export const projectCalendarSchema = z.enum(projectCalendarValues)

const optionalTextSchema = z.string().trim().optional()

const optionalDateSchema = z.string().optional()

export const projectPartyRoleValues = [
  'owner',
  'consultant',
  'contractor',
  'subcontractor',
] as const

export const projectPartyRoleSchema = z.enum(projectPartyRoleValues)

export const companySchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  legalName: z.string().nullable().optional(),
  tradeName: z.string().nullable().optional(),
  registrationNumber: z.string().nullable().optional(),
  taxNumber: z.string().nullable().optional(),
  type: z.string(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const projectPartySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  companyId: z.string().uuid(),
  role: projectPartyRoleSchema,
  roleLabel: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  accessLevel: z.string(),
  permissionProfile: z.string().nullable().optional(),
  permissionPolicy: z.unknown().optional(),
  status: z.string(),
  company: companySchema.nullable().optional(),
  members: z
    .array(
      z.object({
        id: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.string(),
        status: z.string(),
        user: z
          .object({
            id: z.string().uuid(),
            name: z.string(),
            email: z.string(),
            role: z.string(),
            status: z.string(),
          })
          .nullable()
          .optional(),
      })
    )
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const partyInputSchema = z.object({
  role: projectPartyRoleSchema,
  companyId: z.string().uuid().optional(),
  companyName: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  accessLevel: z
    .enum(['read_only', 'collaborator', 'reviewer', 'admin'])
    .optional(),
})

export const projectSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  type: z.string().nullable(),
  location: z.string().nullable(),
  clientName: z.string().nullable().optional(),
  consultantName: z.string().nullable().optional(),
  contractorName: z.string().nullable().optional(),
  contractType: contractTypeSchema.nullable().optional(),
  contractNumber: z.string().nullable().optional(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  completionDate: z.string().nullable().optional(),
  baselineDate: z.string().nullable().optional(),
  dataDate: z.string().nullable().optional(),
  revisedCompletionDate: z.string().nullable().optional(),
  contractValue: z.number().nullable(),
  defaultRetentionRate: z.number().nullable().optional(),
  ldRatePerDay: z.number().optional().default(0),
  weatherAllowanceDays: z.number().int().optional().default(20),
  duration: z.number().int().nullable().optional(),
  durationUnit: durationUnitSchema.default('months'),
  projectCalendar: projectCalendarSchema.nullable().optional(),
  reportingCutoffDay: z.number().int().nullable().optional(),
  currency: z.string().default('USD'),
  status: projectStatusSchema,
  archivedAt: z.string().nullable().optional(),
  archivedBy: z.string().nullable().optional(),
  parties: z.array(projectPartySchema).optional(),
  projectAccess: projectAccessSchema,
  effectiveRole: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Project = z.infer<typeof projectSchema>
export type Company = z.infer<typeof companySchema>
export type ProjectParty = z.infer<typeof projectPartySchema>
export type ProjectPartyRole = z.infer<typeof projectPartyRoleSchema>

/**
 * One record behind a readiness issue (PC-4): what it is, what it lacks and
 * where to fix it — `href` is the module page under the project's workspace
 * with the record in the URL, as notification links carry it.
 */
export type ProjectSetupItem = {
  type: string
  id: string | null
  code: string | null
  label: string | null
  missing: string
  href: string
}

export type ProjectSetupIssue = {
  code: string
  message: string
  /** 'advisory': information only — it never moves a step's status or a gate. */
  severity: 'blocking' | 'warning' | 'advisory' | string
  details?: Record<string, unknown>
  /** The offending records, capped at 50; `count` is the whole number. */
  items?: ProjectSetupItem[]
  /** Absent on a mapping issue for a caller who may not read the BOQ. */
  count?: number
  /**
   * True when the caller may not read the BOQ and the BOQ records behind
   * the issue were left out of `items`.
   */
  itemsWithheld?: boolean
  /**
   * True on a mapping issue for a caller who may not read the BOQ: how many
   * rows or allocations it concerns is not given (owner decision C).
   */
  mappingDetailsWithheld?: boolean
  /**
   * True on a BOQ filing or unit issue (BOQ_ITEMS_WITHOUT_WBS,
   * BOQ_ITEMS_WITHOUT_COST_CODE, BOQ_UNIT_UNRESOLVED, UOM_UNRESOLVED) for a
   * caller who may not read the BOQ: no count of rows, `reason` says why.
   */
  boqDetailsWithheld?: boolean
  reason?: string
  stepKey?: string
  stepLabel?: string
  actionLabel?: string
  target?: ProjectSetupTarget
}

export type ProjectSetupTarget = {
  module: string
  child?: string
  status?: string
  source?: string
  recordId?: string
  /** Pin to highlight when the target is a sheet (drawings deep link). */
  pin?: string
  /** Day to open when the target is the daily log (`YYYY-MM-DD`). */
  date?: string
  /** Open the module's create dialog on arrival (Phase 22A quick actions). */
  new?: string
}

/**
 * One thing the structure step guides (§21): WBS, locations, cost codes,
 * BOQ structure, schedule structure or mapping readiness — its state, what
 * is still to file, and where that is done.
 */
export type ProjectSetupGuide = {
  key: string
  label: string
  status: 'complete' | 'attention' | 'pending'
  /** null on mapping_readiness and boq_structure for a caller who may not read the BOQ. */
  count: number | null
  detail: string
  detailsWithheld?: boolean
  target: ProjectSetupTarget
  href: string
}

/** One entry of the §33 status line: "BOQ imported PASS", "Mapping 83%", … */
export type ProjectSetupHeadlineEntry = {
  key: string
  label: string
  value: string
  tone: 'done' | 'review' | 'blocked' | 'info' | 'neutral'
  raw?: unknown
  /** On the mapping entry, for a caller who may not read the BOQ. */
  withheld?: boolean
  reason?: string
}

export type ProjectSetupStep = {
  key: string
  label: string
  description: string
  status: 'complete' | 'attention' | 'blocked' | 'pending'
  requiredFor: string[]
  critical: boolean
  message: string
  blockers: ProjectSetupIssue[]
  warnings: ProjectSetupIssue[]
  /**
   * PC-4's filing and matching checks: listed with the step, never moving
   * its status, its message or a gate.
   */
  advisories?: ProjectSetupIssue[]
  counts: Record<string, unknown>
  action: {
    label: string
    target: ProjectSetupTarget
  }
  /** On structure_setup only. */
  guides?: ProjectSetupGuide[]
}

/** A transition the approval workflow recorded on a BOQ revision (PC-2). */
export type BoqRevisionHistoryEntry = {
  id: string
  action: string
  fromStatus: string | null
  toStatus: string | null
  actorId: string | null
  actorName: string | null
  actorRole: string | null
  decision: string | null
  reason: string | null
  comment: string | null
  at: string | null
}

export type ProjectSetupReadiness = {
  projectId: string
  rulesetVersion: string
  checkedAt: string
  summary: {
    status: 'ready' | 'not_ready' | string
    completeSteps: number
    attentionSteps: number
    blockedSteps: number
    totalSteps: number
    blockingCount: number
    warningCount: number
    readyForBaseline: boolean
    readyForProgress: boolean
    readyForReporting?: boolean
    /** The §33 status line, in reading order. */
    headline?: ProjectSetupHeadlineEntry[]
    criticalUnmappedActivities?: number
    /** From the ten original steps only (setup doc §3: unchanged). */
    nextAction: {
      stepKey: string
      label: string
      target: ProjectSetupTarget
      message: string
    } | null
    /**
     * The first of the two advisory steps (structure_setup, boq_approval)
     * still asking for something, offered apart from nextAction.
     */
    advisoryAction?: {
      stepKey: string
      label: string
      target: ProjectSetupTarget
      message: string
    } | null
  }
  gates: {
    baseline: {
      mode: 'block' | string
      ready: boolean
      alreadyLocked: boolean
      blockers: ProjectSetupIssue[]
      message: string
    }
    progress: {
      mode: 'warn' | 'block' | string
      ready: boolean
      blockers: ProjectSetupIssue[]
      warnings: ProjectSetupIssue[]
      message: string
    }
    reporting?: {
      mode: 'warn' | 'block' | string
      ready: boolean
      blockers: ProjectSetupIssue[]
      warnings: ProjectSetupIssue[]
      overrideAllowedRoles?: string[]
      message: string
    }
  }
  /** The structure dimension (PC-1) as the check found it. */
  structure?: {
    wbsNodes: number
    locations: number
    projectCostCodes: number
    /** Absent for a caller who may not read the BOQ (unitsUnresolvedWithheld). */
    unitsUnresolved?: number
    unitsUnresolvedWithheld?: boolean
    reason?: string
  }
  /**
   * The §69 coverage totals, exactly as the coverage endpoint reports them
   * (PC-3) — the readiness check never recomputes them. A caller who may not
   * read the BOQ gets none of it (owner decision C): `{ withheld: true,
   * reason }`, no share and no counts.
   */
  coverage?: {
    withheld?: boolean
    reason?: string
    totalBoqAmount?: number
    allocatableBoqAmount?: number
    approvedAllocatedAmount?: number
    pendingAllocatedAmount?: number
    unallocatedAmount?: number
    optionalUnallocatedAmount?: number
    notApplicableAmount?: number
    earnedValue?: number
    certifiedValue?: number
    coveragePct?: number
    counts?: {
      unmapped: number
      partial: number
      complete: number
      over: number
      notApplicable: number
    }
  }
  context?: {
    workspace?: { orgId: string; segment: string }
    currentRevision?: {
      id: string
      label: string | null
      status: string
      isActive: boolean
      approvedAt: string | null
      baselinedAt: string | null
    } | null
    boqRevision?: {
      id: string
      revisionNumber: number
      label: string | null
      source?: string
      status: string
      baselineLocked: boolean
      lockedAt: string | null
      /**
       * The revision's row counts (itemCount, changes, validation.blockedCount)
       * are only for a caller who may read the BOQ; anyone else gets
       * countsWithheld and the reason ("BOQ details unavailable to you").
       */
      itemCount?: number
      countsWithheld?: boolean
      reason?: string
      /** Only for a caller who may read the BOQ. */
      totalAmount?: number
      /** The upload's comparison against the bill before it (PC-2). */
      changes?: {
        added: number
        updated: number
        removed: number
        unchanged: number
        blocked: number
      }
      /** The rows the comparison could not apply. */
      validation?: {
        blockedCount?: number
        blocked: Array<{
          code: string | null
          description: string | null
          /** The machine code PC-2 recorded, e.g. DUPLICATE_BOQ_ITEM_CODE. */
          reason: string | null
          /** The sentence to show. */
          message?: string | null
        }>
      }
      /** Only for a caller who may read the BOQ. */
      history?: BoqRevisionHistoryEntry[]
      createdAt?: string | null
    } | null
    boqBaseline?: {
      locked: boolean
      source: 'boq_revision' | 'schedule_baseline' | null
      boqRevisionId: string | null
    }
    progressMethods?: {
      configured: number
      total: number
      byMethod: Record<string, number>
      quantityWithoutUnit: number
    }
    [key: string]: unknown
  }
  steps: ProjectSetupStep[]
}

export const createProjectSchema = z
  .object({
    name: z.string().min(1, 'Project name is required'),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    type: optionalTextSchema,
    location: optionalTextSchema,
    clientName: optionalTextSchema,
    consultantName: optionalTextSchema,
    contractorName: optionalTextSchema,
    clientCompanyId: optionalTextSchema,
    consultantCompanyId: optionalTextSchema,
    contractorCompanyId: optionalTextSchema,
    subcontractorCompanyId: optionalTextSchema,
    subcontractorName: optionalTextSchema,
    parties: z.array(partyInputSchema).optional(),
    contractType: contractTypeSchema.optional(),
    contractNumber: optionalTextSchema,
    completionDate: optionalDateSchema,
    baselineDate: optionalDateSchema,
    dataDate: optionalDateSchema,
    revisedCompletionDate: optionalDateSchema,
    contractValue: z
      .number({ error: 'Contract value must be a number' })
      .min(0, 'Contract value cannot be negative')
      .refine(hasMoneyPrecision, MONEY_PRECISION_MESSAGE)
      .optional(),
    defaultRetentionRate: z
      .number({ error: 'Retention must be a number' })
      .min(0, 'Retention cannot be negative')
      .max(100, 'Retention cannot exceed 100%')
      .optional(),
    ldRatePerDay: z
      .number({ error: 'LD rate must be a number' })
      .min(0, 'LD rate cannot be negative')
      .refine(hasMoneyPrecision, MONEY_PRECISION_MESSAGE)
      .optional(),
    weatherAllowanceDays: z
      .number({ error: 'Weather allowance must be a number' })
      .int('Weather allowance must be a whole number')
      .min(0, 'Weather allowance cannot be negative')
      .optional(),
    duration: z
      .number({ error: 'Duration must be a number' })
      .int('Duration must be a whole number')
      .positive('Duration must be greater than 0')
      .optional(),
    durationUnit: durationUnitSchema.default('months'),
    projectCalendar: projectCalendarSchema.optional(),
    reportingCutoffDay: z
      .number({ error: 'Cutoff day must be a number' })
      .int('Cutoff day must be a whole number')
      .min(1, 'Cutoff day must be between 1 and 31')
      .max(31, 'Cutoff day must be between 1 and 31')
      .optional(),
    currency: z
      .string()
      .length(3, 'Currency must be a 3-letter code')
      .default('USD')
      .transform((value) => value.toUpperCase()),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine(
    (data) =>
      !data.completionDate ||
      new Date(data.completionDate) >= new Date(data.startDate),
    {
      message: 'Completion date must be on or after start date',
      path: ['completionDate'],
    }
  )
  .refine(
    (data) =>
      !data.revisedCompletionDate ||
      new Date(data.revisedCompletionDate) >= new Date(data.startDate),
    {
      message: 'Revised completion must be on or after start date',
      path: ['revisedCompletionDate'],
    }
  )

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type ContractType = z.infer<typeof contractTypeSchema>
export type ProjectCalendar = z.infer<typeof projectCalendarSchema>
