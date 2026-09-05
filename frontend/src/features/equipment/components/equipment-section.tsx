import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { BadgeDollarSign, Clock3, Layers3, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCompanyEquipment } from '@/features/company/hooks/use-company'
import { addEquipmentSchema, type AddEquipmentInput } from '../data/schema'
import {
  useAddEquipment,
  useDeleteEquipment,
  useEquipment,
  useEquipmentUtilization,
} from '../hooks/use-equipment'

type EquipmentSectionProps = {
  projectId: string
}

const fmtMoney = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const fmtHours = (value: number) =>
  `${Number(value || 0).toLocaleString('en-US', {
    maximumFractionDigits: 1,
  })} h`

function UtilizationTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon: typeof Clock3
}) {
  return (
    <div className='rounded-md border bg-card p-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-xs font-medium text-muted-foreground'>{label}</p>
        <Icon className='h-4 w-4 text-muted-foreground' />
      </div>
      <p className='mt-2 text-xl font-semibold'>{value}</p>
    </div>
  )
}

export function EquipmentSection({ projectId }: EquipmentSectionProps) {
  const { data: equipment = [], isLoading } = useEquipment(projectId)
  const { data: utilization, isLoading: utilizationLoading } =
    useEquipmentUtilization(projectId)
  const addEquipment = useAddEquipment(projectId)
  const deleteEquipment = useDeleteEquipment(projectId)
  const { data: companyEquipment } = useCompanyEquipment()
  const masters = companyEquipment?.items ?? []

  const form = useForm<AddEquipmentInput>({
    resolver: zodResolver(addEquipmentSchema),
    defaultValues: {
      companyEquipmentId: undefined,
      name: '',
      rateType: 'daily',
      rate: 0,
    },
  })

  // Picking from the company list pre-fills the row; the rate stays editable.
  const applyMaster = (value: string) => {
    const master = masters.find((item) => item.id === value)
    if (!master) {
      form.setValue('companyEquipmentId', undefined)
      return
    }
    form.setValue('companyEquipmentId', master.id)
    form.setValue('name', master.name, { shouldValidate: true })
    form.setValue('rateType', master.rateType)
    form.setValue('rate', master.rate)
  }

  const onSubmit = async (values: AddEquipmentInput) => {
    try {
      await addEquipment.mutateAsync(values)
      toast.success('Equipment added.')
      form.reset({
        companyEquipmentId: undefined,
        name: '',
        rateType: 'daily',
        rate: 0,
      })
    } catch {
      toast.error('Failed to add equipment.')
    }
  }

  const onDelete = async (equipmentId: string) => {
    try {
      await deleteEquipment.mutateAsync(equipmentId)
      toast.success('Equipment removed.')
    } catch {
      toast.error('Failed to remove equipment.')
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h2 className='text-lg font-semibold'>Equipment</h2>
          <p className='text-xs text-muted-foreground'>
            Master rates and approved activity utilization
          </p>
        </div>
        {utilization?.totals.unpricedHours ? (
          <Badge variant='outline' className='border-amber-300 text-amber-700'>
            {fmtHours(utilization.totals.unpricedHours)} unpriced
          </Badge>
        ) : null}
      </div>

      {isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading equipment...</p>
      ) : equipment.length > 0 ? (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {equipment.map((item) => (
            <div
              key={item.id}
              className='flex items-start justify-between rounded-md border p-3'
            >
              <div>
                <p className='text-sm font-medium'>{item.name}</p>
                <p className='text-xs text-muted-foreground capitalize'>
                  {item.rateType} rate
                  {item.rate > 0 ? ` | ${fmtMoney(item.rate)}` : ''}
                </p>
              </div>

              <Button
                variant='ghost'
                size='icon'
                className='h-7 w-7 text-destructive'
                onClick={() => onDelete(item.id)}
              >
                <Trash2 className='h-4 w-4' />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>No equipment added yet.</p>
      )}

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className='flex flex-wrap items-end gap-2'
        >
          {masters.length > 0 && (
            <div className='w-56 space-y-2'>
              <p className='text-sm font-medium'>From company list</p>
              <Select onValueChange={applyMaster}>
                <SelectTrigger data-testid='uat-equipment-master-picker'>
                  <SelectValue placeholder='Pick equipment' />
                </SelectTrigger>
                <SelectContent>
                  {masters.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem className='min-w-52 flex-1'>
                <FormLabel>Equipment Name</FormLabel>
                <FormControl>
                  <Input placeholder='e.g. Concrete Mixer 500L' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='rateType'
            render={({ field }) => (
              <FormItem className='w-32'>
                <FormLabel>Rate Type</FormLabel>
                <FormControl>
                  <select
                    className='h-9 w-full rounded-md border bg-background px-3 text-sm'
                    {...field}
                  >
                    <option value='hourly'>Hourly</option>
                    <option value='daily'>Daily</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='rate'
            render={({ field }) => (
              <FormItem className='w-28'>
                <FormLabel>Rate</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step='0.01'
                    value={field.value ?? ''}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      field.onChange(
                        nextValue === '' ? undefined : Number(nextValue)
                      )
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type='submit' size='sm' disabled={addEquipment.isPending}>
            Add
          </Button>
        </form>
      </Form>

      <section className='space-y-3'>
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          <UtilizationTile
            label='Approved Hours'
            value={fmtHours(utilization?.totals.hours ?? 0)}
            icon={Clock3}
          />
          <UtilizationTile
            label='Equipment Cost'
            value={fmtMoney(utilization?.totals.costAmount ?? 0)}
            icon={BadgeDollarSign}
          />
          <UtilizationTile
            label='Activities'
            value={utilization?.totals.activityCount ?? 0}
            icon={Layers3}
          />
          <UtilizationTile
            label='Equipment Used'
            value={utilization?.totals.equipmentCount ?? 0}
            icon={Wrench}
          />
        </div>

        <div className='grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]'>
          <div className='rounded-md border'>
            <div className='flex items-center justify-between gap-2 border-b p-3'>
              <h3 className='text-sm font-semibold'>Utilization by Activity</h3>
              <Badge variant='outline'>
                {utilization?.byActivity.length ?? 0}
              </Badge>
            </div>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/50 text-xs text-muted-foreground'>
                  <tr>
                    <th className='p-2 text-left font-medium'>Activity</th>
                    <th className='p-2 text-right font-medium'>Hours</th>
                    <th className='p-2 text-right font-medium'>Cost</th>
                    <th className='p-2 text-right font-medium'>Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {utilizationLoading ? (
                    <tr>
                      <td
                        colSpan={4}
                        className='p-4 text-center text-sm text-muted-foreground'
                      >
                        Loading utilization...
                      </td>
                    </tr>
                  ) : utilization?.byActivity.length ? (
                    utilization.byActivity.map((row) => (
                      <tr key={row.activityId} className='border-t'>
                        <td className='p-2'>
                          <p className='text-xs font-medium'>
                            {row.wbsCode ? `${row.wbsCode} - ` : ''}
                            {row.activityName}
                          </p>
                          <p className='text-xs text-muted-foreground'>
                            {row.category || 'General'}
                          </p>
                        </td>
                        <td className='p-2 text-right text-xs'>
                          {fmtHours(row.hours)}
                        </td>
                        <td className='p-2 text-right text-xs'>
                          {fmtMoney(row.costAmount)}
                        </td>
                        <td className='p-2 text-right text-xs'>
                          {row.usageCount}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={4}
                        className='p-4 text-center text-sm text-muted-foreground'
                      >
                        No approved equipment usage yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className='rounded-md border'>
            <div className='flex items-center justify-between gap-2 border-b p-3'>
              <h3 className='text-sm font-semibold'>Recent Approved Usage</h3>
              <Badge variant='outline'>
                {utilization?.recentUsage.length ?? 0}
              </Badge>
            </div>
            <div className='divide-y'>
              {utilizationLoading ? (
                <p className='p-4 text-sm text-muted-foreground'>
                  Loading usage...
                </p>
              ) : utilization?.recentUsage.length ? (
                utilization.recentUsage.slice(0, 8).map((usage) => (
                  <div
                    key={usage.id}
                    className='flex items-start justify-between gap-3 p-3'
                  >
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium'>
                        {usage.equipmentName}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        {usage.activity?.wbsCode
                          ? `${usage.activity.wbsCode} - `
                          : ''}
                        {usage.activity?.name || 'Activity'}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        Daily report {usage.dailyReportId?.slice(0, 8) || '-'}
                      </p>
                    </div>
                    <div className='text-right text-xs'>
                      <p className='font-medium'>{fmtHours(usage.hours)}</p>
                      <p className='text-muted-foreground'>
                        {fmtMoney(usage.costAmount)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className='p-4 text-sm text-muted-foreground'>
                  Approved daily reports will appear here.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
