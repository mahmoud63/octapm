import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Archive,
  CheckCircle2,
  ClipboardList,
  History,
  ListChecks,
  MessageSquare,
  Plus,
  Save,
  Send,
  Trash2,
  type LucideIcon,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { Activity } from '@/features/activities/data/schema'
import { useActivities } from '@/features/activities/hooks/use-activities'
import {
  type MeetingActionStatus,
  type MeetingPayload,
  type MeetingPriority,
  type MeetingRecord,
  type MeetingStatus,
  type MeetingType,
} from '../data/schema'
import {
  useAddMeetingComment,
  useArchiveMeeting,
  useCreateMeeting,
  useDistributeMeeting,
  useMeetings,
  useUpdateMeeting,
} from '../hooks/use-meetings'

const NO_VALUE = '__none'

type DraftAttendee = {
  name: string
  email: string
  companyName: string
  role: string
  attendanceStatus: 'invited' | 'attended' | 'absent' | 'apology'
  distributionRequired: boolean
}

type DraftAgendaItem = {
  activityId: string
  title: string
  notes: string
  status: 'open' | 'covered' | 'deferred'
}

type DraftDecision = {
  activityId: string
  title: string
  decision: string
  impact: string
}

type DraftActionItem = {
  activityId: string
  taskId: string
  itemNumber: string
  title: string
  description: string
  ownerName: string
  ownerEmail: string
  dueDate: string
  priority: MeetingPriority
  status: MeetingActionStatus
  createTask: boolean
}

type DraftMeeting = {
  title: string
  meetingType: MeetingType
  status: Exclude<MeetingStatus, 'archived'>
  location: string
  scheduledAt: string
  activityId: string
  objective: string
  minutesText: string
  nextMeetingAt: string
  attendees: DraftAttendee[]
  agendaItems: DraftAgendaItem[]
  decisions: DraftDecision[]
  actionItems: DraftActionItem[]
}

const meetingTypeLabels: Record<MeetingType, string> = {
  coordination: 'Coordination',
  progress: 'Progress',
  commercial: 'Commercial',
  quality: 'Quality',
  safety: 'Safety',
  design: 'Design',
  client: 'Client',
  other: 'Other',
}

const statusLabels: Record<MeetingStatus, string> = {
  draft: 'Draft',
  finalized: 'Finalized',
  distributed: 'Distributed',
  archived: 'Archived',
}

const statusClass: Record<MeetingStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  finalized: 'bg-blue-100 text-blue-700',
  distributed: 'bg-green-100 text-green-700',
  archived: 'bg-zinc-100 text-zinc-700',
}

const priorityClass: Record<MeetingPriority, string> = {
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
}

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  return new Date(value).toLocaleDateString()
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

const toDateInput = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const toDateTimeInput = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 16)
}

const toNullableIso = (value: string) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const defaultDraft = (): DraftMeeting => ({
  title: '',
  meetingType: 'coordination',
  status: 'draft',
  location: '',
  scheduledAt: '',
  activityId: '',
  objective: '',
  minutesText: '',
  nextMeetingAt: '',
  attendees: [
    {
      name: '',
      email: '',
      companyName: '',
      role: 'attendee',
      attendanceStatus: 'invited',
      distributionRequired: true,
    },
  ],
  agendaItems: [
    {
      activityId: '',
      title: '',
      notes: '',
      status: 'open',
    },
  ],
  decisions: [
    {
      activityId: '',
      title: '',
      decision: '',
      impact: '',
    },
  ],
  actionItems: [
    {
      activityId: '',
      taskId: '',
      itemNumber: '',
      title: '',
      description: '',
      ownerName: '',
      ownerEmail: '',
      dueDate: '',
      priority: 'medium',
      status: 'open',
      createTask: true,
    },
  ],
})

