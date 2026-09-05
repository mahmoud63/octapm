import { useState } from 'react'
import {
  Camera,
  ClipboardCheck,
  CloudOff,
  Eye,
  FileText,
  ListChecks,
  Loader2,
  Map,
  RefreshCw,
  Wifi,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import {
  isQueued,
  newClientRequestId,
  syncOutbox,
  tempPlaceholder,
} from '@/lib/offline/outbox'
import { useCanPerform } from '@/lib/permissions'
import { useOnline, useOutbox } from '@/hooks/use-online'
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
import { OutboxList } from '@/components/outbox-status'
import { useUploadAttachments } from '@/features/attachments/hooks/use-attachments'
import { InstanceCreateDialog } from '@/features/inspections/components/instance-create-dialog'
import type { ModuleKey } from '@/features/projects/lib/project-modules'
import { PunchCreateDialog } from '@/features/punch/components/punch-create-dialog'
import { useCreatePunchItem } from '@/features/punch/hooks/use-punch'

/**
 * Photos taken on site land on a draft observation so they live on a record
 * (with pins, comments and history) rather than in a loose gallery; the
 * observation can be filled in later or left as a photo note.
 */
function QuickPhotoDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createOne = useCreatePunchItem(projectId)
  const upload = useUploadAttachments(projectId)
  const [files, setFiles] = useState<File[]>([])
  const [caption, setCaption] = useState('')
  const busy = createOne.isPending || upload.isPending

  const save = async () => {
    const title =
      caption.trim() || `Site photo ${new Date().toLocaleDateString()}`
    const tempId = newClientRequestId('photo-tmp')
    try {
      const created = await createOne.mutateAsync({
        kind: 'observation',
        observationType: 'quality',
        title,
        status: 'draft',
        tempId,
        clientRequestId: newClientRequestId('observation'),
      })
      const queued = isQueued(created)
      const uploaded = await upload.mutateAsync({
        recordType: 'punch_item',
        recordId: queued ? tempPlaceholder(tempId) : created.id,
        files,
        role: 'photo',
        caption: caption.trim() || undefined,
        dependsOn: queued ? tempId : null,
        label: `Photos: ${title}`,
      })
      toast.success(
        queued || isQueued(uploaded)
          ? `${files.length} photo${files.length === 1 ? '' : 's'} saved to the outbox`
          : `${files.length} photo${files.length === 1 ? '' : 's'} added to ${created.ref}`
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-capture-photo'>
        <DialogHeader>
          <DialogTitle>Site photos</DialogTitle>
          <DialogDescription>
            Saved on a draft observation so they stay linked to the project
            record; add details later or leave it as a photo note.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='capture-photos'>Photos</Label>
            <Input
              id='capture-photos'
              type='file'
              accept='image/*'
              capture='environment'
              multiple
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []))
              }
            />
            {files.length > 0 && (
              <p className='text-xs text-muted-foreground'>
                {files.length} photo{files.length === 1 ? '' : 's'} selected
              </p>
            )}
          </div>
          <div className='space-y-1'>
            <Label htmlFor='capture-caption'>What is this? (optional)</Label>
            <Input
              id='capture-caption'
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder='e.g. Level 3 slab pour, north bay'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={busy || files.length === 0}
            data-testid='uat-capture-photo-save'
          >
            {busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Capture-first home for phones and tablets (OCTA-MOB-PWA-018): one tap to
 * raise a punch item, an observation, photos, an inspection or a daily
 * report, with the outbox in view so nothing is lost without signal.
 */
export function CaptureHome({
  projectId,
  onNavigate,
}: {
  projectId: string
  onNavigate: (module: ModuleKey, child?: string | null) => void
}) {
  const online = useOnline()
  const { items, syncing } = useOutbox()
  const canPunch = useCanPerform('punch', 'create')
  const canInspect = useCanPerform('inspection', 'create')
  const canReport = useCanPerform('progress', 'create')
  const [dialog, setDialog] = useState<
    'punch' | 'observation' | 'photo' | 'inspection' | null
  >(null)
  const [nonce, setNonce] = useState(0)
  const openDialog = (kind: typeof dialog) => {
    setNonce((value) => value + 1)
    setDialog(kind)
  }

  const tiles: Array<{
    key: NonNullable<typeof dialog> | 'daily' | 'drawings'
    label: string
    hint: string
    icon: React.ReactNode
    enabled: boolean
    onClick: () => void
  }> = [
    {
      key: 'punch',
      label: 'Punch item',
      hint: 'Defect to fix, assigned to a company',
      icon: <ListChecks className='h-6 w-6' />,
      enabled: canPunch,
      onClick: () => openDialog('punch'),
    },
    {
      key: 'observation',
      label: 'Observation',
      hint: 'Safety, quality or work to complete',
      icon: <Eye className='h-6 w-6' />,
      enabled: canPunch,
      onClick: () => openDialog('observation'),
    },
    {
      key: 'photo',
      label: 'Photos',
      hint: 'Straight from the camera',
      icon: <Camera className='h-6 w-6' />,
      enabled: canPunch,
      onClick: () => openDialog('photo'),
    },
    {
      key: 'inspection',
      label: 'Inspection',
      hint: 'Run a checklist or ITP',
      icon: <ClipboardCheck className='h-6 w-6' />,
      enabled: canInspect,
      onClick: () => openDialog('inspection'),
    },
    {
      key: 'daily',
      label: 'Daily report',
      hint: 'Progress, crew, weather, issues',
      icon: <FileText className='h-6 w-6' />,
      enabled: canReport,
      onClick: () => onNavigate('siteReporting'),
    },
    {
      key: 'drawings',
      label: 'Drawings',
      hint: 'Sheets saved for offline use',
      icon: <Map className='h-6 w-6' />,
      enabled: true,
      onClick: () => onNavigate('docControl', 'drawings'),
    },
  ]

  return (
    <div className='space-y-4' data-testid='uat-capture-home'>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='text-lg font-semibold'>Capture</h2>
        <Badge
          variant='outline'
          className={online ? '' : 'border-amber-500/60 text-amber-600'}
          data-testid='uat-capture-online'
        >
          {online ? (
            <Wifi className='mr-1 h-3 w-3' />
          ) : (
            <CloudOff className='mr-1 h-3 w-3' />
          )}
          {online ? 'Online' : 'Offline — everything is kept on this device'}
        </Badge>
      </div>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
        {tiles
          .filter((tile) => tile.enabled)
          .map((tile) => (
            <button
              key={tile.key}
              type='button'
              onClick={tile.onClick}
              data-testid={`uat-capture-${tile.key}`}
              className='flex min-h-28 flex-col items-start justify-between rounded-lg border bg-card p-4 text-left shadow-sm transition hover:border-primary/60 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
            >
              <span className='text-primary'>{tile.icon}</span>
              <span>
                <span className='block text-base font-medium'>
                  {tile.label}
                </span>
                <span className='block text-xs text-muted-foreground'>
                  {tile.hint}
                </span>
              </span>
            </button>
          ))}
      </div>

      <section
        className='rounded-lg border p-4'
        data-testid='uat-capture-outbox'
      >
        <div className='mb-2 flex items-center justify-between'>
          <div>
            <p className='text-sm font-medium'>Outbox</p>
            <p className='text-xs text-muted-foreground'>
              {items.length
                ? `${items.length} item${items.length === 1 ? '' : 's'} waiting to upload`
                : 'Everything is uploaded'}
            </p>
          </div>
          <Button
            size='sm'
            variant='outline'
            disabled={!online || syncing || items.length === 0}
            onClick={() => void syncOutbox()}
          >
            {syncing ? (
              <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
            ) : (
              <RefreshCw className='mr-1 h-3.5 w-3.5' />
            )}
            Sync now
          </Button>
        </div>
        <OutboxList items={items} />
      </section>

      {(dialog === 'punch' || dialog === 'observation') && (
        <PunchCreateDialog
          key={`${dialog}-${nonce}`}
          projectId={projectId}
          kind={dialog}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      )}
      {dialog === 'photo' && (
        <QuickPhotoDialog
          key={`photo-${nonce}`}
          projectId={projectId}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      )}
      {dialog === 'inspection' && (
        <InstanceCreateDialog
          key={`inspection-${nonce}`}
          projectId={projectId}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      )}
    </div>
  )
}
