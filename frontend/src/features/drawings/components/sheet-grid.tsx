import { useMemo, useState } from 'react'
import { CloudDownload, FileWarning, Loader2, Search } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LocationPicker } from '@/features/locations/components/location-picker'
import {
  formatBytes,
  useOfflineManifest,
  useSheets,
  type SheetFilters,
} from '../hooks/use-drawings'
import { SheetThumbnail } from './sheet-thumbnail'

const ALL = '__all'

function OfflineListDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, isLoading } = useOfflineManifest(projectId, { enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[80vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Sheets for offline use</DialogTitle>
          <DialogDescription>
            The current set as of now. Site devices cache these files; the list
            refreshes whenever a set is published.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Building list…
          </div>
        ) : (
          <div className='space-y-2 text-sm'>
            <p className='text-muted-foreground'>
              {data.totals.sheets} sheets in {data.totals.documents} file
              {data.totals.documents === 1 ? '' : 's'} ·{' '}
              {formatBytes(data.totals.bytes)}
            </p>
            <ul className='divide-y rounded border'>
              {data.items.map((item) => (
                <li
                  key={item.revisionId}
                  className='flex items-center gap-2 px-2 py-1.5'
                >
                  <span className='w-24 font-mono text-xs'>{item.number}</span>
                  <span className='min-w-0 flex-1 truncate'>{item.title}</span>
                  <span className='text-xs text-muted-foreground'>
                    Rev {item.revision ?? '—'}
                  </span>
                  <a
                    href={item.fileUrl}
                    target='_blank'
                    rel='noreferrer'
                    className='text-xs underline-offset-2 hover:underline'
                  >
                    PDF{item.pageNumber > 1 ? ` p.${item.pageNumber}` : ''}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The current sheet register: what the site works from. Filters by
 * discipline, area and text; obsolete sheets are hidden unless asked for.
 */
export function SheetGrid({
  projectId,
  onOpenSheet,
}: {
  projectId: string
  onOpenSheet: (sheetId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [discipline, setDiscipline] = useState<string>(ALL)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [status, setStatus] = useState<'current' | 'obsolete' | 'all'>(
    'current'
  )
  const [offlineOpen, setOfflineOpen] = useState(false)

  const filters = useMemo<SheetFilters>(
    () => ({
      search: search.trim() || undefined,
      discipline: discipline === ALL ? null : discipline,
      locationId,
      status,
    }),
    [discipline, locationId, search, status]
  )
  const { data, isLoading, isFetching } = useSheets(projectId, filters)
  const sheets = data?.items ?? []
  const disciplines = data?.summary.disciplines ?? []

  return (
    <div className='space-y-3' data-testid='uat-sheet-grid'>
      <div className='flex flex-wrap items-end gap-2'>
        <div className='relative min-w-[200px] flex-1'>
          <Search className='pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Number or title'
            className='pl-8'
            data-testid='uat-sheet-search'
          />
        </div>
        <Select value={discipline} onValueChange={setDiscipline}>
          <SelectTrigger
            className='w-[180px]'
            data-testid='uat-sheet-discipline'
          >
            <SelectValue placeholder='Discipline' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All disciplines</SelectItem>
            {disciplines.map((entry) => (
              <SelectItem key={entry.discipline} value={entry.discipline}>
                {entry.discipline} ({entry.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className='w-[220px]'>
          <LocationPicker
            projectId={projectId}
            value={locationId}
            onChange={setLocationId}
            allowRoot
            rootLabel='All areas'
            placeholder='Area'
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as typeof status)}
        >
          <SelectTrigger className='w-[150px]' data-testid='uat-sheet-status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='current'>Current sheets</SelectItem>
            <SelectItem value='obsolete'>Obsolete</SelectItem>
            <SelectItem value='all'>All</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size='sm'
          variant='outline'
          onClick={() => setOfflineOpen(true)}
          data-testid='uat-sheet-offline-list'
        >
          <CloudDownload className='mr-2 h-4 w-4' /> Offline list
        </Button>
      </div>

      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        {isFetching && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
        <span>
          {data
            ? `${sheets.length} sheet${sheets.length === 1 ? '' : 's'}`
            : ''}
          {data?.summary.obsolete && status === 'current'
            ? ` · ${data.summary.obsolete} obsolete hidden`
            : ''}
        </span>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading sheets…
        </div>
      ) : sheets.length === 0 ? (
        <div className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No sheets match. Publish a drawing set to build the register.
        </div>
      ) : (
        <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {sheets.map((sheet) => {
            const revision = sheet.currentRevision
            return (
              <li key={sheet.id}>
                <button
                  type='button'
                  className='w-full space-y-2 rounded-md border bg-background p-2 text-left transition hover:border-primary/60'
                  onClick={() => onOpenSheet(sheet.id)}
                  data-testid='uat-sheet-card'
                >
                  <SheetThumbnail
                    fileUrl={revision?.fileUrl ?? null}
                    pageNumber={revision?.pageNumber ?? 1}
                    rotation={revision?.rotation ?? 0}
                    width={260}
                    aspect={
                      revision?.width && revision?.height
                        ? revision.height / revision.width
                        : 0.7
                    }
                    className='w-full'
                  />
                  <div className='flex items-center gap-2'>
                    <span className='font-mono text-sm font-semibold'>
                      {sheet.number}
                    </span>
                    {revision?.revision && (
                      <Badge variant='outline'>Rev {revision.revision}</Badge>
                    )}
                    {sheet.status === 'obsolete' && (
                      <Badge variant='destructive'>Obsolete</Badge>
                    )}
                    {!sheet.hasFile && (
                      <Badge
                        variant='outline'
                        className='gap-1 text-muted-foreground'
                      >
                        <FileWarning className='h-3 w-3' /> No file
                      </Badge>
                    )}
                  </div>
                  <p className='line-clamp-2 text-sm'>{sheet.title}</p>
                  <p className='truncate text-xs text-muted-foreground'>
                    {[
                      sheet.discipline,
                      sheet.location?.name,
                      revision?.publishedAt
                        ? new Date(revision.publishedAt).toLocaleDateString()
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <OfflineListDialog
        projectId={projectId}
        open={offlineOpen}
        onOpenChange={setOfflineOpen}
      />
    </div>
  )
}
