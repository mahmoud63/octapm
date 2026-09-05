import { useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  Eye,
  FileClock,
  FileText,
  FolderTree,
  Send,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { handleServerError } from '@/lib/handle-server-error'
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useRecordTypes } from '@/features/custom-fields/hooks/use-custom-fields'
import { DrawingsModule } from '@/features/drawings/components/drawings-module'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import { useProjectParties } from '@/features/projects/hooks/use-projects'
import {
  WorkflowDecisionDialog,
  type WorkflowDecisionMode,
} from '@/features/workflows/components/workflow-decision-dialog'
import { WorkflowRecordList } from '@/features/workflows/components/workflow-record-list'
import {
  type RfiListQuery,
  type DocumentRegisterRecordType,
  type DocumentRegisterQuery,
  type SubmittalListQuery,
  useApproveDocumentRevision,
  useApproveRfi,
  useApproveSubmittal,
  useCorrespondence,
  useCreateCorrespondence,
  useCreateDrawing,
  useCreateRfi,
  useCreateTransmittal,
  useDocumentRegister,
  useDocControlDashboard,
  useDrawings,
  useRejectRfi,
  useRejectSubmittal,
  useAnswerRfi,
  useCloseRfi,
  useReopenRfi,
  useRfis,
  useReviewSubmittal,
  useResubmitSubmittal,
  useSubmitRfi,
  useSubmitSubmittal,
  useSubmitDocumentRevisionForReview,
  useSupersedeDocumentRevision,
  useSubmittals,
  useUploadDocumentRevisionFile,
  useTransmittals,
} from '../hooks/use-doc-control'
import { DocumentSearchPanel } from './document-search-panel'
import { RfiCreateDialog } from './rfi-create-dialog'
import { RfiDetailDialog } from './rfi-detail-dialog'
import { RfiSavedViews } from './rfi-saved-views'
import { SubmittalCreateDialog } from './submittal-create-dialog'
import { SubmittalDetailDialog } from './submittal-detail-dialog'
import { SubmittalPackagesPanel } from './submittal-packages-panel'
import { SubmittalWorkflowList } from './submittal-workflow-editor'

type DocDecisionTarget =
  | {
      kind: 'rfi'
      mode: WorkflowDecisionMode
      id: string
      label: string
    }
  | {
      kind: 'submittal'
      mode: WorkflowDecisionMode
      id: string
      label: string
    }
  | {
      kind: 'revision'
      mode: WorkflowDecisionMode
      id: string
      label: string
      action: 'approve' | 'supersede'
    }

type RevisionRecordType = Exclude<DocumentRegisterRecordType, 'correspondence'>

const recordTypeLabel = (value: DocumentRegisterRecordType) =>
  ({
    rfi: 'RFI',
    submittal: 'Submittal',
    drawing: 'Drawing',
    transmittal: 'Transmittal',
    correspondence: 'Correspondence',
  })[value]

const defaultFolderPath = (value: DocumentRegisterRecordType) =>
  ({
    rfi: '/RFI',
    submittal: '/Submittals',
    drawing: '/Drawings',
    transmittal: '/Transmittals',
    correspondence: '/Correspondence',
  })[value]

const statusLabel = (value?: string | null) =>
  value ? value.replace(/_/g, ' ') : 'unissued'
const NO_PARTY_VALUE = '__no_party'

const isPreviewableRevision = (mimeType?: string | null) =>
  Boolean(
    mimeType &&
    (mimeType.startsWith('image/') ||
      mimeType === 'application/pdf' ||
      mimeType.startsWith('text/'))
  )

