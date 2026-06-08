import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useCreateBoqActivity } from '../hooks/use-boq'

const schema = z.object({
  activityName: z.string().min(1, 'Required').max(255),
  unit: z.string().min(1, 'Required'),
  quantity: z.number({ error: 'Must be a positive number' }).positive('Must be > 0'),
  rate: z.number({ error: 'Must be a non-negative number' }).nonnegative('Must be ≥ 0'),
  dependencyType: z.enum(['FS', 'SS', 'none']).optional(),
  predecessorCode: z.string().optional(),
})

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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      activityName: '',
      unit: '',
      quantity: undefined,
      rate: undefined,
      dependencyType: 'none',
      predecessorCode: '',
    },
  })

  useEffect(() => {
    if (!open) form.reset()
  }, [open, form])

  const depType = form.watch('dependencyType')

  const onSubmit = async (values: FormValues) => {
    await createActivity.mutateAsync({
      boqItemId,
      data: {
        activityName: values.activityName,
        unit: values.unit,
        quantity: values.quantity,
        rate: values.rate,
        dependencyType:
          values.dependencyType && values.dependencyType !== 'none'
            ? values.dependencyType
            : null,
        predecessorCode:
          values.dependencyType !== 'none' ? values.predecessorCode || null : null,
      },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Add Activity</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='activityName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Activity Name</FormLabel>
                  <FormControl>
                    <Input placeholder='e.g. Excavation to formation level' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                      <Input type='number' step='any' placeholder='0' {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
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
                    <Input type='number' step='any' placeholder='0.00' {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
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

            {depType && depType !== 'none' && existingActivityCodes.length > 0 && (
              <FormField
                control={form.control}
                name='predecessorCode'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Predecessor Activity</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
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
              <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type='submit' disabled={createActivity.isPending}>
                {createActivity.isPending ? 'Adding…' : 'Add Activity'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
