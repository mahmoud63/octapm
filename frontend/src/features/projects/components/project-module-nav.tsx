import {
  Banknote,
  Box,
  Boxes,
  CalendarRange,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Handshake,
  LayoutDashboard,
  ListTree,
  MapPin,
  PanelLeftClose,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ModuleKey } from '../lib/project-modules'

/**
 * Project Modules navigation.
 *
 * Expanded, it is a light surface with Charcoal labels and a Royal Blue
 * selected state — the active item is identifiable from a slim indicator and a
 * tinted row, not an oversized dark block.
 *
 * Collapsed ("Focus Mode"), it becomes a Midnight Indigo rail with white icons
 * and an Azure selected indicator. That is the one place the shell asserts the
 * brand hardest, and it buys back horizontal space for Gantt, BOQ, Budget and
 * Drawings where the working area matters most.
 */

/** One icon per module. The rail is unusable without them. */
export const MODULE_ICONS: Record<ModuleKey, LucideIcon> = {
  overview: LayoutDashboard,
  schedule: CalendarRange,
  activities: ListTree,
  boq: ClipboardList,
  cost: Banknote,
  commercial: Handshake,
  quality: ShieldCheck,
  docControl: FileText,
  meetings: Users,
  siteReporting: Wrench,
  equipment: Truck,
  locations: MapPin,
  photos: Camera,
  team: Users,
  reports: FileText,
  bim: Box,
  capture: Boxes,
}

type MenuChild = { key: string; label: string }
type MenuItem = { key: ModuleKey; label: string; children?: MenuChild[] }

type Props = {
  items: MenuItem[]
  activeModule: ModuleKey
  activeChild?: string
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onSelectModule: (item: MenuItem) => void
  onSelectChild: (module: ModuleKey, child: string) => void
  hasChildren: (key: ModuleKey) => boolean
}

export function ProjectModuleNav({
  items,
  activeModule,
  activeChild,
  collapsed,
  onCollapsedChange,
  onSelectModule,
  onSelectChild,
  hasChildren,
}: Props) {
  if (collapsed) {
    return (
      <nav
        aria-label='Project modules'
        data-testid='uat-project-module-rail'
        className='sticky top-[calc(3.5rem+1rem)] flex max-h-[calc(100vh-3.5rem-2rem)] w-14 shrink-0 flex-col items-center gap-1 self-start overflow-y-auto rounded-md bg-shell py-2 text-shell-foreground shadow-[var(--shadow-card)]'
      >
        {items.map((item) => {
          const Icon = MODULE_ICONS[item.key] ?? LayoutDashboard
          const isActive = activeModule === item.key

          return (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  aria-current={isActive ? 'page' : undefined}
                  data-testid={`uat-project-rail-${item.key}`}
                  onClick={() => onSelectModule(item)}
                  className={cn(
                    'relative grid size-10 shrink-0 place-items-center rounded-md transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-shell-foreground/70 focus-visible:outline-none',
                    isActive
                      ? 'bg-white/12 text-white'
                      : 'text-shell-muted-foreground hover:bg-shell-hover hover:text-white'
                  )}
                >
                  {/* Azure indicator on the leading edge marks the selection. */}
                  {isActive && (
                    <span
                      aria-hidden
                      className='absolute inset-y-1.5 -left-0.5 w-[3px] rounded-full bg-octa-azure'
                    />
                  )}
                  <Icon className='size-[18px]' />
                  <span className='sr-only'>{item.label}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side='right'>{item.label}</TooltipContent>
            </Tooltip>
          )
        })}

        <div className='mt-1 h-px w-8 shrink-0 bg-shell-border' />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              onClick={() => onCollapsedChange(false)}
              data-testid='uat-project-nav-expand'
              className='grid size-10 shrink-0 place-items-center rounded-md text-shell-muted-foreground transition-colors hover:bg-shell-hover hover:text-white focus-visible:ring-2 focus-visible:ring-shell-foreground/70 focus-visible:outline-none'
            >
              <ChevronRight className='size-4' />
              <span className='sr-only'>Expand project modules</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='right'>Expand modules</TooltipContent>
        </Tooltip>
      </nav>
    )
  }

  return (
    <aside
      data-testid='uat-project-module-nav'
      className='self-start rounded-md border bg-card p-3 shadow-[var(--shadow-card)] lg:sticky lg:top-[calc(3.5rem+1rem)] lg:max-h-[calc(100vh-3.5rem-2rem)] lg:overflow-y-auto'
    >
      <div className='mb-3 flex items-center justify-between gap-2'>
        <p className='text-xs font-semibold tracking-wide text-primary uppercase'>
          Project Modules
        </p>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-7 text-muted-foreground'
          onClick={() => onCollapsedChange(true)}
          data-testid='uat-project-nav-collapse'
          title='Focus mode'
        >
          <PanelLeftClose className='size-4' />
          <span className='sr-only'>Collapse project modules</span>
        </Button>
      </div>

      <nav aria-label='Project modules' className='space-y-0.5'>
        {items.map((item) => {
          const Icon = MODULE_ICONS[item.key] ?? LayoutDashboard
          const isActive = activeModule === item.key
          const showChildren = hasChildren(item.key) && isActive

          return (
            <div key={item.key}>
              <button
                type='button'
                aria-current={isActive ? 'page' : undefined}
                data-testid={`uat-project-module-${item.key}`}
                onClick={() => onSelectModule(item)}
                className={cn(
                  'relative flex w-full items-center gap-2.5 rounded-md py-2 pe-2 ps-2.5 text-left text-sm font-medium transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  isActive
                    ? 'bg-selected text-selected-foreground'
                    : 'text-foreground hover:bg-accent/60'
                )}
              >
                {isActive && (
                  <span
                    aria-hidden
                    className='absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-selected-indicator'
                  />
                )}
                <Icon
                  className={cn(
                    'size-4 shrink-0',
                    isActive ? 'text-interactive' : 'text-muted-foreground'
                  )}
                />
                <span className='truncate'>{item.label}</span>
              </button>

              {showChildren && (
                <div className='mt-0.5 mb-1 ms-[1.4rem] space-y-0.5 border-s ps-2'>
                  {item.children?.map((child) => {
                    const isChildActive = activeChild === child.key
                    return (
                      <button
                        type='button'
                        key={child.key}
                        data-testid={`uat-project-module-${item.key}-${child.key}`}
                        onClick={() => onSelectChild(item.key, child.key)}
                        className={cn(
                          'block w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          isChildActive
                            ? 'font-medium text-interactive'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                        )}
                      >
                        {child.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

/** Mobile: the same navigation as a branded drawer trigger. */
export function ProjectModuleDrawerTrigger({
  activeLabel,
  onOpen,
}: {
  activeLabel: string
  onOpen: () => void
}) {
  return (
    <Button
      type='button'
      variant='outline'
      className='w-full justify-between lg:hidden'
      onClick={onOpen}
      data-testid='uat-project-module-drawer-trigger'
    >
      <span className='flex items-center gap-2'>
        <ChevronLeft className='size-4 text-interactive' />
        {activeLabel}
      </span>
      <span className='text-xs text-muted-foreground'>Modules</span>
    </Button>
  )
}
