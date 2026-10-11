import { Outlet } from '@tanstack/react-router'
import { SearchProvider } from '@/context/search-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { useRealtimeConnection } from '@/hooks/use-realtime'
import { TopNavbar } from '@/components/layout/top-navbar'
import { SkipToMain } from '@/components/skip-to-main'
import { AskOctaPMLauncher } from '@/features/ai/components/ask-octapm-launcher'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  useRealtimeConnection()

  return (
    <SearchProvider>
      <LayoutProvider>
        <SkipToMain />
        <div className='flex min-h-svh flex-col'>
          <TopNavbar />
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
