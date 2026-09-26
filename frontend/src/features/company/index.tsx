import { Navigate, Outlet } from '@tanstack/react-router'
import {
  Building2,
  ClipboardCheck,
  FolderKanban,
  GitBranch,
  Hash,
  Landmark,
  Lock,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Workflow,
  Wrench,
} from 'lucide-react'
import { useIsCompanyAdmin } from '@/lib/permissions'
import { Separator } from '@/components/ui/separator'
import { Main } from '@/components/layout/main'
import { SidebarNav } from '@/features/settings/components/sidebar-nav'

const navItems = [
  {
    title: 'Workspace',
    href: '/company/workspace',
    icon: <Landmark size={18} />,
  },
  {
    title: 'Directory',
    href: '/company/directory',
    icon: <Building2 size={18} />,
  },
  { title: 'Vendors', href: '/company/vendors', icon: <Store size={18} /> },
  {
    title: 'Cost codes',
    href: '/company/cost-codes',
    icon: <Hash size={18} />,
  },
  {
    title: 'Equipment',
    href: '/company/equipment',
    icon: <Wrench size={18} />,
  },
  {
    title: 'Project templates',
    href: '/company/templates',
    icon: <FolderKanban size={18} />,
  },
  {
    title: 'Inspection templates',
    href: '/company/form-templates',
    icon: <ClipboardCheck size={18} />,
  },
  {
    title: 'Submittal workflows',
    href: '/company/submittal-workflows',
    icon: <GitBranch size={18} />,
  },
  {
    title: 'Workflows',
    href: '/company/workflows',
    icon: <Workflow size={18} />,
  },
  {
    title: 'Custom fields',
    href: '/company/custom-fields',
    icon: <SlidersHorizontal size={18} />,
  },
  {
    title: 'Integrations',
    href: '/company/integrations',
    icon: <Plug size={18} />,
  },
  {
    title: 'Security',
    href: '/company/security',
    icon: <Lock size={18} />,
  },
  {
    title: 'Permissions',
    href: '/company/permissions',
    icon: <ShieldCheck size={18} />,
  },
]

/** Company workspace: masters defined once and reused on every project. */
export function CompanyWorkspace() {
  const isCompanyAdmin = useIsCompanyAdmin()
  if (!isCompanyAdmin) {
    return <Navigate to='/' replace />
  }

  return (
    <Main fixed>
      <div className='space-y-0.5'>
        <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
          Company
        </h1>
        <p className='text-muted-foreground'>
          Vendors, cost codes, equipment, project templates and permissions
          shared by every project in the organisation.
        </p>
      </div>
      <Separator className='my-4 lg:my-6' />
      <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
        <aside className='top-0 lg:sticky lg:w-1/5'>
          <SidebarNav items={navItems} />
        </aside>
        <div className='flex w-full overflow-y-hidden p-1'>
          <Outlet />
        </div>
      </div>
    </Main>
  )
}
