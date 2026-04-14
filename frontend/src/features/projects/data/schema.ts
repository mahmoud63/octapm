import { z } from 'zod'

const projectStatusSchema = z.enum([
  'active',
  'on_hold',
  'completed',
  'cancelled',
])

const durationUnitSchema = z.enum(['days', 'weeks', 'months'])

export const projectSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  type: z.string().nullable(),
  location: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  contractValue: z.number().nullable(),
  duration: z.number().int().nullable().optional(),
  durationUnit: durationUnitSchema.default('months'),
  currency: z.string().default('USD'),
  status: projectStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Project = z.infer<typeof projectSchema>

export const createProjectSchema = z
  .object({
    name: z.string().min(1, 'Project name is required'),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    type: z.string().optional(),
    location: z.string().optional(),
    contractValue: z
      .number({ error: 'Contract value must be a number' })
      .positive('Contract value must be positive')
      .optional(),
    duration: z
      .number({ error: 'Duration must be a number' })
      .int('Duration must be a whole number')
      .positive('Duration must be greater than 0')
      .optional(),
    durationUnit: durationUnitSchema.default('months'),
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

export type CreateProjectInput = z.infer<typeof createProjectSchema>
