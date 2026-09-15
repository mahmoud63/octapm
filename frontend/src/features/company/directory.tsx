import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Building2, Pencil, Plus, Store, Users } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CompanyDialog } from './components/company-dialog'
import { CompanySection } from './components/company-section'
import {
  useCompanyDirectory,
  type CompanyDirectoryEntry,
} from './hooks/use-company'

export function CompanyDirectory() {
  const [search, setSearch] = useState('')
  // an inactive company is kept for history; it is not offered on new records and
  // stays out of the list unless asked for
  const [includeInactive, setIncludeInactive] = useState(false)
  const { data, isLoading } = useCompanyDirectory({
    ...(search ? { search } : {}),
    ...(includeInactive ? {} : { status: 'active' }),
  })
  const items = data?.items ?? []
  // adding or editing a company is the same permission as naming a party on a project
  const canManage = useCanPerform('project_parties', 'create')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CompanyDirectoryEntry | null>(null)

  return (
    <CompanySection
      title='Directory'
      description='Every company the organisation works with — owners, consultants, contractors and vendors — with where they appear.'
      actions={
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          {canManage && (
            <Button
              size='sm'
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
              data-testid='uat-company-new'
            >
              <Plus className='size-4' /> Add company
            </Button>
          )}
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
        <div className='flex flex-wrap items-center gap-4'>
          <Input
            placeholder='Search by name, trade name or email'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='max-w-sm'
          />
          <div className='flex items-center gap-2'>
            <Switch
              id='directory-include-inactive'
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
              data-testid='uat-company-include-inactive'
            />
            <Label htmlFor='directory-include-inactive' className='text-xs'>
              Show inactive companies
            </Label>
          </div>
        </div>
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
                  <TableHead className='w-12' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
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
                      <TableCell className='text-right'>
                        {canManage && (
                          <Button
                            size='icon'
                            variant='ghost'
                            aria-label={`Edit ${company.name}`}
                            data-testid='uat-company-edit'
                            onClick={() => {
                              setEditing(company)
                              setDialogOpen(true)
                            }}
                          >
                            <Pencil className='size-4' />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <CompanyDialog
        open={dialogOpen}
        company={editing}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
      />
    </CompanySection>
  )
}
