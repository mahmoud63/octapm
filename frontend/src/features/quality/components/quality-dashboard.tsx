import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  RotateCcw,
  Send,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { handleServerError } from '@/lib/handle-server-error'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { UserPicker } from '@/components/user-picker'
import { InspectionsModule } from '@/features/inspections/components/inspections-module'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import { PunchModule } from '@/features/punch/components/punch-module'
import {
  WorkflowDecisionDialog,
  type WorkflowDecisionMode,
} from '@/features/workflows/components/workflow-decision-dialog'
import { WorkflowRecordList } from '@/features/workflows/components/workflow-record-list'
import {
  useApproveNcr,
  useApproveSafetyIncident,
  useCloseNcr,
  useCloseSafetyIncident,
  useCreateDefect,
  useCreateItp,
  useCreateMaterialTest,
  useCreateNcr,
  useCreateSafetyIncident,
  useDefects,
  useItps,
  useMaterialTests,
  useNcrs,
  useQualityDashboard,
  useRejectNcr,
  useRejectSafetyIncident,
  useReopenNcr,
  useReopenSafetyIncident,
  useSafetyIncidents,
  useUploadWorkflowAttachments,
  type WorkflowAttachmentUpload,
} from '../hooks/use-quality'

type QualityDecisionTarget =
  | {
      kind: 'ncr'
      action: 'approve' | 'reject' | 'reopen'
      mode: WorkflowDecisionMode
      id: string
      label: string
    }
  | {
      kind: 'safety'
      action: 'approve' | 'reject' | 'reopen'
      mode: WorkflowDecisionMode
      id: string
      label: string
    }

type CloseoutTarget =
  | {
      kind: 'ncr'
      id: string
      label: string
      responsible?: string | null
      assigneeUserId?: string | null
      dueDate?: string | null
    }
  | {
      kind: 'safety'
      id: string
      label: string
      responsible?: string | null
      assigneeUserId?: string | null
      dueDate?: string | null
    }

type CloseoutPayload = {
  responsible: string
  assigneeUserId?: string | null
  dueDate: string
  closureComment: string
  attachmentRefs: Array<{
    fileName?: string
    fileUrl?: string
    storageKey?: string
    mimeType?: string
    sizeBytes?: number
    description: string
  }>
}

type CloseoutEvidenceUploader = (
  files: File[]
) => Promise<WorkflowAttachmentUpload[]>

const closeoutEvidenceAccept =
  'image/*,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'

