import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { useProjects } from '@/features/projects/hooks/use-projects'
import {
  issueStock,
  listLocations,
  moveStock,
  receiveStock,
  type InventoryItem,
  type MovementPayload,
  type StockLine,
  type Warehouse,
} from '../data/api'

/**
 * Turns a scanned item into a stock movement.
 *
 * One dialog for every action rather than five near-identical ones: what
 * changes between receiving and issuing is which extra fields are asked for,
 * not the shape of the job.
 */

export type MovementAction =
  | 'receive'
  | 'issue'
  | 'return'
  | 'adjust'
  | 'damage'
  | 'quarantine'
  | 'release'

const TITLES: Record<MovementAction, { title: string; verb: string; description: string }> = {
  receive: {
    title: 'Receive into store',
    verb: 'Receive',
    description: 'Goods in. This is the movement that sets what the stock is worth.',
  },
  issue: {
    title: 'Issue to site',
    verb: 'Issue',
    description: 'Where does this go? The cost lands on the activity or cost code you name.',
  },
  return: {
    title: 'Return from site',
    verb: 'Return',
    description: 'Unused material coming back into the store.',
  },
  adjust: {
    title: 'Adjust stock',
    verb: 'Adjust',
    description: 'Correct the figure, and say why. Negative to reduce.',
  },
  damage: {
    title: 'Write off as damaged',
    verb: 'Write off',
    description: 'Moves stock off the shelf and onto the damage account.',
  },
  quarantine: {
    title: 'Quarantine',
    verb: 'Quarantine',
    description: 'Hold stock back pending inspection. It stops being available.',
  },
  release: {
    title: 'Release from quarantine',
    verb: 'Release',
    description: 'Put inspected stock back into available.',
  },
}

interface Props {
  action: MovementAction | null
  item: InventoryItem | null
  stock: StockLine[]
  warehouses: Warehouse[]
  onClose: () => void
  onDone?: () => void
}

