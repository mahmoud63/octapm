import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  type ImportModelInput,
  useBim5dRegister,
  useCarryForward,
  useImportBimModel,
  useImportedModel,
  useModelSuggestions,
} from '../hooks/use-bim-5d'

const DISCIPLINES: Array<[string, string]> = [
  ['structural', 'Structural'],
  ['architectural', 'Architectural'],
  ['mep', 'MEP'],
  ['mechanical', 'Mechanical'],
  ['electrical', 'Electrical'],
  ['plumbing', 'Plumbing'],
  ['civil', 'Civil'],
  ['coordination', 'Coordination'],
  ['other', 'Other'],
]
const MAX_BYTES = 300 * 1024 * 1024
const today = () => new Date().toISOString().slice(0, 10)
const NATIVE = /\.(rvt|rfa|nwd|nwc|dwg|dgn|skp|pln)$/i

/** What the browser can say about the file before it travels; the server checks the IFC header itself. */
const checkFile = (file: File | null): string | null => {
  if (!file) return null
  if (NATIVE.test(file.name)) return 'Native Revit, Navisworks and DWG files are not supported yet. Export the model as IFC (.ifc) from your authoring tool.'
  if (/\.(ifczip|ifcxml)$/i.test(file.name)) return 'Compressed IFC (.ifczip) and IFC-XML are not supported yet; export a plain .ifc file.'
  if (!/\.ifc$/i.test(file.name)) return 'Choose an IFC file (.ifc).'
  if (!file.size) return 'The file is empty.'
  if (file.size > MAX_BYTES) return 'The file is larger than 300 MB.'
  return null
}

type StepState = 'pending' | 'active' | 'done' | 'failed' | 'warning'

function Step({ state, label, detail }: { state: StepState; label: string; detail?: React.ReactNode }) {
  const icon = {
    pending: <CircleDashed className='h-4 w-4 text-muted-foreground' />,
    active: <Loader2 className='h-4 w-4 animate-spin text-primary' />,
    done: <CheckCircle2 className='h-4 w-4 text-emerald-600' />,
    warning: <AlertTriangle className='h-4 w-4 text-amber-600' />,
    failed: <XCircle className='h-4 w-4 text-destructive' />,
  }[state]
  return (
    <li className='flex items-start gap-2 text-sm' data-state={state}>
      <span className='mt-0.5'>{icon}</span>
      <span className={cn(state === 'pending' && 'text-muted-foreground')}>
        {label}
        {detail !== undefined && detail !== null && <span className='ms-1 text-muted-foreground'>— {detail}</span>}
      </span>
    </li>
  )
}

/**
 * Upload / Import Model (BIM UX completion): a new model or a new revision of
 * an existing one, IFC only, then the processing steps — uploading, parsing,
 * elements detected and imported, warnings, mapping suggestions — until the
 * model is ready. Older revisions are never overwritten.
 */
