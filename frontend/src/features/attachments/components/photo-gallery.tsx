import { useMemo, useState } from 'react'
import { Camera, Images, MapPin, Sparkles, Tag, X } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Skeleton } from '@/components/ui/skeleton'
import { LocationPicker } from '@/features/locations/components/location-picker'
import {
  formatBytes,
  usePhotos,
  useUpdatePhoto,
  type PhotoFilters,
  type PhotoRecord,
} from '../hooks/use-attachments'
import {
  useAnalyzePhotos,
  usePhotoAiStatus,
} from '../hooks/use-photo-assistant'
import { PhotoAnalysisPanel } from './photo-analysis'

const RECORD_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ncr', label: 'NCR' },
  { value: 'itp', label: 'ITP' },
  { value: 'defect', label: 'Defect' },
  { value: 'safety_incident', label: 'Safety incident' },
  { value: 'material_test', label: 'Material test' },
  { value: 'rfi', label: 'RFI' },
  { value: 'submittal', label: 'Submittal' },
  { value: 'drawing', label: 'Drawing' },
  { value: 'daily_report', label: 'Daily report' },
  { value: 'site_diary', label: 'Site diary' },
  { value: 'task', label: 'Task' },
  { value: 'risk', label: 'Risk' },
]
const ANY_TYPE = '__any__'

const humanize = (value: string) =>
  value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