export function MovementDialog({ action, item, stock, warehouses, onClose, onDone }: Props) {
  const queryClient = useQueryClient()
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [damagedQty, setDamagedQty] = useState('')
  const [projectId, setProjectId] = useState('')
  const [activityId, setActivityId] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  const copy = action ? TITLES[action] : null
  const open = Boolean(action && item)

  // Where the item already is, so issuing defaults to the shelf holding it.
  const suggestedWarehouseId = stock.find((line) => line.onHand > 0)?.warehouseId ?? ''
  const effectiveWarehouseId = warehouseId || suggestedWarehouseId || warehouses[0]?.id || ''

  const locations = useQuery({
    queryKey: ['warehouse-locations', effectiveWarehouseId],
    queryFn: () => listLocations(effectiveWarehouseId),
    enabled: open && Boolean(effectiveWarehouseId),
  })

  const { data: projects } = useProjects()
  const activities = useActivities(projectId)

  const onHandHere = useMemo(
    () =>
      stock
        .filter((line) => line.warehouseId === effectiveWarehouseId)
        .reduce((sum, line) => sum + line.onHand, 0),
    [effectiveWarehouseId, stock]
  )

  const reset = () => {
    setWarehouseId('')
    setLocationId('')
    setQuantity('')
    setUnitCost('')
    setDamagedQty('')
    setProjectId('')
    setActivityId('')
    setReference('')
    setNotes('')
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!item || !action) return
      const payload: MovementPayload = {
        itemId: item.id,
        warehouseId: effectiveWarehouseId,
        locationId: locationId || null,
        quantity: Number(quantity),
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      }

      if (action === 'receive') {
        return receiveStock({
          ...payload,
          unitCost: unitCost === '' ? null : Number(unitCost),
          damagedQty: damagedQty === '' ? null : Number(damagedQty),
        })
      }
      if (action === 'issue') {
        return issueStock({
          ...payload,
          projectId: projectId || null,
          activityId: activityId || null,
        })
      }
      // A return brings its cost back from the activity it was issued to (CX21-455).
      return moveStock(
        action,
        action === 'return'
          ? { ...payload, projectId: projectId || null, activityId: activityId || null }
          : payload
      )
    },
    onSuccess: () => {
      toast.success(`${copy?.verb} recorded`)
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      reset()
      onDone?.()
      onClose()
    },
    onError: (error) => toast.error(getServerErrorMessage(error)),
  })

  if (!open || !item || !copy || !action) return null

  const needsCostTarget = action === 'issue' || action === 'return'
  const canSubmit =
    Number.isFinite(Number(quantity)) &&
    Number(quantity) !== 0 &&
    Boolean(effectiveWarehouseId) &&
    (!needsCostTarget || Boolean(activityId)) &&
    (action !== 'adjust' || notes.trim().length > 0)

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle data-testid='uat-movement-title'>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className='rounded-md border bg-surface p-3 text-sm'>
          <p className='font-medium'>{item.name}</p>
          <p className='font-mono text-xs text-muted-foreground'>{item.sku}</p>
          <p className='mt-1 text-xs text-muted-foreground'>
            {onHandHere} {item.unit} on hand here · {item.onHand} {item.unit} in total
          </p>
        </div>

        <div className='grid gap-4'>
          <div className='grid gap-2'>
            <Label htmlFor='movement-warehouse'>Warehouse</Label>
            <Select
              value={effectiveWarehouseId}
              onValueChange={(value) => {
                setWarehouseId(value)
                setLocationId('')
              }}
            >
              <SelectTrigger id='movement-warehouse' data-testid='uat-movement-warehouse'>
                <SelectValue placeholder='Choose a warehouse' />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='movement-location'>
              Location <span className='text-muted-foreground'>(optional)</span>
            </Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger id='movement-location'>
                <SelectValue placeholder='Anywhere in this warehouse' />
              </SelectTrigger>
              <SelectContent>
                {(locations.data ?? []).map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.code} · {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              Leave this alone and the store takes it from the fullest bin.
            </p>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='movement-quantity'>
              Quantity ({item.unit})
            </Label>
            <Input
              id='movement-quantity'
              data-testid='uat-movement-quantity'
              inputMode='decimal'
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder={action === 'adjust' ? 'Negative to reduce' : '0'}
            />
          </div>

          {action === 'receive' && (
            <>
              <div className='grid gap-2'>
                <Label htmlFor='movement-cost'>Unit cost</Label>
                <Input
                  id='movement-cost'
                  inputMode='decimal'
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  placeholder={String(item.averageCost || 0)}
                />
                <p className='text-xs text-muted-foreground'>
                  Moves the weighted average. Leave blank to keep the current
                  average of {item.averageCost}.
                </p>
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='movement-damaged'>
                  Damaged on delivery{' '}
                  <span className='text-muted-foreground'>(optional)</span>
                </Label>
                <Input
                  id='movement-damaged'
                  inputMode='decimal'
                  value={damagedQty}
                  onChange={(event) => setDamagedQty(event.target.value)}
                  placeholder='0'
                />
              </div>
            </>
          )}

          {(action === 'issue' || action === 'return') && (
            <>
              <div className='grid gap-2'>
                <Label htmlFor='movement-project'>Project</Label>
                <Select
                  value={projectId}
                  onValueChange={(value) => {
                    setProjectId(value)
                    setActivityId('')
                  }}
                >
                  <SelectTrigger id='movement-project' data-testid='uat-movement-project'>
                    <SelectValue placeholder='Choose a project' />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects?.items ?? []).map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='movement-activity'>Activity</Label>
                <Select value={activityId} onValueChange={setActivityId} disabled={!projectId}>
                  <SelectTrigger id='movement-activity' data-testid='uat-movement-activity'>
                    <SelectValue
                      placeholder={projectId ? 'Choose an activity' : 'Choose a project first'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(activities.data ?? []).map((activity) => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {activity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className='text-xs text-muted-foreground'>
                  The material cost posts against this activity. An issue with
                  nowhere to land is how material cost goes missing.
                </p>
              </div>
            </>
          )}

          <div className='grid gap-2'>
            <Label htmlFor='movement-reference'>
              Reference <span className='text-muted-foreground'>(optional)</span>
            </Label>
            <Input
              id='movement-reference'
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder='Delivery note, requisition, pour number…'
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='movement-notes'>
              {action === 'adjust' ? 'Why' : 'Notes'}
              {action !== 'adjust' && (
                <span className='text-muted-foreground'> (optional)</span>
              )}
            </Label>
            <Textarea
              id='movement-notes'
              data-testid='uat-movement-notes'
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              placeholder={
                action === 'adjust'
                  ? 'An unexplained adjustment is the first thing an auditor asks about'
                  : ''
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            data-testid='uat-movement-submit'
          >
            {mutation.isPending && <Loader2 className='me-1.5 size-4 animate-spin' />}
            {copy.verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
