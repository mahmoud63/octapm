import { useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
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
import { useProjectCostCodes } from '@/features/cost/hooks/use-budget'
import {
  useCreateCrew,
  useCreateWorker,
  useCrews,
  useDeleteCrew,
  useImportWorkers,
  useUpdateCrew,
  useUpdateWorker,
  useWorkers,
  type Crew,
  type Worker,
  type WorkerPayload,
} from '../hooks/use-timesheets'
import type { ActivityOption } from './timesheet-editor'

const NONE = '__none__'

type WorkerForm = {
  name: string
  employeeNumber: string
  companyId: string
  trade: string
  classification: string
  hourlyRate: string
  overtimeMultiplier: string
  status: 'active' | 'inactive'
  notes: string
}

const blankWorker = (): WorkerForm => ({
  name: '',
  employeeNumber: '',
  companyId: NONE,
  trade: '',
  classification: '',
  hourlyRate: '',
  overtimeMultiplier: '1.5',
  status: 'active',
  notes: '',
})

const workerToForm = (worker: Worker): WorkerForm => ({
  name: worker.name,
  employeeNumber: worker.employeeNumber ?? '',
  companyId: worker.companyId ?? NONE,
  trade: worker.trade ?? '',
  classification: worker.classification ?? '',
  hourlyRate: worker.hourlyRate === null ? '' : String(worker.hourlyRate),
  overtimeMultiplier: String(worker.overtimeMultiplier),
  status: worker.status,
  notes: worker.notes ?? '',
})

const formToPayload = (form: WorkerForm): WorkerPayload => ({
  name: form.name.trim(),
  employeeNumber: form.employeeNumber.trim() || null,
  companyId: form.companyId === NONE ? null : form.companyId,
  trade: form.trade.trim() || null,
  classification: form.classification.trim() || null,
  hourlyRate: form.hourlyRate.trim() === '' ? null : Number(form.hourlyRate),
  overtimeMultiplier: Number(form.overtimeMultiplier) || 1.5,
  status: form.status,
  notes: form.notes.trim() || null,
})

/** Parses pasted CSV / TSV: name, employee number, trade, classification, rate, company. */
const parseImport = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^name[,;\t]/i.test(line))
    .map((line) => {
      const [
        name,
        employeeNumber,
        trade,
        classification,
        hourlyRate,
        companyName,
      ] = line.split(/[,;\t]/).map((cell) => cell.trim())
      return {
        name,
        employeeNumber: employeeNumber || null,
        trade: trade || null,
        classification: classification || null,
        hourlyRate: hourlyRate ? Number(hourlyRate) : null,
        companyName: companyName || null,
      }
    })