function toDateInputValue(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function CloseoutDialog({
  projectId,
  target,
  isPending,
  onUploadEvidence,
  onOpenChange,
  onConfirm,
}: {
  projectId: string
  target: CloseoutTarget | null
  isPending?: boolean
  onUploadEvidence: CloseoutEvidenceUploader
  onOpenChange: (open: boolean) => void
  onConfirm: (payload: CloseoutPayload) => Promise<void>
}) {
  const [responsible, setResponsible] = useState('')
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [closureComment, setClosureComment] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])

  const open = !!target

  useEffect(() => {
    if (!target) return
    setResponsible(target.responsible || '')
    setAssigneeUserId(target.assigneeUserId ?? null)
    setDueDate(toDateInputValue(target.dueDate))
    setClosureComment('')
    setEvidenceFiles([])
  }, [target])

  const canSubmit = Boolean(
    (assigneeUserId || responsible.trim()) &&
    dueDate &&
    closureComment.trim() &&
    evidenceFiles.length
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Submit closeout</DialogTitle>
          <DialogDescription>{target?.label}</DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='quality-closeout-responsible'>
              Responsible person
            </Label>
            <UserPicker
              id='quality-closeout-responsible'
              testId='uat-closeout-responsible-picker'
              projectId={projectId}
              value={assigneeUserId}
              onChange={setAssigneeUserId}
              placeholder={
                responsible ? `${responsible} (unmatched)` : 'Pick a person'
              }
            />
            {!assigneeUserId && (
              <Input
                aria-label='Responsible party (free text)'
                placeholder='Or type a party name'
                value={responsible}
                onChange={(event) => setResponsible(event.target.value)}
              />
            )}
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='quality-closeout-due-date'>Due date</Label>
            <Input
              id='quality-closeout-due-date'
              type='date'
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          <div className='space-y-1.5 sm:col-span-2'>
            <Label htmlFor='quality-closeout-evidence'>
              Photo or file evidence
            </Label>
            <Input
              id='quality-closeout-evidence'
              className='min-h-10'
              type='file'
              accept={closeoutEvidenceAccept}
              capture='environment'
              multiple
              aria-describedby='quality-closeout-evidence-status'
              onChange={(event) =>
                setEvidenceFiles(Array.from(event.target.files ?? []))
              }
            />
            <p
              id='quality-closeout-evidence-status'
              className='text-xs text-muted-foreground'
            >
              {evidenceFiles.length
                ? `${evidenceFiles.length} selected`
                : 'Evidence is required'}
            </p>
          </div>
          <div className='space-y-1.5 sm:col-span-2'>
            <Label htmlFor='quality-closeout-comment'>Closure comment</Label>
            <Textarea
              id='quality-closeout-comment'
              rows={4}
              value={closureComment}
              onChange={(event) => setClosureComment(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            className='min-h-10'
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            className='min-h-10'
            disabled={isPending || !canSubmit}
            onClick={async () => {
              try {
                const uploaded = await onUploadEvidence(evidenceFiles)
                await onConfirm({
                  responsible: responsible.trim(),
                  assigneeUserId,
                  dueDate,
                  closureComment: closureComment.trim(),
                  attachmentRefs: uploaded.map((file) => ({
                    fileName:
                      file.fileName ||
                      file.filename ||
                      file.originalName ||
                      'Closeout evidence',
                    fileUrl: file.fileUrl || file.url || file.downloadUrl,
                    storageKey: file.storageKey || file.documentId || file.key,
                    mimeType: file.mimeType,
                    sizeBytes: file.sizeBytes ?? file.size,
                    description: 'Closeout evidence',
                  })),
                })
                onOpenChange(false)
              } catch (error) {
                handleServerError(error)
              }
            }}
          >
            <UploadCloud className='mr-2 h-4 w-4' />
            {isPending ? 'Uploading...' : 'Upload & submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function QualityDashboard({
  projectId,
  activeTab,
  onTabChange,
  showTabList = true,
  initialTarget,
}: {
  projectId: string
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
  initialTarget?: ProjectSetupTarget
}) {
  const { data: dashboard } = useQualityDashboard(projectId)
  const { data: ncrs } = useNcrs(projectId)
  const { data: itps } = useItps(projectId)
  const { data: defects } = useDefects(projectId)
  const { data: safety } = useSafetyIncidents(projectId)
  const { data: tests } = useMaterialTests(projectId)

  const createNcr = useCreateNcr(projectId)
  const closeNcr = useCloseNcr(projectId)
  const approveNcr = useApproveNcr(projectId)
  const rejectNcr = useRejectNcr(projectId)
  const reopenNcr = useReopenNcr(projectId)
  const createItp = useCreateItp(projectId)
  const createDefect = useCreateDefect(projectId)
  const createSafety = useCreateSafetyIncident(projectId)
  const closeSafety = useCloseSafetyIncident(projectId)
  const approveSafety = useApproveSafetyIncident(projectId)
  const rejectSafety = useRejectSafetyIncident(projectId)
  const reopenSafety = useReopenSafetyIncident(projectId)
  const uploadCloseoutEvidence = useUploadWorkflowAttachments(projectId)
  const createTest = useCreateMaterialTest(projectId)
  const canCreateNcr = useCanPerform('ncr', 'create')
  const canSubmitNcr = useCanPerform('ncr', 'submit', 'ncr.close')
  const canCreateSafety = useCanPerform('safety', 'create')
  const canSubmitSafety = useCanPerform('safety', 'submit', 'safety.close')
  const canApproveNcr = useCanPerform('ncr', 'approve', 'ncr.approve')
  const canRejectNcr = useCanPerform('ncr', 'approve', 'ncr.reject')
  const canReopenNcr = useCanPerform('ncr', 'approve', 'ncr.reopen')
  const canApproveSafety = useCanPerform('safety', 'approve', 'safety.approve')
  const canRejectSafety = useCanPerform('safety', 'approve', 'safety.reject')
  const canReopenSafety = useCanPerform('safety', 'approve', 'safety.reopen')

  const [ncrDescription, setNcrDescription] = useState('')
  const [itpTitle, setItpTitle] = useState('')
  const [defectTitle, setDefectTitle] = useState('')
  const [safetyTitle, setSafetyTitle] = useState('')
  const [testType, setTestType] = useState('')
  const [decisionTarget, setDecisionTarget] =
    useState<QualityDecisionTarget | null>(null)
  const [closeoutTarget, setCloseoutTarget] = useState<CloseoutTarget | null>(
    null
  )

  const metrics = dashboard?.metrics
  const decisionPending =
    approveNcr.isPending ||
    rejectNcr.isPending ||
    approveSafety.isPending ||
    rejectSafety.isPending ||
    reopenNcr.isPending ||
    reopenSafety.isPending
  const closeoutPending =
    closeNcr.isPending ||
    closeSafety.isPending ||
    uploadCloseoutEvidence.isPending

  const handleDecision = async (note: string) => {
    if (!decisionTarget) return

    try {
      if (decisionTarget.kind === 'ncr') {
        if (decisionTarget.action === 'approve') {
          await approveNcr.mutateAsync({
            ncrId: decisionTarget.id,
            comment: note,
          })
          toast.success('NCR approved')
        } else if (decisionTarget.action === 'reject') {
          await rejectNcr.mutateAsync({
            ncrId: decisionTarget.id,
            reason: note,
          })
          toast.success('NCR disapproved')
        } else {
          await reopenNcr.mutateAsync({
            ncrId: decisionTarget.id,
            reason: note,
          })
          toast.success('NCR reopened')
        }
      } else if (decisionTarget.action === 'approve') {
        await approveSafety.mutateAsync({
          incidentId: decisionTarget.id,
          comment: note,
        })
        toast.success('Safety incident approved')
      } else if (decisionTarget.action === 'reject') {
        await rejectSafety.mutateAsync({
          incidentId: decisionTarget.id,
          reason: note,
        })
        toast.success('Safety incident disapproved')
      } else {
        await reopenSafety.mutateAsync({
          incidentId: decisionTarget.id,
          reason: note,
        })
        toast.success('Safety incident reopened')
      }
    } catch (error) {
      handleServerError(error)
    }
  }

  const handleCloseout = async (payload: CloseoutPayload) => {
    if (!closeoutTarget) return

    try {
      if (closeoutTarget.kind === 'ncr') {
        await closeNcr.mutateAsync({
          ncrId: closeoutTarget.id,
          payload,
        })
        toast.success('NCR closeout submitted')
      } else {
        await closeSafety.mutateAsync({
          incidentId: closeoutTarget.id,
          payload,
        })
        toast.success('Safety closeout submitted')
      }
    } catch (error) {
      handleServerError(error)
    }
  }

  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'ncr' }

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7'>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Quality Score</p>
          <p className='text-2xl font-bold'>{metrics?.qualityScore ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Major NCR</p>
          <p className='text-2xl font-bold'>{metrics?.majorNcrs ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Failed ITP</p>
          <p className='text-2xl font-bold'>{metrics?.failedItps ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Open punch items</p>
          <p className='text-2xl font-bold'>{metrics?.openDefects ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Safety Open</p>
          <p className='text-2xl font-bold'>{metrics?.safetyOpen ?? 0}</p>
        </div>
        <div className='rounded border p-3' data-testid='uat-observations-kpi'>
          <p className='text-xs text-muted-foreground'>Observations</p>
          <p className='text-2xl font-bold'>{metrics?.observationsOpen ?? 0}</p>
          <p className='text-xs text-muted-foreground'>
            {metrics?.safetyObservationsOpen ?? 0} safety
          </p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Due Alerts</p>
          <p className='text-2xl font-bold'>{metrics?.dueAlerts ?? 0}</p>
        </div>
      </div>

      <Tabs {...tabsProps} className='space-y-3'>
        {showTabList && (
          <TabsList className='grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:w-fit sm:flex-wrap'>
            <TabsTrigger className='min-h-10' value='ncr'>
              NCR
            </TabsTrigger>
            <TabsTrigger className='min-h-10' value='itp'>
              Inspections
            </TabsTrigger>
            <TabsTrigger className='min-h-10' value='defects'>
              Punch list
            </TabsTrigger>
            <TabsTrigger className='min-h-10' value='observations'>
              Observations
            </TabsTrigger>
            <TabsTrigger className='min-h-10' value='safety'>
              Safety
            </TabsTrigger>
            <TabsTrigger className='min-h-10' value='tests'>
              Material Tests
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='ncr' className='space-y-2'>
          {canCreateNcr && (
            <div className='flex flex-col gap-2 sm:flex-row'>
              <Input
                aria-label='New NCR description'
                placeholder='New NCR description'
                value={ncrDescription}
                onChange={(e) => setNcrDescription(e.target.value)}
              />
              <Button
                className='min-h-10 w-full sm:w-auto'
                disabled={createNcr.isPending || !ncrDescription}
                onClick={async () => {
                  try {
                    await createNcr.mutateAsync({ description: ncrDescription })
                    setNcrDescription('')
                    toast.success('NCR created')
                  } catch (error) {
                    handleServerError(error)
                  }
                }}
              >
                Add
              </Button>
            </div>
          )}
          <WorkflowRecordList
            projectId={projectId}
            recordType='ncr'
            exportName='ncr'
            initialSelectedId={
              initialTarget?.source === 'ncr' ? initialTarget.recordId : undefined
            }
            rows={ncrs?.rows}
            emptyText='No NCR records'
            getRef={(row) => row.ref}
            getTitle={(row) => row.description || 'No description'}
            getSubtitle={(row) => row.disposition}
            getStatus={(row) => row.status}
            renderMeta={(row) => (
              <div className='flex flex-wrap items-center gap-2'>
                <Badge
                  variant={row.severity === 'major' ? 'destructive' : 'outline'}
                >
                  {row.severity}
                </Badge>
                {row.responsible && (
                  <Badge variant='outline'>
                    Responsible: {row.responsible}
                  </Badge>
                )}
                {row.closureComment && (
                  <span className='text-sm text-muted-foreground'>
                    {row.closureComment}
                  </span>
                )}
              </div>
            )}
            renderActions={(row) =>
              row.status === 'open' ? (
                <>
                  {canSubmitNcr && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='min-h-10 w-full sm:w-auto'
                      onClick={() =>
                        setCloseoutTarget({
                          kind: 'ncr',
                          id: row.id,
                          label: row.ref,
                          responsible: row.responsible || row.owner,
                          assigneeUserId: row.assigneeUserId ?? null,
                          dueDate: row.dueDate,
                        })
                      }
                    >
                      <Send className='mr-2 h-4 w-4' />
                      Submit closeout
                    </Button>
                  )}
                </>
              ) : row.status === 'submitted' ? (
                <>
                  {canApproveNcr && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='min-h-10 w-full sm:w-auto'
                      onClick={() =>
                        setDecisionTarget({
                          kind: 'ncr',
                          action: 'approve',
                          mode: 'approve',
                          id: row.id,
                          label: row.ref,
                        })
                      }
                    >
                      <CheckCircle2 className='mr-2 h-4 w-4' />
                      Approve
                    </Button>
                  )}
                  {canRejectNcr && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='min-h-10 w-full sm:w-auto'
                      onClick={() =>
                        setDecisionTarget({
                          kind: 'ncr',
                          action: 'reject',
                          mode: 'reject',
                          id: row.id,
                          label: row.ref,
                        })
                      }
                    >
                      <XCircle className='mr-2 h-4 w-4' />
                      Disapprove
                    </Button>
                  )}
                </>
              ) : row.status === 'closed' && canReopenNcr ? (
                <Button
                  size='sm'
                  variant='outline'
                  className='min-h-10 w-full sm:w-auto'
                  onClick={() =>
                    setDecisionTarget({
                      kind: 'ncr',
                      action: 'reopen',
                      mode: 'reject',
                      id: row.id,
                      label: row.ref,
                    })
                  }
                >
                  <RotateCcw className='mr-2 h-4 w-4' />
                  Reopen
                </Button>
              ) : null
            }
          />
        </TabsContent>

        <TabsContent value='itp' className='space-y-2'>
          <InspectionsModule
            key={`${initialTarget?.source ?? ''}:${initialTarget?.recordId ?? ''}`}
            projectId={projectId}
            initialTarget={initialTarget}
            legacy={
              <>
                <div className='flex flex-col gap-2 sm:flex-row'>
                  <Input
                    aria-label='ITP title'
                    placeholder='ITP title'
                    value={itpTitle}
                    onChange={(e) => setItpTitle(e.target.value)}
                  />
                  <Button
                    className='min-h-10 w-full sm:w-auto'
                    disabled={createItp.isPending || !itpTitle}
                    onClick={async () => {
                      try {
                        await createItp.mutateAsync({ title: itpTitle })
                        setItpTitle('')
                        toast.success('ITP created')
                      } catch {
                        toast.error('Failed to create ITP')
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
                <WorkflowRecordList
                  projectId={projectId}
                  recordType='itp'
                  exportName='itp'
                  initialSelectedId={
                    initialTarget?.source === 'itp'
                      ? initialTarget.recordId
                      : undefined
                  }
                  rows={itps?.rows}
                  emptyText='No ITP records'
                  getRef={(row) => row.ref}
                  getTitle={(row) => row.title}
                  getSubtitle={(row) => row.pointType}
                  getStatus={(row) => row.status}
                />
              </>
            }
          />
        </TabsContent>

        <TabsContent value='defects' className='space-y-2'>
          <PunchModule
            key={`${initialTarget?.source ?? ''}:${initialTarget?.recordId ?? ''}`}
            projectId={projectId}
            initialTarget={initialTarget}
            legacy={
              <>
                <div className='flex flex-col gap-2 sm:flex-row'>
                  <Input
                    aria-label='Defect title'
                    placeholder='Defect title'
                    value={defectTitle}
                    onChange={(e) => setDefectTitle(e.target.value)}
                  />
                  <Button
                    className='min-h-10 w-full sm:w-auto'
                    disabled={createDefect.isPending || !defectTitle}
                    onClick={async () => {
                      try {
                        await createDefect.mutateAsync({ title: defectTitle })
                        setDefectTitle('')
                        toast.success('Defect created')
                      } catch {
                        toast.error('Failed to create defect')
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
                <WorkflowRecordList
                  projectId={projectId}
                  recordType='defect'
                  exportName='defect'
                  initialSelectedId={
                    initialTarget?.source === 'defect'
                      ? initialTarget.recordId
                      : undefined
                  }
                  rows={defects?.rows}
                  emptyText='No defect records'
                  getRef={(row) => row.ref}
                  getTitle={(row) => row.title}
                  getSubtitle={(row) => row.severity}
                  getStatus={(row) => row.status}
                  renderMeta={(row) => (
                    <div className='flex flex-wrap gap-2'>
                      <Badge
                        variant={
                          row.severity === 'critical'
                            ? 'destructive'
                            : 'outline'
                        }
                      >
                        {row.severity}
                      </Badge>
                    </div>
                  )}
                />
              </>
            }
          />
        </TabsContent>

        <TabsContent value='observations' className='space-y-2'>
          <PunchModule
            key={`obs:${initialTarget?.source ?? ''}:${initialTarget?.recordId ?? ''}`}
            projectId={projectId}
            kind='observation'
            initialTarget={initialTarget}
          />
        </TabsContent>

        <TabsContent value='safety' className='space-y-2'>
          {canCreateSafety && (
            <div className='flex flex-col gap-2 sm:flex-row'>
              <Input
                aria-label='Incident title'
                placeholder='Incident title'
                value={safetyTitle}
                onChange={(e) => setSafetyTitle(e.target.value)}
              />
              <Button
                className='min-h-10 w-full sm:w-auto'
                disabled={createSafety.isPending || !safetyTitle}
                onClick={async () => {
                  try {
                    await createSafety.mutateAsync({
                      title: safetyTitle,
                      incidentType: 'near_miss',
                    })
                    setSafetyTitle('')
                    toast.success('Incident logged')
                  } catch (error) {
                    handleServerError(error)
                  }
                }}
              >
                Add
              </Button>
            </div>
          )}
          <WorkflowRecordList
            projectId={projectId}
            recordType='safety_incident'
            initialSelectedId={
              initialTarget?.source === 'safety_incident'
                ? initialTarget.recordId
                : undefined
            }
            exportName='safety_incident'
            rows={safety?.rows}
            emptyText='No safety incidents'
            getRef={(row) => row.ref}
            getTitle={(row) => row.title}
            getSubtitle={(row) =>
              `${row.incidentType} / ${row.lostDays} lost days`
            }
            getStatus={(row) => row.status}
            renderMeta={(row) => (
              <div className='flex flex-wrap items-center gap-2'>
                {row.responsible && (
                  <Badge variant='outline'>
                    Responsible: {row.responsible}
                  </Badge>
                )}
                {row.closureComment && (
                  <span className='text-sm text-muted-foreground'>
                    {row.closureComment}
                  </span>
                )}
              </div>
            )}
            renderActions={(row) =>
              row.status === 'open' || row.status === 'investigating' ? (
                <>
                  {canSubmitSafety && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='min-h-10 w-full sm:w-auto'
                      onClick={() =>
                        setCloseoutTarget({
                          kind: 'safety',
                          id: row.id,
                          label: row.ref,
                          responsible: row.responsible || row.owner,
                          assigneeUserId: row.assigneeUserId ?? null,
                          dueDate: row.dueDate,
                        })
                      }
                    >
                      <Send className='mr-2 h-4 w-4' />
                      Submit closeout
                    </Button>
                  )}
                </>
              ) : row.status === 'submitted' ? (
                <>
                  {canApproveSafety && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='min-h-10 w-full sm:w-auto'
                      onClick={() =>
                        setDecisionTarget({
                          kind: 'safety',
                          action: 'approve',
                          mode: 'approve',
                          id: row.id,
                          label: row.ref,
                        })
                      }
                    >
                      <CheckCircle2 className='mr-2 h-4 w-4' />
                      Approve
                    </Button>
                  )}
                  {canRejectSafety && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='min-h-10 w-full sm:w-auto'
                      onClick={() =>
                        setDecisionTarget({
                          kind: 'safety',
                          action: 'reject',
                          mode: 'reject',
                          id: row.id,
                          label: row.ref,
                        })
                      }
                    >
                      <XCircle className='mr-2 h-4 w-4' />
                      Disapprove
                    </Button>
                  )}
                </>
              ) : row.status === 'closed' && canReopenSafety ? (
                <Button
                  size='sm'
                  variant='outline'
                  className='min-h-10 w-full sm:w-auto'
                  onClick={() =>
                    setDecisionTarget({
                      kind: 'safety',
                      action: 'reopen',
                      mode: 'reject',
                      id: row.id,
                      label: row.ref,
                    })
                  }
                >
                  <RotateCcw className='mr-2 h-4 w-4' />
                  Reopen
                </Button>
              ) : null
            }
          />
        </TabsContent>

        <TabsContent value='tests' className='space-y-2'>
          <div className='flex flex-col gap-2 sm:flex-row'>
            <Input
              aria-label='Material test type'
              placeholder='Test type'
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
            />
            <Button
              className='min-h-10 w-full sm:w-auto'
              disabled={createTest.isPending || !testType}
              onClick={async () => {
                try {
                  await createTest.mutateAsync({ testType })
                  setTestType('')
                  toast.success('Material test logged')
                } catch {
                  toast.error('Failed to create test')
                }
              }}
            >
              Add
            </Button>
          </div>
          <WorkflowRecordList
            projectId={projectId}
            recordType='material_test'
            initialSelectedId={
              initialTarget?.source === 'material_test'
                ? initialTarget.recordId
                : undefined
            }
            exportName='material_test'
            rows={tests?.rows}
            emptyText='No material tests'
            getRef={(row) => row.ref}
            getTitle={(row) => row.testType}
            getStatus={(row) => row.result}
          />
        </TabsContent>
      </Tabs>
      <CloseoutDialog
        projectId={projectId}
        target={closeoutTarget}
        isPending={closeoutPending}
        onUploadEvidence={(files) => uploadCloseoutEvidence.mutateAsync(files)}
        onOpenChange={(open) => {
          if (!open) setCloseoutTarget(null)
        }}
        onConfirm={handleCloseout}
      />
      <WorkflowDecisionDialog
        open={!!decisionTarget}
        onOpenChange={(open) => {
          if (!open) setDecisionTarget(null)
        }}
        mode={decisionTarget?.mode ?? 'approve'}
        title={`${
          decisionTarget?.action === 'reopen'
            ? 'Reopen'
            : decisionTarget?.mode === 'reject'
              ? 'Disapprove'
              : 'Approve'
        } ${decisionTarget?.label ?? 'record'}`}
        description={
          decisionTarget?.action === 'reopen'
            ? 'A reopen reason is required.'
            : decisionTarget?.mode === 'reject'
              ? 'A reason is required.'
              : 'Add an optional comment.'
        }
        isPending={decisionPending}
        rejectLabel={
          decisionTarget?.action === 'reopen' ? 'Reopen' : 'Disapprove'
        }
        onConfirm={handleDecision}
      />
    </div>
  )
}
