import { z } from 'zod'

export const UNITS = [
  'TON',
  'KG',
  'M3',
  'M2',
  'M',
  'PCS',
  'L',
  'BAG',
  'SHEET',
  'ROLL',
  'LOAD',
] as const

export const UNIT_LABELS: Record<(typeof UNITS)[number], string> = {
  TON: 'TON',
  KG: 'KG',
  M3: 'M³',
  M2: 'M²',
  M: 'M',
  PCS: 'PCS',
  L: 'L',
  BAG: 'BAG',
  SHEET: 'SHEET',
  ROLL: 'ROLL',
  LOAD: 'LOAD',
}

export const materialSchema = z.object({
  id: z.string().uuid(),
  activityId: z.string().uuid(),
  name: z.string(),
  unit: z.enum(UNITS),
  qty: z.number(),
  createdAt: z.string(),
})

export const addMaterialSchema = z.object({
  name: z.string().min(1, 'Material name is required'),
  unit: z.enum(UNITS, { error: 'Select a unit' }),
  qty: z
    .number({ error: 'Quantity is required' })
    .positive('Quantity must be positive'),
})

export type Material = z.infer<typeof materialSchema>
export type AddMaterialInput = z.infer<typeof addMaterialSchema>
