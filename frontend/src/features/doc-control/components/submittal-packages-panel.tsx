import { useState } from 'react'
import { CheckCircle2, Loader2, Package, Plus, Send, X } from 'lucide-react'
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
import { UserPicker } from '@/components/user-picker'
import { useActivities } from '@/features/activities/hooks/use-activities'
import {
  useAddSubmittalPackageItems,
  useCreateSubmittalPackage,
  useDecideSubmittalPackage,
  useRemoveSubmittalPackageItem,
  useSubmitSubmittalPackage,
  useSubmittalPackages,
  useSubmittals,
  type SubmittalPackage,
  type SubmittalResponseCode,
} from '../hooks/use-doc-control'
import {
  APPROVE_CODES,
  PACKAGE_STATUS_LABEL,
  REJECT_CODES,
  RESPONSE_CODE_LABELS,
  SUBMITTAL_STATUS_LABEL,
  formatDate,
} from '../lib/submittal-workflow'

const NONE = '__none'

function PackageDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateSubmittalPackage(projectId)
  const { data: activities } = useActivities(projectId)
  const { data: loose } = useSubmittals(projectId, { limit: 100 })
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [activityId, setActivityId] = useState('')
  const [requiredOnSite, setRequiredOnSite] = useState('')
  const [managerUserId, setManagerUserId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const candidates = (loose?.rows ?? []).filter((row) => !row.packageId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-sub-package-create'
      >
        <DialogHeader>
          <DialogTitle>New submittal package</DialogTitle>
          <DialogDescription>
            Group related submittals so they are sent, tracked and decided
            together.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 md:grid-cols-2'>
          <div className='space-y-1 md:col-span-2'>
            <Label htmlFor='pkg-name'>Name</Label>
            <Input
              id='pkg-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. Facade package'
            />
          </div>
          <div className='space-y-1'>
            <Label>Activity</Label>
            <Select
              value={activityId || NONE}
              onValueChange={(value) =>
                setActivityId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder='Link an activity' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No activity</SelectItem>
                {activities?.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='pkg-required'>Required on site</Label>
            <Input
              id='pkg-required'
              type='date'
              value={requiredOnSite}
              onChange={(e) => setRequiredOnSite(e.target.value)}
            />
          </div>
          <div className='space-y-1 md:col-span-2'>
            <Label>Package manager</Label>
            <UserPicker
              projectId={projectId}
              value={managerUserId}
              onChange={setManagerUserId}
              allowNone
            />
          </div>
          <div className='space-y-1 md:col-span-2'>
            <Label htmlFor='pkg-description'>Description</Label>
            <Textarea
              id='pkg-description'
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className='space-y-1 md:col-span-2'>
            <Label>Submittals to include</Label>
            {candidates.length === 0 ? (
              <p className='text-xs text-muted-foreground'>
                Every submittal is already in a package, or none exist yet.
              </p>
            ) : (
              <div className='max-h-48 space-y-1 overflow-y-auto rounded-md border p-2'>
                {candidates.map((row) => (
                  <label
                    key={row.id}
                    className='flex items-center gap-2 text-sm'
                  >
                    <Checkbox
                      checked={selected.includes(row.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) =>
                          checked
                            ? [...prev, row.id]
                            : prev.filter((id) => id !== row.id)
                        )
                      }
                    />
                    <span className='font-mono text-xs'>{row.ref}</span>
                    <span>{row.title}</span>
                    <Badge variant='outline' className='ml-auto'>
                      {SUBMITTAL_STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || !name.trim()}
            data-testid='uat-sub-package-save'
            onClick={async () => {
              try {
                const created = await create.mutateAsync({
                  name: name.trim(),
                  description: description.trim() || null,
                  activityId: activityId || null,
                  requiredOnSite: requiredOnSite || null,
                  managerUserId,
                  submittalIds: selected,
                })
                toast.success(`${created.ref} created`)
                onOpenChange(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
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

function PackageDecisionDialog({
  projectId,
  pkg,
  onOpenChange,
}: {
  projectId: string
  pkg: SubmittalPackage | null
  onOpenChange: (open: boolean) => void
}) {
  const decide = useDecideSubmittalPackage(projectId)
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve')
  const [responseCode, setResponseCode] =
    useState<SubmittalResponseCode>('approved')
  const [comment, setComment] = useState('')
  const codes =
    decision === 'approve'
      ? APPROVE_CODES.filter((code) => code !== 'custom')
      : REJECT_CODES.filter((code) => code !== 'custom')
  return (
    <Dialog open={Boolean(pkg)} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-sub-package-decide'>
        <DialogHeader>
          <DialogTitle>Decide {pkg?.ref}</DialogTitle>
          <DialogDescription>
            Applies to every item under review whose active step is waiting on
            you. Items waiting on someone else are reported, not changed.
          </DialogDescription>
        </DialogHeader>
        <div className='flex gap-1'>
          <Button
            size='sm'
            variant={decision === 'approve' ? 'default' : 'outline'}
            onClick={() => {
              setDecision('approve')
              setResponseCode('approved')
            }}
          >
            Approve
          </Button>
          <Button
            size='sm'
            variant={decision === 'reject' ? 'destructive' : 'outline'}
            onClick={() => {
              setDecision('reject')
              setResponseCode('revise_resubmit')
            }}
          >
            Return
          </Button>
        </div>
        <Select
          value={responseCode}
          onValueChange={(value) =>
            setResponseCode(value as SubmittalResponseCode)
          }
        >
          <SelectTrigger aria-label='Response code'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {codes.map((code) => (
              <SelectItem key={code} value={code}>
                {RESPONSE_CODE_LABELS[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          rows={2}
          placeholder={
            decision === 'reject'
              ? 'What needs to change (required)'
              : 'Comment (optional)'
          }
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              decide.isPending ||
              (decision === 'reject' && !comment.trim()) ||
              !pkg
            }
            onClick={async () => {
              if (!pkg) return
              try {
                const result = await decide.mutateAsync({
                  packageId: pkg.id,
                  payload: {
                    decision,
                    responseCode,
                    comment: comment.trim() || null,
                  },
                })
                const decided = result.results.filter(
                  (row) => row.decided
                ).length
                const failed = result.results.filter(
                  (row) => row.decided === false
                )
                toast.success(
                  `${decided} item${decided === 1 ? '' : 's'} decided${failed.length ? `, ${failed.length} not yours to decide` : ''}`
                )
                onOpenChange(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {decide.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Record decisions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Packages: grouped submittals with one-shot submit / decide and a live status. */
export function SubmittalPackagesPanel({
  projectId,
  onOpenSubmittal,
}: {
  projectId: string
  onOpenSubmittal: (submittalId: string) => void
}) {
  const { data, isLoading } = useSubmittalPackages(projectId)
  const { data: loose } = useSubmittals(projectId, { limit: 100 })
  const addItems = useAddSubmittalPackageItems(projectId)
  const removeItem = useRemoveSubmittalPackageItem(projectId)
  const submitPackage = useSubmitSubmittalPackage(projectId)
  const canCreate = useCanPerform('submittal', 'create')
  const canUpdate = useCanPerform('submittal', 'update')
  const canSubmit = useCanPerform('submittal', 'submit', 'submittal.submit')
  const canReview = useCanPerform('submittal', 'submit', 'submittal.review')
  const [createOpen, setCreateOpen] = useState(false)
  const [createNonce, setCreateNonce] = useState(0)
  const [deciding, setDeciding] = useState<SubmittalPackage | null>(null)
  const [adding, setAdding] = useState<Record<string, string>>({})
  const packages = data?.items ?? []
  const unpackaged = (loose?.rows ?? []).filter((row) => !row.packageId)

  return (
    <div className='space-y-3' data-testid='uat-sub-packages'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm text-muted-foreground'>
          A package sends and tracks a set of submittals as one. Its status
          follows its items.
        </p>
        {canCreate && (
          <Button
            size='sm'
            data-testid='uat-sub-package-new'
            onClick={() => {
              setCreateNonce((n) => n + 1)
              setCreateOpen(true)
            }}
          >
            <Plus className='mr-1 h-4 w-4' /> New package
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading…</p>
      ) : packages.length === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
          No packages yet.
        </p>
      ) : (
        <div className='space-y-3'>
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className='rounded-md border p-3'
              data-testid='uat-sub-package-row'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <Package className='h-4 w-4 text-muted-foreground' />
                <span className='font-mono text-xs'>{pkg.ref}</span>
                <span className='font-medium'>{pkg.name}</span>
                <Badge
                  variant={pkg.status === 'closed' ? 'default' : 'outline'}
                >
                  {PACKAGE_STATUS_LABEL[pkg.status] ?? pkg.status}
                </Badge>
                <span className='text-xs text-muted-foreground'>
                  {pkg.summary.total} items · {pkg.summary.underReview} in
                  review · {pkg.summary.approved} approved
                  {pkg.summary.returned
                    ? ` · ${pkg.summary.returned} returned`
                    : ''}
                </span>
                {pkg.requiredOnSite && (
                  <span className='text-xs text-muted-foreground'>
                    · on site {formatDate(pkg.requiredOnSite)}
                  </span>
                )}
                {pkg.manager && (
                  <span className='text-xs text-muted-foreground'>
                    · {pkg.manager.name}
                  </span>
                )}
                <div className='ml-auto flex gap-1'>
                  {canSubmit &&
                    pkg.items.some((item) =>
                      ['pending', 'resubmit', 'rejected'].includes(item.status)
                    ) && (
                      <Button
                        size='sm'
                        variant='outline'
                        data-testid='uat-sub-package-submit'
                        disabled={submitPackage.isPending}
                        onClick={async () => {
                          try {
                            const result = await submitPackage.mutateAsync({
                              packageId: pkg.id,
                            })
                            const sent = result.results.filter(
                              (row) => row.submitted
                            ).length
                            const failed = result.results.filter(
                              (row) => row.submitted === false
                            )
                            toast.success(
                              `${sent} submitted${failed.length ? `; ${failed.length} need a revision attached (${failed.map((row) => row.ref).join(', ')})` : ''}`
                            )
                          } catch (error) {
                            toast.error(getServerErrorMessage(error))
                          }
                        }}
                      >
                        <Send className='mr-1 h-4 w-4' /> Submit all
                      </Button>
                    )}
                  {canReview && pkg.summary.underReview > 0 && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setDeciding(pkg)}
                    >
                      <CheckCircle2 className='mr-1 h-4 w-4' /> Decide all
                    </Button>
                  )}
                </div>
              </div>
              {pkg.description && (
                <p className='mt-1 text-xs text-muted-foreground'>
                  {pkg.description}
                </p>
              )}
              <ul className='mt-2 divide-y text-sm'>
                {pkg.items.map((item) => (
                  <li
                    key={item.id}
                    className='flex flex-wrap items-center gap-2 py-1'
                  >
                    <button
                      type='button'
                      className='font-mono text-xs underline-offset-2 hover:underline'
                      onClick={() => onOpenSubmittal(item.id)}
                    >
                      {item.ref}
                    </button>
                    <span>{item.title}</span>
                    <Badge variant='outline'>
                      {SUBMITTAL_STATUS_LABEL[item.status] ?? item.status}
                    </Badge>
                    {item.responseCodeLabel && (
                      <span className='text-xs text-muted-foreground'>
                        {item.responseCodeLabel}
                      </span>
                    )}
                    {item.dueDate && item.status === 'under_review' && (
                      <span className='text-xs text-muted-foreground'>
                        due {formatDate(item.dueDate)}
                      </span>
                    )}
                    {canUpdate && (
                      <Button
                        size='icon'
                        variant='ghost'
                        className='ml-auto h-6 w-6'
                        aria-label={`Remove ${item.ref} from package`}
                        disabled={removeItem.isPending}
                        onClick={async () => {
                          try {
                            await removeItem.mutateAsync({
                              packageId: pkg.id,
                              submittalId: item.id,
                            })
                          } catch (error) {
                            toast.error(getServerErrorMessage(error))
                          }
                        }}
                      >
                        <X className='h-3 w-3' />
                      </Button>
                    )}
                  </li>
                ))}
                {pkg.items.length === 0 && (
                  <li className='py-1 text-xs text-muted-foreground'>
                    Empty package
                  </li>
                )}
              </ul>
              {canUpdate &&
                unpackaged.length > 0 &&
                pkg.status !== 'closed' && (
                  <div className='mt-2 flex flex-wrap items-center gap-2'>
                    <Select
                      value={adding[pkg.id] ?? ''}
                      onValueChange={(value) =>
                        setAdding((prev) => ({ ...prev, [pkg.id]: value }))
                      }
                    >
                      <SelectTrigger
                        className='w-72'
                        aria-label='Add a submittal'
                      >
                        <SelectValue placeholder='Add a submittal…' />
                      </SelectTrigger>
                      <SelectContent>
                        {unpackaged.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {row.ref} · {row.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={!adding[pkg.id] || addItems.isPending}
                      onClick={async () => {
                        try {
                          await addItems.mutateAsync({
                            packageId: pkg.id,
                            submittalIds: [adding[pkg.id]],
                          })
                          setAdding((prev) => ({ ...prev, [pkg.id]: '' }))
                        } catch (error) {
                          toast.error(getServerErrorMessage(error))
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                )}
            </div>
          ))}
        </div>
      )}
      {createOpen && (
        <PackageDialog
          key={createNonce}
          projectId={projectId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
      <PackageDecisionDialog
        key={deciding?.id ?? 'none'}
        projectId={projectId}
        pkg={deciding}
        onOpenChange={(open) => {
          if (!open) setDeciding(null)
        }}
      />
    </div>
  )
}
