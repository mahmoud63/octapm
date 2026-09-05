import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Camera, ExternalLink, MapPin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
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
import { CompanyPicker } from '@/components/user-picker'
import { useUploadAttachments } from '@/features/attachments/hooks/use-attachments'
import { useRfis } from '@/features/doc-control/hooks/use-doc-control'
import { usePunchItems } from '@/features/punch/hooks/use-punch'
import { useDefects } from '@/features/quality/hooks/use-quality'
import {
  useCreatePin,
  useDeletePin,
  type MarkupPoint,
  type Pin,
} from '../hooks/use-markups'

type Mode =
  | 'new_punch'
  | 'link_punch'
  | 'new_rfi'
  | 'link_rfi'
  | 'link_defect'
  | 'photo'

const MODE_LABEL: Record<Mode, string> = {
  new_punch: 'Raise a punch item here',
  link_punch: 'Link a punch item',
  new_rfi: 'Raise an RFI here',
  link_rfi: 'Link an existing RFI',
  link_defect: 'Link a legacy defect',
  photo: 'Attach a photo here',
}

/**
 * Drops a pin at a point: raises a punch item or an RFI on the spot, links
 * an existing punch item, RFI or defect, or attaches a photo to the sheet
 * and pins it.
 */
export function PinCreateDialog({
  projectId,
  sheetId,
  sheetNumber,
  sheetRevisionId,
  point,
  onOpenChange,
}: {
  projectId: string
  sheetId: string
  sheetNumber: string
  sheetRevisionId: string | null
  point: MarkupPoint | null
  onOpenChange: (open: boolean) => void
}) {
  const canCreatePunch = useCanPerform('punch', 'create')
  const canReadPunch = useCanPerform('punch', 'read')
  const canCreateRfi = useCanPerform('rfi', 'create')
  const canReadRfi = useCanPerform('rfi', 'read')
  const canReadDefects = useCanPerform('ncr', 'read')
  const createPin = useCreatePin(projectId, sheetId)
  const upload = useUploadAttachments(projectId)
  const [mode, setMode] = useState<Mode>(
    canCreatePunch ? 'new_punch' : canCreateRfi ? 'new_rfi' : 'photo'
  )
  const [subject, setSubject] = useState('')
  const [question, setQuestion] = useState('')
  const [priority, setPriority] = useState('normal')
  const [punchCompanyId, setPunchCompanyId] = useState<string | null>(null)
  const [punchId, setPunchId] = useState('')
  const [rfiId, setRfiId] = useState('')
  const [defectId, setDefectId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const open = Boolean(point)

  const { data: rfis } = useRfis(projectId, { limit: 100 })
  const { data: defects } = useDefects(projectId)
  const { data: punch } = usePunchItems(
    projectId,
    { limit: 500 },
    { enabled: open && canReadPunch }
  )

  const reset = () => {
    setSubject('')
    setQuestion('')
    setPunchCompanyId(null)
    setPunchId('')
    setRfiId('')
    setDefectId('')
    setFile(null)
    setCaption('')
  }

  const submit = async () => {
    if (!point) return
    try {
      if (mode === 'new_punch') {
        const result = await createPin.mutateAsync({
          x: point.x,
          y: point.y,
          recordType: 'punch_item',
          sheetRevisionId,
          create: {
            title: subject.trim(),
            description: question.trim() || undefined,
            priority,
            assigneeCompanyId: punchCompanyId || undefined,
          },
        })
        toast.success(
          `${result.created?.ref ?? 'Punch item'} raised on sheet ${sheetNumber}`
        )
      } else if (mode === 'link_punch') {
        await createPin.mutateAsync({
          x: point.x,
          y: point.y,
          recordType: 'punch_item',
          recordId: punchId,
          sheetRevisionId,
        })
        toast.success('Punch item pinned')
      } else if (mode === 'new_rfi') {
        const result = await createPin.mutateAsync({
          x: point.x,
          y: point.y,
          recordType: 'rfi',
          sheetRevisionId,
          create: {
            subject: subject.trim(),
            question: question.trim() || undefined,
            priority,
          },
        })
        toast.success(
          `${result.created?.ref ?? 'RFI'} raised on sheet ${sheetNumber}`
        )
      } else if (mode === 'link_rfi') {
        await createPin.mutateAsync({
          x: point.x,
          y: point.y,
          recordType: 'rfi',
          recordId: rfiId,
          sheetRevisionId,
        })
        toast.success('RFI pinned')
      } else if (mode === 'link_defect') {
        await createPin.mutateAsync({
          x: point.x,
          y: point.y,
          recordType: 'defect',
          recordId: defectId,
          sheetRevisionId,
        })
        toast.success('Defect pinned')
      } else if (mode === 'photo' && file) {
        const uploaded = await upload.mutateAsync({
          recordType: 'sheet',
          recordId: sheetId,
          role: 'photo',
          caption: caption.trim() || undefined,
          files: [file],
        })
        const photoId = uploaded.items.find((item) => item.photo?.id)?.photo?.id
        if (!photoId) throw new Error('The file is not an image')
        await createPin.mutateAsync({
          x: point.x,
          y: point.y,
          recordType: 'photo',
          recordId: photoId,
          sheetRevisionId,
          label: caption.trim() || null,
        })
        toast.success('Photo pinned')
      }
      reset()
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const canSubmit =
    (mode === 'new_punch' && subject.trim().length > 0) ||
    (mode === 'link_punch' && Boolean(punchId)) ||
    (mode === 'new_rfi' && subject.trim().length > 0) ||
    (mode === 'link_rfi' && Boolean(rfiId)) ||
    (mode === 'link_defect' && Boolean(defectId)) ||
    (mode === 'photo' && Boolean(file))
  const busy = createPin.isPending || upload.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onOpenChange(false))}
    >
      <DialogContent data-testid='uat-pin-dialog'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <MapPin className='h-4 w-4' /> Pin on {sheetNumber}
          </DialogTitle>
          <DialogDescription>
            The pin stays at this spot on every revision of the sheet and links
            to the record.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>What is here?</Label>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as Mode)}
            >
              <SelectTrigger data-testid='uat-pin-mode'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {canCreatePunch && (
                  <SelectItem value='new_punch'>
                    {MODE_LABEL.new_punch}
                  </SelectItem>
                )}
                {canReadPunch && (
                  <SelectItem value='link_punch'>
                    {MODE_LABEL.link_punch}
                  </SelectItem>
                )}
                {canCreateRfi && (
                  <SelectItem value='new_rfi'>{MODE_LABEL.new_rfi}</SelectItem>
                )}
                {canReadRfi && (
                  <SelectItem value='link_rfi'>
                    {MODE_LABEL.link_rfi}
                  </SelectItem>
                )}
                {canReadDefects && (
                  <SelectItem value='link_defect'>
                    {MODE_LABEL.link_defect}
                  </SelectItem>
                )}
                <SelectItem value='photo'>{MODE_LABEL.photo}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'new_punch' && (
            <>
              <div className='space-y-1'>
                <Label htmlFor='pin-punch-title'>What needs fixing</Label>
                <Input
                  id='pin-punch-title'
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder='e.g. Cracked tile at threshold'
                  maxLength={200}
                  data-testid='uat-pin-punch-title'
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='pin-punch-details'>Details</Label>
                <Textarea
                  id='pin-punch-details'
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={2}
                  placeholder='Optional'
                />
              </div>
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-1'>
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['low', 'normal', 'high', 'urgent'].map((value) => (
                        <SelectItem key={value} value={value}>
                          {value.charAt(0).toUpperCase() + value.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1'>
                  <Label>Responsible company</Label>
                  <CompanyPicker
                    projectId={projectId}
                    value={punchCompanyId}
                    onChange={setPunchCompanyId}
                    placeholder='Decide later'
                  />
                </div>
              </div>
              <p className='text-xs text-muted-foreground'>
                The item opens straight away and the pin links it to this spot.
              </p>
            </>
          )}

          {mode === 'link_punch' && (
            <div className='space-y-1'>
              <Label>Punch item</Label>
              <Select value={punchId} onValueChange={setPunchId}>
                <SelectTrigger data-testid='uat-pin-punch-select'>
                  <SelectValue placeholder='Choose an item' />
                </SelectTrigger>
                <SelectContent>
                  {(punch?.items ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.ref} · {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === 'new_rfi' && (
            <>
              <div className='space-y-1'>
                <Label htmlFor='pin-rfi-subject'>Subject</Label>
                <Input
                  id='pin-rfi-subject'
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder='e.g. Rebar spacing at gridline C'
                  data-testid='uat-pin-rfi-subject'
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='pin-rfi-question'>Question</Label>
                <Textarea
                  id='pin-rfi-question'
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={3}
                  placeholder='What needs clarifying?'
                />
              </div>
              <div className='space-y-1'>
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['low', 'normal', 'high', 'urgent'].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value.charAt(0).toUpperCase() + value.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {mode === 'link_rfi' && (
            <div className='space-y-1'>
              <Label>RFI</Label>
              <Select value={rfiId} onValueChange={setRfiId}>
                <SelectTrigger data-testid='uat-pin-rfi-select'>
                  <SelectValue placeholder='Choose an RFI' />
                </SelectTrigger>
                <SelectContent>
                  {(rfis?.rows ?? []).map((rfi) => (
                    <SelectItem key={rfi.id} value={rfi.id}>
                      {rfi.ref} · {rfi.subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === 'link_defect' && (
            <div className='space-y-1'>
              <Label>Defect</Label>
              <Select value={defectId} onValueChange={setDefectId}>
                <SelectTrigger>
                  <SelectValue placeholder='Choose a defect' />
                </SelectTrigger>
                <SelectContent>
                  {(defects?.rows ?? []).map((defect) => (
                    <SelectItem key={defect.id} value={defect.id}>
                      {defect.ref} · {defect.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === 'photo' && (
            <>
              <div className='space-y-1'>
                <Label htmlFor='pin-photo-file'>Photo</Label>
                <Input
                  id='pin-photo-file'
                  type='file'
                  accept='image/*,.heic,.heif'
                  capture='environment'
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  data-testid='uat-pin-photo-file'
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='pin-photo-caption'>Caption</Label>
                <Input
                  id='pin-photo-caption'
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder='What the photo shows'
                  maxLength={80}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit || busy}
            data-testid='uat-pin-submit'
          >
            {mode === 'photo' ? (
              <Camera className='mr-2 h-4 w-4' />
            ) : (
              <MapPin className='mr-2 h-4 w-4' />
            )}
            {busy ? 'Saving…' : 'Drop pin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What a pin points at, with a link to the record and removal. */
export function PinDetailDialog({
  projectId,
  pin,
  onOpenChange,
}: {
  projectId: string
  pin: Pin | null
  onOpenChange: (open: boolean) => void
}) {
  const currentUser = useAuthStore((state) => state.auth.user)
  const canManage = useCanPerform('document_control', 'update')
  const deletePin = useDeletePin(projectId)
  if (!pin) return null
  const canRemove =
    canManage || (currentUser?.id && pin.createdBy === currentUser.id)
  return (
    <Dialog
      open
      onOpenChange={(next) => (next ? undefined : onOpenChange(false))}
    >
      <DialogContent data-testid='uat-pin-detail'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            <Badge variant='outline'>{pin.recordLabel}</Badge>
            <span>{pin.record?.display ?? pin.recordId}</span>
          </DialogTitle>
          <DialogDescription>
            {pin.createdByName ? `Pinned by ${pin.createdByName} · ` : ''}
            {new Date(pin.createdAt).toLocaleString()}
            {pin.label ? ` · ${pin.label}` : ''}
          </DialogDescription>
        </DialogHeader>
        {pin.record?.status && (
          <p className='text-sm'>
            Status:{' '}
            <Badge variant='secondary'>
              {pin.record.status.replace(/_/g, ' ')}
            </Badge>
          </p>
        )}
        {pin.recordType === 'photo' && pin.record?.thumbnailUrl && (
          <img
            src={pin.record.thumbnailUrl}
            alt={pin.record.display}
            className='max-h-64 w-auto rounded border object-contain'
          />
        )}
        {!pin.record?.exists && (
          <p className='text-sm text-muted-foreground'>
            The linked record no longer exists.
          </p>
        )}
        <DialogFooter className='gap-2'>
          {canRemove && (
            <Button
              variant='ghost'
              className='text-destructive'
              disabled={deletePin.isPending}
              onClick={() =>
                deletePin.mutate(pin.id, {
                  onSuccess: () => {
                    toast.success('Pin removed')
                    onOpenChange(false)
                  },
                  onError: (error) => toast.error(getServerErrorMessage(error)),
                })
              }
            >
              <Trash2 className='mr-2 h-4 w-4' /> Remove pin
            </Button>
          )}
          {pin.recordType === 'photo' && pin.record?.fileUrl ? (
            <Button asChild>
              <a href={pin.record.fileUrl} target='_blank' rel='noreferrer'>
                <ExternalLink className='mr-2 h-4 w-4' /> Open photo
              </a>
            </Button>
          ) : pin.recordPath && pin.record?.exists ? (
            <Button asChild>
              <Link to={pin.recordPath}>
                <ExternalLink className='mr-2 h-4 w-4' /> Open {pin.recordLabel}
              </Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
