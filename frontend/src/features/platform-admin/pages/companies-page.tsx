import { useCallback } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { platformAdminApi } from '@/services/platform-admin/api'
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
  Flags,
  LoadingBlock,
  PageHeading,
  Pager,
  StatusBadge,
} from '../components/console-ui'
import { FilterSelect, SearchBox } from '../components/list-filters'
import {
  fmtBytes,
  fmtDate,
  fmtNumber,
  fmtRelative,
  humanize,
} from '../lib/format'
import { useListState } from '../lib/use-list-state'

export function PlatformCompaniesPage() {
  const { filters, set, page, setPage } = useListState({
    q: '',
    plan: '',
    subscriptionStatus: '',
    kind: '',
    activity: '',
    size: '',
    sort: '-created',
  })
  const query = useQuery({
    queryKey: ['platform-admin', 'companies', filters, page],
    queryFn: () =>
      platformAdminApi.companies({ ...filters, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  })
  const onSearch = useCallback((v: string) => set('q')(v), [set])

  return (
    <>
      <PageHeading
        title='Companies'
        description='One row per organisation: plan, members, projects, last activity and health flags. Platform metadata only.'
      />
      <div className='mb-4 flex flex-wrap gap-2'>
        <SearchBox
          value={filters.q}
          onChange={onSearch}
          placeholder='Search name or slug'
        />
        <FilterSelect
          label='Plan'
          value={filters.plan}
          onChange={set('plan')}
          options={[
            'trial',
            'individual',
            'business',
            'enterprise',
            'standard',
          ].map((v) => ({ value: v, label: humanize(v) }))}
        />
        <FilterSelect
          label='Subscription'
          value={filters.subscriptionStatus}
          onChange={set('subscriptionStatus')}
          options={[
            'trialing',
            'active',
            'past_due',
            'canceled',
            'expired',
            'incomplete',
          ].map((v) => ({ value: v, label: humanize(v) }))}
        />
        <FilterSelect
          label='Type'
          value={filters.kind}
          onChange={set('kind')}
          options={[
            { value: 'company', label: 'Company' },
            { value: 'personal', label: 'Personal' },
          ]}
        />
        <FilterSelect
          label='Activity'
          value={filters.activity}
          onChange={set('activity')}
          options={[
            { value: 'active', label: 'Active in 30 days' },
            { value: 'inactive', label: 'Inactive 30+ days' },
          ]}
        />
        <FilterSelect
          label='Size'
          value={filters.size}
          onChange={set('size')}
          options={[
            { value: 'solo', label: '0–1 members' },
            { value: 'small', label: '2–10' },
            { value: 'medium', label: '11–50' },
            { value: 'large', label: '51+' },
          ]}
        />
        <FilterSelect
          label='Sort'
          value={filters.sort}
          onChange={set('sort')}
          options={[
            { value: '-created', label: 'Newest' },
            { value: 'name', label: 'Name A–Z' },
            { value: '-members', label: 'Most members' },
            { value: '-projects', label: 'Most projects' },
            { value: '-activity', label: 'Recently active' },
            { value: 'activity', label: 'Least recently active' },
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
                  <TableHead>Company</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead className='text-right'>Members</TableHead>
                  <TableHead className='text-right'>Projects</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className='text-right'>Storage</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className='py-8 text-center text-muted-foreground'
                    >
                      No companies match.
                    </TableCell>
                  </TableRow>
                ) : null}
                {query.data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        to='/platform-admin/companies/$orgId'
                        params={{ orgId: c.id }}
                        className='font-medium hover:underline'
                      >
                        {c.name}
                      </Link>
                      <div className='text-xs text-muted-foreground'>
                        {humanize(c.workspaceType)}
                        {c.status !== 'active'
                          ? ` · ${humanize(c.status)}`
                          : ''}
                      </div>
                    </TableCell>
                    <TableCell>{humanize(c.plan)}</TableCell>
                    <TableCell>
                      <StatusBadge value={c.subscriptionStatus} />
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {fmtNumber(c.activeMembers)}
                      <span className='text-muted-foreground'>
                        {' '}
                        / {fmtNumber(c.seats)} seats
                      </span>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {fmtNumber(c.activeProjects)}
                      <span className='text-muted-foreground'>
                        {' '}
                        of {fmtNumber(c.totalProjects)}
                      </span>
                    </TableCell>
                    <TableCell>{fmtRelative(c.lastActivityAt)}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {fmtBytes(c.storageBytes)}
                    </TableCell>
                    <TableCell>{fmtDate(c.createdAt)}</TableCell>
                    <TableCell>
                      <Flags flags={c.healthFlags} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={query.data.page} onPage={setPage} />
          <p className='mt-2 text-xs text-muted-foreground'>
            {query.data.definitions?.lastActivityAt}
          </p>
        </>
      ) : null}
    </>
  )
}
