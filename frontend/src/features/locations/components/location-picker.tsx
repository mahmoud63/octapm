import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocations, type LocationRecord } from '../hooks/use-locations'

export const ROOT_LOCATION_VALUE = '__root__'

type LocationPickerProps = {
  projectId: string
  value: string | null
  onChange: (locationId: string | null) => void
  /** Ids that cannot be chosen (e.g. the node being moved and its subtree). */
  excludePaths?: string[]
  allowRoot?: boolean
  rootLabel?: string
  placeholder?: string
  disabled?: boolean
  id?: string
}

const isExcluded = (location: LocationRecord, excludePaths: string[]) =>
  excludePaths.some(
    (path) => location.path === path || location.path.startsWith(`${path}/`)
  )

/**
 * Dropdown over the flattened location tree, indented by depth. Reusable by
 * every field record that needs a location (punch items, inspections, photos).
 */
export function LocationPicker({
  projectId,
  value,
  onChange,
  excludePaths = [],
  allowRoot = true,
  rootLabel = 'Top level (no parent)',
  placeholder = 'Choose a location',
  disabled,
  id,
}: LocationPickerProps) {
  const { data, isLoading } = useLocations(projectId)
  const items = (data?.items ?? []).filter(
    (location) => !isExcluded(location, excludePaths)
  )

  return (
    <Select
      value={value ?? (allowRoot ? ROOT_LOCATION_VALUE : '')}
      onValueChange={(next) =>
        onChange(next === ROOT_LOCATION_VALUE ? null : next)
      }
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} className='w-full'>
        <SelectValue
          placeholder={isLoading ? 'Loading locations…' : placeholder}
        />
      </SelectTrigger>
      <SelectContent>
        {allowRoot && (
          <SelectItem value={ROOT_LOCATION_VALUE}>{rootLabel}</SelectItem>
        )}
        {items.map((location) => (
          <SelectItem key={location.id} value={location.id}>
            <span
              className='inline-block'
              style={{ paddingInlineStart: `${location.depth * 12}px` }}
            >
              {location.depth > 0 && (
                <span className='text-muted-foreground'>└ </span>
              )}
              {location.name}
              {location.code && (
                <span className='ms-1 text-xs text-muted-foreground'>
                  {location.code}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
