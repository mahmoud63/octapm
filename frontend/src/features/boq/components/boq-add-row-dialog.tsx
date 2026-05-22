import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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
import { Button } from '@/components/ui/button'
import { useCreateBoqItem } from '../hooks/use-boq'

const schema = z.object({
  code: z.string().min(1, 'Required'),
  description: z.string().min(1, 'Required').max(255),
  quantity: z.number({ error: 'Must be a positive number' }).positive('Must be > 0'),
  unit: z.string().min(1, 'Required'),
  rate: z.number({ error: 'Must be a positive number' }).positive('Must be > 0'),
  activityName: z.string().min(1, 'Required').max(255),
  activityCode: z.string().min(1, 'Required').max(20),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function BoqAddRowDialog({ open, onOpenChange, projectId }: Props) {
  const createItem = useCreateBoqItem(projectId)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      description: '',
      quantity: undefined,
      unit: '',
      rate: undefined,
      activityName: '',
      activityCode: '',
    },
  })

  useEffect(() => {
    if (!open) form.reset()
  }, [open, form])

  const onSubmit = async (values: FormValues) => {
    await createItem.mutateAsync(values)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Add BOQ Row</DialogTitle>
          <DialogDescription className='text-xs text-muted-foreground'>
            This row will not be processed by AI. Enter the Activity Name and
            Activity Code manually.
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
                      <Input type='number' step='any' placeholder='0' {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
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
                      <Input type='number' step='any' placeholder='0.00' {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className='rounded-md border border-dashed p-3'>
              <p className='mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide'>
                Activity (no AI)
              </p>
              <div className='grid grid-cols-2 gap-3'>
                <FormField
                  control={form.control}
                  name='activityCode'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Activity Code</FormLabel>
                      <FormControl>
                        <Input placeholder='AC-XXXXX' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className='mt-3'>
                <FormField
                  control={form.control}
                  name='activityName'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Activity Name</FormLabel>
                      <FormControl>
                        <Input placeholder='e.g. Fabricate and erect steelwork' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type='submit' disabled={createItem.isPending}>
                {createItem.isPending ? 'Adding…' : 'Add Row'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
