import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ModuleKey } from '../lib/project-modules'

/**
 * The Project Module Bar: the second navigation row, directly under the
 * Midnight Indigo application header.
 *
 * Major modules are the top-level navigation; their sub-pages appear in
 * dropdowns rather than being spread across the row. Lower-frequency modules
 * collapse into More, so the row stays readable and the workspace keeps its
 * full width.
 *
 * Lighter than the primary header by design — this is the bar people work
 * against all day, so it favours legibility over brand weight. The active
 * module is Midnight Indigo text with a Royal Blue underline, never a filled
 * rectangle.
 */

export type ModuleChild = { key: string; label: string }
export type ModuleItem = { key: ModuleKey; label: string; children?: ModuleChild[] }

/**
 * Modules that stay directly visible, in construction working order. Anything
 * else falls into More. Ordering is deliberate: the modules a site team touches
 * daily come first.
 */
const PRIMARY_ORDER: ModuleKey[] = [
  'overview',
  'schedule',
  'siteReporting',
  'cost',
  'commercial',
  'procurement',
  'quality',
  'docControl',
  'meetings',
  'boq',
  'bim',
]

type Props = {
  items: ModuleItem[]
  activeModule: ModuleKey
  activeChild?: string
  onSelectModule: (item: ModuleItem) => void
  onSelectChild: (module: ModuleKey, child: string) => void
}

export function ProjectModuleBar({
  items,
  activeModule,
  activeChild,
  onSelectModule,
  onSelectChild,
}: Props) {
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])

  // Permission filtering already happened upstream; this only orders what is
  // left and decides what stays visible versus what folds into More.
  const primary = PRIMARY_ORDER.map((key) => byKey.get(key)).filter(
    (item): item is ModuleItem => Boolean(item)
  )
  const overflow = items.filter((item) => !PRIMARY_ORDER.includes(item.key))

  // If the active module lives in More, surface it so the user can always see
  // where they are in the bar.
  const activeInOverflow = overflow.find((item) => item.key === activeModule)
  const visible = activeInOverflow ? [...primary, activeInOverflow] : primary
  const remaining = activeInOverflow
    ? overflow.filter((item) => item.key !== activeModule)
    : overflow

  return (
    <nav
      aria-label='Project modules'
      data-testid='uat-project-module-bar'
      className='sticky top-14 z-40 border-b bg-background'
    >
      <div className='flex h-12 items-stretch gap-0.5 px-2 lg:px-4'>
        {/* Mobile: the row is replaced by a single Modules trigger. */}
        <MobileModuleMenu
          items={items}
          activeModule={activeModule}
          onSelectModule={onSelectModule}
          onSelectChild={onSelectChild}
        />

        {/* Tablet and up: the row scrolls within itself rather than pushing
            the page sideways. */}
        <div className='hidden min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] md:flex [&::-webkit-scrollbar]:hidden'>
          {visible.map((item) =>
            item.children?.length ? (
              <ModuleDropdown
                key={item.key}
                item={item}
                isActive={activeModule === item.key}
                activeChild={activeChild}
                onSelectModule={onSelectModule}
                onSelectChild={onSelectChild}
              />
            ) : (
              <ModuleTab
                key={item.key}
                label={item.label}
                isActive={activeModule === item.key}
                testId={`uat-module-tab-${item.key}`}
                onClick={() => onSelectModule(item)}
              />
            )
          )}

          {remaining.length > 0 && (
            <MoreMenu
              items={remaining}
              activeModule={activeModule}
              onSelectModule={onSelectModule}
            />
          )}
        </div>
      </div>
    </nav>
  )
}

