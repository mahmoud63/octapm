import { useCallback } from 'react'
import type { ProjectFeatures } from '@/services/platform-admin/integration-api'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { platformAdminApi } from '@/services/platform-admin/api'
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
  Flags,
  LoadingBlock,
  PageHeading,
  Pager,
  StatusBadge,
} from '../components/console-ui'
import { FilterSelect, SearchBox } from '../components/list-filters'
import { fmtDate, fmtNumber, fmtRelative, humanize } from '../lib/format'
import { useListState } from '../lib/use-list-state'

export function PlatformProjectsPage() {
  const { filters, set, page, setPage } = useListState({
    q: '',
    status: '',
    sort: '-created',
  })
  const query = useQuery({
    queryKey: ['platform-admin', 'projects', filters, page],
    queryFn: () =>
      platformAdminApi.projects({ ...filters, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  })
  const onSearch = useCallback((v: string) => set('q')(v), [set])

  return (
    <>
      <PageHeading
        title='Projects'
        description='Project metadata across companies: status, members, activity and which modules were used. No contract values, budgets, costs or record content.'
      />
      <div className='mb-4 flex flex-wrap gap-2'>
        <SearchBox
          value={filters.q}
          onChange={onSearch}
          placeholder='Search project or company'
        />
        <FilterSelect
          label='Status'
          value={filters.status}
          onChange={set('status')}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <FilterSelect
          label='Sort'
          value={filters.sort}
          onChange={set('sort')}
          options={[
            { value: '-created', label: 'Newest' },
            { value: 'name', label: 'Name A–Z' },
            { value: 'company', label: 'Company' },
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
                  <TableHead>Project</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Members</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className='text-right'>Changes (30 d)</TableHead>
                  <TableHead>Modules used (30 d)</TableHead>
                  <TableHead>BIM · Closeout · Consultants · AI (30 d)</TableHead>
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
                      No projects match.
                    </TableCell>
                  </TableRow>
                ) : null}
                {query.data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className='font-medium'>{p.name}</TableCell>
                    <TableCell>
                      <Link
                        to='/platform-admin/companies/$orgId'
                        params={{ orgId: p.organisation.id }}
                        className='hover:underline'
                      >
                        {p.organisation.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={p.status} />
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {fmtNumber(p.members)}
                    </TableCell>
                    <TableCell>{fmtRelative(p.lastActivityAt)}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {fmtNumber(p.recordChanges30d)}
                    </TableCell>
                    <TableCell>
                      <div className='flex max-w-xs flex-wrap gap-1'>
                        {p.modulesUsed30d.length ? (
                          p.modulesUsed30d.map((m) => (
                            <Badge
                              key={m}
                              variant='secondary'
                              className='text-[11px]'
                            >
                              {humanize(m)}
                            </Badge>
                          ))
                        ) : (
                          <span className='text-xs text-muted-foreground'>
                            —
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className='text-xs whitespace-nowrap tabular-nums'>
                      {(() => {
                        const f = (p as typeof p & { features?: ProjectFeatures }).features
                        if (!f) return '—'
                        return `${f.bimModels} models · ${f.closeoutDeliverables} deliverables · ${f.consultantParties} consultants / ${f.consultantReviews} reviews · ${f.aiCalls30d} AI calls`
                      })()}
                    </TableCell>
                    <TableCell>{fmtDate(p.createdAt)}</TableCell>
                    <TableCell>
                      <Flags flags={p.healthFlags} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={query.data.page} onPage={setPage} />
        </>
      ) : null}
    </>
  )
}
