import { useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  initials,
  useConversationPeople,
  type ConversationPerson,
} from '../hooks/use-conversations'

/** Pick people to message: everyone in the organisation, or those who can open a project. */
export function PeoplePicker({
  projectId,
  exclude = [],
  single = false,
  onConfirm,
  confirmLabel = 'Continue',
  pending,
  children,
}: {
  projectId: string | null
  exclude?: string[]
  single?: boolean
  onConfirm: (userIds: string[], people: ConversationPerson[]) => void
  confirmLabel?: string
  pending?: boolean
  children?: React.ReactNode
}) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Map<string, ConversationPerson>>(
    new Map()
  )
  const { data, isLoading } = useConversationPeople(projectId, q)
  const people = useMemo(
    () => (data?.items ?? []).filter((person) => !exclude.includes(person.id)),
    [data, exclude]
  )
  const toggle = (person: ConversationPerson) => {
    setSelected((current) => {
      const next = single ? new Map() : new Map(current)
      if (current.has(person.id) && !single) next.delete(person.id)
      else next.set(person.id, person)
      return next
    })
  }

  return (
    <div className='space-y-2' data-testid='uat-people-picker'>
      <div className='relative'>
        <Search className='absolute top-2.5 left-2 h-4 w-4 text-muted-foreground' />
        <Input
          className='pl-8'
          placeholder='Search by name or email'
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      {selected.size > 0 && (
        <div className='flex flex-wrap gap-1'>
          {Array.from(selected.values()).map((person) => (
            <button
              key={person.id}
              type='button'
              className='rounded-full border bg-muted/40 px-2 py-0.5 text-xs hover:bg-muted'
              onClick={() => toggle(person)}
              title='Remove'
            >
              {person.name} ×
            </button>
          ))}
        </div>
      )}
      <div className='max-h-64 overflow-y-auto rounded-md border'>
        {isLoading ? (
          <div className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading people…
          </div>
        ) : people.length === 0 ? (
          <p className='p-3 text-sm text-muted-foreground'>Nobody matches.</p>
        ) : (
          people.map((person) => {
            const checked = selected.has(person.id)
            return (
              <label
                key={person.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-muted/40',
                  checked && 'bg-primary/5'
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(person)}
                />
                <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold'>
                  {initials(person.name)}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate'>{person.name}</span>
                  <span className='block truncate text-xs text-muted-foreground'>
                    {person.email}
                    {person.role ? ` · ${person.role.replace('_', ' ')}` : ''}
                  </span>
                </span>
              </label>
            )
          })
        )}
      </div>
      {children}
      <div className='flex justify-end'>
        <Button
          disabled={selected.size === 0 || pending}
          onClick={() =>
            onConfirm(
              Array.from(selected.keys()),
              Array.from(selected.values())
            )
          }
          data-testid='uat-people-picker-confirm'
        >
          {pending && <Loader2 className='mr-1 h-4 w-4 animate-spin' />}
          {confirmLabel}
          {selected.size > 1 ? ` (${selected.size})` : ''}
        </Button>
      </div>
    </div>
  )
}