/** A top-level module with no sub-pages. */
function ModuleTab({
  label,
  isActive,
  onClick,
  testId,
  hasPopup,
  expanded,
}: {
  label: string
  isActive: boolean
  onClick: () => void
  testId: string
  hasPopup?: boolean
  expanded?: boolean
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={testId}
      aria-current={isActive ? 'page' : undefined}
      {...(hasPopup ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': expanded } : {})}
      className={cn(
        'relative flex shrink-0 items-center gap-1 whitespace-nowrap px-3 text-sm transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
        isActive
          ? 'font-semibold text-primary'
          : 'font-medium text-foreground hover:bg-accent/60'
      )}
    >
      {label}
      {hasPopup && (
        <ChevronDown
          className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      )}
      {/* The active indicator: a Royal Blue underline, not a filled block.
          `aria-current` above carries the same meaning without colour. */}
      {isActive && (
        <span
          aria-hidden
          className='absolute inset-x-2 bottom-0 h-[3px] rounded-t-sm bg-selected-indicator'
        />
      )}
    </button>
  )
}

/** A module whose sub-pages open in a dropdown. */
function ModuleDropdown({
  item,
  isActive,
  activeChild,
  onSelectModule,
  onSelectChild,
}: {
  item: ModuleItem
  isActive: boolean
  activeChild?: string
  onSelectModule: (item: ModuleItem) => void
  onSelectChild: (module: ModuleKey, child: string) => void
}) {
  const [open, setOpen] = useState(false)
  const children = item.children ?? []
  // Long lists read better in two columns than as a tall scroll.
  const twoColumn = children.length > 8

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span className='flex'>
          <ModuleTab
            label={item.label}
            isActive={isActive}
            onClick={() => setOpen((value) => !value)}
            testId={`uat-module-tab-${item.key}`}
            hasPopup
            expanded={open}
          />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        sideOffset={2}
        data-testid={`uat-module-menu-${item.key}`}
        className={cn('p-1.5', twoColumn ? 'w-[26rem]' : 'w-56')}
      >
        <p className='px-2 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
          {item.label}
        </p>
        <div className={cn(twoColumn && 'grid grid-cols-2 gap-x-1')}>
          {children.map((child) => {
            const childActive = isActive && activeChild === child.key
            return (
              <DropdownMenuItem
                key={child.key}
                data-testid={`uat-module-child-${item.key}-${child.key}`}
                aria-current={childActive ? 'page' : undefined}
                onSelect={() => onSelectChild(item.key, child.key)}
                className={cn(
                  'cursor-pointer text-sm',
                  childActive && 'bg-selected font-medium text-selected-foreground'
                )}
              >
                {child.label}
              </DropdownMenuItem>
            )
          })}
        </div>
        <DropdownMenuItem
          onSelect={() => onSelectModule(item)}
          className='mt-1 cursor-pointer border-t text-xs text-muted-foreground'
        >
          Open {item.label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Lower-frequency modules, so the row stays readable. */
function MoreMenu({
  items,
  activeModule,
  onSelectModule,
}: {
  items: ModuleItem[]
  activeModule: ModuleKey
  onSelectModule: (item: ModuleItem) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span className='flex'>
          <ModuleTab
            label='More'
            isActive={items.some((item) => item.key === activeModule)}
            onClick={() => setOpen((value) => !value)}
            testId='uat-module-tab-more'
            hasPopup
            expanded={open}
          />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' sideOffset={2} className='w-52 p-1.5' data-testid='uat-module-menu-more'>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            data-testid={`uat-module-more-${item.key}`}
            aria-current={activeModule === item.key ? 'page' : undefined}
            onSelect={() => onSelectModule(item)}
            className='cursor-pointer text-sm'
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Mobile: a searchable module menu rather than a horizontal row nobody can
 * read. Search matters once a project has fifteen modules and sixty sub-pages.
 */
function MobileModuleMenu({
  items,
  activeModule,
  onSelectModule,
  onSelectChild,
}: {
  items: ModuleItem[]
  activeModule: ModuleKey
  onSelectModule: (item: ModuleItem) => void
  onSelectChild: (module: ModuleKey, child: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const activeLabel = items.find((item) => item.key === activeModule)?.label ?? 'Modules'
  const needle = query.trim().toLowerCase()

  // Search spans modules and their sub-pages, so "gantt" finds it directly.
  const results = items
    .map((item) => {
      const matchesModule = item.label.toLowerCase().includes(needle)
      const children = (item.children ?? []).filter((child) =>
        child.label.toLowerCase().includes(needle)
      )
      if (!needle) return { item, children: item.children ?? [] }
      if (matchesModule) return { item, children: item.children ?? [] }
      return children.length ? { item, children } : null
    })
    .filter((entry): entry is { item: ModuleItem; children: ModuleChild[] } => Boolean(entry))

  return (
    <>
      <Button
        type='button'
        variant='ghost'
        onClick={() => setOpen(true)}
        data-testid='uat-module-menu-trigger'
        aria-haspopup='dialog'
        aria-expanded={open}
        className='flex h-full flex-1 items-center justify-between gap-2 px-2 md:hidden'
      >
        <span className='truncate text-sm font-semibold text-primary'>{activeLabel}</span>
        <span className='flex items-center gap-1 text-xs text-muted-foreground'>
          Modules
          <ChevronDown className='size-3.5' aria-hidden />
        </span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side='left'
          className='w-[85vw] max-w-sm p-0'
          data-testid='uat-module-drawer'
        >
          <SheetHeader className='border-b p-4 pb-3'>
            <SheetTitle className='text-base'>Project modules</SheetTitle>
            <div className='relative mt-2'>
              <Search
                className='absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
                aria-hidden
              />
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='Search modules…'
                data-testid='uat-module-drawer-search'
                className='ps-8'
              />
              {query && (
                <button
                  type='button'
                  onClick={() => setQuery('')}
                  aria-label='Clear search'
                  className='absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground'
                >
                  <X className='size-4' />
                </button>
              )}
            </div>
          </SheetHeader>

          <div className='max-h-[calc(100vh-8.5rem)] overflow-y-auto p-2'>
            {results.length === 0 && (
              <p className='px-2 py-6 text-center text-sm text-muted-foreground'>
                No module matches “{query}”.
              </p>
            )}
            {results.map(({ item, children }) => (
              <div key={item.key} className='mb-1'>
                <button
                  type='button'
                  data-testid={`uat-module-drawer-${item.key}`}
                  aria-current={activeModule === item.key ? 'page' : undefined}
                  onClick={() => {
                    onSelectModule(item)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-2 text-left text-sm transition-colors',
                    activeModule === item.key
                      ? 'bg-selected font-semibold text-selected-foreground'
                      : 'font-medium text-foreground hover:bg-accent/60'
                  )}
                >
                  {item.label}
                </button>
                {children.length > 0 && (
                  <div className='ms-2 border-s ps-2'>
                    {children.map((child) => (
                      <button
                        type='button'
                        key={child.key}
                        onClick={() => {
                          onSelectChild(item.key, child.key)
                          setOpen(false)
                        }}
                        className='block w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground'
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