function WorkerDialog({
  projectId,
  worker,
  companies,
  open,
  onOpenChange,
}: {
  projectId: string
  worker: Worker | null
  companies: Array<{ id: string; name: string }>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateWorker(projectId)
  const update = useUpdateWorker(projectId)
  const [form, setForm] = useState<WorkerForm>(blankWorker())
  useEffect(() => {
    if (open) setForm(worker ? workerToForm(worker) : blankWorker())
  }, [open, worker])
  const set = (patch: Partial<WorkerForm>) =>
    setForm((current) => ({ ...current, ...patch }))
  const busy = create.isPending || update.isPending
  const submit = async () => {
    try {
      const payload = formToPayload(form)
      if (worker) await update.mutateAsync({ workerId: worker.id, ...payload })
      else await create.mutateAsync(payload)
      toast.success(worker ? 'Worker updated' : 'Worker added')
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='uat-worker-dialog'>
        <DialogHeader>
          <DialogTitle>{worker ? 'Edit worker' : 'New worker'}</DialogTitle>
          <DialogDescription>
            The hourly rate is snapshotted on each approved timesheet; overtime
            is paid at the multiplier, double time at ×2.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1 sm:col-span-2'>
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label>Employee number</Label>
            <Input
              value={form.employeeNumber}
              onChange={(event) => set({ employeeNumber: event.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label>Company</Label>
            <Select
              value={form.companyId}
              onValueChange={(value) => set({ companyId: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Trade</Label>
            <Input
              value={form.trade}
              onChange={(event) => set({ trade: event.target.value })}
              placeholder='Carpenter'
            />
          </div>
          <div className='space-y-1'>
            <Label>Classification</Label>
            <Input
              value={form.classification}
              onChange={(event) => set({ classification: event.target.value })}
              placeholder='Skilled'
            />
          </div>
          <div className='space-y-1'>
            <Label>Hourly rate</Label>
            <Input
              type='number'
              min={0}
              step={0.01}
              value={form.hourlyRate}
              onChange={(event) => set({ hourlyRate: event.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label>Overtime multiplier</Label>
            <Input
              type='number'
              min={1}
              max={5}
              step={0.05}
              value={form.overtimeMultiplier}
              onChange={(event) =>
                set({ overtimeMultiplier: event.target.value })
              }
            />
          </div>
          <div className='space-y-1'>
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(value) =>
                set({ status: value as WorkerForm['status'] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='active'>Active</SelectItem>
                <SelectItem value='inactive'>Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(event) => set({ notes: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!form.name.trim() || busy}
            onClick={submit}
            data-testid='uat-worker-save'
          >
            {busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {worker ? 'Save' : 'Add worker'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CrewDialog({
  projectId,
  crew,
  workers,
  companies,
  activities,
  open,
  onOpenChange,
}: {
  projectId: string
  crew: Crew | null
  workers: Worker[]
  companies: Array<{ id: string; name: string }>
  activities: ActivityOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateCrew(projectId)
  const update = useUpdateCrew(projectId)
  const { data: costCodes } = useProjectCostCodes(projectId)
  const [name, setName] = useState('')
  const [companyId, setCompanyId] = useState(NONE)
  const [activityId, setActivityId] = useState(NONE)
  const [costCodeId, setCostCodeId] = useState(NONE)
  const [status, setStatus] = useState<'active' | 'inactive'>('active')
  const [members, setMembers] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  useEffect(() => {
    if (!open) return
    setName(crew?.name ?? '')
    setCompanyId(crew?.companyId ?? NONE)
    setActivityId(crew?.defaultActivityId ?? NONE)
    setCostCodeId(crew?.defaultCostCodeId ?? NONE)
    setStatus(crew?.status ?? 'active')
    setMembers(new Set((crew?.members ?? []).map((member) => member.workerId)))
    setFilter('')
  }, [open, crew])
  const busy = create.isPending || update.isPending
  const visibleWorkers = workers.filter(
    (worker) =>
      worker.status === 'active' &&
      (companyId === NONE ||
        worker.companyId === companyId ||
        members.has(worker.id)) &&
      (!filter.trim() ||
        `${worker.name} ${worker.trade ?? ''}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase()))
  )
  const submit = async () => {
    const payload = {
      name: name.trim(),
      companyId: companyId === NONE ? null : companyId,
      defaultActivityId: activityId === NONE ? null : activityId,
      defaultCostCodeId: costCodeId === NONE ? null : costCodeId,
      status,
      workerIds: [...members],
    }
    try {
      if (crew) await update.mutateAsync({ crewId: crew.id, ...payload })
      else await create.mutateAsync(payload)
      toast.success(crew ? 'Crew updated' : 'Crew created')
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl' data-testid='uat-crew-dialog'>
        <DialogHeader>
          <DialogTitle>{crew ? 'Edit crew' : 'New crew'}</DialogTitle>
          <DialogDescription>
            A crew&apos;s members are pre-filled on each new timesheet with the
            default activity and cost code.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='Formwork A'
            />
          </div>
          <div className='space-y-1'>
            <Label>Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— any —</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Default activity</Label>
            <Select value={activityId} onValueChange={setActivityId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {activities.map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {activity.activityCode || activity.wbsCode
                      ? `${activity.activityCode || activity.wbsCode} · `
                      : ''}
                    {activity.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Default cost code</Label>
            <Select value={costCodeId} onValueChange={setCostCodeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {(costCodes?.items ?? [])
                  .filter((code) => code.status === 'active')
                  .map((code) => (
                    <SelectItem key={code.costCodeId} value={code.costCodeId}>
                      {code.code} {code.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {crew && (
            <div className='space-y-1'>
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as typeof status)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='active'>Active</SelectItem>
                  <SelectItem value='inactive'>Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className='space-y-1 sm:col-span-2'>
            <div className='flex items-center justify-between'>
              <Label>Members · {members.size}</Label>
              <Input
                className='h-8 w-48'
                placeholder='Filter workers'
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div
              className='max-h-60 space-y-1 overflow-auto rounded-md border p-2'
              data-testid='uat-crew-members'
            >
              {visibleWorkers.map((worker) => (
                <label
                  key={worker.id}
                  className='flex items-center gap-2 text-sm'
                >
                  <Checkbox
                    checked={members.has(worker.id)}
                    onCheckedChange={(checked) =>
                      setMembers((current) => {
                        const next = new Set(current)
                        if (checked) next.add(worker.id)
                        else next.delete(worker.id)
                        return next
                      })
                    }
                  />
                  <span className='min-w-0 flex-1 truncate'>{worker.name}</span>
                  <span className='text-xs text-muted-foreground'>
                    {[worker.trade, worker.companyName]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </label>
              ))}
              {visibleWorkers.length === 0 && (
                <p className='text-xs text-muted-foreground'>
                  No workers match — add workers first.
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || busy}
            onClick={submit}
            data-testid='uat-crew-save'
          >
            {busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {crew ? 'Save' : 'Create crew'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Crews of the project and the workers they draw from. */
export function CrewsPanel({
  projectId,
  activities,
}: {
  projectId: string
  activities: ActivityOption[]
}) {
  const [search, setSearch] = useState('')
  const { data: workers, isLoading: workersLoading } = useWorkers(
    projectId,
    search
  )
  const { data: crews, isLoading: crewsLoading } = useCrews(projectId)
  const remove = useDeleteCrew(projectId)
  const importWorkers = useImportWorkers(projectId)
  const canCreate = useCanPerform('timesheet', 'create')
  const canUpdate = useCanPerform('timesheet', 'update')
  const canDelete = useCanPerform('timesheet', 'delete')
  const canAdmin = useCanPerform(
    'timesheet',
    'create',
    'timesheet.worker_admin'
  )
  const [crewDialog, setCrewDialog] = useState<{
    open: boolean
    crew: Crew | null
  }>({ open: false, crew: null })
  const [workerDialog, setWorkerDialog] = useState<{
    open: boolean
    worker: Worker | null
  }>({ open: false, worker: null })
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const workerItems = workers?.items ?? []
  const companies = useMemo(() => {
    const map = new Map<string, string>()
    for (const worker of workerItems)
      if (worker.companyId && worker.companyName)
        map.set(worker.companyId, worker.companyName)
    for (const crew of crews?.items ?? [])
      if (crew.companyId && crew.companyName)
        map.set(crew.companyId, crew.companyName)
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [workerItems, crews?.items])

  const runImport = async () => {
    const rows = parseImport(importText).filter((row) => row.name)
    if (!rows.length) {
      toast.error(
        'Paste at least one line: name, employee no, trade, classification, rate, company'
      )
      return
    }
    try {
      const result = await importWorkers.mutateAsync(rows)
      toast.success(
        `${result.created} added · ${result.updated} updated${result.errors.length ? ` · ${result.errors.length} rejected` : ''}`
      )
      setImportOpen(false)
      setImportText('')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='grid gap-3 lg:grid-cols-2' data-testid='uat-crews-panel'>
      <section className='space-y-2 rounded-md border p-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <p className='font-medium'>Crews</p>
          <span className='text-xs text-muted-foreground'>
            {crews?.items.length ?? 0}
          </span>
          {canCreate && (
            <Button
              size='sm'
              className='ml-auto'
              onClick={() => setCrewDialog({ open: true, crew: null })}
              data-testid='uat-crew-new'
            >
              <Plus className='mr-2 h-4 w-4' /> New crew
            </Button>
          )}
        </div>
        {crewsLoading ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (crews?.items.length ?? 0) === 0 ? (
          <p className='text-xs text-muted-foreground'>
            No crew yet. A crew groups workers so a day&apos;s timesheet is one
            click.
          </p>
        ) : (
          <ul className='space-y-2'>
            {crews!.items.map((crew) => (
              <li key={crew.id} className='rounded border p-2 text-sm'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>{crew.name}</span>
                  {crew.status === 'inactive' && (
                    <Badge variant='outline'>inactive</Badge>
                  )}
                  <span className='text-xs text-muted-foreground'>
                    {crew.memberCount} worker{crew.memberCount === 1 ? '' : 's'}
                    {crew.companyName ? ` · ${crew.companyName}` : ''}
                  </span>
                  <span className='ml-auto flex gap-1'>
                    {canUpdate && (
                      <Button
                        size='sm'
                        variant='ghost'
                        className='h-7 px-2'
                        onClick={() => setCrewDialog({ open: true, crew })}
                        title='Edit crew'
                      >
                        <Pencil className='h-3.5 w-3.5' />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size='sm'
                        variant='ghost'
                        className='h-7 px-2 text-destructive'
                        title='Delete crew'
                        onClick={() => {
                          if (
                            !window.confirm(`Delete the crew "${crew.name}"?`)
                          )
                            return
                          remove.mutate(crew.id, {
                            onError: (error) =>
                              toast.error(getServerErrorMessage(error)),
                          })
                        }}
                      >
                        <Trash2 className='h-3.5 w-3.5' />
                      </Button>
                    )}
                  </span>
                </div>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {crew.members
                    .map((member) => member.worker?.name ?? 'Worker')
                    .join(', ') || 'No members'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className='space-y-2 rounded-md border p-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <p className='font-medium'>Workers</p>
          <span className='text-xs text-muted-foreground'>
            {workers?.total ?? 0}
          </span>
          <Input
            className='h-8 w-44'
            placeholder='Search'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {canAdmin && (
            <span className='ml-auto flex gap-1'>
              <Button
                size='sm'
                variant='outline'
                onClick={() => setImportOpen(true)}
                data-testid='uat-worker-import'
              >
                <Upload className='mr-2 h-4 w-4' /> Import
              </Button>
              <Button
                size='sm'
                onClick={() => setWorkerDialog({ open: true, worker: null })}
                data-testid='uat-worker-new'
              >
                <Plus className='mr-2 h-4 w-4' /> Add
              </Button>
            </span>
          )}
        </div>
        {workersLoading ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : workerItems.length === 0 ? (
          <p className='text-xs text-muted-foreground'>No workers yet.</p>
        ) : (
          <div className='max-h-[28rem] overflow-auto rounded border'>
            <table className='w-full text-sm'>
              <thead className='sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur'>
                <tr>
                  <th className='px-2 py-1 text-left'>Name</th>
                  <th className='px-2 py-1 text-left'>Trade</th>
                  <th className='px-2 py-1 text-left'>Company</th>
                  <th className='px-2 py-1 text-right'>Rate</th>
                  {canAdmin && <th className='px-2 py-1' />}
                </tr>
              </thead>
              <tbody data-testid='uat-worker-rows'>
                {workerItems.map((worker) => (
                  <tr key={worker.id} className='border-t'>
                    <td className='px-2 py-1'>
                      <span
                        className={
                          worker.status === 'inactive'
                            ? 'text-muted-foreground line-through'
                            : ''
                        }
                      >
                        {worker.name}
                      </span>
                      {worker.employeeNumber && (
                        <span className='ml-1 font-mono text-xs text-muted-foreground'>
                          {worker.employeeNumber}
                        </span>
                      )}
                      {worker.crews && worker.crews.length > 0 && (
                        <span className='ml-1 text-xs text-muted-foreground'>
                          · {worker.crews.map((crew) => crew.name).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className='px-2 py-1'>{worker.trade ?? '—'}</td>
                    <td className='px-2 py-1'>{worker.companyName ?? '—'}</td>
                    <td className='px-2 py-1 text-right tabular-nums'>
                      {worker.hourlyRate ?? '—'}
                    </td>
                    {canAdmin && (
                      <td className='px-2 py-1 text-right'>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-7 px-2'
                          onClick={() =>
                            setWorkerDialog({ open: true, worker })
                          }
                          title='Edit worker'
                        >
                          <Pencil className='h-3.5 w-3.5' />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CrewDialog
        projectId={projectId}
        crew={crewDialog.crew}
        workers={workerItems}
        companies={companies}
        activities={activities}
        open={crewDialog.open}
        onOpenChange={(open) =>
          setCrewDialog((current) => ({ ...current, open }))
        }
      />
      <WorkerDialog
        projectId={projectId}
        worker={workerDialog.worker}
        companies={companies}
        open={workerDialog.open}
        onOpenChange={(open) =>
          setWorkerDialog((current) => ({ ...current, open }))
        }
      />
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent
          className='sm:max-w-lg'
          data-testid='uat-worker-import-dialog'
        >
          <DialogHeader>
            <DialogTitle>Import workers</DialogTitle>
            <DialogDescription>
              One worker per line: name, employee number, trade, classification,
              hourly rate, company. Existing employee numbers are updated.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={8}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={
              'Ali Hassan, E-001, Carpenter, Skilled, 20, Main Contractor\nBen Okoro, E-002, Labourer, , 12'
            }
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={importWorkers.isPending || !importText.trim()}
              onClick={runImport}
              data-testid='uat-worker-import-run'
            >
              {importWorkers.isPending && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
