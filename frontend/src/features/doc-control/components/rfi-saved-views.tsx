import { useState } from 'react'
import { Bookmark, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { RfiListQuery } from '../hooks/use-doc-control'

export type RfiSavedView = {
  name: string
  query: Pick<
    RfiListQuery,
    | 'status'
    | 'priority'
    | 'search'
    | 'sortBy'
    | 'sortDir'
    | 'ballInCourtUserId'
    | 'overdue'
  >
}

const NONE = '__none'
const storageKey = (projectId: string) => `octapm.rfi.views.${projectId}`

const readViews = (projectId: string): RfiSavedView[] => {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
    const parsed = raw ? (JSON.parse(raw) as RfiSavedView[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeViews = (projectId: string, views: RfiSavedView[]) => {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(views))
  } catch {
    // Storage may be unavailable (private mode); the view still applies now.
  }
}

/**
 * Named filter sets for the RFI list, kept in this browser. Built-in views
 * cover the everyday questions; "Save current" keeps whatever is set.
 */
export function RfiSavedViews({
  projectId,
  current,
  onApply,
}: {
  projectId: string
  current: RfiSavedView['query']
  onApply: (query: RfiSavedView['query']) => void
}) {
  const [views, setViews] = useState<RfiSavedView[]>(() => readViews(projectId))
  const [selected, setSelected] = useState<string>(NONE)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const builtIn: RfiSavedView[] = [
    {
      name: 'Waiting on me',
      query: {
        status: 'all',
        ballInCourtUserId: 'me',
        sortBy: 'dueDate',
        sortDir: 'asc',
      },
    },
    {
      name: 'Overdue',
      query: {
        status: 'all',
        overdue: true,
        sortBy: 'dueDate',
        sortDir: 'asc',
      },
    },
    {
      name: 'Awaiting answer',
      query: { status: 'open', sortBy: 'responseRequiredBy', sortDir: 'asc' },
    },
    {
      name: 'Answered, to close',
      query: { status: 'answered', sortBy: 'updated', sortDir: 'desc' },
    },
  ]

  const apply = (key: string) => {
    setSelected(key)
    if (key === NONE) return
    const [kind, index] = key.split(':')
    const view = kind === 'b' ? builtIn[Number(index)] : views[Number(index)]
    if (view) onApply(view.query)
  }

  const saveCurrent = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const next = [
      ...views.filter((view) => view.name !== trimmed),
      { name: trimmed, query: current },
    ]
    setViews(next)
    writeViews(projectId, next)
    setSelected(`s:${next.length - 1}`)
    setNaming(false)
    setName('')
    toast.success(`View "${trimmed}" saved`)
  }

  const removeSelected = () => {
    if (!selected.startsWith('s:')) return
    const index = Number(selected.split(':')[1])
    const next = views.filter((_, i) => i !== index)
    setViews(next)
    writeViews(projectId, next)
    setSelected(NONE)
  }

  return (
    <div
      className='flex flex-wrap items-center gap-2'
      data-testid='uat-rfi-views'
    >
      <Select value={selected} onValueChange={apply}>
        <SelectTrigger className='w-[200px]' data-testid='uat-rfi-view-select'>
          <Bookmark className='mr-1 h-4 w-4 text-muted-foreground' />
          <SelectValue placeholder='Saved views' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>All RFIs</SelectItem>
          {builtIn.map((view, index) => (
            <SelectItem key={`b:${index}`} value={`b:${index}`}>
              {view.name}
            </SelectItem>
          ))}
          {views.map((view, index) => (
            <SelectItem key={`s:${index}`} value={`s:${index}`}>
              ★ {view.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {naming ? (
        <>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder='View name'
            className='w-44'
            maxLength={60}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveCurrent()
              if (event.key === 'Escape') setNaming(false)
            }}
            data-testid='uat-rfi-view-name'
          />
          <Button size='sm' onClick={saveCurrent} disabled={!name.trim()}>
            Save
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          size='sm'
          variant='ghost'
          onClick={() => setNaming(true)}
          data-testid='uat-rfi-view-save'
        >
          Save current
        </Button>
      )}
      {selected.startsWith('s:') && (
        <Button
          size='sm'
          variant='ghost'
          className='text-muted-foreground'
          onClick={removeSelected}
          aria-label='Delete saved view'
        >
          <Trash2 className='h-4 w-4' />
        </Button>
      )}
    </div>
  )
}