export function ImportModelDialog({
  projectId,
  open,
  onClose,
  baseModelId = null,
  onCompare,
  onOpenElements,
}: {
  projectId: string
  open: boolean
  onClose: () => void
  /** Preselects "new revision of" this model revision. */
  baseModelId?: string | null
  onCompare?: (revisionId: string) => void
  onOpenElements?: (revisionId: string) => void
}) {
  const { data: register } = useBim5dRegister(projectId, open)
  const models = useMemo(() => register?.models ?? [], [register])
  const canLink = useCanPerform('bim', 'update', 'bim.link')
  const importModel = useImportBimModel(projectId)
  const carry = useCarryForward(projectId)
  const [mode, setMode] = useState<'new' | 'revision'>('new')
  const [base, setBase] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [discipline, setDiscipline] = useState('structural')
  const [revision, setRevision] = useState('')
  const [revisionDate, setRevisionDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [modelId, setModelId] = useState<string | null>(null)
  const [carried, setCarried] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setFile(null)
    setName('')
    setNotes('')
    setRevision('')
    setRevisionDate(today())
    setProgress(0)
    setError(null)
    setModelId(null)
    setCarried(null)
    importModel.reset()
    const preset = baseModelId ? models.find((model) => model.revisions.some((rev) => rev.id === baseModelId)) : null
    setMode(preset ? 'revision' : 'new')
    setBase(preset ? preset.currentRevisionId : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, baseModelId])

  const baseModel = models.find((model) => model.currentRevisionId === base || model.revisions.some((rev) => rev.id === base)) ?? null
  useEffect(() => {
    if (baseModel?.discipline) setDiscipline(baseModel.discipline)
  }, [baseModel?.discipline])
  const nextRevision = mode === 'revision' && baseModel ? `R${String(Math.max(...baseModel.revisions.map((rev) => rev.version)) + 1).padStart(2, '0')}` : 'R01'
  const usedCodes = new Set((baseModel?.revisions ?? []).map((rev) => rev.revision.toUpperCase()))
  const fileProblem = checkFile(file)
  const nameTaken = mode === 'new' && name.trim() && models.some((model) => model.name.toLowerCase() === name.trim().toLowerCase())
  const codeTaken = mode === 'revision' && usedCodes.has((revision.trim() || nextRevision).toUpperCase())
  const problems = [
    !file && 'Choose the IFC file.',
    fileProblem,
    mode === 'new' && !name.trim() && 'Give the model a name.',
    nameTaken && `A model called "${name.trim()}" already exists — upload this as a new revision of it.`,
    mode === 'revision' && !baseModel && 'Choose the model this file revises.',
    codeTaken && `This model already has revision ${(revision.trim() || nextRevision).toUpperCase()}; revisions are never overwritten.`,
    revisionDate > today() && 'The revision date cannot be in the future.',
  ].filter(Boolean) as string[]

  const { data: model } = useImportedModel(projectId, modelId)
  const ready = model?.status === 'ready'
  const failed = model?.status === 'failed'
  const { data: suggestions, isLoading: suggesting } = useModelSuggestions(projectId, modelId, ready)
  const isRevision = mode === 'revision'

  const submit = async () => {
    if (!file || problems.length) return
    setError(null)
    setProgress(0)
    const input: ImportModelInput = {
      file,
      mode,
      name: mode === 'new' ? name : undefined,
      baseModelId: mode === 'revision' ? base : undefined,
      discipline,
      revision: revision.trim() || undefined,
      revisionDate,
      notes,
    }
    try {
      const created = await importModel.mutateAsync({ input, onProgress: setProgress })
      setModelId(created.id)
    } catch (err) {
      setError(getServerErrorMessage(err))
    }
  }

  const processing = Boolean(modelId) || importModel.isPending
  const warnings = model?.warnings ?? []
  const warningText = (item: (typeof warnings)[number]) => (typeof item === 'string' ? item : item.message || item.code || 'Warning')

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !importModel.isPending && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl' data-testid='uat-bim5d-import'>
        <DialogHeader>
          <DialogTitle>Upload / Import Model</DialogTitle>
          <DialogDescription>
            IFC (.ifc, IFC2X3 or IFC4) is supported today. Native Revit (RVT), Navisworks and DWG are not — export the model as IFC first. A new revision never overwrites an older one.
          </DialogDescription>
        </DialogHeader>

        {!processing ? (
          <div className='space-y-4'>
            <RadioGroup value={mode} onValueChange={(value) => setMode(value as 'new' | 'revision')} className='grid gap-2 sm:grid-cols-2'>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm', mode === 'new' && 'border-primary')}>
                <RadioGroupItem value='new' className='mt-0.5' /> <span><span className='font-medium'>New model</span><br /><span className='text-xs text-muted-foreground'>A model the project does not have yet</span></span>
              </label>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm', mode === 'revision' && 'border-primary', !models.length && 'opacity-50')}>
                <RadioGroupItem value='revision' disabled={!models.length} className='mt-0.5' /> <span><span className='font-medium'>New revision</span><br /><span className='text-xs text-muted-foreground'>Of a model already uploaded</span></span>
              </label>
            </RadioGroup>

            <div className='space-y-1.5'>
              <Label htmlFor='bim-import-file'>File</Label>
              <Input id='bim-import-file' type='file' accept='.ifc' onChange={(event) => setFile(event.target.files?.[0] ?? null)} data-testid='uat-bim5d-import-file' />
              {file && !fileProblem && <p className='text-xs text-muted-foreground'>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              {mode === 'new' ? (
                <div className='space-y-1.5 sm:col-span-2'>
                  <Label htmlFor='bim-import-name'>Model name</Label>
                  <Input id='bim-import-name' value={name} onChange={(event) => setName(event.target.value)} placeholder='e.g. Riverside Architectural' />
                </div>
              ) : (
                <div className='space-y-1.5 sm:col-span-2'>
                  <Label>Model</Label>
                  <Select value={base} onValueChange={setBase}>
                    <SelectTrigger><SelectValue placeholder='Choose the model this file revises' /></SelectTrigger>
                    <SelectContent>
                      {models.map((row) => <SelectItem key={row.name} value={row.currentRevisionId}>{row.name} (latest {row.latestRevision})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className='space-y-1.5'>
                <Label>Discipline</Label>
                <Select value={discipline} onValueChange={setDiscipline}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DISCIPLINES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='bim-import-revision'>Revision</Label>
                <Input id='bim-import-revision' value={revision} onChange={(event) => setRevision(event.target.value.toUpperCase())} placeholder={nextRevision} maxLength={20} />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='bim-import-date'>Revision date</Label>
                <Input id='bim-import-date' type='date' max={today()} value={revisionDate} onChange={(event) => setRevisionDate(event.target.value)} />
              </div>
              <div className='space-y-1.5 sm:col-span-2'>
                <Label htmlFor='bim-import-notes'>Description / notes</Label>
                <Textarea id='bim-import-notes' rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder='e.g. IFC for construction, issued with transmittal TR-014' />
              </div>
            </div>

            {(file || name || base) && problems.length > 0 && (
              <ul className='space-y-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300'>
                {problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            )}
            {error && <p className='rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive' data-testid='uat-bim5d-import-error'>{error}</p>}
          </div>
        ) : (
          <div className='space-y-3' data-testid='uat-bim5d-import-progress'>
            <ol className='space-y-1.5'>
              <Step state={modelId ? 'done' : importModel.isPending ? 'active' : 'pending'} label='Uploading' detail={modelId ? 'stored as the original file' : `${progress}%`} />
              <Step state={!modelId ? 'pending' : failed ? 'failed' : ready ? 'done' : 'active'} label='Parsing the IFC' detail={failed ? model?.error || 'The model could not be read' : model?.schema ?? undefined} />
              <Step state={ready ? 'done' : 'pending'} label='Elements detected' detail={ready ? `${model?.entityCount.toLocaleString()} IFC entities read, ${model?.storeyCount} storeys` : undefined} />
              <Step state={ready ? 'done' : 'pending'} label='Elements imported' detail={ready ? model?.elementCount.toLocaleString() : undefined} />
              <Step state={!ready ? 'pending' : warnings.length ? 'warning' : 'done'} label='Warnings' detail={ready ? (warnings.length ? `${warnings.length}` : 'none') : undefined} />
              <Step
                state={!ready ? 'pending' : suggesting ? 'active' : 'done'}
                label='Mapping suggestions generated'
                detail={ready && suggestions ? `${suggestions.location.length} to locations, ${suggestions.boq.length} to BOQ items — review and apply them on the Overview` : undefined}
              />
              <Step state={ready && suggestions ? 'done' : failed ? 'failed' : 'pending'} label={failed ? 'Processing failed' : 'Processing complete'} detail={ready && suggestions ? `${model?.name} ${model?.revision}` : undefined} />
            </ol>
            {warnings.length > 0 && (
              <ul className='max-h-28 list-disc space-y-0.5 overflow-y-auto rounded-md border bg-muted/30 p-2 ps-6 text-xs'>
                {warnings.map((item, index) => <li key={index}>{warningText(item)}</li>)}
              </ul>
            )}
            {failed && <p className='text-xs text-muted-foreground'>Nothing was overwritten. Check the export settings in your authoring tool (IFC2X3 or IFC4, with base quantities) and upload again.</p>}
            {ready && isRevision && canLink && (
              <div className='flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm'>
                <span className='flex-1 text-xs text-muted-foreground'>
                  {carried === null ? 'Copy the previous revision’s location, WBS, activity and BOQ mappings onto this one by GlobalId (BOQ quantities are re-measured from this revision).' : `${carried} mappings carried forward.`}
                </span>
                {carried === null && (
                  <Button size='sm' variant='outline' disabled={carry.isPending} onClick={async () => {
                    try {
                      const result = (await carry.mutateAsync(modelId as string)) as { carried?: number }
                      setCarried(result.carried ?? 0)
                    } catch (err) {
                      toast.error(getServerErrorMessage(err))
                    }
                  }}>
                    {carry.isPending && <Loader2 className='h-4 w-4 animate-spin' />} Carry mappings forward
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className='gap-2'>
          {!processing ? (
            <>
              <Button variant='outline' onClick={onClose}>Cancel</Button>
              <Button disabled={problems.length > 0} onClick={submit} data-testid='uat-bim5d-import-confirm'>Upload and import</Button>
            </>
          ) : (
            <>
              {ready && isRevision && onCompare && <Button variant='outline' onClick={() => { onCompare(modelId as string); onClose() }}>Compare with previous</Button>}
              {ready && onOpenElements && <Button variant='outline' onClick={() => { onOpenElements(modelId as string); onClose() }}>Open elements</Button>}
              <Button disabled={importModel.isPending || (!!modelId && !ready && !failed)} onClick={onClose} data-testid='uat-bim5d-import-done'>
                {ready || failed ? 'Done' : 'Processing…'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
