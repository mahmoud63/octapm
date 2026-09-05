import { useRef, useState } from 'react'
import {
  Camera,
  FileText,
  Images,
  Link2,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { isQueued } from '@/lib/offline/outbox'
import { useCanPerform, type PermissionModule } from '@/lib/permissions'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatBytes,
  useAttachments,
  useDeleteAttachment,
  usePhotos,
  useUploadAttachments,
  type AttachmentRecord,
} from '../hooks/use-attachments'

const ACCEPT_ANY = 'image/*,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'

/** Maps record types to the permission module that guards their attachments. */
const RECORD_MODULES: Record<string, PermissionModule> = {
  risk: 'risk',
  ncr: 'ncr',
  itp: 'ncr',
  defect: 'ncr',
  punch_item: 'punch',
  form_template: 'inspection',
  form_instance: 'inspection',
  form_response: 'inspection',
  material_test: 'ncr',
  safety_incident: 'safety',
  rfi: 'rfi',
  submittal: 'submittal',
  drawing: 'document_control',
  transmittal: 'document_control',
  correspondence: 'document_control',
  document: 'document_control',
  task: 'task',
  daily_report: 'progress',
  site_diary: 'progress',
  daily_log: 'progress',
  progress_submission: 'progress',
  activity: 'schedule',
  change_order: 'change_order',
  ipc: 'ipc',
  ipc_certificate: 'ipc',
  sub_valuation: 'ipc',
  eot: 'eot',
  weather_delay: 'eot',
  meeting: 'meeting',
  meeting_action: 'meeting',
  procurement_order: 'procurement',
  procurement_package: 'procurement',
  delivery_receipt: 'procurement',
  cost_record: 'cost',
  boq_item: 'boq',
  location: 'location',
  project: 'project_parties',
}

export const moduleForRecordType = (recordType: string): PermissionModule =>
  RECORD_MODULES[recordType] ?? 'document_control'

