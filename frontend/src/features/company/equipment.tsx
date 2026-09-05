import { useState } from 'react'
import { Archive, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CompanySection } from './components/company-section'
import {
  useCompanyEquipment,
  useCreateCompanyEquipment,
  useUpdateCompanyEquipment,
} from './hooks/use-company'

const fmtMoney = (value: number) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

export function CompanyEquipmentPage() {
  const { data, isLoading } = useCompanyEquipment()
  const create = useCreateCompanyEquipment()
  const update = useUpdateCompanyEquipment()
  const [draft, setDraft] = useState({
    name: '',
    category: '',
    rateType: 'daily' as 'hourly' | 'daily',
    rate: '',
  })
  const items = data?.items ?? []

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error('Equipment name is required.')
      return
    }
    try {
      await create.mutateAsync({
        name: draft.name.trim(),
        category: draft.category.trim() || null,
        rateType: draft.rateType,
        rate: draft.rate ? Number(draft.rate) : 0,
      })
      toast.success('Equipment added to the company list.')
      setDraft({ name: '', category: '', rateType: 'daily', rate: '' })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <CompanySection
      title='Equipment'
      description='Master list of plant and equipment with standard rates. Projects pick from it and can override the rate.'
    >
      <div className='space-y-4' data-testid='uat-company-equipment'>
        <div className='flex flex-wrap items-end gap-2 rounded-md border p-3'>
          <div className='min-w-48 flex-1 space-y-1'>
            <Label htmlFor='ce-name'>Name</Label>
            <Input
              id='ce-name'
              data-testid='uat-company-equipment-name'
              placeholder='Tower crane 12t'
              value={draft.name}
              onChange={(e) =>
                setDraft((p) => ({ ...p, name: e.target.value }))
              }
            />
          </div>
          <div className='w-40 space-y-1'>
            <Label htmlFor='ce-category'>Category</Label>
            <Input
              id='ce-category'
              placeholder='Lifting'
              value={draft.category}
              onChange={(e) =>
                setDraft((p) => ({ ...p, category: e.target.value }))
              }
            />
          </div>
          <div className='w-28 space-y-1'>
            <Label htmlFor='ce-rate-type'>Rate type</Label>
            <select
              id='ce-rate-type'
              className='h-9 w-full rounded-md border bg-background px-3 text-sm'
              value={draft.rateType}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  rateType: e.target.value as 'hourly' | 'daily',
                }))
              }
            >
              <option value='hourly'>Hourly</option>
              <option value='daily'>Daily</option>
            </select>
          </div>
          <div className='w-28 space-y-1'>
            <Label htmlFor='ce-rate'>Rate</Label>
            <Input
              id='ce-rate'
              type='number'
              min={0}
              step='0.01'
              value={draft.rate}
              onChange={(e) =>
                setDraft((p) => ({ ...p, rate: e.target.value }))
              }
            />
          </div>
          <Button
            onClick={submit}
            disabled={create.isPending}
            data-testid='uat-company-equipment-save'
          >
            <Plus className='size-4' /> Add
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className='h-32 w-full' />
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className='text-right'>On projects</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className='text-center text-muted-foreground'
                    >
                      No equipment in the company list yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className='font-medium'>{row.name}</TableCell>
                      <TableCell>
                        {row.category ? (
                          <Badge variant='outline'>{row.category}</Badge>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className='tabular-nums'>
                        {fmtMoney(row.rate)} /{' '}
                        {row.rateType === 'hourly' ? 'hour' : 'day'}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {row.projectCount}
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          size='icon'
                          variant='ghost'
                          aria-label='Archive equipment'
                          onClick={async () => {
                            try {
                              await update.mutateAsync({
                                equipmentId: row.id,
                                payload: { status: 'archived' },
                              })
                              toast.success(`${row.name} archived.`)
                            } catch (error) {
                              toast.error(getServerErrorMessage(error))
                            }
                          }}
                        >
                          <Archive className='size-4' />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CompanySection>
  )
}
