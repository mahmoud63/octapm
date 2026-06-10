import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import { WorkflowRecordList } from '@/features/workflows/components/workflow-record-list'
import { handleServerError } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import {
  type RfiListQuery,
  type SubmittalListQuery,
  useCorrespondence,
  useCreateCorrespondence,
  useCreateDrawing,
  useCreateRfi,
  useCreateSubmittal,
  useCreateTransmittal,
  useDocControlDashboard,
  useDrawings,
  useRfis,
  useSubmittals,
  useTransmittals,
} from '../hooks/use-doc-control'

export function DocControlDashboard({
  projectId,
  activeTab,
  onTabChange,
  showTabList = true,
}: {
  projectId: string
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
}) {
  const [rfiSubject, setRfiSubject] = useState('')
  const [rfiSearch, setRfiSearch] = useState('')
  const [rfiStatus, setRfiStatus] = useState<RfiListQuery['status']>('all')
  const [rfiPriority, setRfiPriority] =
    useState<RfiListQuery['priority']>('all')
  const [rfiSortBy, setRfiSortBy] = useState<RfiListQuery['sortBy']>('created')
  const [rfiSortDir, setRfiSortDir] = useState<RfiListQuery['sortDir']>('desc')
  const [rfiCursor, setRfiCursor] = useState<string | null>(null)

  const [submittalTitle, setSubmittalTitle] = useState('')
  const [submittalSearch, setSubmittalSearch] = useState('')
  const [submittalStatus, setSubmittalStatus] =
    useState<SubmittalListQuery['status']>('all')
  const [submittalSortBy, setSubmittalSortBy] =
    useState<SubmittalListQuery['sortBy']>('created')
  const [submittalSortDir, setSubmittalSortDir] =
    useState<SubmittalListQuery['sortDir']>('desc')
  const [submittalCursor, setSubmittalCursor] = useState<string | null>(null)

  const [drawingNumber, setDrawingNumber] = useState('')
  const [drawingTitle, setDrawingTitle] = useState('')
  const [transmittalSubject, setTransmittalSubject] = useState('')
  const [correspondenceSubject, setCorrespondenceSubject] = useState('')

  const rfiQuery = useMemo<RfiListQuery>(
    () => ({
      limit: 25,
      cursor: rfiCursor,
      search: rfiSearch,
      status: rfiStatus,
      priority: rfiPriority,
      sortBy: rfiSortBy,
      sortDir: rfiSortDir,
    }),
    [rfiCursor, rfiPriority, rfiSearch, rfiSortBy, rfiSortDir, rfiStatus]
  )
  const submittalQuery = useMemo<SubmittalListQuery>(
    () => ({
      limit: 25,
      cursor: submittalCursor,
      search: submittalSearch,
      status: submittalStatus,
      sortBy: submittalSortBy,
      sortDir: submittalSortDir,
    }),
    [
      submittalCursor,
      submittalSearch,
      submittalSortBy,
      submittalSortDir,
      submittalStatus,
    ]
  )

  const { data: dashboard } = useDocControlDashboard(projectId)
  const { data: rfis } = useRfis(projectId, rfiQuery)
  const { data: submittals } = useSubmittals(projectId, submittalQuery)
  const { data: drawings } = useDrawings(projectId)
  const { data: transmittals } = useTransmittals(projectId)
  const { data: correspondence } = useCorrespondence(projectId)

  const createRfi = useCreateRfi(projectId)
  const createSubmittal = useCreateSubmittal(projectId)
  const createDrawing = useCreateDrawing(projectId)
  const createTransmittal = useCreateTransmittal(projectId)
  const createCorrespondence = useCreateCorrespondence(projectId)
  const canCreateRfi = useCanPerform('rfi', 'create')
  const canCreateSubmittal = useCanPerform('submittal', 'create')

  const metrics = dashboard?.metrics

  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'rfi' }

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-6'>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Open RFI</p>
          <p className='text-2xl font-bold'>{metrics?.rfiOpen ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Overdue RFI</p>
          <p className='text-2xl font-bold'>{metrics?.rfiOverdue ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Pending Submittal</p>
          <p className='text-2xl font-bold'>{metrics?.submittalPending ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Pending Ack</p>
          <p className='text-2xl font-bold'>
            {metrics?.transmittalPendingAck ?? 0}
          </p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Notices</p>
          <p className='text-2xl font-bold'>
            {metrics?.contractualNotices ?? 0}
          </p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Due Alerts</p>
          <p className='text-2xl font-bold'>{metrics?.dueAlerts ?? 0}</p>
        </div>
      </div>

      <Tabs {...tabsProps} className='space-y-3'>
        {showTabList && (
          <TabsList className='flex-wrap'>
            <TabsTrigger value='rfi'>RFI</TabsTrigger>
            <TabsTrigger value='submittals'>Submittals</TabsTrigger>
            <TabsTrigger value='drawings'>Drawings</TabsTrigger>
            <TabsTrigger value='transmittals'>Transmittals</TabsTrigger>
            <TabsTrigger value='correspondence'>Correspondence</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='rfi' className='space-y-2'>
          {canCreateRfi && (
            <div className='flex gap-2'>
              <Input
                placeholder='RFI subject'
                value={rfiSubject}
                onChange={(e) => setRfiSubject(e.target.value)}
              />
              <Button
                disabled={createRfi.isPending || !rfiSubject}
                onClick={async () => {
                  try {
                    await createRfi.mutateAsync({ subject: rfiSubject })
                    setRfiSubject('')
                    toast.success('RFI created')
                  } catch (error) {
                    handleServerError(error)
                  }
                }}
              >
                Add
              </Button>
            </div>
          )}
          <div className='grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_repeat(4,max-content)]'>
            <Input
              placeholder='Search RFI'
              value={rfiSearch}
              onChange={(e) => {
                setRfiCursor(null)
                setRfiSearch(e.target.value)
              }}
            />
            <Select
              value={rfiStatus}
              onValueChange={(value) => {
                setRfiCursor(null)
                setRfiStatus(value as RfiListQuery['status'])
              }}
            >
              <SelectTrigger className='w-full md:w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All status</SelectItem>
                <SelectItem value='open'>Open</SelectItem>
                <SelectItem value='answered'>Answered</SelectItem>
                <SelectItem value='closed'>Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={rfiPriority}
              onValueChange={(value) => {
                setRfiCursor(null)
                setRfiPriority(value as RfiListQuery['priority'])
              }}
            >
              <SelectTrigger className='w-full md:w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All priority</SelectItem>
                <SelectItem value='low'>Low</SelectItem>
                <SelectItem value='normal'>Normal</SelectItem>
                <SelectItem value='high'>High</SelectItem>
                <SelectItem value='urgent'>Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={rfiSortBy}
              onValueChange={(value) => {
                setRfiCursor(null)
                setRfiSortBy(value as RfiListQuery['sortBy'])
              }}
            >
              <SelectTrigger className='w-full md:w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='created'>Created</SelectItem>
                <SelectItem value='dueDate'>Due date</SelectItem>
                <SelectItem value='priority'>Priority</SelectItem>
                <SelectItem value='status'>Status</SelectItem>
                <SelectItem value='ref'>Reference</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={rfiSortDir}
              onValueChange={(value) => {
                setRfiCursor(null)
                setRfiSortDir(value as RfiListQuery['sortDir'])
              }}
            >
              <SelectTrigger className='w-full md:w-28'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='desc'>Desc</SelectItem>
                <SelectItem value='asc'>Asc</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <WorkflowRecordList
            rows={rfis?.rows}
            emptyText='No RFI records'
            getRef={(row) => row.ref}
            getTitle={(row) => row.subject}
            getSubtitle={(row) => row.question || row.response}
            getStatus={(row) => row.status}
            renderMeta={(row) => (
              <div className='flex flex-wrap gap-2'>
                <Badge variant={row.priority === 'urgent' ? 'destructive' : 'outline'}>
                  {row.priority}
                </Badge>
              </div>
            )}
          />
          <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
            <span>{rfis?.rows?.length ?? 0} RFI records</span>
            <div className='flex gap-2'>
              {rfiCursor && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setRfiCursor(null)}
                >
                  First page
                </Button>
              )}
              <Button
                size='sm'
                variant='outline'
                disabled={!rfis?.pagination?.nextCursor}
                onClick={() => setRfiCursor(rfis?.pagination?.nextCursor ?? null)}
              >
                Next page
              </Button>
            </div>
          </div>
          <AuditHistoryPanel
            projectId={projectId}
            entityType='rfi'
            title='RFI Audit History'
            limit={8}
          />
        </TabsContent>

        <TabsContent value='submittals' className='space-y-2'>
          {canCreateSubmittal && (
            <div className='flex gap-2'>
              <Input
                placeholder='Submittal title'
                value={submittalTitle}
                onChange={(e) => setSubmittalTitle(e.target.value)}
              />
              <Button
                disabled={createSubmittal.isPending || !submittalTitle}
                onClick={async () => {
                  try {
                    await createSubmittal.mutateAsync({ title: submittalTitle })
                    setSubmittalTitle('')
                    toast.success('Submittal created')
                  } catch (error) {
                    handleServerError(error)
                  }
                }}
              >
                Add
              </Button>
            </div>
          )}
          <div className='grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_repeat(3,max-content)]'>
            <Input
              placeholder='Search submittals'
              value={submittalSearch}
              onChange={(e) => {
                setSubmittalCursor(null)
                setSubmittalSearch(e.target.value)
              }}
            />
            <Select
              value={submittalStatus}
              onValueChange={(value) => {
                setSubmittalCursor(null)
                setSubmittalStatus(value as SubmittalListQuery['status'])
              }}
            >
              <SelectTrigger className='w-full md:w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All status</SelectItem>
                <SelectItem value='pending'>Pending</SelectItem>
                <SelectItem value='under_review'>Under review</SelectItem>
                <SelectItem value='approved'>Approved</SelectItem>
                <SelectItem value='resubmit'>Resubmit</SelectItem>
                <SelectItem value='rejected'>Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={submittalSortBy}
              onValueChange={(value) => {
                setSubmittalCursor(null)
                setSubmittalSortBy(value as SubmittalListQuery['sortBy'])
              }}
            >
              <SelectTrigger className='w-full md:w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='created'>Created</SelectItem>
                <SelectItem value='dueDate'>Due date</SelectItem>
                <SelectItem value='submittedOn'>Submitted</SelectItem>
                <SelectItem value='status'>Status</SelectItem>
                <SelectItem value='title'>Title</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={submittalSortDir}
              onValueChange={(value) => {
                setSubmittalCursor(null)
                setSubmittalSortDir(value as SubmittalListQuery['sortDir'])
              }}
            >
              <SelectTrigger className='w-full md:w-28'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='desc'>Desc</SelectItem>
                <SelectItem value='asc'>Asc</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <WorkflowRecordList
            rows={submittals?.rows}
            emptyText='No submittals'
            getRef={(row) => row.ref}
            getTitle={(row) => row.title}
            getSubtitle={(row) => row.remarks}
            getStatus={(row) => row.status}
            renderMeta={(row) => (
              <div className='flex flex-wrap gap-2'>
                <Badge variant='outline'>Rev {row.revision}</Badge>
              </div>
            )}
          />
          <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
            <span>{submittals?.rows?.length ?? 0} submittals</span>
            <div className='flex gap-2'>
              {submittalCursor && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setSubmittalCursor(null)}
                >
                  First page
                </Button>
              )}
              <Button
                size='sm'
                variant='outline'
                disabled={!submittals?.pagination?.nextCursor}
                onClick={() =>
                  setSubmittalCursor(submittals?.pagination?.nextCursor ?? null)
                }
              >
                Next page
              </Button>
            </div>
          </div>
          <AuditHistoryPanel
            projectId={projectId}
            entityType='submittal'
            title='Submittal Audit History'
            limit={8}
          />
        </TabsContent>

        <TabsContent value='drawings' className='space-y-2'>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
            <Input
              placeholder='Drawing no'
              value={drawingNumber}
              onChange={(e) => setDrawingNumber(e.target.value)}
            />
            <Input
              placeholder='Drawing title'
              value={drawingTitle}
              onChange={(e) => setDrawingTitle(e.target.value)}
            />
            <Button
              disabled={
                createDrawing.isPending || !drawingNumber || !drawingTitle
              }
              onClick={async () => {
                try {
                  await createDrawing.mutateAsync({
                    drawingNumber,
                    title: drawingTitle,
                  })
                  setDrawingNumber('')
                  setDrawingTitle('')
                  toast.success('Drawing created')
                } catch {
                  toast.error('Failed to create drawing')
                }
              }}
            >
              Add
            </Button>
          </div>
          <WorkflowRecordList
            rows={drawings?.rows}
            emptyText='No drawing records'
            getRef={(row) => row.ref}
            getTitle={(row) => `${row.drawingNumber} / ${row.title}`}
            getStatus={(row) => row.status}
            renderMeta={(row) => (
              <div className='flex flex-wrap gap-2'>
                <Badge variant='outline'>Rev {row.revision}</Badge>
              </div>
            )}
          />
        </TabsContent>

        <TabsContent value='transmittals' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Transmittal subject'
              value={transmittalSubject}
              onChange={(e) => setTransmittalSubject(e.target.value)}
            />
            <Button
              disabled={createTransmittal.isPending || !transmittalSubject}
              onClick={async () => {
                try {
                  await createTransmittal.mutateAsync({
                    subject: transmittalSubject,
                    sender: 'PM Team',
                    recipient: 'Consultant',
                  })
                  setTransmittalSubject('')
                  toast.success('Transmittal created')
                } catch {
                  toast.error('Failed to create transmittal')
                }
              }}
            >
              Add
            </Button>
          </div>
          <WorkflowRecordList
            rows={transmittals?.rows}
            emptyText='No transmittals'
            getRef={(row) => row.ref}
            getTitle={(row) => row.subject}
            getStatus={(row) => row.status}
          />
        </TabsContent>

        <TabsContent value='correspondence' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Correspondence subject'
              value={correspondenceSubject}
              onChange={(e) => setCorrespondenceSubject(e.target.value)}
            />
            <Button
              disabled={
                createCorrespondence.isPending || !correspondenceSubject
              }
              onClick={async () => {
                try {
                  await createCorrespondence.mutateAsync({
                    direction: 'outgoing',
                    type: 'letter',
                    subject: correspondenceSubject,
                  })
                  setCorrespondenceSubject('')
                  toast.success('Correspondence created')
                } catch {
                  toast.error('Failed to create correspondence')
                }
              }}
            >
              Add
            </Button>
          </div>
          <WorkflowRecordList
            rows={correspondence?.rows}
            emptyText='No correspondence records'
            getRef={(row) => row.ref}
            getTitle={(row) => row.subject}
            getSubtitle={(row) => `${row.direction} ${row.type}`}
            getStatus={(row) => row.status}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
