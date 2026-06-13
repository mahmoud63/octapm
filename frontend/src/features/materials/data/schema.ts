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
  projectId: z.string().uuid(),
  activityId: z.string().uuid(),
  materialMasterId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  procurementPackageId: z.string().uuid().nullable().optional(),
  code: z.string().nullable().optional(),
  name: z.string(),
  spec: z.string().nullable().optional(),
  unit: z.enum(UNITS),
  qty: z.number(),
  plannedQty: z.number().optional(),
  requiredDate: z.string().nullable().optional(),
  requiredTiming: z.enum(['activity_start', 'activity_finish']).optional(),
  needOffsetDays: z.number().optional(),
  leadWeeks: z.number().optional(),
  bufferDays: z.number().optional(),
  orderByDate: z.string().nullable().optional(),
  receivedQty: z.number().optional(),
  issuedQty: z.number().optional(),
  consumedQty: z.number().optional(),
  wasteQty: z.number().optional(),
  status: z.string().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  supplier: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
    })
    .nullable()
    .optional(),
  procurementPackage: z
    .object({
      id: z.string().uuid(),
      packageNumber: z.string(),
      title: z.string(),
    })
    .nullable()
    .optional(),
  poLines: z
    .array(
      z.object({
        id: z.string().uuid(),
        lineNumber: z.number(),
        description: z.string(),
        unit: z.string(),
        orderedQty: z.number(),
        receivedQty: z.number(),
        issuedQty: z.number(),
        consumedQty: z.number(),
        status: z.string(),
        promisedDate: z.string().nullable().optional(),
        order: z
          .object({
            id: z.string().uuid(),
            ref: z.string(),
          })
          .optional(),
      })
    )
    .optional(),
  usages: z
    .array(
      z.object({
        id: z.string().uuid(),
        dailyReportId: z.string().uuid().nullable().optional(),
        usedQty: z.number(),
        wasteQty: z.number(),
        usageDate: z.string(),
        installedLocation: z.string().nullable().optional(),
        dailyReport: z
          .object({
            id: z.string().uuid(),
            date: z.string(),
            shift: z.string(),
            status: z.string(),
          })
          .nullable()
          .optional(),
      })
    )
    .optional(),
  receiptLines: z
    .array(
      z.object({
        id: z.string().uuid(),
        dailyReportId: z.string().uuid().nullable().optional(),
        acceptedQty: z.number(),
        rejectedQty: z.number(),
        issuedQty: z.number(),
        createdAt: z.string(),
        receipt: z
          .object({
            id: z.string().uuid(),
            receiptNumber: z.string(),
            receivedAt: z.string(),
            status: z.string(),
          })
          .optional(),
        dailyReport: z
          .object({
            id: z.string().uuid(),
            date: z.string(),
            shift: z.string(),
            status: z.string(),
          })
          .nullable()
          .optional(),
      })
    )
    .optional(),
  procurementRisk: z
    .object({
      severity: z.enum(['none', 'low', 'medium', 'high', 'critical']),
      reason: z.string(),
      isAtRisk: z.boolean(),
      daysAtRisk: z.number(),
      deliverySlipDays: z.number(),
      orderBySlackDays: z.number().nullable(),
      needSlackDays: z.number().nullable(),
      needDate: z.string().nullable(),
      orderByDate: z.string().nullable(),
      expectedDeliveryDate: z.string().nullable(),
      flags: z.array(z.string()),
    })
    .optional(),
})

export const addMaterialSchema = z.object({
  name: z.string().min(1, 'Material name is required'),
  code: z.string().optional(),
  spec: z.string().optional(),
  supplierName: z.string().optional(),
  unit: z.enum(UNITS, { error: 'Select a unit' }),
  qty: z
    .number({ error: 'Quantity is required' })
    .positive('Quantity must be positive'),
  requiredDate: z.string().optional(),
  requiredTiming: z.enum(['activity_start', 'activity_finish']),
  needOffsetDays: z.number().min(0),
  leadWeeks: z.number().min(0),
  bufferDays: z.number().min(0),
  notes: z.string().optional(),
})

export const materialUsageSchema = z.object({
  usedQty: z
    .number({ error: 'Used quantity is required' })
    .positive('Used quantity must be positive'),
  wasteQty: z.number().min(0),
  usageDate: z.string().optional(),
  installedLocation: z.string().optional(),
  dailyReportId: z.string().optional(),
  notes: z.string().optional(),
})

export type Material = z.infer<typeof materialSchema>
export type AddMaterialInput = z.infer<typeof addMaterialSchema>
export type MaterialUsageInput = z.infer<typeof materialUsageSchema>
