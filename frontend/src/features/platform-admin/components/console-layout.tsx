import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { platformAdminApi } from '@/services/platform-admin/api'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bot,
  Building2,
  CreditCard,
  FolderKanban,
  LayoutDashboard,
  ScrollText,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { OctaMark } from '@/components/brand/octa-logo'
import { SkipToMain } from '@/components/skip-to-main'
import { ThemeSwitch } from '@/components/theme-switch'
import { PLATFORM_SESSION_KEY } from '../lib/session'

const NAV = [
  {
    to: '/platform-admin',
    label: 'Overview',
    icon: LayoutDashboard,
    exact: true,
  },
  { to: '/platform-admin/companies', label: 'Companies', icon: Building2 },
  { to: '/platform-admin/users', label: 'Users', icon: Users },
  { to: '/platform-admin/projects', label: 'Projects', icon: FolderKanban },
  {
    to: '/platform-admin/subscriptions',
    label: 'Subscriptions',
    icon: CreditCard,
  },
  {
    to: '/platform-admin/analytics',
    label: 'Product Adoption',
    icon: BarChart3,
  },
  { to: '/platform-admin/health', label: 'System Health', icon: Activity },
  { to: '/platform-admin/audit', label: 'Audit', icon: ScrollText },
] as const

/**
 * The platform operations console shell: its own navigation and header, no
 * workspace switcher, no project navigation, no realtime connection — it is
 * not a company workspace. Hiding this shell from non-operators is a
 * convenience; the API refuses them regardless.
 */
export function PlatformConsoleLayout() {
  const { pathname } = useLocation()
  const session = useQuery({
    queryKey: PLATFORM_SESSION_KEY,
    queryFn: platformAdminApi.session,
    staleTime: 60_000,
  })
  const isActive = (to: string, exact?: boolean) =>
    exact
      ? pathname === to || pathname === `${to}/`
      : pathname === to || pathname.startsWith(`${to}/`)

  return (
    <div className='flex min-h-svh bg-background'>
      <SkipToMain />
      <aside className='sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-slate-950 text-slate-100 md:flex'>
        <div className='flex items-center gap-2 border-b border-slate-800 px-4 py-4'>
          <OctaMark className='size-7' />
          <div className='leading-tight'>
            <div className='text-sm font-semibold'>OctaPM Platform</div>
            <div className='text-[11px] tracking-wide text-slate-400 uppercase'>
              Operations console
            </div>
          </div>
        </div>
        <nav
          className='flex-1 space-y-0.5 overflow-y-auto px-2 py-3'
          aria-label='Platform console'
        >
          {NAV.map((item) => {
            const active = isActive(
              item.to,
              'exact' in item ? item.exact : false
            )
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-[#13c1ce]/15 text-[#5fe3ec]'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon className='size-4' aria-hidden />
                {item.label}
              </Link>
            )
          })}
          <div className='mt-4 border-t border-slate-800 pt-3'>
            <div className='px-3 pb-1 text-[11px] tracking-wide text-slate-500 uppercase'>
              Future
            </div>
            <Link
              to='/platform-admin/ai-usage'
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm',
                isActive('/platform-admin/ai-usage')
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-500 hover:bg-slate-900'
              )}
            >
              <Bot className='size-4' aria-hidden />
              AI Usage
              <Badge
                variant='outline'
                className='ml-auto border-slate-700 text-[10px] text-slate-400'
              >
                Not active
              </Badge>
            </Link>
          </div>
        </nav>
        <div className='border-t border-slate-800 px-4 py-3 text-xs text-slate-400'>
          <div className='truncate' title={session.data?.operator.email}>
            {session.data?.operator.email ?? '…'}
          </div>
          <div className='text-slate-500'>
            Read-only · every view is audited
          </div>
        </div>
      </aside>

      <div className='flex min-w-0 flex-1 flex-col'>
        <header className='sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur lg:px-8'>
          <Badge className='bg-slate-900 text-[11px] tracking-wide text-[#5fe3ec] uppercase dark:bg-slate-800'>
            Platform operations
          </Badge>
          <nav
            className='flex gap-1 overflow-x-auto md:hidden'
            aria-label='Platform console (compact)'
          >
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'rounded px-2 py-1 text-xs whitespace-nowrap',
                  isActive(item.to, 'exact' in item ? item.exact : false)
                    ? 'bg-muted font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className='ml-auto flex items-center gap-2'>
            <Link
              to='/'
              className='flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'
            >
              <ArrowLeft className='size-4' aria-hidden /> Back to OctaPM
            </Link>
            <ThemeSwitch />
          </div>
        </header>
        <main id='content' className='w-full px-4 py-6 lg:px-8'>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
