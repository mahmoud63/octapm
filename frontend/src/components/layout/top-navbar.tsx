import * as React from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import {
  Menu,
  ChevronDown,
  LogOut,
  BadgeCheck,
  Bell,
  CreditCard,
  Sparkles,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { OctaLogo } from '@/components/brand/octa-logo'
import useDialogState from '@/hooks/use-dialog-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ConfigDrawer } from '@/components/config-drawer'
import { OutboxStatus } from '@/components/outbox-status'
import { RealtimeStatus } from '@/components/realtime-status'
import { Search } from '@/components/search'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { ThemeSwitch } from '@/components/theme-switch'
import { AssistantButton } from '@/features/assistant/components/assistant-sheet'
import { SubscriptionBanner } from '@/features/billing/components/subscription-banner'
import { NotificationCenter } from '@/features/notifications/components/notification-center'
import {
  displayNavigationItems,
  type DisplayNavigationItemId,
  useUserSettings,
} from '@/features/settings/hooks/use-user-settings'
import { sidebarData } from './data/sidebar-data'
import { ProjectSwitcher } from './project-switcher'
import { type NavCollapsible, type NavLink, type NavItem } from './types'

// â”€â”€ Flat list of top-level nav items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// "Work" group items show directly; collapsible items become dropdowns.
const generalItems = sidebarData.navGroups[0].items // Dashboard, Projects, Tasks, Users
const otherItems = sidebarData.navGroups[1].items // Settings (collapsible), Help Center

const defaultDisplayItemIds: DisplayNavigationItemId[] =
  displayNavigationItems.map((item) => item.id)

function isNavLink(item: NavItem): item is NavLink {
  return !('items' in item) || !item.items
}
function isNavCollapsible(item: NavItem): item is NavCollapsible {
  return 'items' in item && !!item.items
}

// â”€â”€ Desktop nav link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function displayIdForTitle(title: string): DisplayNavigationItemId | null {
  const normalized = title.toLowerCase().replace(/\s+/g, '-')
  return displayNavigationItems.some((item) => item.id === normalized)
    ? (normalized as DisplayNavigationItemId)
    : null
}

function filterDisplayItems(
  items: NavItem[],
  visibleItems: Set<DisplayNavigationItemId>
) {
  return items.filter((item) => {
    if (isNavCollapsible(item)) return true

    const displayId = displayIdForTitle(item.title)
    return displayId ? visibleItems.has(displayId) : true
  })
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'U'
  )
}

function NavLinkItem({ item, href }: { item: NavLink; href: string }) {
  const active = href === item.url || href.split('?')[0] === item.url
  return (
    <Link
      to={item.url}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {item.icon && <item.icon className='size-4 shrink-0' />}
      {item.title}
      {item.badge && (
        <Badge
          variant='secondary'
          className='ms-1 rounded-full px-1.5 py-0 text-xs'
        >
          {item.badge}
        </Badge>
      )}
    </Link>
  )
}

