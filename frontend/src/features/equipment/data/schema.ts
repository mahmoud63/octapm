import { z } from 'zod'

export const equipmentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  rateType: z.enum(['hourly', 'daily']),
  rate: z.number(),
  createdAt: z.string(),
})

export const addEquipmentSchema = z.object({
  name: z.string().min(1, 'Equipment name is required'),
  rateType: z.enum(['hourly', 'daily'], { error: 'Select a rate type' }),
  rate: z
    .number({ error: 'Rate must be a number' })
    .min(0, 'Rate must be zero or positive')
    .optional(),
})

export type Equipment = z.infer<typeof equipmentSchema>
export type AddEquipmentInput = z.infer<typeof addEquipmentSchema>