const draftFromMeeting = (meeting: MeetingRecord): DraftMeeting => ({
  title: meeting.title,
  meetingType: meeting.meetingType,
  status: meeting.status === 'archived' ? 'draft' : meeting.status,
  location: meeting.location || '',
  scheduledAt: toDateTimeInput(meeting.scheduledAt),
  activityId: meeting.activityId || '',
  objective: meeting.objective || '',
  minutesText: meeting.minutesText || '',
  nextMeetingAt: toDateTimeInput(meeting.nextMeetingAt),
  attendees:
    meeting.attendees.length > 0
      ? meeting.attendees.map((attendee) => ({
          name: attendee.name || attendee.user?.name || '',
          email: attendee.email || attendee.user?.email || '',
          companyName: attendee.companyName || '',
          role: attendee.role || 'attendee',
          attendanceStatus: attendee.attendanceStatus || 'invited',
          distributionRequired: attendee.distributionRequired,
        }))
      : defaultDraft().attendees,
  agendaItems:
    meeting.agendaItems.length > 0
      ? meeting.agendaItems.map((item) => ({
          activityId: item.activityId || '',
          title: item.title,
          notes: item.notes || '',
          status: item.status,
        }))
      : defaultDraft().agendaItems,
  decisions:
    meeting.decisions.length > 0
      ? meeting.decisions.map((decision) => ({
          activityId: decision.activityId || '',
          title: decision.title,
          decision: decision.decision,
          impact: decision.impact || '',
        }))
      : defaultDraft().decisions,
  actionItems:
    meeting.actionItems.length > 0
      ? meeting.actionItems.map((item) => ({
          activityId: item.activityId || '',
          taskId: item.taskId || '',
          itemNumber: item.itemNumber,
          title: item.title,
          description: item.description || '',
          ownerName: item.ownerName || item.owner?.name || '',
          ownerEmail: item.ownerEmail || item.owner?.email || '',
          dueDate: toDateInput(item.dueDate),
          priority: item.priority,
          status: item.status,
          createTask: !item.taskId,
        }))
      : defaultDraft().actionItems,
})

const activityLabel = (activity?: Activity | MeetingRecord['activity']) => {
  if (!activity) return 'Project level'
  const code = 'activityCode' in activity ? activity.activityCode : null
  return [code, activity.name].filter(Boolean).join(' - ')
}

const toPayload = (draft: DraftMeeting): MeetingPayload => ({
  title: draft.title.trim(),
  meetingType: draft.meetingType,
  status: draft.status,
  location: draft.location.trim() || null,
  scheduledAt: toNullableIso(draft.scheduledAt),
  nextMeetingAt: toNullableIso(draft.nextMeetingAt),
  activityId: draft.activityId || null,
  objective: draft.objective.trim() || null,
  minutesText: draft.minutesText.trim() || null,
  attendees: draft.attendees
    .filter((row) => row.name.trim() || row.email.trim())
    .map((row) => ({
      name: row.name.trim() || null,
      email: row.email.trim() || null,
      companyName: row.companyName.trim() || null,
      role: row.role.trim() || 'attendee',
      attendanceStatus: row.attendanceStatus,
      distributionRequired: row.distributionRequired,
    })),
  agendaItems: draft.agendaItems
    .filter((row) => row.title.trim())
    .map((row, index) => ({
      activityId: row.activityId || null,
      sortOrder: index + 1,
      title: row.title.trim(),
      notes: row.notes.trim() || null,
      status: row.status,
    })),
  decisions: draft.decisions
    .filter((row) => row.title.trim() || row.decision.trim())
    .map((row) => ({
      activityId: row.activityId || null,
      title: row.title.trim() || row.decision.trim().slice(0, 80),
      decision: row.decision.trim(),
      impact: row.impact.trim() || null,
      decidedAt: new Date().toISOString(),
    })),
  actionItems: draft.actionItems
    .filter((row) => row.title.trim())
    .map((row, index) => ({
      activityId: row.activityId || null,
      taskId: row.taskId || null,
      itemNumber:
        row.itemNumber.trim() || `AI-${String(index + 1).padStart(3, '0')}`,
      title: row.title.trim(),
      description: row.description.trim() || null,
      ownerName: row.ownerName.trim() || null,
      ownerEmail: row.ownerEmail.trim() || null,
      dueDate: row.dueDate,
      priority: row.priority,
      status: row.status,
      createTask: row.createTask,
    })),
})