function GalleryPickerDialog({
  projectId,
  open,
  onOpenChange,
  onPick,
  isPending,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (documentIds: string[]) => Promise<void>
  isPending: boolean
}) {
  const { data, isLoading } = usePhotos(
    projectId,
    { limit: 60 },
    { enabled: open }
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (documentId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Add from project photos</DialogTitle>
          <DialogDescription>
            Reuse a photo already on this project. It stays in the gallery and
            can be attached to as many records as needed.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className='aspect-square' />
            ))}
          </div>
        ) : !data?.items.length ? (
          <p className='text-sm text-muted-foreground'>
            No photos on this project yet.
          </p>
        ) : (
          <div className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
            {data.items.map((photo) => {
              const isSelected = selected.has(photo.documentId)
              return (
                <button
                  key={photo.id}
                  type='button'
                  onClick={() => toggle(photo.documentId)}
                  className={cn(
                    'relative aspect-square overflow-hidden rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    isSelected && 'ring-2 ring-primary'
                  )}
                  aria-pressed={isSelected}
                >
                  <img
                    src={photo.thumbnailUrl}
                    alt={photo.caption || photo.document?.fileName || 'Photo'}
                    loading='lazy'
                    className='size-full object-cover'
                  />
                  {photo.caption && (
                    <span className='absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 py-0.5 text-[10px] text-white'>
                      {photo.caption}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid='uat-attachment-link-photos'
            disabled={!selected.size || isPending}
            onClick={async () => {
              await onPick([...selected])
              setSelected(new Set())
            }}
          >
            <Link2 className='size-4' />
            Attach {selected.size ? `(${selected.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AttachmentTile({
  attachment,
  canRemove,
  onRemove,
}: {
  attachment: AttachmentRecord
  canRemove: boolean
  onRemove: () => void
}) {
  const isImage =
    Boolean(attachment.photo) || attachment.mimeType?.startsWith('image/')
  const label =
    attachment.caption ||
    attachment.document?.originalName ||
    attachment.fileName ||
    'Attachment'
  const href =
    attachment.photo?.url ||
    attachment.fileUrl ||
    attachment.document?.url ||
    '#'
  return (
    <div
      data-testid='uat-attachment-item'
      className='group relative flex min-w-0 items-center gap-3 rounded-md border p-2'
    >
      <a
        href={href}
        target='_blank'
        rel='noreferrer'
        className='flex size-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted'
      >
        {isImage && attachment.photo ? (
          <img
            src={attachment.photo.thumbnailUrl}
            alt={label}
            loading='lazy'
            className='size-full object-cover'
          />
        ) : (
          <FileText className='size-6 text-muted-foreground' />
        )}
      </a>
      <div className='min-w-0 flex-1'>
        <a
          href={href}
          target='_blank'
          rel='noreferrer'
          className='block truncate text-sm font-medium underline-offset-4 hover:underline'
        >
          {label}
        </a>
        <p className='truncate text-xs text-muted-foreground'>
          {attachment.role}
          {attachment.sizeBytes
            ? ` · ${formatBytes(attachment.sizeBytes)}`
            : ''}
          {attachment.photo?.takenAt
            ? ` · ${new Date(attachment.photo.takenAt).toLocaleDateString()}`
            : ''}
          {attachment.photo?.location?.name
            ? ` · ${attachment.photo.location.name}`
            : ''}
        </p>
        {attachment.photo?.tags?.length ? (
          <div className='mt-1 flex flex-wrap gap-1'>
            {attachment.photo.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant='outline' className='text-[10px]'>
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      {canRemove && (
        <Button
          size='icon'
          variant='ghost'
          className='shrink-0'
          aria-label='Remove attachment'
          onClick={onRemove}
        >
          <Trash2 className='size-4' />
        </Button>
      )}
    </div>
  )
}

/**
 * Attachments for one record: upload from files or camera, reuse a project
 * photo, and unlink. Permission follows the record's module.
 */
export function AttachmentPanel({
  projectId,
  recordType,
  recordId,
  legacyAttachments = [],
  compact = false,
}: {
  projectId: string
  recordType: string
  recordId: string
  legacyAttachments?: Array<{
    id?: string
    fileName?: string | null
    filename?: string | null
    fileUrl?: string | null
    url?: string | null
    mimeType?: string | null
    description?: string | null
  }>
  compact?: boolean
}) {
  const moduleName = moduleForRecordType(recordType)
  const canUpdate = useCanPerform(moduleName, 'update')
  const canSubmit = useCanPerform(moduleName, 'submit')
  const canCreate = useCanPerform(moduleName, 'create')
  const canWrite = canUpdate || canSubmit || canCreate

  const { data, isLoading } = useAttachments(projectId, recordType, recordId)
  const upload = useUploadAttachments(projectId)
  const remove = useDeleteAttachment(projectId)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  const items = data?.items ?? []
  const legacy = legacyAttachments.filter(
    (row) =>
      !items.some(
        (item) =>
          item.documentId === row.id ||
          (row.fileUrl && item.fileUrl === row.fileUrl)
      )
  )

  const handleFiles = async (
    files: FileList | null,
    role?: 'photo' | 'evidence'
  ) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    try {
      const result = await upload.mutateAsync({
        recordType,
        recordId,
        files: list,
        role,
      })
      toast.success(
        isQueued(result)
          ? `${list.length} file${list.length === 1 ? '' : 's'} saved to the outbox — uploads when you are back online`
          : result.items.length === 1
            ? 'Attachment added.'
            : `${result.items.length} attachments added.`
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      if (fileInput.current) fileInput.current.value = ''
      if (cameraInput.current) cameraInput.current.value = ''
    }
  }

  return (
    <div className='space-y-3' data-testid='uat-attachment-panel'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='flex items-center gap-1 text-xs text-muted-foreground'>
          <Paperclip className='size-3.5' />
          {items.length + legacy.length} attached
        </span>
        {canWrite && (
          <div className='ms-auto flex flex-wrap gap-1'>
            <input
              ref={fileInput}
              type='file'
              multiple
              accept={ACCEPT_ANY}
              className='hidden'
              data-testid='uat-attachment-file-input'
              onChange={(event) => handleFiles(event.target.files)}
            />
            <input
              ref={cameraInput}
              type='file'
              accept='image/*'
              capture='environment'
              className='hidden'
              data-testid='uat-attachment-camera-input'
              onChange={(event) => handleFiles(event.target.files, 'photo')}
            />
            <Button
              size='sm'
              variant='outline'
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className='size-4' />
              {compact ? null : 'Upload'}
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={upload.isPending}
              onClick={() => cameraInput.current?.click()}
              aria-label='Take a photo'
            >
              <Camera className='size-4' />
              {compact ? null : 'Camera'}
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={upload.isPending}
              onClick={() => setGalleryOpen(true)}
              aria-label='Add from gallery'
            >
              <Images className='size-4' />
              {compact ? null : 'From gallery'}
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className='space-y-2'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      ) : items.length === 0 && legacy.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No evidence attached</p>
      ) : (
        <div className='grid gap-2 sm:grid-cols-2'>
          {items.map((attachment) => (
            <AttachmentTile
              key={attachment.id}
              attachment={attachment}
              canRemove={canWrite}
              onRemove={async () => {
                try {
                  await remove.mutateAsync(attachment.id)
                  toast.success('Attachment removed.')
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
            />
          ))}
          {legacy.map((row, index) => {
            const label =
              row.fileName || row.filename || row.description || 'Attachment'
            const href = row.fileUrl || row.url || null
            return (
              <div
                key={row.id || `${label}-${index}`}
                className='flex min-w-0 items-center gap-3 rounded-md border border-dashed p-2'
              >
                <div className='flex size-14 shrink-0 items-center justify-center rounded bg-muted'>
                  <FileText className='size-6 text-muted-foreground' />
                </div>
                <div className='min-w-0 flex-1'>
                  {href ? (
                    <a
                      href={href}
                      className='block truncate text-sm font-medium underline-offset-4 hover:underline'
                    >
                      {label}
                    </a>
                  ) : (
                    <span className='block truncate text-sm font-medium'>
                      {label}
                    </span>
                  )}
                  <p className='text-xs text-muted-foreground'>
                    Legacy evidence
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <GalleryPickerDialog
        projectId={projectId}
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        isPending={upload.isPending}
        onPick={async (documentIds) => {
          try {
            await upload.mutateAsync({
              recordType,
              recordId,
              documentIds,
              role: 'photo',
            })
            toast.success('Photos attached.')
            setGalleryOpen(false)
          } catch (error) {
            toast.error(getServerErrorMessage(error))
          }
        }}
      />
    </div>
  )
}
