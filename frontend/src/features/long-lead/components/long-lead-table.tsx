import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  type LongLeadItemRecord,
  type LongLeadPayload,
  useCreateLongLeadItem,
  useDeleteLongLeadItem,
  useLongLeadItems,
  useUpdateLongLeadItem,
} from '../hooks/use-long-lead'

type Props = {
  projectId: string
  activities: ScheduleActivity[]
}

type FormState = {
  item: string
  leadWeeks: number
  orderBy: string
  criticality: string
  risk: string
  supplier: string
  status: 'not_ordered' | 'ordered' | 'delivered'
  activityId: string
}

const defaultForm: FormState = {
  item: '',
  leadWeeks: 0,
  orderBy: '',
  criticality: '',
  risk: '',
  supplier: '',
  status: 'not_ordered',
  activityId: '',
}

export function LongLeadTable({ projectId, activities }: Props) {
  const { data: items = [], isLoading } = useLongLeadItems(projectId)
  const createItem = useCreateLongLeadItem(projectId)
  const updateItem = useUpdateLongLeadItem(projectId)
  const deleteItem = useDeleteLongLeadItem(projectId)

  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<LongLeadItemRecord | null>(
    null
  )
  const [form, setForm] = useState<FormState>(defaultForm)

  const setFormFromItem = (item: LongLeadItemRecord | null) => {
    if (!item) {
      setForm(defaultForm)
      return
    }
    setForm({
      item: item.item,
      leadWeeks: item.leadWeeks,
      orderBy: item.orderBy || '',
      criticality: item.criticality || '',
      risk: item.risk || '',
      supplier: item.supplier || '',
      status: item.status,
      activityId: item.activityId || '',
    })
  }

  const toPayload = (): LongLeadPayload => ({
    item: form.item,
    leadWeeks: Number(form.leadWeeks) || 0,
    orderBy: form.orderBy,
    criticality: form.criticality,
    risk: form.risk,
    supplier: form.supplier,
    status: form.status,
    activityId: form.activityId || null,
  })

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>
        Loading long lead items…
      </p>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-semibold'>Long Lead Register</h3>
        <Button
          size='sm'
          onClick={() => {
            setEditingItem(null)
            setForm(defaultForm)
            setFormOpen(true)
          }}
        >
          Add Item
        </Button>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm whitespace-nowrap'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>Item</th>
              <th className='p-2 text-right font-medium'>Lead Weeks</th>
              <th className='p-2 text-left font-medium'>Order By</th>
              <th className='p-2 text-left font-medium'>Activity</th>
              <th className='p-2 text-left font-medium'>Criticality</th>
              <th className='p-2 text-left font-medium'>Risk Note</th>
              <th className='p-2 text-left font-medium'>Supplier</th>
              <th className='p-2 text-center font-medium'>Status</th>
              <th className='p-2 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className='p-6 text-center text-muted-foreground'
                >
                  No long lead items available.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const urgent = item.leadWeeks >= 12
                return (
                  <tr
                    key={item.id}
                    className={`border-b hover:bg-muted/25 ${urgent ? 'bg-orange-50/70 dark:bg-orange-950/20' : ''}`}
                  >
                    <td className='p-2'>
                      <div className='flex items-center gap-1.5'>
                        {urgent && (
                          <AlertTriangle className='h-3.5 w-3.5 text-orange-600' />
                        )}
                        <span className='font-medium'>{item.item}</span>
                      </div>
                    </td>
                    <td className='p-2 text-right'>{item.leadWeeks}</td>
                    <td className='p-2 text-muted-foreground'>
                      {item.orderBy || '—'}
                    </td>
                    <td className='p-2'>
                      {item.activity ? (
                        <button
                          className='rounded-full border px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50 dark:text-blue-300'
                          onClick={() => {
                            const encoded = encodeURIComponent(
                              item.activity?.id || ''
                            )
                            window.location.hash = `activity-${encoded}`
                          }}
                        >
                          {item.activity.wbsCode
                            ? `${item.activity.wbsCode} · `
                            : ''}
                          {item.activity.name}
                        </button>
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </td>
                    <td className='p-2 text-muted-foreground'>
                      {item.criticality || '—'}
                    </td>
                    <td
                      className='max-w-60 truncate p-2 text-muted-foreground'
                      title={item.risk || ''}
                    >
                      {item.risk || '—'}
                    </td>
                    <td className='p-2 text-muted-foreground'>
                      {item.supplier || '—'}
                    </td>
                    <td className='p-2 text-center'>
                      <select
                        className='h-8 rounded-md border bg-background px-2 text-xs'
                        value={item.status}
                        onChange={async (e) => {
                          try {
                            await updateItem.mutateAsync({
                              itemId: item.id,
                              payload: {
                                status: e.target
                                  .value as LongLeadPayload['status'],
                              },
                            })
                            toast.success('Status updated')
                          } catch {
                            toast.error('Failed to update status')
                          }
                        }}
                      >
                        <option value='not_ordered'>Not Ordered</option>
                        <option value='ordered'>Ordered</option>
                        <option value='delivered'>Delivered</option>
                      </select>
                    </td>
                    <td className='p-2 text-right'>
                      <div className='flex justify-end gap-1'>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => {
                            setEditingItem(item)
                            setFormFromItem(item)
                            setFormOpen(true)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-red-600 hover:text-red-700'
                          onClick={async () => {
                            const confirmed = window.confirm(
                              'Delete this long lead item?'
                            )
                            if (!confirmed) return

                            try {
                              await deleteItem.mutateAsync(item.id)
                              toast.success('Item deleted')
                            } catch {
                              toast.error('Failed to delete item')
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'Edit Long Lead Item' : 'Add Long Lead Item'}
            </DialogTitle>
            <DialogDescription>
              Link procurement-critical items to schedule activities and track
              delivery status.
            </DialogDescription>
          </DialogHeader>

          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-item'>Item</Label>
              <Input
                id='ll-item'
                value={form.item}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, item: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-lead-weeks'>Lead Weeks</Label>
              <Input
                id='ll-lead-weeks'
                type='number'
                min={0}
                value={form.leadWeeks}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    leadWeeks: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-order-by'>Order By</Label>
              <Input
                id='ll-order-by'
                value={form.orderBy}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, orderBy: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-criticality'>Criticality</Label>
              <Input
                id='ll-criticality'
                value={form.criticality}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, criticality: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-supplier'>Supplier</Label>
              <Input
                id='ll-supplier'
                value={form.supplier}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, supplier: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-status'>Status</Label>
              <select
                id='ll-status'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.status}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    status: e.target.value as FormState['status'],
                  }))
                }
              >
                <option value='not_ordered'>Not Ordered</option>
                <option value='ordered'>Ordered</option>
                <option value='delivered'>Delivered</option>
              </select>
            </div>
            <div className='col-span-2 grid gap-1.5'>
              <Label htmlFor='ll-activity'>Linked Activity</Label>
              <select
                id='ll-activity'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.activityId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, activityId: e.target.value }))
                }
              >
                <option value=''>None</option>
                {activities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.wbsCode ? `${activity.wbsCode} · ` : ''}
                    {activity.name}
                  </option>
                ))}
              </select>
            </div>
            <div className='col-span-2 grid gap-1.5'>
              <Label htmlFor='ll-risk'>Risk Note</Label>
              <Input
                id='ll-risk'
                value={form.risk}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, risk: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createItem.isPending ||
                updateItem.isPending ||
                !form.item.trim()
              }
              onClick={async () => {
                try {
                  if (editingItem) {
                    await updateItem.mutateAsync({
                      itemId: editingItem.id,
                      payload: toPayload(),
                    })
                    toast.success('Long lead item updated')
                  } else {
                    await createItem.mutateAsync(toPayload())
                    toast.success('Long lead item added')
                  }

                  setFormOpen(false)
                  setEditingItem(null)
                } catch {
                  toast.error('Failed to save long lead item')
                }
              }}
            >
              {editingItem ? 'Save Changes' : 'Add Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