// â”€â”€ Desktop dropdown for collapsible items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function NavDropdownItem({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  const active = !!item.items?.find(
    (i) => href === i.url || href.split('?')[0] === i.url
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none',
            active
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          {item.icon && <item.icon className='size-4 shrink-0' />}
          {item.title}
          <ChevronDown className='size-3.5 opacity-60' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-44'>
        {item.items.map((sub) => (
          <DropdownMenuItem key={sub.title} asChild>
            <Link
              to={sub.url}
              className={cn(
                'flex items-center gap-2',
                (href === sub.url || href.split('?')[0] === sub.url) &&
                  'bg-accent'
              )}
            >
              {sub.icon && <sub.icon className='size-4 shrink-0' />}
              {sub.title}
              {sub.badge && (
                <span className='ms-auto text-xs text-muted-foreground'>
                  {sub.badge}
                </span>
              )}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// â”€â”€ User avatar dropdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function UserDropdown() {
  const authUser = useAuthStore((state) => state.auth.user)
  const user = authUser
    ? {
        name: authUser.name,
        email: authUser.email,
        avatar: '',
      }
    : sidebarData.user
  const [open, setOpen] = useDialogState()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-9 rounded-full p-0'
          >
            <Avatar className='size-8 rounded-full'>
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className='rounded-full text-xs'>
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className='min-w-56 rounded-lg'
          align='end'
          sideOffset={8}
        >
          <DropdownMenuLabel className='p-0 font-normal'>
            <div className='flex items-center gap-2 px-1 py-1.5'>
              <Avatar className='size-8 rounded-lg'>
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className='rounded-lg text-xs'>
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className='grid flex-1 text-sm leading-tight'>
                <span className='truncate font-semibold'>{user.name}</span>
                <span className='truncate text-xs text-muted-foreground'>
                  {user.email}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to='/billing'>
                <Sparkles className='size-4' />
                Plans &amp; billing
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to='/settings/account'>
                <BadgeCheck className='size-4' />
                Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/settings/billing'>
                <CreditCard className='size-4' />
                Billing settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/settings/notifications'>
                <Bell className='size-4' />
                Notifications
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => setOpen(true)}>
            <LogOut className='size-4' />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}

// â”€â”€ Mobile sheet nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function MobileNav({ href, items }: { href: string; items: NavItem[] }) {
  const [open, setOpen] = React.useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant='ghost' size='icon' className='md:hidden'>
          <Menu className='size-5' />
          <span className='sr-only'>Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side='left' className='w-72 p-0'>
        <SheetHeader className='border-b px-4 py-3'>
          <SheetTitle asChild>
            <Link
              to='/'
              className='flex items-center gap-2'
              onClick={() => setOpen(false)}
            >
              <OctaLogo size='lg' />
            </Link>
          </SheetTitle>
        </SheetHeader>
        <nav className='flex flex-col gap-0.5 p-3'>
          {items.map((item) => {
            if (isNavLink(item)) {
              const active =
                href === item.url || href.split('?')[0] === item.url
              return (
                <Link
                  key={item.title}
                  to={item.url}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {item.icon && <item.icon className='size-4 shrink-0' />}
                  {item.title}
                  {item.badge && (
                    <Badge
                      variant='secondary'
                      className='ms-auto rounded-full px-1.5 py-0 text-xs'
                    >
                      {item.badge}
                    </Badge>
                  )}
                </Link>
              )
            }
            if (isNavCollapsible(item)) {
              return (
                <div key={item.title}>
                  <div className='mt-2 flex items-center gap-3 px-3 py-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
                    {item.title}
                  </div>
                  {item.items.map((sub) => {
                    const active =
                      href === sub.url || href.split('?')[0] === sub.url
                    return (
                      <Link
                        key={sub.title}
                        to={sub.url}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'ms-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                          active
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        {sub.icon && <sub.icon className='size-4 shrink-0' />}
                        {sub.title}
                      </Link>
                    )
                  })}
                </div>
              )
            }
            return null
          })}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

// â”€â”€ Main TopNavbar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function TopNavbar() {
  const href = useLocation({ select: (l) => l.href })
  const [scrolled, setScrolled] = React.useState(false)
  const settingsQuery = useUserSettings()
  const displayItems =
    settingsQuery.data?.display.items ?? defaultDisplayItemIds
  const visibleDisplayItems = React.useMemo<Set<DisplayNavigationItemId>>(
    () => new Set(displayItems),
    [displayItems]
  )
  const visibleGeneralItems = React.useMemo(
    () => filterDisplayItems(generalItems, visibleDisplayItems),
    [visibleDisplayItems]
  )
  const visibleOtherItems = React.useMemo(
    () => filterDisplayItems(otherItems, visibleDisplayItems),
    [visibleDisplayItems]
  )
  const visibleMobileItems = React.useMemo(
    () => [...visibleGeneralItems, ...visibleOtherItems],
    [visibleGeneralItems, visibleOtherItems]
  )

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    // Midnight Indigo: the strongest brand surface in the product. Everything
    // inside is white or white at reduced opacity — never black on the dark
    // header. `octa-dark-header` re-points the shadcn tokens for this subtree
    // so nested components (dropdowns, buttons, the project switcher) come
    // along without each needing its own dark variant.
    <header
      className={cn(
        'octa-dark-header octa-pattern relative isolate sticky top-0 z-50 w-full text-shell-foreground',
        scrolled && 'shadow-[var(--shadow-raised)]'
      )}
    >
      <SubscriptionBanner />
      <div className='flex h-14 items-center gap-3 px-4 lg:gap-4 lg:px-6'>
        {/* The brand mark, in its white treatment for the indigo ground. The
            wordmark hides on the narrowest widths; the mark always stays. */}
        <Link to='/' className='flex shrink-0 items-center' aria-label='OctaPM home'>
          <OctaLogo className='sm:hidden' markOnly size='md' surface='dark' />
          <OctaLogo className='hidden sm:inline-flex' size='md' surface='dark' />
        </Link>

        <ProjectSwitcher className='hidden md:inline-flex' />

        {/* Desktop nav */}
        {/* min-w-0 lets the nav shrink inside the flex row, and the nav scrolls
            within itself rather than pushing the page sideways â€” at tablet
            width the full link set is ~1056px against a 758px viewport. */}
        <nav className='hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] md:flex [&::-webkit-scrollbar]:hidden'>
          {visibleGeneralItems.map((item) =>
            isNavLink(item) ? (
              <NavLinkItem key={item.title} item={item} href={href} />
            ) : isNavCollapsible(item) ? (
              <NavDropdownItem key={item.title} item={item} href={href} />
            ) : null
          )}
          <div className='mx-1 h-4 w-px bg-border' />
          {visibleOtherItems.map((item) =>
            isNavLink(item) ? (
              <NavLinkItem key={item.title} item={item} href={href} />
            ) : isNavCollapsible(item) ? (
              <NavDropdownItem key={item.title} item={item} href={href} />
            ) : null
          )}
        </nav>

        {/* Right actions */}
        <div className='ms-auto flex items-center gap-2'>
          <OutboxStatus />
          <RealtimeStatus className='hidden sm:inline-flex' />
          <Search className='hidden sm:flex' />
          <AssistantButton />
          <NotificationCenter />
          <ConfigDrawer />
          <ThemeSwitch />
          <UserDropdown />
          <MobileNav href={href} items={visibleMobileItems} />
        </div>
      </div>
    </header>
  )
}
