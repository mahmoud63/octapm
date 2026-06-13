export type MeetingStatus = 'draft' | 'finalized' | 'distributed' | 'archived'
export type MeetingType =
  | 'coordination'
  | 'progress'
  | 'commercial'
  | 'quality'
  | 'safety'
  | 'design'
  | 'client'
  | 'other'

export type MeetingActionStatus = 'open' | 'in_progress' | 'closed' | 'canceled'

export type MeetingPriority = 'low' | 'medium' | 'high' | 'critical'

export type MeetingUser = {
  id: string
  name: string
  email: string
  role: string
}

export type MeetingActivity = {
  id: string
  name: string
  activityCode?: string | null
  p6ActivityId?: string | null
  wbsCode?: string | null
}

export type MeetingAttendee = {
  id: string
  meetingId: string
  activityId?: string | null
  activity?: MeetingActivity | null
  userId?: string | null
  user?: MeetingUser | null
  projectPartyId?: string | null
  name?: string | null
  email?: string | null
  companyName?: string | null
  role: string
  attendanceStatus: 'invited' | 'attended' | 'absent' | 'apology'
  distributionRequired: boolean
  attendedAt?: string | null
}

export type MeetingAgendaItem = {
  id: string
  meetingId: string
  activityId?: string | null
  activity?: MeetingActivity | null
  sortOrder: number
  title: string
  notes?: string | null
  status: 'open' | 'covered' | 'deferred'
}

export type MeetingDecision = {
  id: string
  meetingId: string
  activityId?: string | null
  activity?: MeetingActivity | null
  decidedById?: string | null
  decidedBy?: MeetingUser | null
  title: string
  decision: string
  impact?: string | null
  decidedAt: string
}

export type MeetingActionItem = {
  id: string
  meetingId: string
  activityId?: string | null
  activity?: MeetingActivity | null
  taskId?: string | null
  task?: {
    id: string
    taskNumber: string
    title: string
    status: string
    dueDate?: string | null
    assigneeId?: string | null
  } | null
  itemNumber: string
  title: string
  description?: string | null
  ownerId?: string | null
  owner?: MeetingUser | null
  ownerName?: string | null
  ownerEmail?: string | null
  dueDate: string
  priority: MeetingPriority
  status: MeetingActionStatus
}

export type MeetingDistribution = {
  id: string
  meetingId: string
  recipientUserId?: string | null
  recipientUser?: MeetingUser | null
  projectPartyId?: string | null
  recipientName?: string | null
  recipientEmail?: string | null
  companyName?: string | null
  channel: string
  status: string
  message?: string | null
  sentBy?: MeetingUser | null
  sentAt: string
}

export type MeetingComment = {
  id: string
  meetingId: string
  author?: MeetingUser | null
  body: string
  createdAt: string
}

export type MeetingRecord = {
  id: string
  orgId: string
  projectId: string
  activityId?: string | null
  activity?: MeetingActivity | null
  meetingNumber: string
  title: string
  meetingType: MeetingType
  location?: string | null
  scheduledAt?: string | null
  startedAt?: string | null
  endedAt?: string | null
  status: MeetingStatus
  objective?: string | null
  minutesText?: string | null
  nextMeetingAt?: string | null
  chairId?: string | null
  chair?: MeetingUser | null
  distributedAt?: string | null
  distributedBy?: MeetingUser | null
  attendees: MeetingAttendee[]
  agendaItems: MeetingAgendaItem[]
  decisions: MeetingDecision[]
  actionItems: MeetingActionItem[]
  distributions: MeetingDistribution[]
  comments: MeetingComment[]
  attendeeCount: number
  decisionCount: number
  actionItemCount: number
  openActionItemCount: number
  distributionCount: number
  createdAt: string
  updatedAt: string
}

export type MeetingPayload = {
  activityId?: string | null
  chairId?: string | null
  title: string
  meetingType?: MeetingType
  status?: Exclude<MeetingStatus, 'archived'>
  location?: string | null
  scheduledAt?: string | null
  startedAt?: string | null
  endedAt?: string | null
  objective?: string | null
  minutesText?: string | null
  nextMeetingAt?: string | null
  attendees?: Array<{
    activityId?: string | null
    name?: string | null
    email?: string | null
    companyName?: string | null
    role?: string
    attendanceStatus?: MeetingAttendee['attendanceStatus']
    distributionRequired?: boolean
  }>
  agendaItems?: Array<{
    activityId?: string | null
    sortOrder?: number
    title: string
    notes?: string | null
    status?: MeetingAgendaItem['status']
  }>
  decisions?: Array<{
    activityId?: string | null
    title: string
    decision: string
    impact?: string | null
    decidedAt?: string | null
  }>
  actionItems?: Array<{
    activityId?: string | null
    taskId?: string | null
    itemNumber?: string | null
    title: string
    description?: string | null
    ownerName?: string | null
    ownerEmail?: string | null
    dueDate: string
    priority?: MeetingPriority
    status?: MeetingActionStatus
    createTask?: boolean
  }>
}
