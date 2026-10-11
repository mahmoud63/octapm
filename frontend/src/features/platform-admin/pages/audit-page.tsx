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
  LoadingBlock,
  Note,
  PageHeading,
  Pager,
} from '../components/console-ui'
import { FilterSelect } from '../components/list-filters'
import { fmtDateTime } from '../lib/format'
import { useListState } from '../lib/use-list-state'

export function PlatformAuditPage() {
  const { filters, set, page, setPage } = useListState({
    action: '',
    days: '30',
  })
  const query = useQuery({
    queryKey: ['platform-admin', 'audit', filters, page],
    queryFn: () => platformAdminApi.audit({ ...filters, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeading
        title='Platform audit'
        description='Every request to this console — including views — and every refused attempt, with operator, target and time. Query values are never stored, only parameter names.'
      />
      <div className='mb-4 flex flex-wrap gap-2'>
        <FilterSelect
          label='Action'
          value={filters.action}
          onChange={set('action')}
          options={[
            { value: 'platform.company', label: 'Company views' },
            { value: 'platform.companies', label: 'Company lists' },
            { value: 'platform.users', label: 'User lists' },
            {
              value: 'platform.access',
              label: 'Access granted / revoked / denied',
            },
            { value: 'platform.analytics', label: 'Analytics' },
            { value: 'platform.health', label: 'Health' },
          ]}
        />
        <FilterSelect
          label='Period'
          value={filters.days}
          onChange={set('days')}
          options={[
            { value: '1', label: 'Last 24 hours' },
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '365', label: 'Last year' },
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
                  <TableHead>When</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Request</TableHead>
                  <TableHead className='text-right'>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className='py-8 text-center text-muted-foreground'
                    >
                      Nothing recorded in this period.
                    </TableCell>
                  </TableRow>
                ) : null}
                {query.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className='whitespace-nowrap'>
                      {fmtDateTime(r.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <div>{r.actorEmail}</div>
                      <div className='text-xs text-muted-foreground'>
                        {r.actorRole}
                      </div>
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {r.action}
                    </TableCell>
                    <TableCell>
                      {r.targetOrgId ? (
                        <Link
                          to='/platform-admin/companies/$orgId'
                          params={{ orgId: r.targetOrgId }}
                          className='text-xs hover:underline'
                        >
                          company {r.targetOrgId.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span className='text-xs text-muted-foreground'>
                          {r.targetType ?? '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {r.method} {r.path}
                      {r.queryKeys.length ? `?${r.queryKeys.join('&')}` : ''}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${r.statusCode >= 400 ? 'text-red-600' : ''}`}
                    >
                      {r.statusCode || '…'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={query.data.page} onPage={setPage} />
          <div className='mt-3'>
            <Note>
              Platform access is granted and revoked only with the server-side
              script (scripts/platform/platform-access.js); those changes appear
              here as platform.access.granted / revoked.
            </Note>
          </div>
        </>
      ) : null}
    </>
  )
}
