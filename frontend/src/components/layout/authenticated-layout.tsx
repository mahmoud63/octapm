import { Outlet } from '@tanstack/react-router'
import { SearchProvider } from '@/context/search-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { useRealtimeConnection } from '@/hooks/use-realtime'
import { useScreenOpenTracking } from '@/lib/product-usage'
import { TopNavbar } from '@/components/layout/top-navbar'
import { PortalTopBar } from '@/components/layout/portal-top-bar'
import { currentSurface } from '@/lib/domains'
import { SkipToMain } from '@/components/skip-to-main'
import { AskOctaPMLauncher } from '@/features/ai/components/ask-octapm-launcher'

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
          {/* portal.octapm.com has its own shell (domain architecture §13):
              an external party never gets the contractor's navigation. */}
          {currentSurface() === 'portal' ? <PortalTopBar /> : <TopNavbar />}
          {/* Bottom room so the floating Ask OctaPM button never covers a
              page's last controls. */}
          <div className='flex flex-1 flex-col pb-20 @container/content'>
            {children ?? <Outlet />}
          </div>
        </div>
        {/* Ask OctaPM on every authenticated screen: the one drawer and
            its floating button, mounted once here. */}
        <AskOctaPMLauncher />
      </LayoutProvider>
    </SearchProvider>
  )
}