function ActivitySelect({
  value,
  activities,
  onChange,
}: {
  value: string
  activities: Activity[]
  onChange: (value: string) => void
}) {
  return (
    <Select
      value={value || NO_VALUE}
      onValueChange={(next) => onChange(next === NO_VALUE ? '' : next)}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_VALUE}>Project level</SelectItem>
        {activities.map((activity) => (
          <SelectItem key={activity.id} value={activity.id}>
            {activityLabel(activity)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function MeetingsDashboard({
  projectId,
  initialTarget,
}: {
  projectId: string
  initialTarget?: { recordId?: string }
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'edit' | 'create'>('view')
  const [draft, setDraft] = useState<DraftMeeting>(defaultDraft)
  const [distributionMessage, setDistributionMessage] = useState('')
  const [manualRecipientName, setManualRecipientName] = useState('')
  const [manualRecipientEmail, setManualRecipientEmail] = useState('')
  const [comment, setComment] = useState('')

  const meetingsQuery = useMeetings(projectId, {
    status,
    search,
    sortBy: 'scheduled',
    sortDir: 'desc',
  })
  const { data: activities = [] } = useActivities(projectId)
  const createMeeting = useCreateMeeting(projectId)
  const updateMeeting = useUpdateMeeting(projectId)
  const distributeMeeting = useDistributeMeeting(projectId)
  const addComment = useAddMeetingComment(projectId)
  const archiveMeeting = useArchiveMeeting(projectId)

  const canCreate = useCanPerform('meeting', 'create')
  const canUpdate = useCanPerform('meeting', 'update')
  const canDistribute = useCanPerform('meeting', 'submit', 'meeting.distribute')
  const canComment = useCanPerform('meeting', 'submit', 'meeting.comment')
  const canArchive = useCanPerform('meeting', 'delete')

  const meetings = meetingsQuery.data?.rows ?? []
  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedId) ?? meetings[0],
    [meetings, selectedId]
  )

  useEffect(() => {
    if (
      initialTarget?.recordId &&
      meetings.some((meeting) => meeting.id === initialTarget.recordId)
    ) {
      setSelectedId(initialTarget.recordId)
      return
    }
    if (!selectedId && meetings[0]) {
      setSelectedId(meetings[0].id)
    }
  }, [initialTarget?.recordId, meetings, selectedId])

  const startCreate = () => {
    setDraft(defaultDraft())
    setMode('create')
    setSelectedId(null)
  }

  const startEdit = (meeting: MeetingRecord) => {
    setDraft(draftFromMeeting(meeting))
    setSelectedId(meeting.id)
    setMode('edit')
  }

  const validateDraft = () => {
    const payload = toPayload(draft)
    if (!payload.title) {
      toast.error('Meeting title is required')
      return false
    }
    const invalidDecision = payload.decisions?.some(
      (decision) => !decision.title || !decision.decision
    )
    if (invalidDecision) {
      toast.error('Decision title and decision text are required')
      return false
    }
    const invalidAction = payload.actionItems?.some(
      (item) => !item.ownerName || !item.dueDate
    )
    if (invalidAction) {
      toast.error('Action items require owner and due date')
      return false
    }
    return true
  }

  const saveMeeting = async () => {
    if (!validateDraft()) return

    try {
      const payload = toPayload(draft)
      if (mode === 'create') {
        const created = await createMeeting.mutateAsync(payload)
        setSelectedId(created.id)
        setMode('view')
        toast.success('Meeting minutes created')
      } else if (selectedMeeting) {
        const updated = await updateMeeting.mutateAsync({
          meetingId: selectedMeeting.id,
          payload,
        })
        setSelectedId(updated.id)
        setMode('view')
        toast.success('Meeting minutes updated')
      }
    } catch (error) {
      toast.error(
        getServerErrorMessage(error, 'Unable to save meeting minutes.')
      )
    }
  }

  const distributeSelected = async () => {
    if (!selectedMeeting) return

    try {
      const recipients =
        manualRecipientEmail.trim() || manualRecipientName.trim()
          ? [
              {
                name: manualRecipientName.trim() || null,
                email: manualRecipientEmail.trim() || null,
              },
            ]
          : []
      await distributeMeeting.mutateAsync({
        meetingId: selectedMeeting.id,
        payload: {
          includeAttendees: true,
          message: distributionMessage.trim() || null,
          recipients,
        },
      })
      setDistributionMessage('')
      setManualRecipientName('')
      setManualRecipientEmail('')
      toast.success('Meeting minutes distributed')
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to distribute minutes.'))
    }
  }

  const submitComment = async () => {
    if (!selectedMeeting || !comment.trim()) return
    try {
      await addComment.mutateAsync({
        meetingId: selectedMeeting.id,
        body: comment.trim(),
      })
      setComment('')
      toast.success('Comment added')
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to add comment.'))
    }
  }

  const archiveSelected = async () => {
    if (!selectedMeeting) return
    try {
      await archiveMeeting.mutateAsync(selectedMeeting.id)
      setSelectedId(null)
      setMode('view')
      toast.success('Meeting archived')
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to archive meeting.'))
    }
  }

  const updateAttendee = (index: number, patch: Partial<DraftAttendee>) => {
    setDraft((current) => ({
      ...current,
      attendees: current.attendees.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    }))
  }

  const updateAgendaItem = (index: number, patch: Partial<DraftAgendaItem>) => {
    setDraft((current) => ({
      ...current,
      agendaItems: current.agendaItems.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    }))
  }

  const updateDecision = (index: number, patch: Partial<DraftDecision>) => {
    setDraft((current) => ({
      ...current,
      decisions: current.decisions.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    }))
  }

  const updateActionItem = (index: number, patch: Partial<DraftActionItem>) => {
    setDraft((current) => ({
      ...current,
      actionItems: current.actionItems.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    }))
  }

  const removeDraftRow = (
    key: 'attendees' | 'agendaItems' | 'decisions' | 'actionItems',
    index: number
  ) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].filter((_, rowIndex) => rowIndex !== index),
    }))
  }

  const addDraftRow = (
    key: 'attendees' | 'agendaItems' | 'decisions' | 'actionItems'
  ) => {
    const defaults = defaultDraft()
    setDraft((current) => ({
      ...current,
      [key]: [...current[key], defaults[key][0]],
    }))
  }

  const isEditing = mode === 'create' || mode === 'edit'
  const isSaving = createMeeting.isPending || updateMeeting.isPending

  return (
    <div className='space-y-4' data-testid='uat-meetings-dashboard'>
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <div className='rounded-md border px-4 py-3'>
          <p className='text-sm text-muted-foreground'>Meetings</p>
          <p className='text-2xl font-semibold'>
            {meetingsQuery.data?.summary.total ?? 0}
          </p>
        </div>
        <div className='rounded-md border px-4 py-3'>
          <p className='text-sm text-muted-foreground'>Draft</p>
          <p className='text-2xl font-semibold'>
            {meetingsQuery.data?.summary.draft ?? 0}
          </p>
        </div>
        <div className='rounded-md border px-4 py-3'>
          <p className='text-sm text-muted-foreground'>Distributed</p>
          <p className='text-2xl font-semibold text-green-700'>
            {meetingsQuery.data?.summary.distributed ?? 0}
          </p>
        </div>
        <div className='rounded-md border px-4 py-3'>
          <p className='text-sm text-muted-foreground'>Open Actions</p>
          <p className='text-2xl font-semibold text-amber-700'>
            {meetingsQuery.data?.summary.openActionItems ?? 0}
          </p>
        </div>
      </div>

      <div className='grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]'>
        <aside className='space-y-3 rounded-md border p-3'>
          <div className='flex items-center justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <ClipboardList className='size-4 text-muted-foreground' />
              <h3 className='text-sm font-semibold'>Minutes Register</h3>
            </div>
            {canCreate && (
              <Button size='sm' type='button' onClick={startCreate}>
                <Plus className='size-4' />
                New
              </Button>
            )}
          </div>
          <div className='grid gap-2'>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Search minutes'
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All statuses</SelectItem>
                <SelectItem value='draft'>Draft</SelectItem>
                <SelectItem value='finalized'>Finalized</SelectItem>
                <SelectItem value='distributed'>Distributed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            {meetingsQuery.isLoading ? (
              <>
                <Skeleton className='h-20 w-full' />
                <Skeleton className='h-20 w-full' />
              </>
            ) : meetings.length ? (
              meetings.map((meeting) => (
                <button
                  key={meeting.id}
                  type='button'
                  id={`uat-record-row-${meeting.id}`}
                  data-testid={`uat-record-row-${meeting.id}`}
                  data-selected={
                    selectedMeeting?.id === meeting.id ? 'true' : 'false'
                  }
                  onClick={() => {
                    setSelectedId(meeting.id)
                    setMode('view')
                  }}
                  className={[
                    'w-full rounded-md border px-3 py-2 text-left transition-colors',
                    selectedMeeting?.id === meeting.id && mode !== 'create'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50',
                  ].join(' ')}
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium'>
                        {meeting.meetingNumber}
                      </p>
                      <p className='line-clamp-2 text-sm text-muted-foreground'>
                        {meeting.title}
                      </p>
                    </div>
                    <Badge className={statusClass[meeting.status]}>
                      {statusLabels[meeting.status]}
                    </Badge>
                  </div>
                  <div className='mt-2 flex items-center gap-3 text-xs text-muted-foreground'>
                    <span>{meetingTypeLabels[meeting.meetingType]}</span>
                    <span>{formatDate(meeting.scheduledAt)}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
                No meeting minutes found.
              </div>
            )}
          </div>
        </aside>

        <section className='min-w-0 rounded-md border p-4'>
          {isEditing ? (
            <div className='space-y-5'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div>
                  <h3 className='text-lg font-semibold'>
                    {mode === 'create' ? 'New Meeting Minutes' : 'Edit Minutes'}
                  </h3>
                  <p className='text-sm text-muted-foreground'>
                    {selectedMeeting?.meetingNumber || 'Draft record'}
                  </p>
                </div>
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => setMode('view')}
                  >
                    Cancel
                  </Button>
                  <Button
                    type='button'
                    disabled={isSaving}
                    onClick={saveMeeting}
                  >
                    <Save className='size-4' />
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>

              <div className='grid gap-3 lg:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label htmlFor='meeting-title'>Title</Label>
                  <Input
                    id='meeting-title'
                    value={draft.title}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className='grid gap-1.5'>
                  <Label>Type</Label>
                  <Select
                    value={draft.meetingType}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        meetingType: value as MeetingType,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(meetingTypeLabels).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='meeting-scheduled'>Scheduled</Label>
                  <Input
                    id='meeting-scheduled'
                    type='datetime-local'
                    value={draft.scheduledAt}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        scheduledAt: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='meeting-location'>Location</Label>
                  <Input
                    id='meeting-location'
                    value={draft.location}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        location: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className='grid gap-1.5'>
                  <Label>Activity</Label>
                  <ActivitySelect
                    value={draft.activityId}
                    activities={activities}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, activityId: value }))
                    }
                  />
                </div>
                <div className='grid gap-1.5'>
                  <Label>Status</Label>
                  <Select
                    value={draft.status}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        status: value as DraftMeeting['status'],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='draft'>Draft</SelectItem>
                      <SelectItem value='finalized'>Finalized</SelectItem>
                      <SelectItem value='distributed'>Distributed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className='grid gap-3 lg:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label htmlFor='meeting-objective'>Objective</Label>
                  <Textarea
                    id='meeting-objective'
                    value={draft.objective}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        objective: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='meeting-minutes'>Minutes</Label>
                  <Textarea
                    id='meeting-minutes'
                    className='min-h-28'
                    value={draft.minutesText}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        minutesText: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className='space-y-3'>
                <SectionHeading
                  icon={Users}
                  title='Attendees'
                  onAdd={() => addDraftRow('attendees')}
                />
                <div className='space-y-2'>
                  {draft.attendees.map((attendee, index) => (
                    <div
                      key={index}
                      className='grid gap-2 rounded-md border p-3 lg:grid-cols-[1fr_1fr_1fr_120px_44px]'
                    >
                      <Input
                        value={attendee.name}
                        placeholder='Name'
                        onChange={(event) =>
                          updateAttendee(index, { name: event.target.value })
                        }
                      />
                      <Input
                        value={attendee.email}
                        placeholder='Email'
                        onChange={(event) =>
                          updateAttendee(index, { email: event.target.value })
                        }
                      />
                      <Input
                        value={attendee.companyName}
                        placeholder='Company'
                        onChange={(event) =>
                          updateAttendee(index, {
                            companyName: event.target.value,
                          })
                        }
                      />
                      <Select
                        value={attendee.attendanceStatus}
                        onValueChange={(value) =>
                          updateAttendee(index, {
                            attendanceStatus:
                              value as DraftAttendee['attendanceStatus'],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='invited'>Invited</SelectItem>
                          <SelectItem value='attended'>Attended</SelectItem>
                          <SelectItem value='absent'>Absent</SelectItem>
                          <SelectItem value='apology'>Apology</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        onClick={() => removeDraftRow('attendees', index)}
                      >
                        <Trash2 className='size-4' />
                        <span className='sr-only'>Remove attendee</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className='space-y-3'>
                <SectionHeading
                  icon={ClipboardList}
                  title='Agenda'
                  onAdd={() => addDraftRow('agendaItems')}
                />
                <div className='space-y-2'>
                  {draft.agendaItems.map((item, index) => (
                    <div
                      key={index}
                      className='grid gap-2 rounded-md border p-3 lg:grid-cols-[minmax(180px,1fr)_220px_44px]'
                    >
                      <Input
                        value={item.title}
                        placeholder='Agenda item'
                        onChange={(event) =>
                          updateAgendaItem(index, { title: event.target.value })
                        }
                      />
                      <ActivitySelect
                        value={item.activityId}
                        activities={activities}
                        onChange={(value) =>
                          updateAgendaItem(index, { activityId: value })
                        }
                      />
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        onClick={() => removeDraftRow('agendaItems', index)}
                      >
                        <Trash2 className='size-4' />
                        <span className='sr-only'>Remove agenda item</span>
                      </Button>
                      <Textarea
                        className='lg:col-span-3'
                        value={item.notes}
                        placeholder='Notes'
                        onChange={(event) =>
                          updateAgendaItem(index, { notes: event.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className='space-y-3'>
                <SectionHeading
                  icon={CheckCircle2}
                  title='Decisions'
                  onAdd={() => addDraftRow('decisions')}
                />
                <div className='space-y-2'>
                  {draft.decisions.map((decision, index) => (
                    <div
                      key={index}
                      className='grid gap-2 rounded-md border p-3 lg:grid-cols-[minmax(180px,1fr)_220px_44px]'
                    >
                      <Input
                        value={decision.title}
                        placeholder='Decision title'
                        onChange={(event) =>
                          updateDecision(index, { title: event.target.value })
                        }
                      />
                      <ActivitySelect
                        value={decision.activityId}
                        activities={activities}
                        onChange={(value) =>
                          updateDecision(index, { activityId: value })
                        }
                      />
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        onClick={() => removeDraftRow('decisions', index)}
                      >
                        <Trash2 className='size-4' />
                        <span className='sr-only'>Remove decision</span>
                      </Button>
                      <Textarea
                        className='lg:col-span-3'
                        value={decision.decision}
                        placeholder='Decision'
                        onChange={(event) =>
                          updateDecision(index, {
                            decision: event.target.value,
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className='space-y-3'>
                <SectionHeading
                  icon={ListChecks}
                  title='Action Items'
                  onAdd={() => addDraftRow('actionItems')}
                />
                <div className='space-y-2'>
                  {draft.actionItems.map((item, index) => (
                    <div
                      key={index}
                      className='grid gap-2 rounded-md border p-3 xl:grid-cols-[minmax(180px,1.4fr)_160px_150px_130px_220px_44px]'
                    >
                      <Input
                        value={item.title}
                        placeholder='Action item'
                        onChange={(event) =>
                          updateActionItem(index, { title: event.target.value })
                        }
                      />
                      <Input
                        value={item.ownerName}
                        placeholder='Owner'
                        onChange={(event) =>
                          updateActionItem(index, {
                            ownerName: event.target.value,
                          })
                        }
                      />
                      <Input
                        type='date'
                        value={item.dueDate}
                        onChange={(event) =>
                          updateActionItem(index, {
                            dueDate: event.target.value,
                          })
                        }
                      />
                      <Select
                        value={item.priority}
                        onValueChange={(value) =>
                          updateActionItem(index, {
                            priority: value as MeetingPriority,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='low'>Low</SelectItem>
                          <SelectItem value='medium'>Medium</SelectItem>
                          <SelectItem value='high'>High</SelectItem>
                          <SelectItem value='critical'>Critical</SelectItem>
                        </SelectContent>
                      </Select>
                      <ActivitySelect
                        value={item.activityId}
                        activities={activities}
                        onChange={(value) =>
                          updateActionItem(index, { activityId: value })
                        }
                      />
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        onClick={() => removeDraftRow('actionItems', index)}
                      >
                        <Trash2 className='size-4' />
                        <span className='sr-only'>Remove action item</span>
                      </Button>
                      <Textarea
                        className='xl:col-span-6'
                        value={item.description}
                        placeholder='Description'
                        onChange={(event) =>
                          updateActionItem(index, {
                            description: event.target.value,
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : selectedMeeting ? (
            <div className='space-y-5'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h3 className='text-xl font-semibold'>
                      {selectedMeeting.meetingNumber}
                    </h3>
                    <Badge className={statusClass[selectedMeeting.status]}>
                      {statusLabels[selectedMeeting.status]}
                    </Badge>
                  </div>
                  <p className='mt-1 text-lg font-medium'>
                    {selectedMeeting.title}
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    {meetingTypeLabels[selectedMeeting.meetingType]} |{' '}
                    {formatDateTime(selectedMeeting.scheduledAt)} |{' '}
                    {selectedMeeting.location || 'No location'}
                  </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  {canUpdate && (
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => startEdit(selectedMeeting)}
                    >
                      <ClipboardList className='size-4' />
                      Edit
                    </Button>
                  )}
                  {canDistribute && (
                    <Button
                      type='button'
                      disabled={distributeMeeting.isPending}
                      onClick={distributeSelected}
                    >
                      <Send className='size-4' />
                      {distributeMeeting.isPending
                        ? 'Sending...'
                        : 'Distribute'}
                    </Button>
                  )}
                  {canArchive && (
                    <Button
                      type='button'
                      variant='ghost'
                      disabled={archiveMeeting.isPending}
                      onClick={archiveSelected}
                    >
                      <Archive className='size-4' />
                      Archive
                    </Button>
                  )}
                </div>
              </div>

              <div className='grid gap-3 lg:grid-cols-3'>
                <DetailMetric
                  icon={Users}
                  label='Attendees'
                  value={selectedMeeting.attendeeCount}
                />
                <DetailMetric
                  icon={CheckCircle2}
                  label='Decisions'
                  value={selectedMeeting.decisionCount}
                />
                <DetailMetric
                  icon={ListChecks}
                  label='Open actions'
                  value={selectedMeeting.openActionItemCount}
                />
              </div>

              <div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]'>
                <div className='space-y-4'>
                  <section className='rounded-md border p-4'>
                    <h4 className='mb-2 text-sm font-semibold'>Minutes</h4>
                    <p className='text-sm whitespace-pre-wrap text-muted-foreground'>
                      {selectedMeeting.minutesText || 'No minutes recorded.'}
                    </p>
                  </section>

                  <RecordSection
                    title='Agenda'
                    empty='No agenda items recorded.'
                    rows={selectedMeeting.agendaItems}
                    render={(item) => (
                      <div key={item.id} className='rounded-md border p-3'>
                        <div className='flex items-start justify-between gap-2'>
                          <p className='font-medium'>{item.title}</p>
                          <Badge variant='outline'>{item.status}</Badge>
                        </div>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {activityLabel(item.activity)}
                        </p>
                        {item.notes && (
                          <p className='mt-2 text-sm text-muted-foreground'>
                            {item.notes}
                          </p>
                        )}
                      </div>
                    )}
                  />

                  <RecordSection
                    title='Decisions'
                    empty='No decisions recorded.'
                    rows={selectedMeeting.decisions}
                    render={(decision) => (
                      <div key={decision.id} className='rounded-md border p-3'>
                        <div className='flex items-start justify-between gap-2'>
                          <p className='font-medium'>{decision.title}</p>
                          <span className='text-xs text-muted-foreground'>
                            {formatDate(decision.decidedAt)}
                          </span>
                        </div>
                        <p className='mt-2 text-sm'>{decision.decision}</p>
                        {decision.impact && (
                          <p className='mt-2 text-sm text-muted-foreground'>
                            {decision.impact}
                          </p>
                        )}
                      </div>
                    )}
                  />

                  <RecordSection
                    title='Action Items'
                    empty='No action items recorded.'
                    rows={selectedMeeting.actionItems}
                    render={(item) => (
                      <div key={item.id} className='rounded-md border p-3'>
                        <div className='flex flex-wrap items-start justify-between gap-2'>
                          <div>
                            <p className='font-medium'>{item.title}</p>
                            <p className='text-xs text-muted-foreground'>
                              {item.itemNumber} | Owner:{' '}
                              {item.ownerName || item.owner?.name || '-'} | Due:{' '}
                              {formatDate(item.dueDate)}
                            </p>
                          </div>
                          <div className='flex gap-2'>
                            <Badge className={priorityClass[item.priority]}>
                              {item.priority}
                            </Badge>
                            {item.task && (
                              <Badge variant='outline'>
                                {item.task.taskNumber}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {item.description && (
                          <p className='mt-2 text-sm text-muted-foreground'>
                            {item.description}
                          </p>
                        )}
                      </div>
                    )}
                  />
                </div>

                <aside className='space-y-4'>
                  <section className='rounded-md border p-4'>
                    <div className='mb-3 flex items-center gap-2'>
                      <Send className='size-4 text-muted-foreground' />
                      <h4 className='text-sm font-semibold'>Distribution</h4>
                    </div>
                    <div className='space-y-2'>
                      <Textarea
                        value={distributionMessage}
                        onChange={(event) =>
                          setDistributionMessage(event.target.value)
                        }
                        placeholder='Distribution note'
                      />
                      <Input
                        value={manualRecipientName}
                        onChange={(event) =>
                          setManualRecipientName(event.target.value)
                        }
                        placeholder='Recipient name'
                      />
                      <Input
                        value={manualRecipientEmail}
                        onChange={(event) =>
                          setManualRecipientEmail(event.target.value)
                        }
                        placeholder='Recipient email'
                      />
                    </div>
                    <div className='mt-3 space-y-2'>
                      {selectedMeeting.distributions.length ? (
                        selectedMeeting.distributions.map((row) => (
                          <div
                            key={row.id}
                            className='rounded-md border bg-muted/20 p-2 text-sm'
                          >
                            <p className='font-medium'>
                              {row.recipientName ||
                                row.recipientUser?.name ||
                                row.recipientEmail}
                            </p>
                            <p className='text-xs text-muted-foreground'>
                              {formatDateTime(row.sentAt)} | {row.status}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className='text-sm text-muted-foreground'>
                          No distribution history.
                        </p>
                      )}
                    </div>
                  </section>

                  <section className='rounded-md border p-4'>
                    <div className='mb-3 flex items-center gap-2'>
                      <MessageSquare className='size-4 text-muted-foreground' />
                      <h4 className='text-sm font-semibold'>Comments</h4>
                    </div>
                    <div className='space-y-2'>
                      {selectedMeeting.comments.map((row) => (
                        <div key={row.id} className='rounded-md border p-2'>
                          <p className='text-sm'>{row.body}</p>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            {row.author?.name || 'User'} |{' '}
                            {formatDateTime(row.createdAt)}
                          </p>
                        </div>
                      ))}
                      {!selectedMeeting.comments.length && (
                        <p className='text-sm text-muted-foreground'>
                          No comments.
                        </p>
                      )}
                      {canComment && (
                        <div className='space-y-2 pt-2'>
                          <Textarea
                            value={comment}
                            onChange={(event) => setComment(event.target.value)}
                            placeholder='Comment'
                          />
                          <Button
                            type='button'
                            size='sm'
                            disabled={addComment.isPending || !comment.trim()}
                            onClick={submitComment}
                          >
                            <MessageSquare className='size-4' />
                            Add
                          </Button>
                        </div>
                      )}
                    </div>
                  </section>
                </aside>
              </div>
            </div>
          ) : (
            <div className='flex min-h-80 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground'>
              <History className='size-8' />
              <span>No meeting selected.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function SectionHeading({
  icon: Icon,
  title,
  onAdd,
}: {
  icon: LucideIcon
  title: string
  onAdd: () => void
}) {
  return (
    <div className='flex items-center justify-between gap-2'>
      <div className='flex items-center gap-2'>
        <Icon className='size-4 text-muted-foreground' />
        <h4 className='text-sm font-semibold'>{title}</h4>
      </div>
      <Button type='button' size='sm' variant='outline' onClick={onAdd}>
        <Plus className='size-4' />
        Add
      </Button>
    </div>
  )
}

function DetailMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: number
}) {
  return (
    <div className='flex items-center gap-3 rounded-md border px-4 py-3'>
      <Icon className='size-4 text-muted-foreground' />
      <div>
        <p className='text-sm text-muted-foreground'>{label}</p>
        <p className='text-xl font-semibold'>{value}</p>
      </div>
    </div>
  )
}

function RecordSection<T>({
  title,
  empty,
  rows,
  render,
}: {
  title: string
  empty: string
  rows: T[]
  render: (row: T) => ReactNode
}) {
  return (
    <section className='space-y-2 rounded-md border p-4'>
      <h4 className='text-sm font-semibold'>{title}</h4>
      {rows.length ? (
        <div className='space-y-2'>{rows.map(render)}</div>
      ) : (
        <p className='text-sm text-muted-foreground'>{empty}</p>
      )}
    </section>
  )
}
