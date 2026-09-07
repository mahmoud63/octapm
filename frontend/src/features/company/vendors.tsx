import { useState } from 'react'
import { GitMerge, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Textarea } from '@/components/ui/textarea'
import { CompanySection } from './components/company-section'
import { PrequalificationPanel } from './components/prequalification-panel'
import {
  useCreateVendor,
  useUpdateVendor,
  useVendorMigrationReport,
  useVendors,
  type CompanyDirectoryEntry,
  type VendorPayload,
} from './hooks/use-company'
import { prequalLabel, type PrequalStatus } from './hooks/use-prequalification'

type Draft = {
  name: string
  contactName: string
  email: string
  phone: string
  address: string
  trades: string
  leadTimeReliability: string
  paymentTerms: string
  notes: string
  status: 'active' | 'inactive'
}

const emptyDraft: Draft = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  trades: '',
  leadTimeReliability: '',
  paymentTerms: '',
  notes: '',
  status: 'active',
}

const draftFrom = (vendor?: CompanyDirectoryEntry | null): Draft =>
  vendor
    ? {
        name: vendor.name,
        contactName: vendor.contactName ?? '',
        email: vendor.email ?? '',
        phone: vendor.phone ?? '',
        address: vendor.address ?? '',
        trades: vendor.trades.join(', '),
        leadTimeReliability:
          vendor.vendorProfile.leadTimeReliability != null
            ? String(vendor.vendorProfile.leadTimeReliability)
            : '',
        paymentTerms: vendor.vendorProfile.paymentTerms ?? '',
        notes: vendor.vendorProfile.notes ?? '',
        status: vendor.status,
      }
    : emptyDraft

const toPayload = (draft: Draft): VendorPayload => ({
  name: draft.name.trim(),
  contactName: draft.contactName.trim() || null,
  email: draft.email.trim() || null,
  phone: draft.phone.trim() || null,
  address: draft.address.trim() || null,
  trades: draft.trades
    .split(',')
    .map((trade) => trade.trim())
    .filter(Boolean),
  leadTimeReliability: draft.leadTimeReliability
    ? Number(draft.leadTimeReliability)
    : null,
  paymentTerms: draft.paymentTerms.trim() || null,
  notes: draft.notes.trim() || null,
  status: draft.status,
})

/**
 * The prequalification state, on the row where somebody picks a
 * subcontractor. "Not assessed" is a finding, so it is shown rather than left
 * blank.
 */
function PrequalBadge({
  state,
  score,
}: {
  state: PrequalStatus
  score: number | null
}) {
  const tone =
    state === 'approved' || state === 'conditionally_approved'
      ? 'default'
      : state === 'rejected' || state === 'expired'
        ? 'destructive'
        : 'outline'
  return (
    <span className='flex items-center gap-1.5'>
      <Badge variant={tone} data-testid={`uat-vendor-prequal-${state}`}>
        {prequalLabel[state]}
      </Badge>
      {score !== null && (
        <span className='text-xs tabular-nums text-muted-foreground'>{score}</span>
      )}
    </span>
  )
}

