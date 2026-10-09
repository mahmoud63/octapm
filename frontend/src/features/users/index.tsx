import { useState } from 'react'
import { Navigate, getRouteApi } from '@tanstack/react-router'
import { type SortingState } from '@tanstack/react-table'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { useSubscription } from '@/features/billing/hooks/use-billing'
import { UsersDialogs } from './components/users-dialogs'
import { UsersPendingInvitations } from './components/users-pending-invitations'
import { UsersPrimaryButtons } from './components/users-primary-buttons'
import { useUsers, UsersProvider } from './components/users-provider'
import { UsersTable } from './components/users-table'
import { useCanInvite, useUsersQuery } from './hooks/use-users'

const route = getRouteApi('/_authenticated/o/$orgSlug/users/')

// Maps TanStack column ids to the API's `sortBy` values.
const SORT_COLUMN_MAP: Record<string, 'name' | 'email' | 'projects'> = {
  name: 'name',
  email: 'email',
  projectCount: 'projects',
}

/**
 * The directory of people is administration; anyone else lands back on the
 * workspace before the page asks for a list it would be refused (Phase 22B).
 */
export function UsersGate() {
  const canSeePeople = useCanPerform('user_management', 'read')
  if (!canSeePeople) return <Navigate to='/' replace />
  return <Users />
}

export function Users() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  // Pending invitations are for the people who can invite (D-ID-1 Q5).
  const canInvite = useCanInvite()

  const [sorting, setSorting] = useState<SortingState>([])
  const activeSort = sorting[0]

  const { data, isLoading } = useUsersQuery({
    status: search.status?.[0],
    role: search.role?.[0],
    search: search.filter || undefined,
    sortBy: activeSort ? SORT_COLUMN_MAP[activeSort.id] : undefined,
    sortDir: activeSort ? (activeSort.desc ? 'desc' : 'asc') : undefined,
  })

  const users = data?.items ?? []

  const people = isLoading ? (
    <div className='py-12 text-center text-muted-foreground'>
      Loading users...
    </div>
  ) : users.length === 0 ? (
    <div className='flex flex-col items-center justify-center py-16 text-center'>
      <p className='mb-4 text-muted-foreground'>No people yet.</p>
      <InviteFirstPersonButton />
    </div>
  ) : (
    <UsersTable
      data={users}
      search={search}
      navigate={navigate}
      sorting={sorting}
      onSortingChange={setSorting}
    />
  )

  return (
    <UsersProvider>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>People</h2>
            <p className='text-muted-foreground'>
              Everyone in the organisation, their role and the projects they are on.
            </p>
          </div>
          <UsersPrimaryButtons />
        </div>

        {canInvite ? (
          <Tabs defaultValue='people' className='gap-4'>
            <TabsList>
              <TabsTrigger value='people'>People</TabsTrigger>
              <TabsTrigger
                value='invitations'
                data-testid='uat-users-pending-tab'
              >
                Pending invitations
              </TabsTrigger>
            </TabsList>
            <TabsContent value='people'>{people}</TabsContent>
            <TabsContent value='invitations'>
              <UsersPendingInvitations />
            </TabsContent>
          </Tabs>
        ) : (
          people
        )}
      </Main>

      <UsersDialogs />
    </UsersProvider>
  )
}

function InviteFirstPersonButton() {
  const { setOpen } = useUsers()
  const canInvite = useCanInvite()
  const { data: subscription } = useSubscription()
  const subscriptionAllowsWrites = subscription?.hasAccess !== false

  if (!canInvite || !subscriptionAllowsWrites) return null

  return <Button onClick={() => setOpen('invite')}>+ Invite a person</Button>
}
