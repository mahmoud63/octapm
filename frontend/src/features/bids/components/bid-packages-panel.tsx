import { useState } from 'react'
import { Gavel, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  PACKAGE_STATUS_LABEL,
  formatBidDate,
  useBidBoqSections,
  useBidPackages,
  useCreateBidPackage,
  type BidPackageStatus,
} from '../hooks/use-bids'
import { BidPackageDialog } from './bid-package-dialog'

const statusTone = (status: BidPackageStatus) =>
  status === 'open'
    ? 'border-green-500/50 text-green-700 dark:text-green-400'
    : status === 'awarded'
      ? 'border-primary/50 text-primary'
      : status === 'cancelled'
        ? 'text-muted-foreground'
        : ''

const toLocalInput = (days: number) => {
  const date = new Date(Date.now() + days * 86_400_000)
  date.setMinutes(0, 0, 0)
  return date.toISOString().slice(0, 16)
}

function CreatePackageDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (packageId: string) => void
}) {
  const { data: sections = [] } = useBidBoqSections(projectId, open)
  const create = useCreateBidPackage(projectId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState(toLocalInput(14))
  const [questionsDueAt, setQuestionsDueAt] = useState(toLocalInput(10))
  const [commitmentType, setCommitmentType] = useState<
    'subcontract' | 'purchase_order'
  >('subcontract')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const submit = async () => {
    if (!title.trim()) {
      toast.error('Give the package a title')
      return
    }
    try {
      const created = await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        questionsDueAt: questionsDueAt
          ? new Date(questionsDueAt).toISOString()
          : null,
        commitmentType,
        boqSections: [...selected],
      })
      toast.success(
        `${created.ref} created with ${created.lines?.length ?? 0} lines`
      )
      onCreated(created.id)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>New bid package</DialogTitle>
          <DialogDescription>
            Pick the BOQ sections to price; every active item becomes a bid form
            line (your rates stay internal). Documents, bidders and addenda come
            next.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='bp-title'>Title</Label>
            <Input
              id='bp-title'
              data-testid='uat-bid-title'
              placeholder='Piling subcontract'
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='bp-description'>Scope summary</Label>
            <Textarea
              id='bp-description'
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='grid gap-3 sm:grid-cols-3'>
            <div className='space-y-1'>
              <Label htmlFor='bp-due'>Bids due</Label>
              <Input
                id='bp-due'
                type='datetime-local'
                data-testid='uat-bid-due'
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='bp-qdue'>Questions until</Label>
              <Input
                id='bp-qdue'
                type='datetime-local'
                value={questionsDueAt}
                onChange={(event) => setQuestionsDueAt(event.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label>Award as</Label>
              <Select
                value={commitmentType}
                onValueChange={(value) =>
                  setCommitmentType(value as 'subcontract' | 'purchase_order')
                }
              >
                <SelectTrigger aria-label='Commitment type'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='subcontract'>Subcontract</SelectItem>
                  <SelectItem value='purchase_order'>Purchase order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='space-y-1'>
            <Label>BOQ sections</Label>
            {sections.length === 0 ? (
              <p className='text-xs text-muted-foreground'>
                No active BOQ items yet — add lines by hand after creating.
              </p>
            ) : (
              <div
                className='max-h-52 space-y-1 overflow-y-auto rounded-md border p-2 text-sm'
                data-testid='uat-bid-sections'
              >
                {sections.map((section) => (
                  <label
                    key={section.key}
                    className='flex items-center justify-between gap-2'
                  >
                    <span className='flex items-center gap-2'>
                      <Checkbox
                        checked={selected.has(section.key)}
                        onCheckedChange={(state) =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (state === true) next.add(section.key)
                            else next.delete(section.key)
                            return next
                          })
                        }
                      />
                      {section.section}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      {section.items} item{section.items === 1 ? '' : 's'} ·{' '}
                      {section.amount.toLocaleString()}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={create.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={create.isPending}
            data-testid='uat-bid-create'
            onClick={submit}
          >
            {create.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Create package
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Commercial › Bids: packages, their state and the workspace dialog. */
export function BidPackagesPanel({
  projectId,
  initialRecordId,
}: {
  projectId: string
  initialRecordId?: string | null
}) {
  const canCreate = useCanPerform('bid', 'create')
  const [status, setStatus] = useState<BidPackageStatus | 'all'>('all')
  const { data: packages = [], isLoading } = useBidPackages(projectId, status)
  const [createOpen, setCreateOpen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(
    initialRecordId ?? null
  )

  return (
    <div className='space-y-3' data-testid='uat-bids'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={status}
          onValueChange={(value) =>
            setStatus(value as BidPackageStatus | 'all')
          }
        >
          <SelectTrigger className='w-44' aria-label='Package status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All packages</SelectItem>
            {(Object.keys(PACKAGE_STATUS_LABEL) as BidPackageStatus[]).map(
              (key) => (
                <SelectItem key={key} value={key}>
                  {PACKAGE_STATUS_LABEL[key]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        <p className='text-sm text-muted-foreground'>
          Invite vendors to price BOQ sections through a personal portal link,
          answer their questions, level the bids and award the commitment.
        </p>
        {canCreate && (
          <Button
            size='sm'
            className='ml-auto'
            data-testid='uat-bid-new'
            onClick={() => {
              setNonce((value) => value + 1)
              setCreateOpen(true)
            }}
          >
            <Plus className='mr-1 h-4 w-4' /> New package
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          Loading…
        </p>
      ) : packages.length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No bid packages yet.
        </p>
      ) : (
        <ul className='divide-y rounded-md border'>
          {packages.map((pkg) => (
            <li
              key={pkg.id}
              className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
              data-testid='uat-bid-row'
            >
              <Gavel className='h-4 w-4 text-muted-foreground' />
              <button
                type='button'
                className='font-medium underline-offset-2 hover:underline'
                onClick={() => setDetailId(pkg.id)}
              >
                {pkg.ref} · {pkg.title}
              </button>
              <Badge variant='outline' className={statusTone(pkg.status)}>
                {PACKAGE_STATUS_LABEL[pkg.status]}
              </Badge>
              {pkg.softAwardBidId && pkg.status !== 'awarded' && (
                <Badge variant='secondary'>Soft award</Badge>
              )}
              <span className='text-xs text-muted-foreground'>
                {pkg.counts.lines} line{pkg.counts.lines === 1 ? '' : 's'} ·{' '}
                {pkg.counts.invitations} bidder
                {pkg.counts.invitations === 1 ? '' : 's'} · {pkg.counts.bids}{' '}
                bid{pkg.counts.bids === 1 ? '' : 's'}
                {pkg.counts.openQuestions
                  ? ` · ${pkg.counts.openQuestions} open question${pkg.counts.openQuestions === 1 ? '' : 's'}`
                  : ''}
                {pkg.dueAt ? ` · due ${formatBidDate(pkg.dueAt)}` : ''}
              </span>
              <Button
                size='sm'
                variant='outline'
                className='ml-auto h-7'
                onClick={() => setDetailId(pkg.id)}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
      {createOpen && (
        <CreatePackageDialog
          key={nonce}
          projectId={projectId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={setDetailId}
        />
      )}
      {detailId && (
        <BidPackageDialog
          projectId={projectId}
          packageId={detailId}
          onOpenChange={(open) => !open && setDetailId(null)}
        />
      )}
    </div>
  )
}