function VendorDialog({
  vendor,
  open,
  onOpenChange,
}: {
  vendor: CompanyDirectoryEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateVendor()
  const update = useUpdateVendor()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(vendor))
  const [seededFor, setSeededFor] = useState<string | null>(vendor?.id ?? null)
  if ((vendor?.id ?? null) !== seededFor) {
    setSeededFor(vendor?.id ?? null)
    setDraft(draftFrom(vendor))
  }
  const isPending = create.isPending || update.isPending
  const set = (patch: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, ...patch }))

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error('Vendor name is required.')
      return
    }
    try {
      if (vendor) {
        await update.mutateAsync({
          vendorId: vendor.id,
          payload: toPayload(draft),
        })
        toast.success('Vendor updated.')
      } else {
        await create.mutateAsync(toPayload(draft))
        toast.success(
          'Vendor added. It now appears in every project’s supplier picker.'
        )
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {vendor ? `Edit ${vendor.name}` : 'New vendor'}
          </DialogTitle>
          <DialogDescription>
            Vendors are companies available as suppliers on every project.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='vendor-name'>Name</Label>
            <Input
              id='vendor-name'
              data-testid='uat-vendor-name'
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='vendor-contact'>Contact</Label>
            <Input
              id='vendor-contact'
              value={draft.contactName}
              onChange={(e) => set({ contactName: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='vendor-email'>Email</Label>
            <Input
              id='vendor-email'
              type='email'
              value={draft.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='vendor-phone'>Phone</Label>
            <Input
              id='vendor-phone'
              value={draft.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='vendor-trades'>Trades</Label>
            <Input
              id='vendor-trades'
              placeholder='steel, rebar, formwork'
              value={draft.trades}
              onChange={(e) => set({ trades: e.target.value })}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='vendor-address'>Address</Label>
            <Input
              id='vendor-address'
              value={draft.address}
              onChange={(e) => set({ address: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='vendor-reliability'>
              Lead-time reliability (%)
            </Label>
            <Input
              id='vendor-reliability'
              type='number'
              min={0}
              max={100}
              value={draft.leadTimeReliability}
              onChange={(e) => set({ leadTimeReliability: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='vendor-terms'>Payment terms</Label>
            <Input
              id='vendor-terms'
              placeholder='30 days from invoice'
              value={draft.paymentTerms}
              onChange={(e) => set({ paymentTerms: e.target.value })}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='vendor-notes'>Notes</Label>
            <Textarea
              id='vendor-notes'
              rows={2}
              value={draft.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
          <div className='flex items-center justify-between rounded-md border p-3 sm:col-span-2'>
            <div>
              <Label>Active</Label>
              <p className='text-xs text-muted-foreground'>
                Inactive vendors stay on existing projects but leave the
                pickers.
              </p>
            </div>
            <Switch
              checked={draft.status === 'active'}
              onCheckedChange={(checked) =>
                set({ status: checked ? 'active' : 'inactive' })
              }
            />
          </div>
        </div>
        {/* Prequalification is only meaningful for a company that exists. */}
        {vendor && (
          <div className='mt-2'>
            <PrequalificationPanel companyId={vendor.id} canManage />
          </div>
        )}
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isPending}
            data-testid='uat-vendor-save'
          >
            {isPending ? 'Saving…' : vendor ? 'Save changes' : 'Add vendor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MigrationReport({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, isLoading } = useVendorMigrationReport({ enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Supplier consolidation report</DialogTitle>
          <DialogDescription>
            Project suppliers were matched to vendors by name. Merged vendors
            absorbed suppliers from several projects; unlinked suppliers had no
            vendor.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <Skeleton className='h-24 w-full' />
        ) : (
          <div className='space-y-4 text-sm'>
            <div className='flex flex-wrap gap-2'>
              <Badge variant='outline'>
                {data.summary.suppliers} suppliers
              </Badge>
              <Badge variant='outline'>{data.summary.linked} linked</Badge>
              <Badge variant='outline'>{data.summary.vendors} vendors</Badge>
              <Badge>{data.summary.mergedVendors} merged</Badge>
              <Badge
                variant={data.summary.unlinked ? 'destructive' : 'outline'}
              >
                {data.summary.unlinked} unlinked
              </Badge>
            </div>
            {data.merged.length > 0 && (
              <div className='space-y-2'>
                <p className='text-xs font-semibold text-muted-foreground uppercase'>
                  Merged
                </p>
                {data.merged.map((entry) => (
                  <div key={entry.companyId} className='rounded-md border p-2'>
                    <p className='font-medium'>{entry.name}</p>
                    <ul className='mt-1 text-xs text-muted-foreground'>
                      {entry.suppliers.map((supplier) => (
                        <li key={supplier.supplierId}>
                          {supplier.name} · {supplier.projectName} ·{' '}
                          {supplier.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {data.unlinked.length > 0 && (
              <div className='space-y-1'>
                <p className='text-xs font-semibold text-muted-foreground uppercase'>
                  Unlinked suppliers
                </p>
                <ul className='text-xs text-muted-foreground'>
                  {data.unlinked.map((supplier) => (
                    <li key={supplier.supplierId}>
                      {supplier.name} · {supplier.projectName}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function CompanyVendors() {
  const [search, setSearch] = useState('')
  const [trade, setTrade] = useState<string | undefined>()
  const [editing, setEditing] = useState<CompanyDirectoryEntry | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const { data, isLoading } = useVendors({
    ...(search ? { search } : {}),
    ...(trade ? { trade } : {}),
    includeInactive: true,
  })
  const items = data?.items ?? []

  return (
    <CompanySection
      title='Vendors'
      description='Suppliers defined once and offered on every project’s procurement and material pickers.'
      actions={
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => setReportOpen(true)}
          >
            <GitMerge className='size-4' /> Consolidation report
          </Button>
          <Button
            size='sm'
            data-testid='uat-vendor-new'
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus className='size-4' /> New vendor
          </Button>
        </div>
      }
    >
      <div className='space-y-3' data-testid='uat-company-vendors'>
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            placeholder='Search vendors'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='max-w-xs'
          />
          {data && (
            <span
              className='text-xs text-muted-foreground'
              data-testid='uat-vendor-qualified-count'
            >
              {data.summary.qualified} of {data.summary.total} prequalified
            </span>
          )}
          {data?.summary.trades.map(({ trade: value, count }) => (
            <button
              key={value}
              type='button'
              onClick={() =>
                setTrade((prev) => (prev === value ? undefined : value))
              }
              className={`rounded-full border px-2 py-0.5 text-xs ${trade === value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
            >
              {value} <span className='text-muted-foreground'>{count}</span>
            </button>
          ))}
        </div>
        {isLoading ? (
          <Skeleton className='h-32 w-full' />
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Prequalification</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className='text-right'>Reliability</TableHead>
                  <TableHead className='text-right'>Used on</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className='text-center text-muted-foreground'
                    >
                      No vendors yet. Add one, or they appear automatically when
                      a project supplier is created.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((vendor) => (
                    <TableRow
                      key={vendor.id}
                      data-testid={`uat-vendor-${vendor.id}`}
                    >
                      <TableCell className='font-medium'>
                        {vendor.name}
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          {vendor.trades.map((value) => (
                            <Badge key={value} variant='outline'>
                              {value}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <PrequalBadge
                          state={vendor.prequalification?.status ?? 'not_assessed'}
                          score={vendor.prequalification?.score ?? null}
                        />
                      </TableCell>
                      <TableCell className='text-xs'>
                        <div>{vendor.contactName || '—'}</div>
                        <div className='text-muted-foreground'>
                          {vendor.email || vendor.phone || ''}
                        </div>
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {vendor.vendorProfile.leadTimeReliability != null
                          ? `${vendor.vendorProfile.leadTimeReliability}%`
                          : '—'}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {vendor.supplierCount} projects
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            vendor.status === 'active' ? 'outline' : 'secondary'
                          }
                        >
                          {vendor.status}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          size='icon'
                          variant='ghost'
                          aria-label='Edit vendor'
                          onClick={() => {
                            setEditing(vendor)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil className='size-4' />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <VendorDialog
        vendor={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <MigrationReport open={reportOpen} onOpenChange={setReportOpen} />
    </CompanySection>
  )
}
