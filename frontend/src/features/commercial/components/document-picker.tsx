import { useMemo, useState } from 'react'
import { Check, FileText, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDocumentRegister } from '@/features/doc-control/hooks/use-doc-control'

/**
 * Pick supporting documents from the project's document register — searched
 * by reference, title, document number, revision and status — and keep the
 * file's canonical id underneath. A person never sees or types an id
 * (Phase 22A, from the Phase 22 audit UX22-03).
 */
export function DocumentPicker({
  projectId,
  value,
  onChange,
  initialLabels = {},
}: {
  projectId: string
  /** ProjectDocument ids (what the change order persists). */
  value: string[]
  onChange: (ids: string[]) => void
  /** Labels for ids already on the record, shown before the register loads. */
  initialLabels?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data, isLoading } = useDocumentRegister(projectId, {
    search: search.trim() || undefined,
  })

  const options = useMemo(
    () =>
      (data?.rows || [])
        .map((row) => ({
          documentId: row.latestRevision?.projectDocumentId || null,
          ref: row.ref,
          title: row.title,
          documentNumber: row.documentNumber || null,
          revision: row.currentRevision || row.latestRevision?.revision || null,
          status: row.latestRevision?.status || row.status || null,
        }))
        .filter((row) => row.documentId),
    [data]
  )
  const labelById = useMemo(() => {
    const map: Record<string, string> = { ...initialLabels }
    for (const row of options) {
      map[row.documentId as string] =
        `${row.ref}${row.revision ? ` rev ${row.revision}` : ''} — ${row.title}`
    }
    return map
  }, [options, initialLabels])

  const toggle = (documentId: string) =>
    onChange(
      value.includes(documentId)
        ? value.filter((id) => id !== documentId)
        : [...value, documentId]
    )

  return (
    <div className='grid gap-2'>
      {value.length > 0 && (
        <div className='flex flex-wrap gap-1.5' data-testid='co-document-chips'>
          {value.map((documentId) => (
            <Badge key={documentId} variant='secondary' className='gap-1 pr-1'>
              <FileText className='size-3' />
              <span className='max-w-[18rem] truncate'>
                {labelById[documentId] || 'Document'}
              </span>
              <button
                type='button'
                aria-label='Remove document'
                className='rounded-sm hover:bg-muted'
                onClick={() => toggle(documentId)}
              >
                <X className='size-3' />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='w-fit'
            data-testid='co-document-picker'
          >
            <FileText className='size-4' />
            {value.length ? 'Add another document' : 'Choose documents'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[28rem] p-0' align='start'>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder='Search by reference, title, number or revision'
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading
                  ? 'Loading documents…'
                  : 'No documents match. Only register documents with an uploaded revision can be attached.'}
              </CommandEmpty>
              <CommandGroup heading='Project documents'>
                {options.map((row) => {
                  const selected = value.includes(row.documentId as string)
                  return (
                    <CommandItem
                      key={row.documentId as string}
                      value={row.documentId as string}
                      onSelect={() => toggle(row.documentId as string)}
                      className='flex items-start gap-2'
                    >
                      <Check
                        className={cn('mt-0.5 size-4', selected ? 'opacity-100' : 'opacity-0')}
                      />
                      <div className='min-w-0'>
                        <p className='truncate text-sm font-medium'>
                          {row.ref}
                          {row.revision ? ` · rev ${row.revision}` : ''}
                          {row.status ? (
                            <span className='ml-2 text-xs font-normal text-muted-foreground'>
                              {row.status}
                            </span>
                          ) : null}
                        </p>
                        <p className='truncate text-xs text-muted-foreground'>
                          {row.title}
                          {row.documentNumber ? ` · ${row.documentNumber}` : ''}
                        </p>
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
