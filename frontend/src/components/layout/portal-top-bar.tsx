import { Link } from '@tanstack/react-router'
import { Bell, LogOut, UserRound } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { OctaLogo } from '@/components/brand/octa-logo'
import useDialogState from '@/hooks/use-dialog-state'
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
import { ProjectSwitcher } from '@/components/layout/project-switcher'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { ThemeSwitch } from '@/components/theme-switch'
import { NotificationCenter } from '@/features/notifications/components/notification-center'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

/**
 * The External Collaboration Portal's header (portal.octapm.com): the brand,
 * the project the person collaborates on, notifications and their account —
 * none of the contractor company's navigation (dashboard, portfolio,
 * inventory, company settings), which an external party has no use for.
 * What each page shows is still authorized by the API.
 */
export function PortalTopBar() {
  const user = useAuthStore((state) => state.auth.user)
  const [open, setOpen] = useDialogState()
  return (
    <header
      className='octa-dark-header octa-pattern relative isolate sticky top-0 z-50 w-full text-shell-foreground'
      data-testid='portal-top-bar'
    >
      <div className='flex h-14 items-center gap-3 px-4 lg:px-6'>
        <Link to='/' className='flex shrink-0 items-center gap-2' aria-label='OctaPM Portal home'>
          <OctaLogo className='sm:hidden' markOnly size='md' surface='dark' />
          <OctaLogo className='hidden sm:inline-flex' size='md' surface='dark' />
          <span className='rounded border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase'>
            Portal
          </span>
        </Link>
        <ProjectSwitcher className='hidden md:inline-flex' />
        <div className='ms-auto flex items-center gap-2'>
          <NotificationCenter />
          <ThemeSwitch />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' className='size-9 rounded-full p-0' aria-label='Account menu'>
                <span className='flex size-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold'>
                  {initials(user?.name || user?.email || '?')}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className='min-w-56 rounded-lg' align='end' sideOffset={8}>
              <DropdownMenuLabel className='font-normal'>
                <div className='grid text-sm leading-tight'>
                  <span className='truncate font-semibold'>{user?.name}</span>
                  <span className='truncate text-xs text-muted-foreground'>{user?.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link to='/settings/account'>
                    <UserRound className='size-4' />
                    Account
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
        </div>
      </div>
      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </header>
  )
}