const formatBytes = (value?: number | null) => {
  if (!value) return '0 KB'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function DocControlDashboard({
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
  const [rfiSubject, setRfiSubject] = useState('')
  const [rfiOwnerPartyId, setRfiOwnerPartyId] = useState(NO_PARTY_VALUE)
  const [rfiSearch, setRfiSearch] = useState('')
  const [rfiStatus, setRfiStatus] = useState<RfiListQuery['status']>(
    initialTarget?.source === 'rfi' &&
      ['open', 'answered', 'closed'].includes(initialTarget.status || '')
      ? (initialTarget.status as RfiListQuery['status'])
      : 'all'
  )
  const [rfiPriority, setRfiPriority] =
    useState<RfiListQuery['priority']>('all')
  const [rfiSortBy, setRfiSortBy] = useState<RfiListQuery['sortBy']>('created')
  const [rfiSortDir, setRfiSortDir] = useState<RfiListQuery['sortDir']>('desc')
  const [rfiCursor, setRfiCursor] = useState<string | null>(null)
  const [rfiBallInCourt, setRfiBallInCourt] = useState<string | null>(null)
  const [rfiOverdue, setRfiOverdue] = useState(false)
  const [rfiDetailId, setRfiDetailId] = useState<string | null>(
    initialTarget?.source === 'rfi' && initialTarget.recordId
      ? initialTarget.recordId
      : null
  )
  const [rfiCreateOpen, setRfiCreateOpen] = useState(false)

  const [submittalSearch, setSubmittalSearch] = useState('')
  const [submittalView, setSubmittalView] = useState<
    'register' | 'packages' | 'workflows'
  >('register')
  const [submittalMine, setSubmittalMine] = useState(false)
  const [submittalLate, setSubmittalLate] = useState(false)
  const [submittalDetailId, setSubmittalDetailId] = useState<string | null>(
    initialTarget?.source === 'submittal' && initialTarget.recordId
      ? initialTarget.recordId
      : null
  )
  const [submittalCreateOpen, setSubmittalCreateOpen] = useState(false)
  const [submittalStatus, setSubmittalStatus] = useState<
    SubmittalListQuery['status']
  >(
    initialTarget?.source === 'submittal' &&
      ['pending', 'under_review', 'approved', 'resubmit', 'rejected'].includes(
        initialTarget.status || ''
      )
      ? (initialTarget.status as SubmittalListQuery['status'])
      : 'all'
  )
  const [submittalSortBy, setSubmittalSortBy] =
    useState<SubmittalListQuery['sortBy']>('created')
  const [submittalSortDir, setSubmittalSortDir] =
    useState<SubmittalListQuery['sortDir']>('desc')
  const [submittalCursor, setSubmittalCursor] = useState<string | null>(null)

  const [registerSearch, setRegisterSearch] = useState('')
  const [registerType, setRegisterType] =
    useState<DocumentRegisterQuery['recordType']>('all')
  const [registerFolder, setRegisterFolder] = useState('all')
  const [selectedRegisterId, setSelectedRegisterId] = useState<string | null>(
    null
  )
  const [revisionFile, setRevisionFile] = useState<File | null>(null)
  const [revisionCode, setRevisionCode] = useState('')
  const [revisionTitle, setRevisionTitle] = useState('')
  const [revisionCategory, setRevisionCategory] = useState('')
  const [revisionFolderPath, setRevisionFolderPath] = useState('')
  const [revisionDiscipline, setRevisionDiscipline] = useState('')
  const [revisionReviewDueAt, setRevisionReviewDueAt] = useState('')
  const [revisionNotes, setRevisionNotes] = useState('')
  const [revisionStatus, setRevisionStatus] = useState<
    'uploaded' | 'submitted'
  >('submitted')
  const revisionFileInputRef = useRef<HTMLInputElement | null>(null)

  const [drawingNumber, setDrawingNumber] = useState('')
  const [drawingTitle, setDrawingTitle] = useState('')
  const [transmittalSubject, setTransmittalSubject] = useState('')
  const [correspondenceSubject, setCorrespondenceSubject] = useState('')
  const [correspondenceRecordType, setCorrespondenceRecordType] = useState('')
  const { data: correspondenceRecordTypes } = useRecordTypes('correspondence')
  const correspondenceTypeLabel = (key?: string | null) =>
    key
      ? ((correspondenceRecordTypes?.items ?? []).find(
          (item) => item.key === key
        )?.label ?? key)
      : null

  const rfiQuery = useMemo<RfiListQuery>(
    () => ({
      limit: 25,
      cursor: rfiCursor,
      search: rfiSearch,
      status: rfiStatus,
      priority: rfiPriority,
      sortBy: rfiSortBy,
      sortDir: rfiSortDir,
      ballInCourtUserId: rfiBallInCourt,
      overdue: rfiOverdue || undefined,
    }),
    [
      rfiBallInCourt,
      rfiCursor,
      rfiOverdue,
      rfiPriority,
      rfiSearch,
      rfiSortBy,
      rfiSortDir,
      rfiStatus,
    ]
  )
  const submittalQuery = useMemo<SubmittalListQuery>(
    () => ({
      limit: 25,
      cursor: submittalCursor,
      search: submittalSearch,
      status: submittalStatus,
      sortBy: submittalSortBy,
      sortDir: submittalSortDir,
      ballInCourtUserId: submittalMine ? 'me' : null,
      overdue: submittalLate || undefined,
    }),
    [
      submittalCursor,
      submittalLate,
      submittalMine,
      submittalSearch,
      submittalSortBy,
      submittalSortDir,
      submittalStatus,
    ]
  )
  const registerQuery = useMemo<DocumentRegisterQuery>(
    () => ({
      recordType: registerType,
      folder: registerFolder,
      search: registerSearch,
    }),
    [registerFolder, registerSearch, registerType]
  )

  const { data: dashboard } = useDocControlDashboard(projectId)
  const { data: documentRegister } = useDocumentRegister(
    projectId,
    registerQuery
  )
  const { data: rfis } = useRfis(projectId, rfiQuery)
  const { data: submittals } = useSubmittals(projectId, submittalQuery)
  const { data: projectParties } = useProjectParties(projectId)
  const { data: drawings } = useDrawings(projectId)
  const { data: transmittals } = useTransmittals(projectId)
  const { data: correspondence } = useCorrespondence(projectId)

  const createRfi = useCreateRfi(projectId)
  const approveRfi = useApproveRfi(projectId)
  const rejectRfi = useRejectRfi(projectId)
  const submitRfi = useSubmitRfi(projectId)
  const answerRfi = useAnswerRfi(projectId)
  const closeRfi = useCloseRfi(projectId)
  const reopenRfi = useReopenRfi(projectId)
  const approveSubmittal = useApproveSubmittal(projectId)
  const rejectSubmittal = useRejectSubmittal(projectId)
  const submitSubmittal = useSubmitSubmittal(projectId)
  const reviewSubmittal = useReviewSubmittal(projectId)
  const resubmitSubmittal = useResubmitSubmittal(projectId)
  const uploadRevision = useUploadDocumentRevisionFile(projectId)
  const submitRevisionReview = useSubmitDocumentRevisionForReview(projectId)
  const approveRevision = useApproveDocumentRevision(projectId)
  const supersedeRevision = useSupersedeDocumentRevision(projectId)
  const createDrawing = useCreateDrawing(projectId)
  const createTransmittal = useCreateTransmittal(projectId)
  const createCorrespondence = useCreateCorrespondence(projectId)
  const partyItems = [
    { id: NO_PARTY_VALUE, label: 'No party route' },
    ...(projectParties?.items.map((party) => ({
      id: party.id,
      label: `${party.company?.name ?? 'Company'} - ${party.role.replace(
        /_/g,
        ' '
      )}`,
    })) ?? []),
  ]
  const canCreateRfi = useCanPerform('rfi', 'create')
  const canCreateSubmittal = useCanPerform('submittal', 'create')
  const canUpdateSubmittal = useCanPerform('submittal', 'update')
  const canApproveRfi = useCanPerform('rfi', 'approve', 'rfi.approve')
  const canRejectRfi = useCanPerform('rfi', 'approve', 'rfi.reject')
  const canSubmitRfi = useCanPerform('rfi', 'submit', 'rfi.submit')
  const canAnswerRfi = useCanPerform('rfi', 'submit', 'rfi.answer')
  const canCloseRfi = useCanPerform('rfi', 'approve', 'rfi.close')
  const canReopenRfi = useCanPerform('rfi', 'approve', 'rfi.reopen')
  const canApproveSubmittal = useCanPerform(
    'submittal',
    'approve',
    'submittal.approve'
  )
  const canRejectSubmittal = useCanPerform(
    'submittal',
    'approve',
    'submittal.reject'
  )
  const canSubmitSubmittal = useCanPerform(
    'submittal',
    'submit',
    'submittal.submit'
  )
  const canReviewSubmittal = useCanPerform(
    'submittal',
    'submit',
    'submittal.review'
  )
  const canResubmitSubmittal = useCanPerform(
    'submittal',
    'submit',
    'submittal.resubmit'
  )
  const canUploadRevision = useCanPerform(
    'document_control',
    'submit',
    'document.revision.upload'
  )
  const canSubmitRevisionReview = useCanPerform(
    'document_control',
    'submit',
    'document.revision.submit_review'
  )
  const canApproveRevision = useCanPerform(
    'document_control',
    'approve',
    'document.revision.approve'
  )
  const canSupersedeRevision = useCanPerform(
    'document_control',
    'approve',
    'document.revision.supersede'
  )

  const metrics = dashboard?.metrics
  const [decisionTarget, setDecisionTarget] =
    useState<DocDecisionTarget | null>(null)
  const decisionPending =
    approveRfi.isPending ||
    rejectRfi.isPending ||
    submitRfi.isPending ||
    answerRfi.isPending ||
    closeRfi.isPending ||
    reopenRfi.isPending ||
    approveSubmittal.isPending ||
    rejectSubmittal.isPending ||
    submitSubmittal.isPending ||
    reviewSubmittal.isPending ||
    resubmitSubmittal.isPending ||
    approveRevision.isPending ||
    supersedeRevision.isPending

  const registerRows = documentRegister?.rows ?? []
  const selectedRegisterRow = useMemo(
    () =>
      registerRows.find((row) => row.id === selectedRegisterId) ||
      registerRows[0] ||
      null,
    [registerRows, selectedRegisterId]
  )
  const revisionTarget = useMemo(
    () =>
      selectedRegisterRow?.recordType !== 'correspondence'
        ? selectedRegisterRow
        : registerRows.find((row) => row.recordType !== 'correspondence') ||
          null,
    [registerRows, selectedRegisterRow]
  )
  const latestPreviewRevision = selectedRegisterRow?.latestRevision
  const latestPreviewUrl =
    latestPreviewRevision?.previewUrl ||
    latestPreviewRevision?.fileUrl ||
    latestPreviewRevision?.downloadUrl
  const canPreviewSelected =
    Boolean(latestPreviewUrl) &&
    isPreviewableRevision(latestPreviewRevision?.mimeType)

  const prepareRevisionUpload = (
    row: NonNullable<typeof selectedRegisterRow>
  ) => {
    setSelectedRegisterId(row.id)
    setRevisionTitle(row.title)
    setRevisionCategory(row.category || recordTypeLabel(row.recordType))
    setRevisionFolderPath(row.folderPath || defaultFolderPath(row.recordType))
  }

  const handleRevisionUpload = async () => {
    if (!revisionTarget || revisionTarget.recordType === 'correspondence')
      return
    if (!revisionFile || !revisionCode) return

    try {
      await uploadRevision.mutateAsync({
        recordType: revisionTarget.recordType as RevisionRecordType,
        recordId: revisionTarget.recordId,
        file: revisionFile,
        payload: {
          revision: revisionCode,
          title: revisionTitle || revisionTarget.title,
          documentNumber: revisionTarget.documentNumber || revisionTarget.ref,
          category:
            revisionCategory ||
            revisionTarget.category ||
            recordTypeLabel(revisionTarget.recordType),
          folderPath:
            revisionFolderPath ||
            revisionTarget.folderPath ||
            defaultFolderPath(revisionTarget.recordType),
          discipline: revisionDiscipline || undefined,
          reviewDueAt: revisionReviewDueAt || undefined,
          status: revisionStatus,
          notes: revisionNotes || undefined,
        },
      })
      setRevisionCode('')
      setRevisionFile(null)
      setRevisionNotes('')
      setRevisionReviewDueAt('')
      if (revisionFileInputRef.current) revisionFileInputRef.current.value = ''
      toast.success(
        revisionStatus === 'submitted'
          ? 'Revision uploaded for review'
          : 'Revision uploaded'
      )
    } catch (error) {
      handleServerError(error)
    }
  }

  const handleDecision = async (note: string) => {
    if (!decisionTarget) return

    try {
      if (decisionTarget.kind === 'rfi') {
        if (decisionTarget.mode === 'approve') {
          await approveRfi.mutateAsync({
            rfiId: decisionTarget.id,
            comment: note,
          })
          toast.success('RFI approved')
        } else {
          await rejectRfi.mutateAsync({
            rfiId: decisionTarget.id,
            reason: note,
          })
          toast.success('RFI disapproved')
        }
      } else if (decisionTarget.kind === 'submittal') {
        if (decisionTarget.mode === 'approve') {
          await approveSubmittal.mutateAsync({
            submittalId: decisionTarget.id,
            comment: note,
          })
          toast.success('Submittal approved')
        } else {
          await rejectSubmittal.mutateAsync({
            submittalId: decisionTarget.id,
            reason: note,
          })
          toast.success('Submittal disapproved')
        }
      } else if (decisionTarget.kind === 'revision') {
        if (decisionTarget.action === 'approve') {
          await approveRevision.mutateAsync({
            revisionId: decisionTarget.id,
            comment: note,
          })
          toast.success('Revision approved')
        } else {
          await supersedeRevision.mutateAsync({
            revisionId: decisionTarget.id,
            reason: note,
          })
          toast.success('Revision superseded')
        }
      }
    } catch (error) {
      handleServerError(error)
    }
  }

  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'register' }

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
            <TabsTrigger value='register'>Register</TabsTrigger>
            <TabsTrigger value='rfi'>RFI</TabsTrigger>
            <TabsTrigger value='submittals'>Submittals</TabsTrigger>
            <TabsTrigger value='drawings'>Drawings</TabsTrigger>
            <TabsTrigger value='transmittals'>Transmittals</TabsTrigger>
            <TabsTrigger value='correspondence'>Correspondence</TabsTrigger>
            <TabsTrigger value='search'>Search</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='search'>
          <DocumentSearchPanel projectId={projectId} />
        </TabsContent>

        <TabsContent value='register' className='space-y-3'>
          <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
            <div className='rounded border p-3'>
              <p className='text-xs text-muted-foreground'>Register Rows</p>
              <p className='text-2xl font-bold'>
                {documentRegister?.summary?.records ?? 0}
              </p>
            </div>
            <div className='rounded border p-3'>
              <p className='text-xs text-muted-foreground'>Latest Approved</p>
              <p className='text-2xl font-bold'>
                {documentRegister?.summary?.latestApproved ?? 0}
              </p>
            </div>
            <div className='rounded border p-3'>
              <p className='text-xs text-muted-foreground'>Superseded Rev</p>
              <p className='text-2xl font-bold'>
                {documentRegister?.summary?.supersededRevisions ?? 0}
              </p>
            </div>
            <div className='rounded border p-3'>
              <p className='text-xs text-muted-foreground'>Missing Revision</p>
              <p className='text-2xl font-bold'>
                {documentRegister?.summary?.missingRevision ?? 0}
              </p>
            </div>
          </div>

          <div className='grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px]'>
            <Input
              placeholder='Search register'
              value={registerSearch}
              onChange={(event) => setRegisterSearch(event.target.value)}
            />
            <Select
              value={registerType}
              onValueChange={(value) =>
                setRegisterType(value as DocumentRegisterQuery['recordType'])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All records</SelectItem>
                <SelectItem value='rfi'>RFI</SelectItem>
                <SelectItem value='submittal'>Submittal</SelectItem>
                <SelectItem value='drawing'>Drawing</SelectItem>
                <SelectItem value='transmittal'>Transmittal</SelectItem>
                <SelectItem value='correspondence'>Correspondence</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className='grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_minmax(320px,0.8fr)]'>
            <aside className='space-y-2 rounded border p-3'>
              <div className='flex items-center gap-2 text-sm font-semibold'>
                <FolderTree className='h-4 w-4' />
                Folders
              </div>
              <div className='space-y-1'>
                {(
                  documentRegister?.folders ?? [
                    {
                      key: 'all',
                      label: 'All documents',
                      count: registerRows.length,
                      recordTypes: [],
                    },
                  ]
                ).map((folder) => (
                  <Button
                    key={folder.key}
                    type='button'
                    variant={
                      registerFolder === folder.key ? 'default' : 'ghost'
                    }
                    className='h-9 w-full justify-between px-2'
                    onClick={() => setRegisterFolder(folder.key)}
                  >
                    <span className='truncate'>{folder.label}</span>
                    <Badge variant='outline'>{folder.count}</Badge>
                  </Button>
                ))}
              </div>
              {documentRegister?.summary?.currentOnly && (
                <Badge variant='secondary' className='w-full justify-center'>
                  Current revision only
                </Badge>
              )}
            </aside>

            <section className='space-y-2'>
              {registerRows.length ? (
                registerRows.map((row) => {
                  const latest = row.latestRevision
                  const isSuperseded = latest?.status === 'superseded'
                  const isSelected = selectedRegisterRow?.id === row.id
                  return (
                    <div
                      key={row.id}
                      role='button'
                      tabIndex={0}
                      className={`w-full rounded border bg-background p-3 text-left transition-colors hover:border-primary/60 ${
                        isSelected ? 'border-primary/70' : ''
                      }`}
                      onClick={() => {
                        setSelectedRegisterId(row.id)
                        if (row.recordType !== 'correspondence') {
                          prepareRevisionUpload(row)
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        setSelectedRegisterId(row.id)
                        if (row.recordType !== 'correspondence') {
                          prepareRevisionUpload(row)
                        }
                      }}
                    >
                      <div className='flex flex-col gap-3 md:flex-row md:items-start'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <Badge variant='outline'>
                              {recordTypeLabel(row.recordType)}
                            </Badge>
                            <Badge>{row.ref}</Badge>
                            {latest?.isLatest && <Badge>Latest</Badge>}
                            {isSuperseded && (
                              <Badge variant='secondary'>Read-only</Badge>
                            )}
                          </div>
                          <p className='mt-2 truncate font-medium'>
                            {row.title}
                          </p>
                          <div className='mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                            <span>{row.folderPath || 'Unfiled'}</span>
                            <span>{row.revisionCount} revisions</span>
                            <span>{row.attachmentCount} files</span>
                            <span>
                              {row.activityLinks?.length || 0} activities
                            </span>
                          </div>
                        </div>
                        <div className='flex flex-wrap gap-2'>
                          {latest?.downloadUrl && (
                            <Button asChild size='sm' variant='outline'>
                              <a
                                href={latest.downloadUrl}
                                download
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Download className='mr-2 h-4 w-4' />
                                Download
                              </a>
                            </Button>
                          )}
                          {latest?.previewUrl &&
                            isPreviewableRevision(latest.mimeType) && (
                              <Button asChild size='sm' variant='outline'>
                                <a
                                  href={latest.previewUrl}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Eye className='mr-2 h-4 w-4' />
                                  Preview
                                </a>
                              </Button>
                            )}
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className='rounded border p-4 text-sm text-muted-foreground'>
                  No document register records
                </div>
              )}
            </section>

            <aside className='space-y-3 rounded border p-3'>
              {selectedRegisterRow ? (
                <>
                  <div className='space-y-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Badge>{selectedRegisterRow.ref}</Badge>
                      <Badge variant='outline'>
                        {selectedRegisterRow.category || 'Uncategorized'}
                      </Badge>
                    </div>
                    <div>
                      <h3 className='truncate text-sm font-semibold'>
                        {selectedRegisterRow.title}
                      </h3>
                      <p className='truncate text-xs text-muted-foreground'>
                        {selectedRegisterRow.folderPath || 'Unfiled'}
                      </p>
                    </div>
                  </div>

                  <div className='rounded border bg-muted/20 p-2'>
                    {canPreviewSelected && latestPreviewUrl ? (
                      <iframe
                        title={`${selectedRegisterRow.ref} preview`}
                        src={latestPreviewUrl}
                        className='h-80 w-full rounded border bg-background'
                      />
                    ) : (
                      <div className='flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground'>
                        <FileText className='h-8 w-8' />
                        <span>Preview unavailable</span>
                        {latestPreviewRevision?.downloadUrl && (
                          <Button asChild size='sm' variant='outline'>
                            <a
                              href={latestPreviewRevision.downloadUrl}
                              download
                            >
                              <Download className='mr-2 h-4 w-4' />
                              Download
                            </a>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className='space-y-2'>
                    <div className='flex items-center gap-2 text-sm font-semibold'>
                      <FileClock className='h-4 w-4' />
                      Revisions
                    </div>
                    <div className='space-y-2'>
                      {selectedRegisterRow.revisions.length ? (
                        selectedRegisterRow.revisions.map((revision) => {
                          const isRevisionSuperseded =
                            revision.status === 'superseded'
                          return (
                            <div
                              key={revision.id || revision.revision}
                              className='rounded border px-3 py-2 text-sm'
                            >
                              <div className='flex flex-wrap items-center gap-2'>
                                <Badge
                                  variant={
                                    revision.isLatest ? 'default' : 'outline'
                                  }
                                >
                                  Rev {revision.revision}
                                </Badge>
                                <Badge
                                  variant={
                                    isRevisionSuperseded
                                      ? 'secondary'
                                      : 'outline'
                                  }
                                >
                                  {statusLabel(revision.status)}
                                </Badge>
                                {revision.mimeType && (
                                  <span className='ml-auto text-xs text-muted-foreground'>
                                    {formatBytes(revision.sizeBytes)}
                                  </span>
                                )}
                              </div>
                              <p className='mt-1 truncate text-xs text-muted-foreground'>
                                {revision.fileName || revision.title}
                              </p>
                              <div className='mt-2 flex flex-wrap gap-2'>
                                {revision.downloadUrl && (
                                  <Button asChild size='sm' variant='outline'>
                                    <a href={revision.downloadUrl} download>
                                      <Download className='mr-2 h-4 w-4' />
                                      Download
                                    </a>
                                  </Button>
                                )}
                                {canSubmitRevisionReview &&
                                  revision.id &&
                                  revision.status === 'uploaded' && (
                                    <Button
                                      size='sm'
                                      variant='outline'
                                      disabled={submitRevisionReview.isPending}
                                      onClick={async () => {
                                        try {
                                          await submitRevisionReview.mutateAsync(
                                            {
                                              revisionId: revision.id || '',
                                              comment: 'Submitted for review',
                                            }
                                          )
                                          toast.success('Revision submitted')
                                        } catch (error) {
                                          handleServerError(error)
                                        }
                                      }}
                                    >
                                      <Send className='mr-2 h-4 w-4' />
                                      Submit
                                    </Button>
                                  )}
                                {canApproveRevision &&
                                  revision.id &&
                                  revision.status !== 'approved' &&
                                  !isRevisionSuperseded && (
                                    <Button
                                      size='sm'
                                      variant='outline'
                                      onClick={() =>
                                        setDecisionTarget({
                                          kind: 'revision',
                                          mode: 'approve',
                                          action: 'approve',
                                          id: revision.id || '',
                                          label: `Rev ${revision.revision}`,
                                        })
                                      }
                                    >
                                      <CheckCircle2 className='mr-2 h-4 w-4' />
                                      Approve
                                    </Button>
                                  )}
                                {canSupersedeRevision &&
                                  revision.id &&
                                  !isRevisionSuperseded && (
                                    <Button
                                      size='sm'
                                      variant='outline'
                                      onClick={() =>
                                        setDecisionTarget({
                                          kind: 'revision',
                                          mode: 'reject',
                                          action: 'supersede',
                                          id: revision.id || '',
                                          label: `Rev ${revision.revision}`,
                                        })
                                      }
                                    >
                                      <XCircle className='mr-2 h-4 w-4' />
                                      Supersede
                                    </Button>
                                  )}
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <p className='text-sm text-muted-foreground'>
                          No revision snapshots
                        </p>
                      )}
                    </div>
                  </div>

                  {canUploadRevision &&
                    revisionTarget &&
                    revisionTarget.recordType !== 'correspondence' && (
                      <div className='space-y-3 border-t pt-3'>
                        <div className='flex items-center gap-2 text-sm font-semibold'>
                          <UploadCloud className='h-4 w-4' />
                          Upload revision
                        </div>
                        <div className='grid gap-2 sm:grid-cols-2'>
                          <div className='space-y-1'>
                            <Label htmlFor='doc-revision-code'>Revision</Label>
                            <Input
                              id='doc-revision-code'
                              value={revisionCode}
                              onChange={(event) =>
                                setRevisionCode(event.target.value)
                              }
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label htmlFor='doc-revision-file'>File</Label>
                            <Input
                              id='doc-revision-file'
                              ref={revisionFileInputRef}
                              type='file'
                              onChange={(event) =>
                                setRevisionFile(event.target.files?.[0] ?? null)
                              }
                            />
                          </div>
                          <div className='space-y-1 sm:col-span-2'>
                            <Label htmlFor='doc-revision-title'>Title</Label>
                            <Input
                              id='doc-revision-title'
                              value={revisionTitle}
                              onChange={(event) =>
                                setRevisionTitle(event.target.value)
                              }
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label htmlFor='doc-revision-category'>
                              Category
                            </Label>
                            <Input
                              id='doc-revision-category'
                              value={revisionCategory}
                              onChange={(event) =>
                                setRevisionCategory(event.target.value)
                              }
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label htmlFor='doc-revision-discipline'>
                              Discipline
                            </Label>
                            <Input
                              id='doc-revision-discipline'
                              value={revisionDiscipline}
                              onChange={(event) =>
                                setRevisionDiscipline(event.target.value)
                              }
                            />
                          </div>
                          <div className='space-y-1 sm:col-span-2'>
                            <Label htmlFor='doc-revision-folder'>
                              Folder path
                            </Label>
                            <Input
                              id='doc-revision-folder'
                              value={revisionFolderPath}
                              onChange={(event) =>
                                setRevisionFolderPath(event.target.value)
                              }
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label htmlFor='doc-revision-review-due'>
                              Review due
                            </Label>
                            <Input
                              id='doc-revision-review-due'
                              type='date'
                              value={revisionReviewDueAt}
                              onChange={(event) =>
                                setRevisionReviewDueAt(event.target.value)
                              }
                            />
                          </div>
                          <div className='space-y-1'>
                            <Label>Status</Label>
                            <Select
                              value={revisionStatus}
                              onValueChange={(value) =>
                                setRevisionStatus(
                                  value as 'uploaded' | 'submitted'
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='submitted'>
                                  Submit for review
                                </SelectItem>
                                <SelectItem value='uploaded'>
                                  Upload only
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className='space-y-1 sm:col-span-2'>
                            <Label htmlFor='doc-revision-notes'>Notes</Label>
                            <Textarea
                              id='doc-revision-notes'
                              value={revisionNotes}
                              onChange={(event) =>
                                setRevisionNotes(event.target.value)
                              }
                            />
                          </div>
                        </div>
                        <Button
                          className='w-full'
                          disabled={
                            uploadRevision.isPending ||
                            !revisionCode ||
                            !revisionFile
                          }
                          onClick={handleRevisionUpload}
                        >
                          <UploadCloud className='mr-2 h-4 w-4' />
                          Upload
                        </Button>
                      </div>
                    )}
                </>
              ) : (
                <div className='rounded border p-4 text-sm text-muted-foreground'>
                  No document selected
                </div>
              )}
            </aside>
          </div>
        </TabsContent>

        <TabsContent value='rfi' className='space-y-2'>
          {canCreateRfi && (
            <div className='grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_max-content]'>
              <Input
                placeholder='RFI subject'
                value={rfiSubject}
                onChange={(e) => setRfiSubject(e.target.value)}
              />
              <Select
                value={rfiOwnerPartyId}
                onValueChange={setRfiOwnerPartyId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {partyItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={createRfi.isPending || !rfiSubject}
                onClick={async () => {
                  try {
                    await createRfi.mutateAsync({
                      subject: rfiSubject,
                      ownerPartyId:
                        rfiOwnerPartyId !== NO_PARTY_VALUE
                          ? rfiOwnerPartyId
                          : undefined,
                    })
                    setRfiSubject('')
                    setRfiOwnerPartyId(NO_PARTY_VALUE)
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
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <RfiSavedViews
              projectId={projectId}
              current={{
                status: rfiStatus,
                priority: rfiPriority,
                search: rfiSearch,
                sortBy: rfiSortBy,
                sortDir: rfiSortDir,
                ballInCourtUserId: rfiBallInCourt,
                overdue: rfiOverdue,
              }}
              onApply={(view) => {
                setRfiCursor(null)
                setRfiStatus(view.status ?? 'all')
                setRfiPriority(view.priority ?? 'all')
                setRfiSearch(view.search ?? '')
                setRfiSortBy(view.sortBy ?? 'created')
                setRfiSortDir(view.sortDir ?? 'desc')
                setRfiBallInCourt(view.ballInCourtUserId ?? null)
                setRfiOverdue(Boolean(view.overdue))
              }}
            />
            <div className='flex flex-wrap items-center gap-2'>
              <label className='flex h-9 items-center gap-2 text-sm'>
                <Switch
                  checked={rfiBallInCourt === 'me'}
                  onCheckedChange={(checked) => {
                    setRfiCursor(null)
                    setRfiBallInCourt(checked ? 'me' : null)
                  }}
                  data-testid='uat-rfi-mine'
                />
                Waiting on me
              </label>
              <label className='flex h-9 items-center gap-2 text-sm'>
                <Switch
                  checked={rfiOverdue}
                  onCheckedChange={(checked) => {
                    setRfiCursor(null)
                    setRfiOverdue(checked)
                  }}
                  data-testid='uat-rfi-overdue'
                />
                Overdue
              </label>
              {canCreateRfi && (
                <Button
                  size='sm'
                  onClick={() => setRfiCreateOpen(true)}
                  data-testid='uat-rfi-new'
                >
                  New RFI
                </Button>
              )}
            </div>
          </div>
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
                <SelectItem value='draft'>Draft</SelectItem>
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
            projectId={projectId}
            recordType='rfi'
            exportName='rfi'
            rows={rfis?.rows}
            emptyText='No RFI records'
            getRef={(row) => row.ref}
            getTitle={(row) => row.subject}
            getSubtitle={(row) => row.question || row.response}
            getStatus={(row) => row.status}
            renderMeta={(row) => (
              <div className='flex flex-wrap gap-2'>
                <Badge
                  variant={
                    row.priority === 'urgent' ? 'destructive' : 'outline'
                  }
                >
                  {row.priority}
                </Badge>
                {row.ownerParty?.companyName ? (
                  <Badge variant='secondary'>
                    {row.ownerParty.companyName}
                  </Badge>
                ) : null}
                {row.reviewerParty?.companyName ? (
                  <Badge variant='outline'>
                    {row.reviewerParty.companyName}
                  </Badge>
                ) : null}
              </div>
            )}
            renderActions={(row) =>
              row.status === 'draft' ||
              row.status === 'open' ||
              row.status === 'answered' ||
              row.status === 'closed' ? (
                <>
                  <Button
                    size='sm'
                    onClick={() => setRfiDetailId(row.id)}
                    data-testid='uat-rfi-open'
                  >
                    <Eye className='mr-2 h-4 w-4' />
                    Open
                  </Button>
                  {(row.status === 'draft' || row.status === 'open') &&
                    canSubmitRfi && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={async () => {
                          try {
                            await submitRfi.mutateAsync({
                              rfiId: row.id,
                              comment:
                                'Submitted from document control register',
                            })
                            toast.success('RFI submitted')
                          } catch (error) {
                            handleServerError(error)
                          }
                        }}
                      >
                        Submit
                      </Button>
                    )}
                  {row.status === 'open' && canAnswerRfi && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={async () => {
                        const response = window.prompt('RFI response')
                        if (!response) return
                        try {
                          await answerRfi.mutateAsync({
                            rfiId: row.id,
                            payload: { response },
                          })
                          toast.success('RFI answered')
                        } catch (error) {
                          handleServerError(error)
                        }
                      }}
                    >
                      Answer
                    </Button>
                  )}
                  {row.status === 'answered' && canApproveRfi && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() =>
                        setDecisionTarget({
                          kind: 'rfi',
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
                  {row.status !== 'closed' && canCloseRfi && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={async () => {
                        const comment = window.prompt('Close comment')
                        if (!comment) return
                        try {
                          await closeRfi.mutateAsync({ rfiId: row.id, comment })
                          toast.success('RFI closed')
                        } catch (error) {
                          handleServerError(error)
                        }
                      }}
                    >
                      Close
                    </Button>
                  )}
                  {row.status !== 'open' && canReopenRfi && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={async () => {
                        const reason = window.prompt('Reopen reason')
                        if (!reason) return
                        try {
                          await reopenRfi.mutateAsync({ rfiId: row.id, reason })
                          toast.success('RFI reopened')
                        } catch (error) {
                          handleServerError(error)
                        }
                      }}
                    >
                      Reopen
                    </Button>
                  )}
                  {row.status === 'answered' && canRejectRfi && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() =>
                        setDecisionTarget({
                          kind: 'rfi',
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
              ) : null
            }
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
                onClick={() =>
                  setRfiCursor(rfis?.pagination?.nextCursor ?? null)
                }
              >
                Next page
              </Button>
            </div>
          </div>
          <RfiCreateDialog
            key={`rfi-create-${rfiCreateOpen ? 'open' : 'closed'}`}
            projectId={projectId}
            open={rfiCreateOpen}
            onOpenChange={setRfiCreateOpen}
            partyItems={partyItems
              .filter((item) => item.id !== NO_PARTY_VALUE)
              .map((item) => ({ id: item.id, label: item.label }))}
            onCreated={(rfi) => setRfiDetailId(rfi.id)}
          />
          <RfiDetailDialog
            projectId={projectId}
            rfiId={rfiDetailId}
            onOpenChange={(open) => {
              if (!open) setRfiDetailId(null)
            }}
          />
          <AuditHistoryPanel
            projectId={projectId}
            entityType='rfi'
            title='RFI Audit History'
            limit={8}
          />
        </TabsContent>

        <TabsContent value='submittals' className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <Tabs
              value={submittalView}
              onValueChange={(value) =>
                setSubmittalView(value as typeof submittalView)
              }
            >
              <TabsList>
                <TabsTrigger value='register'>Register</TabsTrigger>
                <TabsTrigger
                  value='packages'
                  data-testid='uat-sub-packages-tab'
                >
                  Packages
                </TabsTrigger>
                <TabsTrigger
                  value='workflows'
                  data-testid='uat-sub-workflows-tab'
                >
                  Workflows
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {submittalView === 'register' && (
              <>
                <div className='flex items-center gap-1'>
                  <Switch
                    id='submittal-mine'
                    checked={submittalMine}
                    onCheckedChange={(checked) => {
                      setSubmittalCursor(null)
                      setSubmittalMine(checked)
                    }}
                    data-testid='uat-sub-mine'
                  />
                  <Label htmlFor='submittal-mine' className='text-xs'>
                    Waiting on me
                  </Label>
                </div>
                <div className='flex items-center gap-1'>
                  <Switch
                    id='submittal-late'
                    checked={submittalLate}
                    onCheckedChange={(checked) => {
                      setSubmittalCursor(null)
                      setSubmittalLate(checked)
                    }}
                    data-testid='uat-sub-late'
                  />
                  <Label htmlFor='submittal-late' className='text-xs'>
                    Late
                  </Label>
                </div>
              </>
            )}
            {canCreateSubmittal && (
              <Button
                className='ml-auto'
                size='sm'
                data-testid='uat-sub-new'
                onClick={() => setSubmittalCreateOpen(true)}
              >
                New submittal
              </Button>
            )}
          </div>
          {submittalView === 'packages' && (
            <SubmittalPackagesPanel
              projectId={projectId}
              onOpenSubmittal={setSubmittalDetailId}
            />
          )}
          {submittalView === 'workflows' && (
            <SubmittalWorkflowList
              projectId={projectId}
              canEdit={canUpdateSubmittal}
            />
          )}
          <div
            className='grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_repeat(3,max-content)]'
            hidden={submittalView !== 'register'}
          >
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
          <div hidden={submittalView !== 'register'}>
            <WorkflowRecordList
              projectId={projectId}
              recordType='submittal'
              exportName='submittal'
              rows={submittals?.rows}
              emptyText='No submittals'
              getRef={(row) => row.ref}
              getTitle={(row) => row.title}
              getSubtitle={(row) => row.remarks}
              getStatus={(row) => row.status}
              renderMeta={(row) => (
                <div className='flex flex-wrap gap-2'>
                  <Badge variant='outline'>Rev {row.revision}</Badge>
                  {row.responseCodeLabel ? (
                    <Badge variant='secondary'>{row.responseCodeLabel}</Badge>
                  ) : null}
                  {row.submitBy &&
                  ['pending', 'resubmit', 'rejected'].includes(row.status) &&
                  new Date(row.submitBy) < new Date() ? (
                    <Badge variant='destructive'>Past submit-by</Badge>
                  ) : row.submitBy &&
                    ['pending', 'resubmit', 'rejected'].includes(row.status) ? (
                    <Badge variant='outline'>
                      Submit by {new Date(row.submitBy).toLocaleDateString()}
                    </Badge>
                  ) : null}
                  {row.reviewerParty?.companyName ? (
                    <Badge variant='secondary'>
                      {row.reviewerParty.companyName}
                    </Badge>
                  ) : null}
                  {row.ownerParty?.companyName ? (
                    <Badge variant='outline'>
                      {row.ownerParty.companyName}
                    </Badge>
                  ) : null}
                </div>
              )}
              renderActions={(row) =>
                row.status ? (
                  <>
                    <Button
                      size='sm'
                      variant='outline'
                      data-testid='uat-sub-open'
                      onClick={() => setSubmittalDetailId(row.id)}
                    >
                      <Eye className='mr-2 h-4 w-4' />
                      Open
                    </Button>
                    {['pending', 'resubmit', 'rejected'].includes(row.status) &&
                      canSubmitSubmittal && (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={async () => {
                            const revision =
                              window.prompt('Revision code', row.revision) ||
                              row.revision
                            try {
                              await submitSubmittal.mutateAsync({
                                submittalId: row.id,
                                payload: { revision },
                              })
                              toast.success('Submittal submitted')
                            } catch (error) {
                              handleServerError(error)
                            }
                          }}
                        >
                          Submit
                        </Button>
                      )}
                    {row.status === 'under_review' && canReviewSubmittal && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={async () => {
                          const comment = window.prompt('Review comment')
                          if (!comment) return
                          try {
                            await reviewSubmittal.mutateAsync({
                              submittalId: row.id,
                              comment,
                            })
                            toast.success('Review recorded')
                          } catch (error) {
                            handleServerError(error)
                          }
                        }}
                      >
                        Review
                      </Button>
                    )}
                    {row.status === 'under_review' && canResubmitSubmittal && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={async () => {
                          const reason = window.prompt('Resubmit reason')
                          if (!reason) return
                          try {
                            await resubmitSubmittal.mutateAsync({
                              submittalId: row.id,
                              payload: { reason },
                            })
                            toast.success('Resubmission requested')
                          } catch (error) {
                            handleServerError(error)
                          }
                        }}
                      >
                        Resubmit
                      </Button>
                    )}
                    {row.status === 'under_review' && canApproveSubmittal && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          setDecisionTarget({
                            kind: 'submittal',
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
                    {row.status === 'under_review' && canRejectSubmittal && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          setDecisionTarget({
                            kind: 'submittal',
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
                ) : null
              }
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
                    setSubmittalCursor(
                      submittals?.pagination?.nextCursor ?? null
                    )
                  }
                >
                  Next page
                </Button>
              </div>
            </div>
          </div>
          {submittalCreateOpen && (
            <SubmittalCreateDialog
              key={`submittal-create-${submittalCreateOpen ? 'open' : 'closed'}`}
              projectId={projectId}
              open={submittalCreateOpen}
              onOpenChange={setSubmittalCreateOpen}
              partyItems={partyItems
                .filter((item) => item.id !== NO_PARTY_VALUE)
                .map((item) => ({ id: item.id, label: item.label }))}
              onCreated={(submittal) => setSubmittalDetailId(submittal.id)}
            />
          )}
          <SubmittalDetailDialog
            projectId={projectId}
            submittalId={submittalDetailId}
            onOpenChange={(open) => {
              if (!open) setSubmittalDetailId(null)
            }}
          />
          <AuditHistoryPanel
            projectId={projectId}
            entityType='submittal'
            title='Submittal Audit History'
            limit={8}
          />
        </TabsContent>

        <TabsContent value='drawings' className='space-y-2'>
          <DrawingsModule
            projectId={projectId}
            initialTarget={initialTarget}
            legacy={
              <>
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
                  projectId={projectId}
                  recordType='drawing'
                  exportName='drawing'
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
              </>
            }
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
            projectId={projectId}
            recordType='transmittal'
            exportName='transmittal'
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
            {(correspondenceRecordTypes?.items ?? []).length > 0 && (
              <Select
                value={correspondenceRecordType || '__none__'}
                onValueChange={(value) =>
                  setCorrespondenceRecordType(value === '__none__' ? '' : value)
                }
              >
                <SelectTrigger
                  className='w-56'
                  aria-label='Correspondence type'
                  data-testid='uat-correspondence-record-type'
                >
                  <SelectValue placeholder='Type' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='__none__'>Plain letter</SelectItem>
                  {(correspondenceRecordTypes?.items ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              disabled={
                createCorrespondence.isPending || !correspondenceSubject
              }
              onClick={async () => {
                try {
                  const selectedType = (
                    correspondenceRecordTypes?.items ?? []
                  ).find((item) => item.key === correspondenceRecordType)
                  const typeDefaults = (selectedType?.settings?.defaults ??
                    {}) as {
                    direction?: 'incoming' | 'outgoing'
                    type?: 'letter' | 'email' | 'memo' | 'notice'
                  }
                  await createCorrespondence.mutateAsync({
                    direction: typeDefaults.direction ?? 'outgoing',
                    type: typeDefaults.type ?? 'letter',
                    recordTypeKey: selectedType?.key ?? null,
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
            projectId={projectId}
            recordType='correspondence'
            exportName='correspondence'
            rows={correspondence?.rows}
            emptyText='No correspondence records'
            getRef={(row) => row.ref}
            getTitle={(row) => row.subject}
            getSubtitle={(row) =>
              `${row.direction} ${row.type}${correspondenceTypeLabel(row.recordTypeKey) ? ` · ${correspondenceTypeLabel(row.recordTypeKey)}` : ''}`
            }
            getStatus={(row) => row.status}
          />
        </TabsContent>
      </Tabs>
      <WorkflowDecisionDialog
        open={!!decisionTarget}
        onOpenChange={(open) => {
          if (!open) setDecisionTarget(null)
        }}
        mode={decisionTarget?.mode ?? 'approve'}
        title={`${decisionTarget?.mode === 'reject' ? 'Disapprove' : 'Approve'} ${decisionTarget?.label ?? 'record'}`}
        description={
          decisionTarget?.kind === 'revision' &&
          decisionTarget.action === 'supersede'
            ? 'A supersede reason is required.'
            : decisionTarget?.mode === 'reject'
              ? 'A reason is required.'
              : 'Add an optional comment.'
        }
        isPending={decisionPending}
        onConfirm={handleDecision}
      />
    </div>
  )
}
