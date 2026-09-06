import { Outlet } from '@tanstack/react-router'
import {
  Monitor,
  Bell,
  Palette,
  Wrench,
  UserCog,
  CreditCard,
  KeyRound,
  ShieldCheck,
} from 'lucide-react'
import { useIsCompanyAdmin } from '@/lib/permissions'
import { Separator } from '@/components/ui/separator'
import { Main } from '@/components/layout/main'
import { SidebarNav } from './components/sidebar-nav'

const sidebarNavItems = [
  {
    title: 'Profile',
    href: '/settings',
    icon: <UserCog size={18} />,
  },
  {
    title: 'Account',
    href: '/settings/account',
    icon: <Wrench size={18} />,
  },
  {
    title: 'Security',
    href: '/settings/security',
    icon: <KeyRound size={18} />,
  },
  {
    title: 'Appearance',
    href: '/settings/appearance',
    icon: <Palette size={18} />,
  },
  {
    title: 'Notifications',
    href: '/settings/notifications',
    icon: <Bell size={18} />,
  },
  {
    title: 'Display',
    href: '/settings/display',
    icon: <Monitor size={18} />,
  },
  {
    title: 'Billing',
    href: '/settings/billing',
    icon: <CreditCard size={18} />,
  },
]

const adminNavItems = [
  {
    title: 'Permissions',
    href: '/settings/permissions',
    icon: <ShieldCheck size={18} />,
  },
]

export function Settings() {
  const isCompanyAdmin = useIsCompanyAdmin()
  const items = isCompanyAdmin
    ? [...sidebarNavItems, ...adminNavItems]
    : sidebarNavItems

  return (
    <>
      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            Settings
          </h1>
          <p className='text-muted-foreground'>
            Manage your account settings and set e-mail preferences.
          </p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <aside className='top-0 lg:sticky lg:w-1/5'>
            <SidebarNav items={items} />
          </aside>
          <div className='flex w-full overflow-y-hidden p-1'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}
