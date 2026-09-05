import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Building2, Store, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CompanySection } from './components/company-section'
import { useCompanyDirectory } from './hooks/use-company'

export function CompanyDirectory() {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useCompanyDirectory(search ? { search } : {})
  const items = data?.items ?? []

  return (
    <CompanySection
      title='Directory'
      description='Every company the organisation works with — owners, consultants, contractors and vendors — with where they appear.'
      actions={
        <div className='flex flex-wrap gap-2 text-xs text-muted-foreground'>
          <Badge variant='outline'>
            <Building2 className='size-3' /> {data?.summary.companies ?? 0}{' '}
            companies
          </Badge>
          <Badge variant='outline'>
            <Store className='size-3' /> {data?.summary.vendors ?? 0} vendors
          </Badge>
          <Badge variant='outline'>
            <Users className='size-3' /> {data?.summary.activeUsers ?? 0} active
            users
          </Badge>
        </div>
      }
    >
      <div className='space-y-3' data-testid='uat-company-directory'>
        <Input
          placeholder='Search by name, trade name or email'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className='max-w-sm'
        />
        {isLoading ? (
          <div className='space-y-2'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className='text-right'>Members</TableHead>
                  <TableHead className='text-right'>Projects</TableHead>
                  <TableHead className='text-right'>Supplier on</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className='text-center text-muted-foreground'
                    >
                      No companies match.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell>
                        <div className='font-medium'>{company.name}</div>
                        {company.tradeName && (
                          <div className='text-xs text-muted-foreground'>
                            {company.tradeName}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          <Badge variant='secondary'>{company.type}</Badge>
                          {company.isVendor && (
                            <Link to='/company/vendors'>
                              <Badge variant='outline'>vendor</Badge>
                            </Link>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className='text-xs'>
                        <div>{company.contactName || '—'}</div>
                        <div className='text-muted-foreground'>
                          {company.email || company.phone || ''}
                        </div>
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {company.memberCount}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {company.projectCount}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {company.supplierCount}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            company.status === 'active'
                              ? 'outline'
                              : 'secondary'
                          }
                        >
                          {company.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CompanySection>
  )
}
