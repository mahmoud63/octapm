import { getRouteApi } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { UsersDialogs } from './components/users-dialogs'
import { UsersPrimaryButtons } from './components/users-primary-buttons'
import { useUsers, UsersProvider } from './components/users-provider'
import { UsersTable } from './components/users-table'
import { useUsersQuery } from './hooks/use-users'

const route = getRouteApi('/_authenticated/users/')

export function Users() {
  const search = route.useSearch()
  const navigate = route.useNavigate()

  const { data, isLoading } = useUsersQuery({
    status: search.status?.[0],
    role: search.role?.[0],
    search: search.filter || undefined,
  })

  const users = data?.items ?? []

  return (
    <UsersProvider>
      <Header fixed>
        <Search />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Engineers</h2>
            <p className='text-muted-foreground'>
              Manage engineer accounts and role assignments.
            </p>
          </div>
          <UsersPrimaryButtons />
        </div>

        {isLoading ? (
          <div className='py-12 text-center text-muted-foreground'>
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-16 text-center'>
            <p className='mb-4 text-muted-foreground'>No engineers yet.</p>
            <AddFirstEngineerButton />
          </div>
        ) : (
          <UsersTable data={users} search={search} navigate={navigate} />
        )}
      </Main>

      <UsersDialogs />
    </UsersProvider>
  )
}

function AddFirstEngineerButton() {
  const { setOpen } = useUsers()

  return <Button onClick={() => setOpen('add')}>+ Add Engineer</Button>
}
