import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'
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
import { useProjects } from '@/features/projects/hooks/use-projects'
import {
  useGlobalSearch,
  type GlobalSearchType,
} from '@/features/search/hooks/use-global-search'

/** Global-search result type → the record type the API uses for links and comments. */
const SEARCH_TYPE_TO_RECORD: Record<GlobalSearchType, string> = {
  project: 'project',
  activity: 'activity',
  boq: 'boq_item',
  rfi: 'rfi',
  submittal: 'submittal',
  drawing: 'drawing',
  document: 'document',
  change_order: 'change_order',
  ipc: 'ipc',
  risk: 'risk',
  procurement: 'procurement_order',
  long_lead: 'procurement_package',
  meeting: 'meeting',
  task: 'task',
}

export interface PickedRecord {
  recordType: string
  recordId: string
  projectId: string
  title: string
  typeLabel: string
}

const ALL = '__all__'

/** Finds a record through the global search and hands it back as a link target. */
export function RecordPickerDialog({
  open,
  onOpenChange,
  projectId,
  onPick,
  title = 'Share a record',
  description = 'Search RFIs, submittals, drawings, change orders, risks, tasks and more.',
  allowedTypes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string | null
  onPick: (record: PickedRecord) => void
  title?: string
  description?: string
  allowedTypes?: string[]
}) {
  const [q, setQ] = useState('')
  const [project, setProject] = useState<string>(projectId ?? ALL)
  const { data: projectsData } = useProjects()
  const effectiveProject = projectId ?? (project === ALL ? undefined : project)
  const { data, isFetching } = useGlobalSearch(
    { q, projectId: effectiveProject, limit: 15 },
    { enabled: open && q.trim().length >= 2 }
  )
  const items = (data?.items ?? []).filter(
    (item) =>
      !allowedTypes || allowedTypes.includes(SEARCH_TYPE_TO_RECORD[item.type])
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='uat-record-picker'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className='flex flex-wrap gap-2'>
          {!projectId && (
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger className='w-48'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {(projectsData?.items ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className='relative min-w-48 flex-1'>
            <Search className='absolute top-2.5 left-2 h-4 w-4 text-muted-foreground' />
            <Input
              autoFocus
              className='pl-8'
              placeholder='Type at least two characters…'
              value={q}
              onChange={(event) => setQ(event.target.value)}
              data-testid='uat-record-picker-search'
            />
          </div>
        </div>
        <div className='max-h-80 overflow-y-auto rounded-md border'>
          {isFetching && (
            <div className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' /> Searching…
            </div>
          )}
          {!isFetching && q.trim().length >= 2 && items.length === 0 && (
            <p className='p-3 text-sm text-muted-foreground'>
              Nothing matches.
            </p>
          )}
          {items.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              type='button'
              className='flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40'
              onClick={() => {
                onPick({
                  recordType: SEARCH_TYPE_TO_RECORD[item.type] ?? item.type,
                  recordId: item.id,
                  projectId: item.projectId,
                  title: item.identifier
                    ? `${item.identifier} ${item.title}`
                    : item.title,
                  typeLabel: item.typeLabel,
                })
                onOpenChange(false)
              }}
            >
              <Badge variant='outline' className='mt-0.5 shrink-0 text-[10px]'>
                {item.typeLabel}
              </Badge>
              <span className='min-w-0 flex-1'>
                <span className='block truncate font-medium'>
                  {item.identifier ? `${item.identifier} · ` : ''}
                  {item.title}
                </span>
                <span className='block truncate text-xs text-muted-foreground'>
                  {item.projectName}
                  {item.subtitle ? ` · ${item.subtitle}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className='flex justify-end'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
