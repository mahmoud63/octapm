import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { addEquipmentSchema, type AddEquipmentInput } from '../data/schema'
import {
  useAddEquipment,
  useDeleteEquipment,
  useEquipment,
} from '../hooks/use-equipment'

type EquipmentSectionProps = {
  projectId: string
}

export function EquipmentSection({ projectId }: EquipmentSectionProps) {
  const { data: equipment = [], isLoading } = useEquipment(projectId)
  const addEquipment = useAddEquipment(projectId)
  const deleteEquipment = useDeleteEquipment(projectId)

  const form = useForm<AddEquipmentInput>({
    resolver: zodResolver(addEquipmentSchema),
    defaultValues: {
      name: '',
      rateType: 'daily',
      rate: 0,
    },
  })

  const onSubmit = async (values: AddEquipmentInput) => {
    try {
      await addEquipment.mutateAsync(values)
      toast.success('Equipment added.')
      form.reset({
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
      <h2 className='text-lg font-semibold'>Equipment</h2>

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
                  {item.rate > 0 ? ` | ${item.rate}` : ''}
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
    </div>
  )
}
