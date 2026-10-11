import { useCallback } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { platformAdminApi } from '@/services/platform-admin/api'
import { roleLabel } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ErrorBlock,
  LoadingBlock,
  Note,
  PageHeading,
  Pager,
  StatusBadge,
} from '../components/console-ui'
import { FilterSelect, SearchBox } from '../components/list-filters'
import { fmtDate, fmtNumber, fmtRelative, humanize } from '../lib/format'
import { useListState } from '../lib/use-list-state'

export function PlatformUsersPage({ initialQ = '' }: { initialQ?: string }) {
  const { filters, set, page, setPage } = useListState({
    q: initialQ,
    status: '',
    multiCompany: '',
    lastLogin: '',
    sort: '-created',
  })
  const query = useQuery({
    queryKey: ['platform-admin', 'users', filters, page],
    queryFn: () => platformAdminApi.users({ ...filters, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  })
  const onSearch = useCallback((v: string) => set('q')(v), [set])

  return (
    <>
      <PageHeading
        title='Users'
        description='Every person on the platform and the companies they belong to. A person has a role per company; there is no platform-wide role.'
      />
      <div className='mb-4 flex flex-wrap gap-2'>
        <SearchBox
          value={filters.q}
          onChange={onSearch}
          placeholder='Search name or email'
        />
        <FilterSelect
          label='Account'
          value={filters.status}
          onChange={set('status')}
          options={['active', 'inactive', 'suspended'].map((v) => ({
            value: v,
            label: humanize(v),
          }))}
        />
        <FilterSelect
          label='Companies'
          value={filters.multiCompany}
          onChange={set('multiCompany')}
          options={[{ value: 'true', label: 'In 2+ companies' }]}
        />
        <FilterSelect
          label='Last sign-in'
          value={filters.lastLogin}
          onChange={set('lastLogin')}
          options={[
            { value: '30d', label: 'Within 30 days' },
            { value: 'stale', label: 'Over 90 days ago' },
            { value: 'never', label: 'Never' },
          ]}
        />
        <FilterSelect
          label='Sort'
          value={filters.sort}
          onChange={set('sort')}
          options={[
            { value: '-created', label: 'Newest' },
            { value: 'name', label: 'Name A–Z' },
            { value: '-lastLogin', label: 'Recent sign-in' },
            { value: '-memberships', label: 'Most companies' },
          ]}
        />
      </div>
      {query.isLoading ? <LoadingBlock /> : null}
      {query.error ? <ErrorBlock error={query.error} /> : null}
      {query.data ? (
        <>
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Companies (role)</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Sign-in</TableHead>
                  <TableHead className='text-right'>Pending invites</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className='py-8 text-center text-muted-foreground'
                    >
                      No people match.
                    </TableCell>
                  </TableRow>
                ) : null}
                {query.data.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className='font-medium'>
                        {u.name}
                        {u.platformOperator ? (
                          <Badge className='ml-2 bg-slate-900 text-[#5fe3ec]'>
                            Platform operator
                          </Badge>
                        ) : null}
                      </div>
                      <div className='text-xs text-muted-foreground'>
                        {u.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className='flex max-w-md flex-wrap gap-1'>
                        {u.companies.map((c) => (
                          <Link
                            key={c.id}
                            to='/platform-admin/companies/$orgId'
                            params={{ orgId: c.id }}
                          >
                            <Badge
                              variant={
                                c.status === 'active' ? 'outline' : 'secondary'
                              }
                              className='hover:bg-accent'
                            >
                              {c.name} · {roleLabel(c.role)}
                              {c.status !== 'active' ? ` (${c.status})` : ''}
                            </Badge>
                          </Link>
                        ))}
                        {u.memberships > u.companies.length ? (
                          <span className='text-xs text-muted-foreground'>
                            +{u.memberships - u.companies.length} more
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={u.accountStatus} />
                    </TableCell>
                    <TableCell>{fmtRelative(u.lastLoginAt)}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {u.ssoLinked ? 'SSO' : 'Password'}
                      {u.mfaEnabled ? ' · MFA' : ''}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {fmtNumber(u.pendingInvitations)}
                    </TableCell>
                    <TableCell>{fmtDate(u.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={query.data.page} onPage={setPage} />
          <div className='mt-3'>
            <Note>{query.data.definitions?.role}</Note>
          </div>
        </>
      ) : null}
    </>
  )
}
