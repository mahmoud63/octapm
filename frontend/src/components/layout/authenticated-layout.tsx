import { Outlet } from '@tanstack/react-router'
import { SearchProvider } from '@/context/search-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { TopNavbar } from '@/components/layout/top-navbar'
import { SkipToMain } from '@/components/skip-to-main'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  return (
    <SearchProvider>
      <LayoutProvider>
        <SkipToMain />
        <div className='flex min-h-svh flex-col'>
          <TopNavbar />
          <div className='flex flex-1 flex-col @container/content'>
            {children ?? <Outlet />}
          </div>
        </div>
      </LayoutProvider>
    </SearchProvider>
  )
}
