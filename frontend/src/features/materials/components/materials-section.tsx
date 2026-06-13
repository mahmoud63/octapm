import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  AlertTriangle,
  ClipboardCheck,
  PackageCheck,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  UNIT_LABELS,
  UNITS,
  addMaterialSchema,
  materialUsageSchema,
  type AddMaterialInput,
  type Material,
  type MaterialUsageInput,
} from '../data/schema'
import {
  useAddMaterial,
  useDeleteMaterial,
  useMaterials,
  useRecordMaterialUsage,
} from '../hooks/use-materials'

type MaterialsSectionProps = {
  projectId: string
  activityId: string
}

type RiskSeverity = NonNullable<Material['procurementRisk']>['severity']

const severityClassMap: Record<RiskSeverity, string> = {
  none: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300',
  low: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-300',
  medium:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300',
  high: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/40 dark:bg-orange-950/20 dark:text-orange-300',
  critical:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300',
}

const formatQty = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

const formatDate = (value: string | null | undefined) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

const riskLabel = (value: string | undefined) =>
  value ? value.replace(/_/g, ' ') : 'on track'

const dailyReportLabel = (
  report:
    | {
        date?: string | null
        shift?: string | null
        status?: string | null
      }
    | null
    | undefined
) =>
  report?.date
    ? `DR ${formatDate(report.date)}${report.shift ? ` ${report.shift}` : ''}`
    : null

