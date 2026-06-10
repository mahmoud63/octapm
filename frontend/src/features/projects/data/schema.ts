import { z } from 'zod'
import { hasMoneyPrecision, MONEY_PRECISION_MESSAGE } from '@/lib/money'

const projectStatusSchema = z.enum([
  'active',
  'on_hold',
  'completed',
  'cancelled',
])

const durationUnitSchema = z.enum(['days', 'weeks', 'months'])

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
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Project = z.infer<typeof projectSchema>

export type ProjectSetupIssue = {
  code: string
  message: string
  severity: 'blocking' | 'warning' | string
  details?: Record<string, unknown>
  stepKey?: string
  stepLabel?: string
}

export type ProjectSetupTarget = {
  module: string
  child?: string
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
  counts: Record<string, unknown>
  action: {
    label: string
    target: ProjectSetupTarget
  }
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
    nextAction: {
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
  }
  context?: Record<string, unknown>
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
    contractType: contractTypeSchema.optional(),
    contractNumber: optionalTextSchema,
    completionDate: optionalDateSchema,
    baselineDate: optionalDateSchema,
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
