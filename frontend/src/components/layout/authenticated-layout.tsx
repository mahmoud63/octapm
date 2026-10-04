import { Outlet } from '@tanstack/react-router'
import { SearchProvider } from '@/context/search-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { useRealtimeConnection } from '@/hooks/use-realtime'
import { useScreenOpenTracking } from '@/lib/product-usage'
import { TopNavbar } from '@/components/layout/top-navbar'
import { SkipToMain } from '@/components/skip-to-main'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  useRealtimeConnection()
  // Screen-open counts for the platform console's Product Adoption page.
  useScreenOpenTracking()

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
