import { Link } from '@tanstack/react-router'
import { MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { isPinRecordType, useRecordPins } from '../hooks/use-markups'

/**
 * "On sheet A-101" chips for a record that has been pinned on drawings;
 * each opens the sheet viewer with the pin highlighted.
 */
export function RecordPins({
  projectId,
  recordType,
  recordId,
}: {
  projectId: string
  recordType: string
  recordId: string
}) {
  const enabled = isPinRecordType(recordType)
  const { data } = useRecordPins(projectId, recordType, recordId, { enabled })
  const pins = data?.items ?? []
  if (!enabled || !pins.length) return null
  return (
    <div
      className='flex flex-wrap items-center gap-1.5'
      data-testid='uat-record-pins'
    >
      <span className='text-xs text-muted-foreground'>On drawings</span>
      {pins.map((pin) => (
        <Link key={pin.id} to={pin.sheetPath}>
          <Badge
            variant='outline'
            className='gap-1 font-normal hover:bg-accent'
          >
            <MapPin className='h-3 w-3' />
            {pin.sheet?.number ?? 'Sheet'}
            {pin.label ? ` · ${pin.label}` : ''}
          </Badge>
        </Link>
      ))}
    </div>
  )
}
