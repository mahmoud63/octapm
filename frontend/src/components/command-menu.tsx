import React from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileText,
  FolderKanban,
  Layers3,
  Laptop,
  Loader2,
  Moon,
  PackageSearch,
  Search,
  Sun,
} from 'lucide-react'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import {
  type GlobalSearchResult,
  type GlobalSearchType,
  useGlobalSearch,
} from '@/features/search/hooks/use-global-search'
import { sidebarData } from './layout/data/sidebar-data'
import { ScrollArea } from './ui/scroll-area'

const searchTypeFilters: Array<{
  value: GlobalSearchType | 'all'
  label: string
}> = [
  { value: 'all', label: 'All' },
  { value: 'rfi', label: 'RFI' },
  { value: 'submittal', label: 'Submittals' },
  { value: 'document', label: 'Docs' },
  { value: 'drawing', label: 'Drawings' },
  { value: 'change_order', label: 'CO' },
  { value: 'task', label: 'Tasks' },
]

const statusFilters = [
  { value: 'all', label: 'Any status' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'done', label: 'Done' },
]

const dateFilters = [
  { value: 'all', label: 'Any date' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

const resultIcons: Record<GlobalSearchType, React.ElementType> = {
  project: FolderKanban,
  activity: Layers3,
  boq: ClipboardList,
  rfi: FileText,
  submittal: FileText,
  drawing: FileText,
  document: FileText,
  change_order: BadgeDollarSign,
  ipc: BadgeDollarSign,
  risk: AlertTriangle,
  procurement: PackageSearch,
  long_lead: PackageSearch,
  meeting: CalendarClock,
  task: ClipboardList,
}

const formatStatus = (value?: string | null) =>
  value ? value.replace(/_/g, ' ') : null

const formatDate = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

const getDateFrom = (filter: string) => {
  if (filter === 'all') return undefined
  const days = filter === '7d' ? 7 : 30
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className='h-7 shrink-0 rounded-md border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground aria-pressed:border-primary/60 aria-pressed:bg-primary/10 aria-pressed:text-primary'
    >
      {children}
    </button>
  )
}

function SearchResultItem({
  result,
  onSelect,
}: {
  result: GlobalSearchResult
  onSelect: () => void
}) {
  const Icon = resultIcons[result.type] ?? Search
  const status = formatStatus(result.status)
  const date = formatDate(result.date)

  return (
    <CommandItem
      value={[
        result.typeLabel,
        result.identifier,
        result.title,
        result.subtitle,
        result.projectName,
        result.status,
      ]
        .filter(Boolean)
        .join(' ')}
      onSelect={onSelect}
      className='items-start gap-3'
    >
      <div className='mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-background'>
        <Icon className='size-4 text-muted-foreground' />
      </div>
      <div className='min-w-0 flex-1 space-y-1'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate font-medium'>{result.title}</span>
          {result.identifier && (
            <span className='shrink-0 text-xs text-muted-foreground'>
              {result.identifier}
            </span>
          )}
        </div>
        <div className='flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
          <span className='truncate'>{result.projectName}</span>
          {result.subtitle && <span className='truncate'>/ {result.subtitle}</span>}
          {status && (
            <Badge variant='outline' className='h-5 rounded px-1.5 text-[10px]'>
              {status}
            </Badge>
          )}
          {date && <span>{date}</span>}
        </div>
      </div>
    </CommandItem>
  )
}

export function CommandMenu() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()
  const [searchValue, setSearchValue] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [typeFilter, setTypeFilter] =
    React.useState<GlobalSearchType | 'all'>('all')
  const [statusFilter, setStatusFilter] = React.useState('all')
  const [dateFilter, setDateFilter] = React.useState('all')

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchValue.trim())
    }, 220)

    return () => window.clearTimeout(timeoutId)
  }, [searchValue])

  React.useEffect(() => {
    if (!open) {
      setSearchValue('')
      setDebouncedSearch('')
      setTypeFilter('all')
      setStatusFilter('all')
      setDateFilter('all')
    }
  }, [open])

  const searchActive =
    debouncedSearch.length >= 2 ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    dateFilter !== 'all'
  const { data: searchResults, isFetching: isSearching } = useGlobalSearch(
    {
      q: debouncedSearch,
      type: typeFilter,
      status: statusFilter,
      dateFrom: getDateFrom(dateFilter),
      limit: 24,
    },
    { enabled: open && searchActive }
  )
  const resultGroups = searchResults?.groups ?? []
  const resultsByType = React.useMemo(() => {
    const map = new Map<GlobalSearchType, GlobalSearchResult[]>()
    for (const result of searchResults?.items ?? []) {
      map.set(result.type, [...(map.get(result.type) ?? []), result])
    }
    return map
  }, [searchResults?.items])

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen]
  )

  return (
    <CommandDialog modal open={open} onOpenChange={setOpen}>
      <CommandInput
        value={searchValue}
        onValueChange={setSearchValue}
        placeholder='Search projects, RFIs, drawings, tasks...'
      />
      <div className='space-y-2 border-b px-3 py-2'>
        <div className='flex gap-1 overflow-x-auto pb-0.5'>
          {searchTypeFilters.map((filter) => (
            <FilterButton
              key={filter.value}
              active={typeFilter === filter.value}
              onClick={() => setTypeFilter(filter.value)}
            >
              {filter.label}
            </FilterButton>
          ))}
        </div>
        <div className='flex gap-1 overflow-x-auto pb-0.5'>
          {statusFilters.map((filter) => (
            <FilterButton
              key={filter.value}
              active={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </FilterButton>
          ))}
          {dateFilters.map((filter) => (
            <FilterButton
              key={filter.value}
              active={dateFilter === filter.value}
              onClick={() => setDateFilter(filter.value)}
            >
              {filter.label}
            </FilterButton>
          ))}
        </div>
      </div>
      <CommandList>
        <ScrollArea type='hover' className='h-96 pe-1'>
          <CommandEmpty>
            {isSearching ? 'Searching...' : 'No results found.'}
          </CommandEmpty>
          {searchActive && (
            <>
              {isSearching && (
                <CommandGroup heading='Search'>
                  <CommandItem
                    disabled
                    value={`${searchValue || 'Searching records'} Searching records`}
                  >
                    <Loader2 className='animate-spin' />
                    <span>Searching records...</span>
                  </CommandItem>
                </CommandGroup>
              )}
              {!isSearching &&
                resultGroups.map((group) => (
                  <CommandGroup
                    key={group.type}
                    heading={`${group.label} (${group.count})`}
                  >
                    {(resultsByType.get(group.type) ?? []).map((result) => (
                      <SearchResultItem
                        key={`${result.type}-${result.id}`}
                        result={result}
                        onSelect={() => {
                          runCommand(() => navigate({ to: result.url }))
                        }}
                      />
                    ))}
                  </CommandGroup>
                ))}
              <CommandSeparator />
            </>
          )}
          {sidebarData.navGroups.map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items.map((navItem, i) => {
                if (navItem.url)
                  return (
                    <CommandItem
                      key={`${navItem.url}-${i}`}
                      value={navItem.title}
                      onSelect={() => {
                        runCommand(() => navigate({ to: navItem.url }))
                      }}
                    >
                      <div className='flex size-4 items-center justify-center'>
                        <ArrowRight className='size-2 text-muted-foreground/80' />
                      </div>
                      {navItem.title}
                    </CommandItem>
                  )

                return navItem.items?.map((subItem, i) => (
                  <CommandItem
                    key={`${navItem.title}-${subItem.url}-${i}`}
                    value={`${navItem.title}-${subItem.url}`}
                    onSelect={() => {
                      runCommand(() => navigate({ to: subItem.url }))
                    }}
                  >
                    <div className='flex size-4 items-center justify-center'>
                      <ArrowRight className='size-2 text-muted-foreground/80' />
                    </div>
                    {navItem.title} <ChevronRight /> {subItem.title}
                  </CommandItem>
                ))
              })}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading='Theme'>
            <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
              <Sun /> <span>Light</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
              <Moon className='scale-90' />
              <span>Dark</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
              <Laptop />
              <span>System</span>
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  )
}
