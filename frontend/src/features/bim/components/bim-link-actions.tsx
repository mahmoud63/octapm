import { useState } from 'react'
import { ChevronDown, Link2, Loader2, MapPin, Search } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocations } from '@/features/locations/hooks/use-locations'
import { RecordPickerDialog } from '@/features/messages/components/record-picker-dialog'
import {
  useCreateBimLinks,
  type BimElementFilters,
  type BimLinkRecordType,
} from '../hooks/use-bim'

/**
 * Ties elements to a record. Either `elementIds` (what is selected) or
 * `filter` (everything the element list is showing) is sent to the API.
 * Activities, BOQ items and RFIs are found through the global search;
 * locations come from the project's own tree.
 */
export function BimLinkActions({
  projectId,
  modelId,
  elementIds,
  filter,
  label = 'Link to…',
  disabled,
  size = 'sm',
  onLinked,
}: {
  projectId: string
  modelId: string
  elementIds?: string[]
  filter?: BimElementFilters
  label?: string
  disabled?: boolean
  size?: 'sm' | 'default'
  onLinked?: () => void
}) {
  const canLink = useCanPerform('bim', 'update', 'bim.link')
  const create = useCreateBimLinks(projectId)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [locationId, setLocationId] = useState('')
  const { data: locations } = useLocations(projectId, { enabled: locationOpen })

  if (!canLink) return null

  const link = async (
    recordType: BimLinkRecordType,
    recordId: string,
    title: string
  ) => {
    try {
      const result = await create.mutateAsync({
        modelId,
        recordType,
        recordId,
        ...(elementIds?.length ? { elementIds } : { filter: filter ?? {} }),
      })
      toast.success(
        result.linked
          ? `${result.linked} element${result.linked === 1 ? '' : 's'} linked to ${result.recordTitle || title}`
          : `Already linked to ${result.recordTitle || title}`
      )
      setLocationOpen(false)
      onLinked?.()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='outline'
            size={size}
            disabled={disabled || create.isPending}
            data-testid='uat-bim-link'
          >
            {create.isPending ? (
              <Loader2 className='mr-1 h-4 w-4 animate-spin' />
            ) : (
              <Link2 className='mr-1 h-4 w-4' />
            )}
            {label}
            <ChevronDown className='ml-1 h-3.5 w-3.5 opacity-60' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <DropdownMenuLabel className='text-xs text-muted-foreground'>
            {elementIds?.length
              ? `${elementIds.length} selected element${elementIds.length === 1 ? '' : 's'}`
              : 'Everything this filter matches'}
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => setPickerOpen(true)}
            data-testid='uat-bim-link-record'
          >
            <Search className='h-4 w-4' />
            <div>
              <p>Activity, BOQ item or RFI</p>
              <p className='text-xs text-muted-foreground'>
                An activity link is what puts the model on the schedule.
              </p>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setLocationOpen(true)}
            data-testid='uat-bim-link-location'
          >
            <MapPin className='h-4 w-4' />
            Location
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RecordPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectId={projectId}
        title='Link the elements to'
        description='Search the project for the activity, BOQ item or RFI these elements belong to.'
        allowedTypes={['activity', 'boq_item', 'rfi']}
        onPick={(record) =>
          link(
            record.recordType as BimLinkRecordType,
            record.recordId,
            record.title
          )
        }
      />

      <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Link to a location</DialogTitle>
            <DialogDescription>
              Ties the elements to a place on site, so photos, punch items and
              inspections there line up with the model.
            </DialogDescription>
          </DialogHeader>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger data-testid='uat-bim-link-location-select'>
              <SelectValue placeholder='Choose a location' />
            </SelectTrigger>
            <SelectContent>
              {(locations?.items ?? []).map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.fullName || location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant='outline' onClick={() => setLocationOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!locationId || create.isPending}
              onClick={() => {
                const location = (locations?.items ?? []).find(
                  (item) => item.id === locationId
                )
                void link(
                  'location',
                  locationId,
                  location?.name ?? 'the location'
                )
              }}
              data-testid='uat-bim-link-location-confirm'
            >
              {create.isPending && (
                <Loader2 className='mr-1 h-4 w-4 animate-spin' />
              )}
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
