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
  Command,
} from 'lucide-react'
import { Search } from '@/components/search'
import { ConfigDrawer } from '@/components/config-drawer'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import { ThemeSwitch } from '@/components/theme-switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Badge } from '@/components/ui/badge'
import { SignOutDialog } from '@/components/sign-out-dialog'
import useDialogState from '@/hooks/use-dialog-state'
import { sidebarData } from './data/sidebar-data'
import { type NavCollapsible, type NavLink, type NavItem } from './types'

// ── Flat list of top-level nav items ──────────────────────────────────────
// General group items show directly; collapsible items become dropdowns.
const generalItems = sidebarData.navGroups[0].items   // Dashboard, Projects, Tasks, …
const otherItems   = sidebarData.navGroups[2].items   // Settings (collapsible), Help Center

function isNavLink(item: NavItem): item is NavLink {
  return !('items' in item) || !item.items
}
function isNavCollapsible(item: NavItem): item is NavCollapsible {
  return 'items' in item && !!item.items
}

// ── Desktop nav link ──────────────────────────────────────────────────────
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
        <Badge variant='secondary' className='ms-1 rounded-full px-1.5 py-0 text-xs'>
          {item.badge}
        </Badge>
      )}
    </Link>
  )
}

// ── Desktop dropdown for collapsible items ────────────────────────────────
function NavDropdownItem({ item, href }: { item: NavCollapsible; href: string }) {
  const active = !!item.items?.find(i => href === i.url || href.split('?')[0] === i.url)
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
        {item.items.map(sub => (
          <DropdownMenuItem key={sub.title} asChild>
            <Link
              to={sub.url}
              className={cn(
                'flex items-center gap-2',
                (href === sub.url || href.split('?')[0] === sub.url) && 'bg-accent'
              )}
            >
              {sub.icon && <sub.icon className='size-4 shrink-0' />}
              {sub.title}
              {sub.badge && <span className='ms-auto text-xs text-muted-foreground'>{sub.badge}</span>}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── User avatar dropdown ──────────────────────────────────────────────────
function UserDropdown() {
  const { user } = sidebarData
  const [open, setOpen] = useDialogState()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' className='rounded-full size-9 p-0'>
            <Avatar className='size-8 rounded-full'>
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className='rounded-full text-xs'>
                {user.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='min-w-56 rounded-lg' align='end' sideOffset={8}>
          <DropdownMenuLabel className='p-0 font-normal'>
            <div className='flex items-center gap-2 px-1 py-1.5'>
              <Avatar className='size-8 rounded-lg'>
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className='rounded-lg text-xs'>
                  {user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className='grid flex-1 text-sm leading-tight'>
                <span className='truncate font-semibold'>{user.name}</span>
                <span className='truncate text-xs text-muted-foreground'>{user.email}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem><Sparkles className='size-4' />Upgrade to Pro</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to='/settings/account'><BadgeCheck className='size-4' />Account</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/settings'><CreditCard className='size-4' />Billing</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/settings/notifications'><Bell className='size-4' />Notifications</Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => setOpen(true)}>
            <LogOut className='size-4' />Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}

// ── Mobile sheet nav ──────────────────────────────────────────────────────
function MobileNav({ href }: { href: string }) {
  const [open, setOpen] = React.useState(false)
  const allItems = [...generalItems, ...otherItems]

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
            <Link to='/' className='flex items-center gap-2' onClick={() => setOpen(false)}>
              <div className='flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm'>8</div>
              <span className='font-bold text-base'>OctaPM</span>
            </Link>
          </SheetTitle>
        </SheetHeader>
        <nav className='flex flex-col gap-0.5 p-3'>
          {allItems.map(item => {
            if (isNavLink(item)) {
              const active = href === item.url || href.split('?')[0] === item.url
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
                    <Badge variant='secondary' className='ms-auto rounded-full px-1.5 py-0 text-xs'>
                      {item.badge}
                    </Badge>
                  )}
                </Link>
              )
            }
            if (isNavCollapsible(item)) {
              return (
                <div key={item.title}>
                  <div className='flex items-center gap-3 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2'>
                    {item.title}
                  </div>
                  {item.items.map(sub => {
                    const active = href === sub.url || href.split('?')[0] === sub.url
                    return (
                      <Link
                        key={sub.title}
                        to={sub.url}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ms-2',
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

// ── Main TopNavbar ─────────────────────────────────────────────────────────
export function TopNavbar() {
  const href = useLocation({ select: l => l.href })
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        scrolled && 'shadow-sm'
      )}
    >
      <div className='flex h-14 items-center gap-4 px-4 lg:px-6'>

        {/* Logo */}
        <Link to='/' className='flex items-center gap-2 shrink-0'>
          <div className='flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm'>
            <Command className='size-4' />
          </div>
          <span className='hidden font-bold sm:inline-block'>OctaPM</span>
        </Link>

        {/* Desktop nav */}
        <nav className='hidden md:flex items-center gap-0.5 flex-1'>
          {generalItems.map(item =>
            isNavLink(item)
              ? <NavLinkItem key={item.title} item={item} href={href} />
              : isNavCollapsible(item)
                ? <NavDropdownItem key={item.title} item={item} href={href} />
                : null
          )}
          <div className='mx-1 h-4 w-px bg-border' />
          {otherItems.map(item =>
            isNavLink(item)
              ? <NavLinkItem key={item.title} item={item} href={href} />
              : isNavCollapsible(item)
                ? <NavDropdownItem key={item.title} item={item} href={href} />
                : null
          )}
        </nav>

        {/* Right actions */}
        <div className='ms-auto flex items-center gap-2'>
          <Search className='hidden sm:flex' />
          <ConfigDrawer />
          <ThemeSwitch />
          <UserDropdown />
          <MobileNav href={href} />
        </div>
      </div>
    </header>
  )
}
