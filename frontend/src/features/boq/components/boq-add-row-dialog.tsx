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
  DialogDescription,
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { useCreateBoqItem } from '../hooks/use-boq'

const schema = z.object({
  code: z.string().min(1, 'Required'),
  description: z.string().min(1, 'Required').max(255),
  quantity: z
    .number({ error: 'Must be a positive number' })
    .positive('Must be > 0'),
  unit: z.string().min(1, 'Required'),
  rate: z
    .number({ error: 'Must be a positive number' })
    .positive('Must be > 0')
    .refine(hasMoneyPrecision, MONEY_PRECISION_MESSAGE),
  // Which activity this row belongs to, said one of three ways. "existing"
  // attaches it to the programme that is already there; "new" lets the row
  // create one, which is how a project with no programme yet gets started;
  // "later" leaves it unallocated so the quantity can be split across several
  // activities afterwards.
  activityMode: z.enum(['existing', 'new', 'later']),
  activityId: z.string().optional(),
  activityName: z.string().max(255).optional(),
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
  projectId: string
}

export function BoqAddRowDialog({ open, onOpenChange, projectId }: Props) {
  const createItem = useCreateBoqItem(projectId)
  const { data: activities } = useActivities(projectId)
  const programme = activities ?? []
  const hasProgramme = programme.length > 0

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      description: '',
      quantity: undefined,
      unit: '',
      rate: undefined,
      // A project that already has a programme should attach to it, not grow a
      // second one; a project with nothing yet has only one sensible option.
      activityMode: hasProgramme ? 'existing' : 'new',
      activityId: undefined,
      activityName: '',
    },
  })

  const activityMode = form.watch('activityMode')
  // The programme arrives asynchronously, so the default has to settle when it
  // does — otherwise a dialog opened before the activities load offers to
  // create a new activity on a project that already has a schedule, which is
  // the thing this exists to stop. It stops adjusting the moment the person
  // makes a choice of their own.
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

  const onSubmit = async (values: FormValues) => {
    const { activityMode: mode, activityId, activityName, ...row } = values
    await createItem.mutateAsync({
      ...row,
      // The relationship is the id. Nothing about the activity is retyped when
      // an existing one is chosen — its code and name come from the activity.
      ...(mode === 'existing' ? { activityId } : {}),
      ...(mode === 'new' ? { activityName } : {}),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Add BOQ Row</DialogTitle>
          <DialogDescription className='text-xs text-muted-foreground'>
            This creates a schedule activity and draft BOQ allocation with an
            automatically generated activity code.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <div className='grid grid-cols-2 gap-3'>
              <FormField
                control={form.control}
                name='code'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input placeholder='e.g. 5.1' {...field} />
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
                      <Input placeholder='m²' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder='Work description' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid grid-cols-2 gap-3'>
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
            </div>

            <div className='rounded-md border border-dashed p-3'>
              <p className='mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase'>
                Schedule Activity
              </p>

              <FormField
                control={form.control}
                name='activityMode'
                render={({ field }) => (
                  <FormItem className='space-y-2'>
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
                            id='activity-existing'
                            disabled={!hasProgramme}
                            data-testid='uat-boq-activity-existing'
                          />
                          <label
                            htmlFor='activity-existing'
                            className={
                              hasProgramme
                                ? 'text-sm'
                                : 'text-sm text-muted-foreground'
                            }
                          >
                            Use an activity already on the programme
                            {!hasProgramme && ' — there are none yet'}
                          </label>
                        </div>
                        <div className='flex items-center gap-2'>
                          <RadioGroupItem
                            value='new'
                            id='activity-new'
                            data-testid='uat-boq-activity-new'
                          />
                          <label htmlFor='activity-new' className='text-sm'>
                            Create a new activity for this row
                          </label>
                        </div>
                        <div className='flex items-center gap-2'>
                          <RadioGroupItem
                            value='later'
                            id='activity-later'
                            data-testid='uat-boq-activity-later'
                          />
                          <label htmlFor='activity-later' className='text-sm'>
                            Decide later — split this row across activities
                          </label>
                        </div>
                      </RadioGroup>
                    </FormControl>
                  </FormItem>
                )}
              />

              {activityMode === 'existing' && (
                <FormField
                  control={form.control}
                  name='activityId'
                  render={({ field }) => (
                    <FormItem className='mt-3'>
                      <FormLabel>Activity</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger data-testid='uat-boq-activity-select'>
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
              )}

              {activityMode === 'new' && (
                <FormField
                  control={form.control}
                  name='activityName'
                  render={({ field }) => (
                    <FormItem className='mt-3'>
                      <FormLabel>Activity Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder='e.g. Fabricate and erect steelwork'
                          data-testid='uat-boq-activity-name'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {activityMode === 'later' && (
                <p className='mt-3 text-xs text-muted-foreground'>
                  The row is added with nothing allocated. Allocate its quantity
                  to one or more activities from the BOQ row itself.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type='submit'
                disabled={createItem.isPending}
                data-testid='uat-boq-add-row-submit'
              >
                {createItem.isPending ? 'Adding…' : 'Add Row'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