const serverMessage = (error: unknown, fallback: string) =>
  (error as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? fallback

const materialBalance = (material: Material) => {
  const planned = material.plannedQty ?? material.qty
  const received = material.receivedQty ?? 0
  const issued = material.issuedQty ?? 0
  const consumed = material.consumedQty ?? 0
  const waste = material.wasteQty ?? 0
  return {
    planned,
    received,
    issued,
    consumed,
    waste,
    available: Math.max(0, issued - consumed - waste),
    ordered: (material.poLines ?? []).reduce(
      (sum, line) => sum + Number(line.orderedQty || 0),
      0
    ),
  }
}

export function MaterialsSection({
  projectId,
  activityId,
}: MaterialsSectionProps) {
  const { data: materials = [], isLoading } = useMaterials(
    projectId,
    activityId
  )
  const canPlanMaterial = useCanPerform(
    'procurement',
    'create',
    'material.plan'
  )
  const canDeleteMaterial = useCanPerform('procurement', 'delete')
  const canUseMaterial = useCanPerform('procurement', 'submit', 'material.use')

  const addMaterial = useAddMaterial(projectId, activityId)
  const deleteMaterial = useDeleteMaterial(projectId, activityId)
  const recordUsage = useRecordMaterialUsage(projectId, activityId)
  const [usageMaterial, setUsageMaterial] = useState<Material | null>(null)

  const totals = useMemo(
    () =>
      materials.reduce(
        (acc, material) => {
          const balance = materialBalance(material)
          acc.planned += balance.planned
          acc.issued += balance.issued
          acc.consumed += balance.consumed
          acc.available += balance.available
          return acc
        },
        { planned: 0, issued: 0, consumed: 0, available: 0 }
      ),
    [materials]
  )

  const form = useForm<AddMaterialInput>({
    resolver: zodResolver(addMaterialSchema),
    defaultValues: {
      name: '',
      code: '',
      spec: '',
      supplierName: '',
      unit: 'TON',
      qty: 0,
      requiredDate: '',
      requiredTiming: 'activity_start',
      needOffsetDays: 0,
      leadWeeks: 0,
      bufferDays: 14,
      notes: '',
    },
  })

  const usageForm = useForm<MaterialUsageInput>({
    resolver: zodResolver(materialUsageSchema),
    defaultValues: {
      usedQty: 0,
      wasteQty: 0,
      usageDate: new Date().toISOString().slice(0, 10),
      installedLocation: '',
      notes: '',
    },
  })

  const onSubmit = async (values: AddMaterialInput) => {
    try {
      await addMaterial.mutateAsync({
        ...values,
        code: values.code?.trim() || undefined,
        spec: values.spec?.trim() || undefined,
        supplierName: values.supplierName?.trim() || undefined,
        requiredDate: values.requiredDate || undefined,
        notes: values.notes?.trim() || undefined,
      })
      toast.success('Material requirement added')
      form.reset({
        name: '',
        code: '',
        spec: '',
        supplierName: '',
        unit: 'TON',
        qty: 0,
        requiredDate: '',
        requiredTiming: 'activity_start',
        needOffsetDays: 0,
        leadWeeks: 0,
        bufferDays: 14,
        notes: '',
      })
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to add material'))
    }
  }

  const onDelete = async (materialId: string) => {
    try {
      await deleteMaterial.mutateAsync(materialId)
      toast.success('Material removed')
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to remove material'))
    }
  }

  const onRecordUsage = async (values: MaterialUsageInput) => {
    if (!usageMaterial) return

    try {
      await recordUsage.mutateAsync({
        materialId: usageMaterial.id,
        payload: {
          ...values,
          usageDate: values.usageDate || undefined,
          installedLocation: values.installedLocation?.trim() || undefined,
          notes: values.notes?.trim() || undefined,
        },
      })
      toast.success('Material usage recorded')
      setUsageMaterial(null)
      usageForm.reset({
        usedQty: 0,
        wasteQty: 0,
        usageDate: new Date().toISOString().slice(0, 10),
        installedLocation: '',
        notes: '',
      })
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to record usage'))
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
            Materials
          </h3>
          <div className='mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground'>
            <span>Planned {formatQty(totals.planned)}</span>
            <span>Issued {formatQty(totals.issued)}</span>
            <span>Consumed {formatQty(totals.consumed)}</span>
            <span>Available {formatQty(totals.available)}</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading materials...</p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm whitespace-nowrap'>
            <thead className='border-b bg-muted/50'>
              <tr>
                <th className='p-2 text-left font-medium'>Material</th>
                <th className='p-2 text-left font-medium'>Need</th>
                <th className='p-2 text-left font-medium'>Supplier</th>
                <th className='p-2 text-right font-medium'>Plan</th>
                <th className='p-2 text-right font-medium'>PO</th>
                <th className='p-2 text-right font-medium'>Receipt</th>
                <th className='p-2 text-right font-medium'>Usage</th>
                <th className='p-2 text-left font-medium'>Risk</th>
                <th className='p-2 text-right font-medium'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {materials.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className='p-6 text-center text-muted-foreground'
                  >
                    No materials added yet.
                  </td>
                </tr>
              ) : (
                materials.map((material) => {
                  const balance = materialBalance(material)
                  const risk = material.procurementRisk
                  const severity = risk?.severity ?? 'none'
                  const latestPoLine = material.poLines?.[0]
                  const latestReceiptLine = material.receiptLines?.[0]
                  const latestUsage = material.usages?.[0]
                  const receiptReport = dailyReportLabel(
                    latestReceiptLine?.dailyReport
                  )
                  const usageReport = dailyReportLabel(latestUsage?.dailyReport)

                  return (
                    <tr
                      key={material.id}
                      className={cn(
                        'border-b align-top hover:bg-muted/25',
                        risk?.isAtRisk && 'bg-amber-50/60 dark:bg-amber-950/15'
                      )}
                    >
                      <td className='max-w-56 p-2'>
                        <div className='flex min-w-0 items-start gap-2'>
                          {risk?.isAtRisk ? (
                            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-amber-600' />
                          ) : (
                            <PackageCheck className='mt-0.5 h-4 w-4 shrink-0 text-emerald-600' />
                          )}
                          <div className='min-w-0'>
                            <p className='truncate font-medium'>
                              {material.code ? `${material.code} - ` : ''}
                              {material.name}
                            </p>
                            {material.spec && (
                              <p className='truncate text-xs text-muted-foreground'>
                                {material.spec}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className='p-2'>
                        <p>
                          {formatDate(risk?.needDate ?? material.requiredDate)}
                        </p>
                        <p className='text-xs text-muted-foreground'>
                          Order By{' '}
                          {formatDate(
                            risk?.orderByDate ?? material.orderByDate
                          )}
                        </p>
                      </td>
                      <td className='max-w-48 p-2'>
                        <p className='truncate'>
                          {material.supplier?.name ?? '-'}
                        </p>
                        {material.procurementPackage && (
                          <p className='truncate text-xs text-muted-foreground'>
                            {material.procurementPackage.packageNumber}
                          </p>
                        )}
                      </td>
                      <td className='p-2 text-right'>
                        <p>
                          {formatQty(balance.planned)}{' '}
                          {UNIT_LABELS[material.unit]}
                        </p>
                        <p className='text-xs text-muted-foreground'>
                          {material.status ?? 'planned'}
                        </p>
                      </td>
                      <td className='p-2 text-right'>
                        <p>{formatQty(balance.ordered)}</p>
                        <p className='text-xs text-muted-foreground'>
                          {latestPoLine?.order?.ref ?? '-'}
                        </p>
                      </td>
                      <td className='p-2 text-right'>
                        <p>{formatQty(balance.received)}</p>
                        <p className='text-xs text-muted-foreground'>
                          {latestReceiptLine?.receipt?.receiptNumber ??
                            `Issued ${formatQty(balance.issued)}`}
                        </p>
                        {receiptReport && (
                          <p className='text-xs text-muted-foreground'>
                            {receiptReport}
                          </p>
                        )}
                      </td>
                      <td className='p-2 text-right'>
                        <p>{formatQty(balance.consumed)}</p>
                        <p className='text-xs text-muted-foreground'>
                          {usageReport ?? `Avail ${formatQty(balance.available)}`}
                        </p>
                      </td>
                      <td className='max-w-40 p-2'>
                        <Badge className={severityClassMap[severity]}>
                          {severity}
                        </Badge>
                        <p
                          className='mt-1 truncate text-xs text-muted-foreground'
                          title={riskLabel(risk?.reason)}
                        >
                          {riskLabel(risk?.reason)}
                        </p>
                      </td>
                      <td className='p-2 text-right'>
                        <div className='flex justify-end gap-1'>
                          {canUseMaterial && balance.available > 0 && (
                            <Button
                              type='button'
                              size='sm'
                              variant='ghost'
                              onClick={() => {
                                setUsageMaterial(material)
                                usageForm.setValue('usedQty', 0)
                                usageForm.setValue('wasteQty', 0)
                              }}
                            >
                              <ClipboardCheck className='mr-1.5 h-3.5 w-3.5' />
                              Use
                            </Button>
                          )}
                          {canDeleteMaterial && (
                            <Button
                              type='button'
                              size='sm'
                              variant='ghost'
                              className='text-destructive hover:text-destructive'
                              onClick={() => onDelete(material.id)}
                            >
                              <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                              Remove
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {usageMaterial && (
        <Form {...usageForm}>
          <form
            onSubmit={usageForm.handleSubmit(onRecordUsage)}
            className='grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-5'
          >
            <div className='sm:col-span-5'>
              <p className='text-sm font-medium'>{usageMaterial.name}</p>
            </div>
            <FormField
              control={usageForm.control}
              name='usedQty'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Used</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      step='0.01'
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value || 0))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={usageForm.control}
              name='wasteQty'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Waste</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      step='0.01'
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value || 0))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={usageForm.control}
              name='usageDate'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input type='date' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={usageForm.control}
              name='installedLocation'
              render={({ field }) => (
                <FormItem className='sm:col-span-2'>
                  <FormLabel>Location</FormLabel>
                  <FormControl>
                    <Input placeholder='Grid B4' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='flex justify-end gap-2 sm:col-span-5'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setUsageMaterial(null)}
              >
                Cancel
              </Button>
              <Button type='submit' size='sm' disabled={recordUsage.isPending}>
                <ClipboardCheck className='mr-1.5 h-4 w-4' />
                Record
              </Button>
            </div>
          </form>
        </Form>
      )}

      {canPlanMaterial && (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-6'
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem className='sm:col-span-2'>
                  <FormLabel>Material</FormLabel>
                  <FormControl>
                    <Input placeholder='Ready-mix concrete' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input placeholder='MAT-001' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='unit'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit</FormLabel>
                  <FormControl>
                    <select
                      className='h-9 w-full rounded-md border bg-background px-3 text-sm'
                      {...field}
                    >
                      {UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {UNIT_LABELS[unit]}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='qty'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Qty</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      step='0.01'
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value || 0))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='supplierName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier</FormLabel>
                  <FormControl>
                    <Input placeholder='Approved vendor' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='spec'
              render={({ field }) => (
                <FormItem className='sm:col-span-2'>
                  <FormLabel>Spec</FormLabel>
                  <FormControl>
                    <Input placeholder='C40/50, ASTM A615...' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='requiredDate'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Need Date</FormLabel>
                  <FormControl>
                    <Input type='date' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='leadWeeks'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead Weeks</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value || 0))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='bufferDays'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Buffer Days</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value || 0))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='requiredTiming'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Basis</FormLabel>
                  <FormControl>
                    <select
                      className='h-9 w-full rounded-md border bg-background px-3 text-sm'
                      {...field}
                    >
                      <option value='activity_start'>Start</option>
                      <option value='activity_finish'>Finish</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='flex justify-end sm:col-span-6'>
              <Button type='submit' size='sm' disabled={addMaterial.isPending}>
                <Plus className='mr-1.5 h-4 w-4' />
                Add
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  )
}