function PhotoDetailDialog({
  projectId,
  photo,
  canEdit,
  onClose,
}: {
  projectId: string
  photo: PhotoRecord | null
  canEdit: boolean
  onClose: () => void
}) {
  const update = useUpdatePhoto(projectId)
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Seed the editable fields when a different photo opens (derived, no effect).
  if (photo && editingId !== photo.id) {
    setEditingId(photo.id)
    setCaption(photo.caption ?? '')
    setTags(photo.tags.join(', '))
    setLocationId(photo.locationId)
  }

  const save = async () => {
    if (!photo) return
    try {
      await update.mutateAsync({
        photoId: photo.id,
        payload: {
          caption: caption.trim() || null,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          locationId,
        },
      })
      toast.success('Photo updated.')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={Boolean(photo)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-4xl'>
        {photo && (
          <>
            <DialogHeader>
              <DialogTitle className='truncate'>
                {photo.caption || photo.document?.originalName || 'Photo'}
              </DialogTitle>
              <DialogDescription>
                {photo.takenAt
                  ? `Taken ${new Date(photo.takenAt).toLocaleString()}`
                  : 'Capture time unknown'}
                {photo.cameraModel
                  ? ` · ${photo.cameraMake ?? ''} ${photo.cameraModel}`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <div className='grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'>
              <a
                href={photo.url}
                target='_blank'
                rel='noreferrer'
                className='block overflow-hidden rounded-md bg-muted'
              >
                <img
                  src={photo.url}
                  alt={photo.caption || 'Photo'}
                  className='max-h-[60vh] w-full object-contain'
                />
              </a>
              <div className='space-y-3 text-sm'>
                <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
                  <dt className='text-muted-foreground'>File</dt>
                  <dd className='truncate'>
                    {photo.document?.originalName}{' '}
                    {photo.document?.sizeBytes
                      ? `(${formatBytes(photo.document.sizeBytes)})`
                      : ''}
                  </dd>
                  <dt className='text-muted-foreground'>Size</dt>
                  <dd>
                    {photo.width && photo.height
                      ? `${photo.width} × ${photo.height}`
                      : '—'}
                  </dd>
                  <dt className='text-muted-foreground'>GPS</dt>
                  <dd>
                    {photo.latitude != null && photo.longitude != null ? (
                      <a
                        className='underline-offset-2 hover:underline'
                        href={`https://www.openstreetmap.org/?mlat=${photo.latitude}&mlon=${photo.longitude}#map=18/${photo.latitude}/${photo.longitude}`}
                        target='_blank'
                        rel='noreferrer'
                      >
                        {photo.latitude.toFixed(5)},{' '}
                        {photo.longitude.toFixed(5)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                  <dt className='text-muted-foreground'>Thumbnail</dt>
                  <dd>{photo.thumbnailStatus}</dd>
                </dl>

                <div className='space-y-2'>
                  <Label htmlFor='photo-caption'>Caption</Label>
                  <Input
                    id='photo-caption'
                    value={caption}
                    disabled={!canEdit}
                    onChange={(event) => setCaption(event.target.value)}
                  />
                  <Label htmlFor='photo-tags'>Tags</Label>
                  <Input
                    id='photo-tags'
                    value={tags}
                    disabled={!canEdit}
                    placeholder='concrete, level 3, defect'
                    onChange={(event) => setTags(event.target.value)}
                  />
                  <Label htmlFor='photo-location'>Location</Label>
                  <LocationPicker
                    id='photo-location'
                    projectId={projectId}
                    value={locationId}
                    onChange={setLocationId}
                    rootLabel='No location'
                    disabled={!canEdit}
                  />
                  {canEdit && (
                    <Button
                      size='sm'
                      onClick={save}
                      disabled={update.isPending}
                      data-testid='uat-photo-save'
                    >
                      {update.isPending ? 'Saving…' : 'Save'}
                    </Button>
                  )}
                </div>

                <PhotoAnalysisPanel
                  projectId={projectId}
                  photo={photo}
                  canEdit={canEdit}
                />

                <div>
                  <p className='mb-1 text-xs font-semibold text-muted-foreground uppercase'>
                    Attached to
                  </p>
                  {photo.records?.length ? (
                    <ul className='space-y-1'>
                      {photo.records.map((record) => (
                        <li
                          key={`${record.recordType}-${record.recordId}`}
                          className='flex items-center gap-2 text-xs'
                        >
                          <Badge variant='outline'>
                            {humanize(record.recordType)}
                          </Badge>
                          <span className='truncate text-muted-foreground'>
                            {record.recordId}
                          </span>
                          <span className='ms-auto text-muted-foreground'>
                            {record.role}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className='text-xs text-muted-foreground'>
                      Not attached to any record.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Project photo gallery with date / location / tag / record filters. */
export function PhotoGallery({ projectId }: { projectId: string }) {
  const canEdit = useCanPerform('document_control', 'create')
  const [filters, setFilters] = useState<PhotoFilters>({ limit: 60 })
  const [selected, setSelected] = useState<PhotoRecord | null>(null)
  const { data, isLoading, error } = usePhotos(projectId, filters)
  const { data: aiStatus } = usePhotoAiStatus(projectId)
  const analyzeBatch = useAnalyzePhotos(projectId)
  const runBatch = async () => {
    try {
      const result = await analyzeBatch.mutateAsync({
        from: filters.from || null,
        to: filters.to || null,
        uncaptionedOnly: true,
      })
      toast.success(
        `${result.analyzed} photo${result.analyzed === 1 ? '' : 's'} analysed${result.cached ? ` (${result.cached} already done)` : ''}; ${result.safetyFindings} safety finding${result.safetyFindings === 1 ? '' : 's'} — open a photo to review`
      )
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    }
  }

  const activeFilters = useMemo(
    () =>
      Object.entries(filters).filter(
        ([key, value]) =>
          key !== 'limit' &&
          value !== undefined &&
          value !== null &&
          value !== ''
      ).length,
    [filters]
  )

  const items = data?.items ?? []
  const groups = useMemo(() => {
    const byDay = new Map<string, PhotoRecord[]>()
    for (const photo of items) {
      const stamp = photo.takenAt || photo.createdAt
      const day = stamp ? new Date(stamp).toDateString() : 'Undated'
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(photo)
    }
    return [...byDay.entries()]
  }, [items])

  return (
    <div className='space-y-4' data-testid='uat-photo-gallery'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <h3 className='flex items-center gap-2 text-base font-semibold'>
            <Images className='size-4' /> Photos
          </h3>
          <p className='text-sm text-muted-foreground'>
            Every photo attached on this project, searchable by date, location
            and tag. Add photos from any record's evidence panel or the camera.
          </p>
        </div>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Camera className='size-3.5' />
          {data?.summary.total ?? 0} photos
          {canEdit && aiStatus?.enabled && (
            <Button
              size='sm'
              variant='outline'
              disabled={analyzeBatch.isPending}
              onClick={runBatch}
              title={`Captions, tags and safety findings for up to ${aiStatus.batchLimit} uncaptioned photos in the current date range`}
              data-testid='uat-photo-ai-batch'
            >
              <Sparkles className='mr-1 size-3.5' />
              {analyzeBatch.isPending
                ? 'Analysing…'
                : 'Analyse uncaptioned photos'}
            </Button>
          )}
          {activeFilters > 0 && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setFilters({ limit: 60 })}
              data-testid='uat-photo-clear-filters'
            >
              <X className='size-3.5' /> Clear filters
            </Button>
          )}
        </div>
      </div>

      <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-5'>
        <div className='space-y-1'>
          <Label htmlFor='photo-from' className='text-xs'>
            From
          </Label>
          <Input
            id='photo-from'
            type='date'
            value={filters.from ?? ''}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                from: event.target.value || undefined,
              }))
            }
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='photo-to' className='text-xs'>
            To
          </Label>
          <Input
            id='photo-to'
            type='date'
            value={filters.to ?? ''}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                to: event.target.value || undefined,
              }))
            }
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='photo-location-filter' className='text-xs'>
            Location
          </Label>
          <LocationPicker
            id='photo-location-filter'
            projectId={projectId}
            value={filters.locationId ?? null}
            onChange={(locationId) =>
              setFilters((prev) => ({ ...prev, locationId }))
            }
            rootLabel='Anywhere'
            placeholder='Anywhere'
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='photo-type-filter' className='text-xs'>
            Attached to
          </Label>
          <Select
            value={filters.recordType ?? ANY_TYPE}
            onValueChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                recordType: value === ANY_TYPE ? undefined : value,
              }))
            }
          >
            <SelectTrigger id='photo-type-filter'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_TYPE}>Any record</SelectItem>
              {RECORD_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label htmlFor='photo-search' className='text-xs'>
            Caption or file
          </Label>
          <Input
            id='photo-search'
            placeholder='Search'
            value={filters.search ?? ''}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                search: event.target.value || undefined,
              }))
            }
          />
        </div>
      </div>

      {data?.summary.tags.length ? (
        <div className='flex flex-wrap items-center gap-1.5'>
          <Tag className='size-3.5 text-muted-foreground' />
          {data.summary.tags.map(({ tag, count }) => (
            <button
              key={tag}
              type='button'
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  tag: prev.tag === tag ? undefined : tag,
                }))
              }
              className={cn(
                'rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-muted',
                filters.tag === tag &&
                  'border-primary bg-primary/10 text-primary'
              )}
            >
              {tag} <span className='text-muted-foreground'>{count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className='text-sm text-destructive'>
          {getServerErrorMessage(error)}
        </p>
      ) : isLoading ? (
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6'>
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={index} className='aspect-square' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground'>
          No photos match. Attach a photo to an NCR, daily report or any record
          and it appears here.
        </div>
      ) : (
        <div className='space-y-5'>
          {groups.map(([day, photos]) => (
            <section key={day} className='space-y-2'>
              <h4 className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
                {day}
              </h4>
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6'>
                {photos.map((photo) => (
                  <button
                    key={photo.id}
                    type='button'
                    onClick={() => setSelected(photo)}
                    data-testid='uat-photo-tile'
                    className='group relative aspect-square overflow-hidden rounded-md border bg-muted text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                  >
                    <img
                      src={photo.thumbnailUrl}
                      alt={photo.caption || photo.document?.fileName || 'Photo'}
                      loading='lazy'
                      className='size-full object-cover transition-transform group-hover:scale-105'
                    />
                    <div className='absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white'>
                      {photo.location?.name && (
                        <span className='flex min-w-0 items-center gap-0.5'>
                          <MapPin className='size-3 shrink-0' />
                          <span className='truncate'>
                            {photo.location.name}
                          </span>
                        </span>
                      )}
                      {photo.records?.length ? (
                        <span className='ms-auto shrink-0 rounded bg-white/20 px-1'>
                          {photo.records.length}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {data?.pagination.nextCursor && (
            <p className='text-center text-xs text-muted-foreground'>
              Showing the first {items.length}; narrow the filters to see more.
            </p>
          )}
        </div>
      )}

      <PhotoDetailDialog
        projectId={projectId}
        photo={selected}
        canEdit={canEdit}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
