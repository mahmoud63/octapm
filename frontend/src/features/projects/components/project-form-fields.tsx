import type { z } from 'zod'
import type { UseFormReturn } from 'react-hook-form'
import {
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
import {
  contractTypeValues,
  createProjectSchema,
  projectCalendarValues,
  type CreateProjectInput,
  type Project,
} from '../data/schema'

export type ProjectFormValues = z.input<typeof createProjectSchema>

const NONE_VALUE = '__none'

const contractTypeLabels = {
  lump_sum: 'Lump Sum',
  unit_rate: 'Unit Rate',
  remeasurement: 'Remeasurement',
  cost_plus: 'Cost Plus',
  design_build: 'Design-Build',
  epc: 'EPC',
  other: 'Other',
} satisfies Record<(typeof contractTypeValues)[number], string>

const projectCalendarLabels = {
  five_day: '5-Day',
  six_day: '6-Day',
  seven_day: '7-Day',
  custom: 'Custom',
} satisfies Record<(typeof projectCalendarValues)[number], string>

const asDateInput = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : ''

export const projectFormDefaultValues = {
  name: '',
  startDate: '',
  endDate: '',
  type: '',
  location: '',
  clientName: '',
  consultantName: '',
  contractorName: '',
  contractType: undefined,
  contractNumber: '',
  completionDate: '',
  baselineDate: '',
  revisedCompletionDate: '',
  contractValue: undefined,
  defaultRetentionRate: 5,
  ldRatePerDay: 0,
  weatherAllowanceDays: 20,
  duration: undefined,
  durationUnit: 'months',
  projectCalendar: 'five_day',
  reportingCutoffDay: 25,
  currency: 'USD',
} satisfies ProjectFormValues

export const getProjectFormValues = (project: Project): ProjectFormValues => ({
  name: project.name,
  startDate: asDateInput(project.startDate),
  endDate: asDateInput(project.endDate),
  type: project.type ?? '',
  location: project.location ?? '',
  clientName: project.clientName ?? '',
  consultantName: project.consultantName ?? '',
  contractorName: project.contractorName ?? '',
  contractType: project.contractType ?? undefined,
  contractNumber: project.contractNumber ?? '',
  completionDate: asDateInput(project.completionDate),
  baselineDate: asDateInput(project.baselineDate),
  revisedCompletionDate: asDateInput(project.revisedCompletionDate),
  contractValue: project.contractValue ?? undefined,
  defaultRetentionRate: project.defaultRetentionRate ?? 5,
  ldRatePerDay: project.ldRatePerDay ?? 0,
  weatherAllowanceDays: project.weatherAllowanceDays ?? 20,
  duration: project.duration ?? undefined,
  durationUnit: project.durationUnit ?? 'months',
  projectCalendar: project.projectCalendar ?? 'five_day',
  reportingCutoffDay: project.reportingCutoffDay ?? 25,
  currency: project.currency,
})

export const buildProjectPayload = (
  values: ProjectFormValues
): CreateProjectInput => {
  const parsed = createProjectSchema.parse(values)

  return {
    ...parsed,
    type: parsed.type?.trim() || undefined,
    location: parsed.location?.trim() || undefined,
    clientName: parsed.clientName?.trim() || undefined,
    consultantName: parsed.consultantName?.trim() || undefined,
    contractorName: parsed.contractorName?.trim() || undefined,
    contractNumber: parsed.contractNumber?.trim() || undefined,
    completionDate: parsed.completionDate || undefined,
    baselineDate: parsed.baselineDate || undefined,
    revisedCompletionDate: parsed.revisedCompletionDate || undefined,
    currency: parsed.currency.toUpperCase(),
  }
}

type ProjectFormFieldsProps = {
  form: UseFormReturn<ProjectFormValues>
}

function NumberInput({
  field,
  min = 0,
  max,
  step = '0.01',
  placeholder,
}: {
  field: {
    value: number | undefined
    onChange: (value: number | undefined) => void
  }
  min?: number
  max?: number
  step?: string
  placeholder?: string
}) {
  return (
    <Input
      type='number'
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={field.value ?? ''}
      onChange={(event) => {
        const nextValue = event.target.value
        field.onChange(nextValue === '' ? undefined : Number(nextValue))
      }}
    />
  )
}

export function ProjectFormFields({ form }: ProjectFormFieldsProps) {
  return (
    <>
      <section className='space-y-3'>
        <h3 className='text-sm font-semibold'>Project Basics</h3>
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Name *</FormLabel>
              <FormControl>
                <Input
                  placeholder='e.g. Tower A Construction'
                  autoComplete='off'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='startDate'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date *</FormLabel>
                <FormControl>
                  <Input type='date' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='endDate'
            render={({ field }) => (
              <FormItem>
                <FormLabel>End Date *</FormLabel>
                <FormControl>
                  <Input type='date' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='type'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <FormControl>
                  <Input
                    placeholder='e.g. Residential'
                    autoComplete='off'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='location'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Location</FormLabel>
                <FormControl>
                  <Input
                    placeholder='e.g. Dubai, UAE'
                    autoComplete='off'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <section className='space-y-3'>
        <h3 className='text-sm font-semibold'>Contract Parties</h3>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
          <FormField
            control={form.control}
            name='clientName'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Client</FormLabel>
                <FormControl>
                  <Input autoComplete='off' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='consultantName'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Consultant</FormLabel>
                <FormControl>
                  <Input autoComplete='off' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='contractorName'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contractor</FormLabel>
                <FormControl>
                  <Input autoComplete='off' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <section className='space-y-3'>
        <h3 className='text-sm font-semibold'>Contract Terms</h3>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='contractType'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contract Type</FormLabel>
                <Select
                  onValueChange={(value) =>
                    field.onChange(value === NONE_VALUE ? undefined : value)
                  }
                  value={field.value ?? NONE_VALUE}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder='Select contract type' />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Not Set</SelectItem>
                    {contractTypeValues.map((value) => (
                      <SelectItem key={value} value={value}>
                        {contractTypeLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='contractNumber'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contract Number</FormLabel>
                <FormControl>
                  <Input autoComplete='off' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
          <FormField
            control={form.control}
            name='completionDate'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contract Completion</FormLabel>
                <FormControl>
                  <Input type='date' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='baselineDate'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Baseline Date</FormLabel>
                <FormControl>
                  <Input type='date' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='revisedCompletionDate'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Revised Completion</FormLabel>
                <FormControl>
                  <Input type='date' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <section className='space-y-3'>
        <h3 className='text-sm font-semibold'>Commercial Defaults</h3>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='contractValue'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contract Value</FormLabel>
                <FormControl>
                  <NumberInput field={field} placeholder='e.g. 5000000' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='currency'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency</FormLabel>
                <FormControl>
                  <Input
                    placeholder='USD'
                    maxLength={3}
                    value={field.value ?? 'USD'}
                    onChange={(event) =>
                      field.onChange(event.target.value.toUpperCase())
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
          <FormField
            control={form.control}
            name='defaultRetentionRate'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Retention %</FormLabel>
                <FormControl>
                  <NumberInput field={field} max={100} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='ldRatePerDay'
            render={({ field }) => (
              <FormItem>
                <FormLabel>LD Rate / Day</FormLabel>
                <FormControl>
                  <NumberInput field={field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='weatherAllowanceDays'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Weather Allowance</FormLabel>
                <FormControl>
                  <NumberInput field={field} step='1' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <section className='space-y-3'>
        <h3 className='text-sm font-semibold'>Reporting Settings</h3>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='duration'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Duration</FormLabel>
                <FormControl>
                  <NumberInput
                    field={field}
                    min={1}
                    step='1'
                    placeholder='e.g. 18'
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='durationUnit'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Duration Unit</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? 'months'}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder='Select duration unit' />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value='days'>Days</SelectItem>
                    <SelectItem value='weeks'>Weeks</SelectItem>
                    <SelectItem value='months'>Months</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='projectCalendar'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Project Calendar</FormLabel>
                <Select
                  onValueChange={(value) =>
                    field.onChange(value === NONE_VALUE ? undefined : value)
                  }
                  value={field.value ?? NONE_VALUE}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder='Select calendar' />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Not Set</SelectItem>
                    {projectCalendarValues.map((value) => (
                      <SelectItem key={value} value={value}>
                        {projectCalendarLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='reportingCutoffDay'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reporting Cutoff Day</FormLabel>
                <FormControl>
                  <NumberInput field={field} min={1} max={31} step='1' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>
    </>
  )
}
