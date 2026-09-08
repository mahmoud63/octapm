import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
} from '@/lib/money'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { useCreateBoqActivity } from '../hooks/use-boq'

const schema = z
  .object({
    // Splitting a bill item across the programme means naming activities that
    // exist. Creating one is still allowed, for a project being built up from
    // the bill, but it is the second option rather than the only one.
    activityMode: z.enum(['existing', 'new']),
    activityId: z.string().optional(),
    activityName: z.string().max(255).optional(),
    unit: z.string().min(1, 'Required'),
    quantity: z
      .number({ error: 'Must be a positive number' })
      .positive('Must be > 0'),
    rate: z
      .number({ error: 'Must be a non-negative number' })
      .nonnegative('Must be ≥ 0'),
    dependencyType: z.enum(['FS', 'SS', 'none']).optional(),
    predecessorCode: z.string().optional(),
  })
  .refine((data) => hasMoneyPrecision(data.rate), {
    message: MONEY_PRECISION_MESSAGE,
    path: ['rate'],
  })
  .refine(
    (data) => data.activityMode !== 'existing' || Boolean(data.activityId),
    { message: 'Choose the activity', path: ['activityId'] },
  )
  .refine(
    (data) => data.activityMode !== 'new' || Boolean(data.activityName?.trim()),
    { message: 'Required', path: ['activityName'] },
  )

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  boqItemId: string
  projectId: string
  existingActivityCodes: string[]
}

export function BoqAddActivityDialog({
  open,
  onOpenChange,
  boqItemId,
  projectId,
  existingActivityCodes,
}: Props) {
  const createActivity = useCreateBoqActivity(projectId)
  const { data: activities } = useActivities(projectId)
  const programme = activities ?? []
  const hasProgramme = programme.length > 0

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      activityMode: hasProgramme ? 'existing' : 'new',
      activityId: undefined,
      activityName: '',
      unit: '',
      quantity: undefined,
      rate: undefined,
      dependencyType: 'none',
      predecessorCode: '',
    },
  })

  // The programme loads asynchronously; the default settles when it arrives,
  // and stops adjusting once the person has chosen for themselves.
  const chosenByHand = useRef(false)

  useEffect(() => {
    if (!open) {
      form.reset()
      chosenByHand.current = false
    }
  }, [open, form])

  useEffect(() => {
    if (!open || chosenByHand.current) return
    form.setValue('activityMode', hasProgramme ? 'existing' : 'new')
  }, [open, hasProgramme, form])

  const depType = form.watch('dependencyType')
  const activityMode = form.watch('activityMode')

  const onSubmit = async (values: FormValues) => {
    await createActivity.mutateAsync({
      boqItemId,
      data: {
        ...(values.activityMode === 'existing'
          ? { activityId: values.activityId }
          : { activityName: values.activityName }),
        unit: values.unit,
        quantity: values.quantity,
        rate: values.rate,
        dependencyType:
          values.dependencyType && values.dependencyType !== 'none'
            ? values.dependencyType
            : null,
        predecessorCode:
          values.dependencyType !== 'none'
            ? values.predecessorCode || null
            : null,
      },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Add Draft Allocation Link</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='activityMode'
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={(value) => {
                        chosenByHand.current = true
                        field.onChange(value)
                      }}
                      className='gap-2'
                    >
                      <div className='flex items-center gap-2'>
                        <RadioGroupItem
                          value='existing'
                          id='alloc-existing'
                          disabled={!hasProgramme}
                          data-testid='uat-alloc-activity-existing'
                        />
                        <label
                          htmlFor='alloc-existing'
                          className={
                            hasProgramme
                              ? 'text-sm'
                              : 'text-sm text-muted-foreground'
                          }
                        >
                          Allocate to an activity on the programme
                          {!hasProgramme && ' — there are none yet'}
                        </label>
                      </div>
                      <div className='flex items-center gap-2'>
                        <RadioGroupItem
                          value='new'
                          id='alloc-new'
                          data-testid='uat-alloc-activity-new'
                        />
                        <label htmlFor='alloc-new' className='text-sm'>
                          Create a new activity for this share
                        </label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />

            {activityMode === 'existing' ? (
              <FormField
                control={form.control}
                name='activityId'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Activity</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid='uat-alloc-activity-select'>
                          <SelectValue placeholder='Choose an activity' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {programme.map((activity) => (
                          <SelectItem key={activity.id} value={activity.id}>
                            {[
                              activity.activityCode || activity.p6ActivityId,
                              activity.name,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name='activityName'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Activity Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g. Excavation to formation level'
                        data-testid='uat-alloc-activity-name'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className='grid grid-cols-2 gap-3'>
              <FormField
                control={form.control}
                name='unit'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <FormControl>
                      <Input placeholder='m³' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='quantity'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        step='any'
                        placeholder='0'
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='rate'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step={MONEY_INPUT_STEP}
                      placeholder='0.00'
                      {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='dependencyType'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dependency Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='None' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value='none'>None</SelectItem>
                      <SelectItem value='FS'>FS — Finish-to-Start</SelectItem>
                      <SelectItem value='SS'>SS — Start-to-Start</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {depType &&
              depType !== 'none' &&
              existingActivityCodes.length > 0 && (
                <FormField
                  control={form.control}
                  name='predecessorCode'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Predecessor Activity</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select predecessor' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {existingActivityCodes.map((code) => (
                            <SelectItem key={code} value={code}>
                              {code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={createActivity.isPending}>
                {createActivity.isPending ? 'Adding...' : 'Add Draft Link'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
