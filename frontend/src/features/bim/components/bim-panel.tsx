import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import {
  BIM_DISCIPLINES,
  BIM_STATUS_LABEL,
  fmtBytes,
  useBimModels,
  useDeleteBimModel,
  useReparseBimModel,
  useUploadBimModel,
  type BimModel,
  type BimStatus,
} from '../hooks/use-bim'
import { BimModelBrowser } from './bim-model-browser'

const STATUS_CLASS: Record<BimStatus, string> = {
  processing:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  ready:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

function UploadDialog({
  projectId,
  open,
  onOpenChange,
  onUploaded,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: (id: string) => void
}) {
  const upload = useUploadBimModel(projectId)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [discipline, setDiscipline] = useState<string>('')
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (open) return
    setFile(null)
    setName('')
    setDiscipline('')
    setNotes('')
  }, [open])

  const submit = async () => {
    if (!file) return
    try {
      const created = await upload.mutateAsync({
        file,
        name,
        discipline: discipline || undefined,
        notes,
      })
      onOpenChange(false)
      toast.success(`${created.name} uploaded — reading the model now`)
      onUploaded(created.id)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='uat-bim-upload'>
        <DialogHeader>
          <DialogTitle>Upload an IFC model</DialogTitle>
          <DialogDescription>
            The spatial breakdown, every element and its property sets,
            materials and quantities are read in the background. Uploading under
            the same name creates the next version and supersedes the current
            one.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>IFC file</Label>
            <Input
              type='file'
              accept='.ifc'
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null
                setFile(picked)
                if (picked && !name) setName(picked.name.replace(/\.ifc$/i, ''))
              }}
              data-testid='uat-bim-upload-file'
            />
            {file && (
              <p className='text-xs text-muted-foreground'>
                {file.name} · {fmtBytes(file.size)}
              </p>
            )}
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label>Name</Label>
              <Input
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label>Discipline</Label>
              <Select value={discipline} onValueChange={setDiscipline}>
                <SelectTrigger>
                  <SelectValue placeholder='Optional' />
                </SelectTrigger>
                <SelectContent>
                  {BIM_DISCIPLINES.map((value) => (
                    <SelectItem
                      key={value}
                      value={value}
                      className='capitalize'
                    >
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='space-y-1'>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={notes}
              maxLength={4000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!file || upload.isPending}
            onClick={submit}
            data-testid='uat-bim-upload-confirm'
          >
            {upload.isPending && (
              <Loader2 className='mr-1 h-4 w-4 animate-spin' />
            )}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Project › BIM: the models, and the browser for the one that is open. */
export function BimPanel({
  projectId,
  initialTarget,
  onUpload,
}: {
  projectId: string
  initialTarget?: ProjectSetupTarget
  /** Opens the BIM / 5D import dialog instead of the panel's own upload. */
  onUpload?: () => void
}) {
  const canCreate = useCanPerform('bim', 'create')
  const canDelete = useCanPerform('bim', 'delete')
  const canUpdate = useCanPerform('bim', 'update')
  const { data, isLoading } = useBimModels(projectId)
  const reparse = useReparseBimModel(projectId)
  const remove = useDeleteBimModel(projectId)
  const [openId, setOpenId] = useState<string | null>(
    initialTarget?.source === 'bim_model'
      ? (initialTarget.recordId ?? null)
      : null
  )
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  if (openId) {
    return (
      <BimModelBrowser
        projectId={projectId}
        modelId={openId}
        onBack={() => setOpenId(null)}
      />
    )
  }

  const summary = data?.summary

  return (
    <div className='space-y-3' data-testid='uat-bim'>
      <div className='flex flex-wrap items-center gap-2'>
        <Boxes className='h-5 w-5' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>BIM models</p>
          <p className='text-xs text-muted-foreground'>
            IFC models read into elements, quantities and property sets, tied to
            the activities, locations and BOQ items they belong to. Geometry is
            not rendered — this is the model's data, not its picture.
          </p>
        </div>
        {canCreate && (
          <Button
            size='sm'
            onClick={() => (onUpload ? onUpload() : setUploading(true))}
            data-testid='uat-bim-new'
          >
            <Upload className='mr-2 h-4 w-4' /> Upload IFC
          </Button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        {(
          [
            [
              'Models',
              summary?.count ?? '—',
              `${summary?.current ?? 0} current`,
            ],
            [
              'Elements',
              summary ? summary.elements.toLocaleString() : '—',
              'in the current models',
            ],
            [
              'Linked',
              summary ? summary.linked.toLocaleString() : '—',
              'tied to project records',
            ],
            [
              'Reading',
              summary?.byStatus.processing ?? '—',
              `${summary?.byStatus.failed ?? 0} failed`,
            ],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} className='rounded border p-3'>
            <p className='text-xs text-muted-foreground'>{label}</p>
            <p className='text-2xl font-bold tabular-nums'>{value}</p>
            <p className='text-[11px] text-muted-foreground'>{hint}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading…
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
          No model yet. Upload the IFC export from Revit, ArchiCAD, Tekla or any
          authoring tool.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-xs text-muted-foreground'>
              <tr>
                <th className='px-2 py-1 text-left'>Model</th>
                <th className='px-2 py-1 text-left'>Discipline</th>
                <th className='px-2 py-1 text-left'>Schema</th>
                <th className='px-2 py-1 text-right'>Elements</th>
                <th className='px-2 py-1 text-right'>Storeys</th>
                <th className='px-2 py-1 text-right'>Linked</th>
                <th className='px-2 py-1 text-left'>Status</th>
                <th className='px-2 py-1' />
              </tr>
            </thead>
            <tbody data-testid='uat-bim-models'>
              {data!.items.map((model: BimModel) => (
                <tr
                  key={model.id}
                  className={cn(
                    'border-t',
                    model.status === 'ready' &&
                      'cursor-pointer hover:bg-muted/40',
                    !model.isCurrent && 'text-muted-foreground'
                  )}
                  onClick={() =>
                    model.status === 'ready' && setOpenId(model.id)
                  }
                >
                  <td className='max-w-72 px-2 py-1'>
                    <span className='block truncate font-medium'>
                      {model.name}
                      <span className='ml-1 text-xs text-muted-foreground'>
                        v{model.version}
                      </span>
                      {!model.isCurrent && (
                        <Badge variant='outline' className='ml-1 text-[10px]'>
                          superseded
                        </Badge>
                      )}
                    </span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {[
                        model.fileName,
                        fmtBytes(model.fileSize),
                        model.ifcProjectName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </td>
                  <td className='px-2 py-1 text-xs capitalize'>
                    {model.discipline ?? '—'}
                  </td>
                  <td className='px-2 py-1 text-xs'>{model.schema ?? '—'}</td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {model.elementCount.toLocaleString()}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {model.storeyCount || '—'}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {model.linkedCount || '—'}
                  </td>
                  <td className='px-2 py-1'>
                    <Badge
                      variant='outline'
                      className={STATUS_CLASS[model.status]}
                    >
                      {BIM_STATUS_LABEL[model.status]}
                    </Badge>
                    {model.error && (
                      <span
                        className='ml-1 inline-flex items-center'
                        title={model.error}
                      >
                        <AlertTriangle className='h-3.5 w-3.5 text-rose-600' />
                      </span>
                    )}
                  </td>
                  <td
                    className='px-2 py-1 text-right whitespace-nowrap'
                    onClick={(event) => event.stopPropagation()}
                  >
                    {canUpdate && model.status !== 'processing' && (
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={reparse.isPending}
                        onClick={() =>
                          reparse
                            .mutateAsync(model.id)
                            .then(() =>
                              toast.success('Reading the model again')
                            )
                            .catch((error) =>
                              toast.error(getServerErrorMessage(error))
                            )
                        }
                        data-testid='uat-bim-reparse'
                      >
                        <RefreshCw className='h-3.5 w-3.5' />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant={
                          confirmDelete === model.id ? 'destructive' : 'ghost'
                        }
                        size='sm'
                        disabled={remove.isPending}
                        onClick={() =>
                          confirmDelete === model.id
                            ? remove
                                .mutateAsync(model.id)
                                .then(() => {
                                  toast.success('Model deleted')
                                  setConfirmDelete(null)
                                })
                                .catch((error) =>
                                  toast.error(getServerErrorMessage(error))
                                )
                            : setConfirmDelete(model.id)
                        }
                        onBlur={() => setConfirmDelete(null)}
                        data-testid='uat-bim-delete'
                      >
                        <Trash2 className='h-3.5 w-3.5' />
                        {confirmDelete === model.id && (
                          <span className='ml-1 text-xs'>Confirm</span>
                        )}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UploadDialog
        projectId={projectId}
        open={uploading}
        onOpenChange={setUploading}
        onUploaded={() => undefined}
      />
    </div>
  )
}
