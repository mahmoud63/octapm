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
import {
  UNIT_LABELS,
  UNITS,
  addMaterialSchema,
  type AddMaterialInput,
} from '../data/schema'
import {
  useAddMaterial,
  useDeleteMaterial,
  useMaterials,
} from '../hooks/use-materials'

type MaterialsSectionProps = {
  projectId: string
  activityId: string
}

export function MaterialsSection({
  projectId,
  activityId,
}: MaterialsSectionProps) {
  const { data: materials = [], isLoading } = useMaterials(
    projectId,
    activityId
  )
  const addMaterial = useAddMaterial(projectId, activityId)
  const deleteMaterial = useDeleteMaterial(projectId, activityId)

  const form = useForm<AddMaterialInput>({
    resolver: zodResolver(addMaterialSchema),
    defaultValues: {
      name: '',
      unit: 'TON',
      qty: 0,
    },
  })

  const onSubmit = async (values: AddMaterialInput) => {
    try {
      await addMaterial.mutateAsync(values)
      toast.success('Material added.')
      form.reset({
        name: '',
        unit: 'TON',
        qty: 0,
      })
    } catch {
      toast.error('Failed to add material.')
    }
  }

  const onDelete = async (materialId: string) => {
    try {
      await deleteMaterial.mutateAsync(materialId)
      toast.success('Material removed.')
    } catch {
      toast.error('Failed to remove material.')
    }
  }

  return (
    <div className='space-y-4'>
      <h3 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
        Materials
      </h3>

      {isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading materials...</p>
      ) : materials.length > 0 ? (
        <table className='w-full rounded-md border text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>Name</th>
              <th className='p-2 text-left font-medium'>Qty</th>
              <th className='p-2 text-left font-medium'>Unit</th>
              <th className='p-2' />
            </tr>
          </thead>
          <tbody>
            {materials.map((material) => (
              <tr key={material.id} className='border-b'>
                <td className='p-2'>{material.name}</td>
                <td className='p-2'>{material.qty}</td>
                <td className='p-2'>{UNIT_LABELS[material.unit]}</td>
                <td className='p-2 text-right'>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 text-destructive'
                    onClick={() => onDelete(material.id)}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className='text-sm text-muted-foreground'>No materials added yet.</p>
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
                <FormLabel>Material Name</FormLabel>
                <FormControl>
                  <Input placeholder='e.g. Sand' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='unit'
            render={({ field }) => (
              <FormItem className='w-28'>
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
              <FormItem className='w-28'>
                <FormLabel>Quantity</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step='0.01'
                    value={field.value}
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

          <Button type='submit' size='sm' disabled={addMaterial.isPending}>
            Add
          </Button>
        </form>
      </Form>
    </div>
  )
}
