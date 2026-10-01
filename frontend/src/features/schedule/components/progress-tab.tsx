import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  Save,
  Send,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import {
  projectSetupReadinessKey,
  useProjectSetupReadiness,
} from '@/features/projects/hooks/use-projects'
import { QUANTITY_TERMS } from '@/lib/financial-terms'
import {
  quantityEntriesOf,
  withheldReason,
  type ActivityProgressExtras,
  type ProgressMethod,
  type ProgressSource,
  type ProgressSubmission,
  type QuantityProgressEntry,
  type ScheduleActivity,
  type SubmissionExtras,
} from '../data/schema'

interface Props {
  activities: ScheduleActivity[]
  projectId: string
}

type SubmissionRow = NonNullable<ProgressSubmission> & SubmissionExtras

// ─── PC-6: PROGRESS SOURCE ───
// Every official and every pending figure says where it came from: the
// daily log and its date, the submission, the import, who and when. The
// server's structured provenance is read first; a server without it (or an
// older row) falls back to the approvedProgressSource string. Nothing here
// computes a figure.
const SOURCE_WORD: Record<string, string> = {
  manual: 'Manual submission',
  mobile: 'Mobile capture',
  daily_log: 'Daily log',
  daily_report: 'Daily report',
  import: 'Progress import',
  submission: 'Submission',
}

const sourceWord = (source: string | null | undefined) =>
  source ? (SOURCE_WORD[source] ?? source.replace(/_/g, ' ')) : null

const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : null

type SourceStory = { headline: string; details: string[] }

const describeSource = (
  provenance: ProgressSource | null | undefined,
  fallback: { source?: string | null; at?: string | null } = {}
): SourceStory | null => {
  if (provenance) {
    const dates = provenance.dailyLogDates?.length
      ? provenance.dailyLogDates
      : provenance.dailyLogDate
        ? [provenance.dailyLogDate]
        : []
    const headline =
      provenance.label ??
      [
        sourceWord(provenance.source) ?? 'Progress',
        dates.length ? dates.join(', ') : null,
        provenance.importFileName ?? null,
      ]
        .filter(Boolean)
        .join(' ')
    const details: string[] = []
    const submitter = provenance.submittedByName ?? provenance.submittedBy
    if (submitter || provenance.submittedAt) {
      details.push(
        [
          'Submitted',
          submitter ? `by ${submitter}` : null,
          when(provenance.submittedAt),
        ]
          .filter(Boolean)
          .join(' ')
      )
    }
    const approver = provenance.approvedByName ?? provenance.approvedBy
    if (approver || provenance.approvedAt) {
      details.push(
        [
          'Approved',
          approver ? `by ${approver}` : null,
          when(provenance.approvedAt),
        ]
          .filter(Boolean)
          .join(' ')
      )
    }
    if (provenance.entryCount != null) {
      details.push(
        `${provenance.entryCount} quantity entr${provenance.entryCount === 1 ? 'y' : 'ies'}`
      )
    }
    if (provenance.basis) details.push(provenance.basis.replace(/_/g, ' '))
    return { headline, details }
  }
  const word = sourceWord(fallback.source)
  if (!word) return null
  const at = when(fallback.at)
  return { headline: word, details: at ? [`Approved ${at}`] : [] }
}

function ProgressSourceCell({
  story,
  kind,
  testId,
}: {
  story: SourceStory | null
  kind: 'official' | 'pending'
  testId: string
}) {
  return (
    <div
      className='min-w-0 text-xs'
      data-testid={testId}
      data-progress-source-kind={kind}
    >
      <p className='text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'>
        Progress source
      </p>
      {story ? (
        <>
          <p className='font-medium' data-progress-source-headline={story.headline}>
            {story.headline}
          </p>
          {story.details.length > 0 && (
            <p className='text-muted-foreground'>{story.details.join(' · ')}</p>
          )}
        </>
      ) : (
        <p className='text-muted-foreground' data-progress-source-headline=''>
          — {kind === 'official' ? 'No approved progress yet' : 'Not stated'}
        </p>
      )}
    </div>
  )
}

const extrasOf = (activity: ScheduleActivity) =>
  activity as ScheduleActivity & ActivityProgressExtras

const entryItemLabel = (entry: QuantityProgressEntry) =>
  [entry.boqItem?.code, entry.boqItem?.description].filter(Boolean).join(' · ') ||
  entry.boqItemId ||
  'BOQ item'

/** The entries a submission bundles: quantity + unit per item, "—" + reason when withheld. */
function BundledEntries({
  submission,
}: {
  submission: SubmissionRow
}) {
  const { entries, reason } = quantityEntriesOf(
    submission.quantityEntries ?? submission.entries
  )
  if (!entries.length && !reason) return null
  return (
    <div
      className='mt-2 rounded-md border bg-muted/30 p-2 text-xs'
      data-testid={`uat-progress-queue-entries-${submission.id}`}
    >
      <p className='text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'>
        Bundled quantity entries
      </p>
      {reason && (
        <p className='text-muted-foreground' data-withheld-reason={reason}>
          — {reason}
        </p>
      )}
      {entries.length > 0 && (
        <ul className='mt-1 space-y-0.5'>
          {entries.map((entry) => {
            const withheld = withheldReason(
              entry.withheld,
              'Withheld by the server'
            )
            const absent =
              withheld ?? (entry.quantity == null ? 'Not stated' : null)
            const unit = entry.unitCode ?? entry.boqItem?.unitCode ?? entry.boqItem?.unit ?? ''
            const story = describeSource(entry.progressSource, {
              source: entry.source,
            })
            return (
              <li
                key={entry.id}
                className='flex flex-wrap items-baseline justify-between gap-x-3'
                data-testid={`uat-progress-queue-entry-${entry.id}`}
              >
                <span className='min-w-0'>
                  {entryItemLabel(entry)}
                  <span className='ml-1 text-muted-foreground'>
                    {[
                      story?.headline,
                      entry.dailyLogDate ?? entry.date ?? null,
                      entry.location?.name ?? null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className='tabular-nums'>
                  {absent ? (
                    <span
                      className='text-muted-foreground'
                      title={absent}
                      data-withheld-reason={absent}
                    >
                      — {absent}
                    </span>
                  ) : (
                    <span data-entry-quantity={entry.quantity ?? ''} data-entry-unit={unit}>
                      {Number(entry.quantity).toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}{' '}
                      {unit}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Installed / planned for a quantity-method activity, read from the
 * server (installedByActivity, plannedQuantityFor): one installed figure per
 * BOQ item in its own unit, never summed; the planned figure with its basis
 * (approved allocations, or the figure typed on the method) on hover.
 */
function InstalledPlanned({ activity }: { activity: ScheduleActivity }) {
  const extras = extrasOf(activity)
  const installed = extras.installedQuantity ?? null
  const planned = extras.plannedQuantity ?? null
  const installedReason =
    withheldReason(installed?.withheld, 'Withheld by the server') ??
    withheldReason(installed?.notAvailable, 'Not available') ??
    (installed?.installed?.length ? null : 'Not reported by this server yet')
  const plannedValue = planned?.planned ?? planned?.value ?? null
  const plannedReason =
    withheldReason(planned?.withheld, 'Withheld by the server') ??
    withheldReason(planned?.notAvailable, 'Not available') ??
    (plannedValue == null
      ? planned?.basis === 'none'
        ? 'No approved allocation and no planned quantity on the method'
        : 'Not reported by this server yet'
      : null)
  const plannedBasis =
    planned?.basis === 'approved_allocations'
      ? 'Σ approved allocation quantities for this activity'
      : planned?.basis === 'method_config'
        ? 'The planned quantity typed on the progress method'
        : (planned?.basis ?? QUANTITY_TERMS.planned.hint)
  return (
    <div
      className='grid gap-2 rounded-md border p-2 text-xs sm:grid-cols-2'
      data-testid={`uat-progress-installed-planned-${activity.id}`}
    >
      <div>
        <p
          className='text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'
          title={QUANTITY_TERMS.installed.hint}
        >
          {QUANTITY_TERMS.installed.label}
        </p>
        {installedReason ? (
          <p
            className='text-muted-foreground'
            data-testid={`uat-progress-installed-${activity.id}`}
            data-absent='true'
            title={installedReason}
          >
            — {installedReason}
          </p>
        ) : (
          <ul data-testid={`uat-progress-installed-${activity.id}`}>
            {installed!.installed!.map((row, index) => {
              const rowReason = withheldReason(row.withheld, 'Withheld by the server')
              return (
                <li
                  key={row.boqItemId ?? index}
                  className='flex justify-between gap-2'
                  title={installed?.basis ?? QUANTITY_TERMS.installed.hint}
                >
                  <span className='truncate text-muted-foreground'>
                    {[row.code, row.description].filter(Boolean).join(' · ') ||
                      row.boqItemId}
                  </span>
                  <span className='tabular-nums'>
                    {rowReason || row.quantity == null ? (
                      <span className='text-muted-foreground' title={rowReason ?? undefined}>
                        — {rowReason ?? ''}
                      </span>
                    ) : (
                      <span data-installed-quantity={row.quantity} data-installed-unit={row.unitCode ?? ''}>
                        {Number(row.quantity).toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}{' '}
                        {row.unitCode ?? ''}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {installed?.asOf && (
          <p className='text-[10px] text-muted-foreground/80'>
            As of {when(installed.asOf)}
          </p>
        )}
      </div>
      <div>
        <p
          className='text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'
          title={QUANTITY_TERMS.planned.hint}
        >
          {QUANTITY_TERMS.planned.label}
        </p>
        {plannedReason ? (
          <p
            className='text-muted-foreground'
            data-testid={`uat-progress-planned-${activity.id}`}
            data-absent='true'
            title={plannedReason}
          >
            — {plannedReason}
          </p>
        ) : (
          <p
            className='tabular-nums'
            data-testid={`uat-progress-planned-${activity.id}`}
            data-planned-quantity={plannedValue ?? ''}
            data-planned-basis={planned?.basis ?? ''}
            title={plannedBasis}
          >
            {Number(plannedValue).toLocaleString(undefined, {
              maximumFractionDigits: 3,
            })}{' '}
            {planned?.unitCode ?? ''}
            <span className='ml-1 text-muted-foreground'>({plannedBasis})</span>
          </p>
        )}
      </div>
    </div>
  )
}

type RowDraft = {
  method: ProgressMethod
  pctComplete: number
  quantityComplete: string
  quantityPlanned: string
  quantityUnit: string
  evidenceRequired: boolean
  evidenceUrl: string
  inspectionStatus: string
  milestoneChecks: Record<string, boolean>
}

const METHOD_OPTIONS: ProgressMethod[] = [
  'percent',
  'quantity',
  'weighted_milestone',
  'inspection',
  'manual',
]

const METHOD_LABELS: Record<ProgressMethod, string> = {
  percent: 'Percent',
  quantity: 'Quantity',
  weighted_milestone: 'Weighted Milestones',
  inspection: 'Inspection',
  manual: 'Manual',
}

const INSPECTION_STATUSES = ['pending', 'passed', 'failed']

const DEFAULT_MILESTONES = [
  { id: 'start', name: 'Started', weight: 20 },
  { id: 'install', name: 'Installed', weight: 50 },
  { id: 'finish', name: 'Finished', weight: 30 },
]

const PROGRESS_ASSIGNMENT_OVERRIDE_ROLES = new Set(['pm', 'planning_eng'])

// A budget withheld from this member (no BOQ read — owner decision E1) reads
// as a dash, with the server's reason beside it where a row states it.
const fmtUSD = (n: number | undefined) =>
  n === undefined
    ? '—'
    : '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const today = () => new Date().toISOString().slice(0, 10)

const isProgressAssignmentOverride = (role?: string | null) =>
  PROGRESS_ASSIGNMENT_OVERRIDE_ROLES.has(String(role || '').toLowerCase())

const errorCodeFrom = (error: unknown) =>
  (
    error as {
      response?: { data?: { error?: { code?: string } } }
    }
  )?.response?.data?.error?.code

const asProgressMethod = (
  method: string | null | undefined
): ProgressMethod => {
  if (method === 'quantity') return 'quantity'
  if (method === 'weighted_milestone' || method === 'milestone') {
    return 'weighted_milestone'
  }
  if (method === 'inspection') return 'inspection'
  if (method === 'manual') return 'manual'
  return 'percent'
}

const milestoneRowsFor = (activity: ScheduleActivity) => {
  const rows = activity.progressMethodConfig?.milestoneWeights
  if (Array.isArray(rows) && rows.length) {
    return rows.map((row, index) => {
      const item = row as { id?: string; name?: string; weight?: number }
      return {
        id: item.id || item.name || String(index),
        name: item.name || item.id || `Milestone ${index + 1}`,
        weight: Number(item.weight || 0),
      }
    })
  }
  return DEFAULT_MILESTONES
}

const buildDefaultDraft = (activity: ScheduleActivity): RowDraft => ({
  method: asProgressMethod(
    activity.progressMethodConfig?.method || activity.progressMethod
  ),
  pctComplete:
    activity.pendingProgress?.pctComplete ?? activity.pctComplete ?? 0,
  quantityComplete: String(activity.pendingProgress?.quantityComplete ?? ''),
  quantityPlanned: String(
    activity.progressMethodConfig?.plannedQuantity ??
      activity.pendingProgress?.quantityPlanned ??
      ''
  ),
  quantityUnit:
    activity.progressMethodConfig?.quantityUnit ??
    activity.pendingProgress?.quantityUnit ??
    '',
  evidenceRequired: Boolean(activity.progressMethodConfig?.evidenceRequired),
  evidenceUrl: '',
  inspectionStatus: activity.pendingProgress?.inspectionStatus ?? 'pending',
  milestoneChecks: {},
})

export function ProgressTab({ activities, projectId }: Props) {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.auth.user)
  const { data: setupReadiness } = useProjectSetupReadiness(projectId)
  const canConfigureProgressMethod = useCanPerform(
    'progress',
    'update',
    'method.configure'
  )
  const canSubmitProgress = useCanPerform(
    'progress',
    'submit',
    'submission.submit'
  )
  const canApproveProgress = useCanPerform(
    'progress',
    'approve',
    'submission.approve'
  )
  const canRejectProgress = useCanPerform(
    'progress',
    'approve',
    'submission.reject'
  )
  const canSubmitDailyReport = useCanPerform(
    'progress',
    'submit',
    'daily_report.submit'
  )
  const [drafts, setDrafts] = useState<Record<string, Partial<RowDraft>>>({})
  const [dailyActivityId, setDailyActivityId] = useState('')
  const [dailyDate, setDailyDate] = useState(today())
  const [dailyPct, setDailyPct] = useState(0)
  const [dailyWorkers, setDailyWorkers] = useState('')
  const [dailyEquipmentHours, setDailyEquipmentHours] = useState('')
  const [dailyMaterial, setDailyMaterial] = useState('')
  const [dailyMaterialQty, setDailyMaterialQty] = useState('')
  const [dailyPhotoUrl, setDailyPhotoUrl] = useState('')
  const [dailyNotes, setDailyNotes] = useState('')

  const selectableActivities = useMemo(
    () => activities.filter((activity) => !activity.isMilestone),
    [activities]
  )
  const currentUserId = currentUser?.id ?? ''
  const currentUserRole = currentUser?.role ?? ''
  const assignmentOverride = useMemo(
    () => isProgressAssignmentOverride(currentUserRole),
    [currentUserRole]
  )
  const assignmentAllowedActivities = useMemo(() => {
    if (assignmentOverride) return selectableActivities
    if (!currentUserId) return []

    return selectableActivities.filter((activity) =>
      activity.assignedEngineers?.some(
        (engineer) => engineer.id === currentUserId
      )
    )
  }, [assignmentOverride, currentUserId, selectableActivities])
  const assignmentAllowedActivityIds = useMemo(
    () => new Set(assignmentAllowedActivities.map((activity) => activity.id)),
    [assignmentAllowedActivities]
  )
  const dailyReportActivities = useMemo(
    () => (canSubmitDailyReport ? assignmentAllowedActivities : []),
    [assignmentAllowedActivities, canSubmitDailyReport]
  )
  const dailyReportActivityIds = useMemo(
    () => new Set(dailyReportActivities.map((activity) => activity.id)),
    [dailyReportActivities]
  )
  const selectedDailyActivityId = dailyReportActivityIds.has(dailyActivityId)
    ? dailyActivityId
    : (dailyReportActivities[0]?.id ?? '')
  const dailyCanSubmitSelectedActivity = Boolean(
    selectedDailyActivityId &&
      dailyReportActivityIds.has(selectedDailyActivityId)
  )
  const dailyReportDisabled =
    !canSubmitDailyReport || !dailyCanSubmitSelectedActivity

  const pendingQuery = useQuery<SubmissionRow[]>({
    queryKey: ['progress-submissions', projectId, 'submitted'],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/activities/progress-submissions`, {
          params: { status: 'submitted' },
        })
        .then((r) => r.data.data as SubmissionRow[]),
    enabled: !!projectId,
  })

  const refreshProgress = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schedule', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['activities', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['ev-report', projectId] }),
      queryClient.invalidateQueries({
        queryKey: ['progress-submissions', projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ['daily-reports', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] }),
      queryClient.invalidateQueries({
        queryKey: projectSetupReadinessKey(projectId),
      }),
    ])
  }

  const saveMethod = useMutation({
    mutationFn: ({
      activity,
      draft,
    }: {
      activity: ScheduleActivity
      draft: RowDraft
    }) =>
      apiClient
        .put(
          `/projects/${projectId}/activities/${activity.id}/progress-method`,
          {
            method: draft.method,
            plannedQuantity:
              draft.quantityPlanned.trim() === ''
                ? null
                : Number(draft.quantityPlanned),
            quantityUnit: draft.quantityUnit || null,
            milestoneWeights:
              draft.method === 'weighted_milestone'
                ? milestoneRowsFor(activity)
                : null,
            evidenceRequired: draft.evidenceRequired,
          }
        )
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Progress method saved')
      await refreshProgress()
    },
    onError: () => toast.error('Failed to save progress method'),
  })

  const submitProgress = useMutation({
    mutationFn: ({
      activity,
      draft,
    }: {
      activity: ScheduleActivity
      draft: RowDraft
    }) => {
      const milestones = milestoneRowsFor(activity).map((row) => ({
        ...row,
        complete: Boolean(draft.milestoneChecks[row.id]),
      }))
      // PC-6: when the server derives the planned quantity from the
      // approved allocations, the client sends none — a typed figure must
      // not override the allocation-derived one (progress measurement §2).
      const planned = extrasOf(activity).plannedQuantity
      const plannedFromAllocations = planned?.basis === 'approved_allocations'
      const payload = {
        method: draft.method,
        pctComplete: draft.pctComplete,
        quantityComplete:
          draft.quantityComplete.trim() === ''
            ? undefined
            : Number(draft.quantityComplete),
        quantityPlanned: plannedFromAllocations
          ? undefined
          : draft.quantityPlanned.trim() === ''
            ? undefined
            : Number(draft.quantityPlanned),
        quantityUnit: plannedFromAllocations
          ? (planned?.unitCode ?? undefined)
          : draft.quantityUnit || undefined,
        inspectionStatus: draft.inspectionStatus,
        milestones:
          draft.method === 'weighted_milestone' ? milestones : undefined,
        evidence: draft.evidenceUrl.trim()
          ? { photos: [{ url: draft.evidenceUrl.trim() }] }
          : undefined,
      }

      return apiClient
        .post(
          `/projects/${projectId}/activities/${activity.id}/progress`,
          payload
        )
        .then((r) => r.data.data)
    },
    onSuccess: async () => {
      toast.success('Progress submitted')
      await refreshProgress()
    },
    onError: (error) =>
      toast.error(
        errorCodeFrom(error) === 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED'
          ? 'Only assigned users can submit progress for that activity'
          : 'Failed to submit progress'
      ),
  })

  const approveSubmission = useMutation({
    mutationFn: (submission: SubmissionRow) =>
      apiClient
        .post(
          `/projects/${projectId}/activities/${submission.activityId}/progress-submissions/${submission.id}/approve`
        )
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Progress approved')
      await refreshProgress()
    },
    onError: () => toast.error('Failed to approve progress'),
  })

  const rejectSubmission = useMutation({
    mutationFn: ({
      submission,
      reason,
    }: {
      submission: SubmissionRow
      reason: string
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/activities/${submission.activityId}/progress-submissions/${submission.id}/reject`,
          { reason }
        )
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Progress rejected')
      await refreshProgress()
    },
    onError: () => toast.error('Failed to reject progress'),
  })

  const createDailyReport = useMutation({
    mutationFn: () =>
      apiClient
        .post(`/projects/${projectId}/daily-reports`, {
          activityId: selectedDailyActivityId,
          date: dailyDate,
          pctProgress: dailyPct,
          manpower: dailyWorkers
            ? [{ trade: 'crew', workers: Number(dailyWorkers), hours: 8 }]
            : [],
          equipment: dailyEquipmentHours
            ? [{ name: 'site equipment', hours: Number(dailyEquipmentHours) }]
            : [],
          materials: dailyMaterial
            ? [
                {
                  name: dailyMaterial,
                  qty: Number(dailyMaterialQty || 0),
                  unit: 'unit',
                },
              ]
            : [],
          photos: dailyPhotoUrl ? [{ url: dailyPhotoUrl }] : [],
          notes: dailyNotes,
        })
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Daily report submitted')
      setDailyPct(0)
      setDailyWorkers('')
      setDailyEquipmentHours('')
      setDailyMaterial('')
      setDailyMaterialQty('')
      setDailyPhotoUrl('')
      setDailyNotes('')
      await refreshProgress()
    },
    onError: (error) =>
      toast.error(
        errorCodeFrom(error) === 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED'
          ? 'Only assigned users can submit reports for that activity'
          : 'Failed to submit daily report'
      ),
  })

  const ev = useMemo(() => {
    const totalBudget = selectableActivities.reduce(
      (sum, a) => sum + (a.budget || 0),
      0
    )
    const evValue = selectableActivities.reduce(
      (sum, a) => sum + ((a.pctComplete ?? 0) / 100) * (a.budget || 0),
      0
    )
    const pv = selectableActivities.reduce((sum, a) => {
      if (a.status === 'todo') return sum
      return sum + (a.budget || 0)
    }, 0)
    const ac = selectableActivities.reduce((sum, a) => {
      if (a.actualCost != null) return sum + a.actualCost
      return sum + ((a.pctComplete ?? 0) / 100) * (a.budget || 0) * 1.03
    }, 0)
    const missingActualCount = selectableActivities.filter(
      (a) => a.actualCost == null
    ).length
    const spi = pv > 0 ? evValue / pv : 1
    const cpi = ac > 0 ? evValue / ac : 1

    return { totalBudget, ev: evValue, pv, ac, spi, cpi, missingActualCount }
  }, [selectableActivities])
  // The server withholds the activity budgets from a member who may not
  // read the BOQ, cost readers included (owner decision E1); every estimate
  // here is built from them, so none is shown rather than a row of zeros.
  const budgetsWithheld = selectableActivities.some(
    (activity) => activity.budget === undefined
  )

  const draftFor = (activity: ScheduleActivity): RowDraft => ({
    ...buildDefaultDraft(activity),
    ...drafts[activity.id],
  })

  const progressGate = setupReadiness?.gates.progress
  const progressBlockers = progressGate?.blockers ?? []
  const officialProgressCount = selectableActivities.filter(
    (activity) => activity.progressApprovalStatus === 'approved'
  ).length
  const pendingProgressCount = selectableActivities.filter(
    (activity) => activity.pendingProgress
  ).length

  const patchDraft = (activityId: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [activityId]: {
        ...prev[activityId],
        ...patch,
      },
    }))
  }

  return (
    <div className='space-y-4'>
      {!budgetsWithheld && (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
          <div className='rounded-lg border p-3 text-center'>
            <p className='text-xs text-muted-foreground'>SPI Est.</p>
            <p
              className={`text-xl font-bold ${ev.spi < 0.9 ? 'text-red-600' : 'text-green-600'}`}
            >
              {ev.spi.toFixed(2)}
            </p>
          </div>
          <div className='rounded-lg border p-3 text-center'>
            <p className='text-xs text-muted-foreground'>CPI Est.</p>
            <p
              className={`text-xl font-bold ${ev.cpi < 0.9 ? 'text-red-600' : 'text-green-600'}`}
            >
              {ev.cpi.toFixed(2)}
            </p>
          </div>
          <div className='rounded-lg border p-3 text-center'>
            <p className='text-xs text-muted-foreground'>EV Est.</p>
            <p className='text-xl font-bold'>{fmtUSD(ev.ev)}</p>
          </div>
          <div className='rounded-lg border p-3 text-center'>
            <p className='text-xs text-muted-foreground'>PV Est.</p>
            <p className='text-xl font-bold'>{fmtUSD(ev.pv)}</p>
          </div>
          <div className='rounded-lg border p-3 text-center'>
            <p className='text-xs text-muted-foreground'>AC Est.</p>
            <p className='text-xl font-bold'>{fmtUSD(ev.ac)}</p>
          </div>
        </div>
      )}

      {progressBlockers.length > 0 && (
        <div className='rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100'>
          <div className='flex flex-wrap items-start gap-2'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            <div className='min-w-0 flex-1'>
              <p className='font-semibold'>Progress setup warnings</p>
              <p className='mt-1 text-xs opacity-90'>{progressGate?.message}</p>
              <ul className='mt-2 list-inside list-disc space-y-1 text-xs'>
                {progressBlockers.slice(0, 4).map((blocker) => (
                  <li key={`${blocker.stepKey}-${blocker.code}`}>
                    {blocker.stepLabel}: {blocker.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-100'>
          <div className='flex items-center gap-2 font-semibold'>
            <CheckCircle2 className='h-4 w-4' />
            Official approved progress
          </div>
          <p className='mt-1 text-xs opacity-90'>
            {officialProgressCount.toLocaleString()} activities have approved
            progress included in official EV.
          </p>
        </div>
        <div className='rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100'>
          <div className='flex items-center gap-2 font-semibold'>
            <Clock3 className='h-4 w-4' />
            Pending progress review
          </div>
          <p className='mt-1 text-xs opacity-90'>
            {pendingProgressCount.toLocaleString()} activities have draft or
            submitted progress held outside official EV.
          </p>
        </div>
      </div>

      <AuditHistoryPanel
        projectId={projectId}
        entityType='progress_submission'
        title='Progress Approval History'
        limit={10}
      />

      <div className='rounded-md border'>
        <div className='flex flex-wrap items-center justify-between gap-2 border-b p-3'>
          <div>
            <p className='text-sm font-semibold'>Approval Queue</p>
            <p className='text-xs text-muted-foreground'>
              {pendingQuery.data?.length ?? 0} submitted
            </p>
          </div>
          <Badge variant='outline'>Approved progress drives official EV</Badge>
        </div>
        <div className='divide-y'>
          {(pendingQuery.data ?? []).length === 0 && (
            <p className='p-3 text-sm text-muted-foreground'>
              No pending progress.
            </p>
          )}
          {(pendingQuery.data ?? []).map((submission) => (
            <div
              key={submission.id}
              className='flex flex-col gap-3 p-3 sm:flex-row sm:items-start'
              data-testid={`uat-progress-queue-${submission.id}`}
              data-activity-id={submission.activityId}
            >
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium'>
                  {submission.activity?.wbsCode
                    ? `${submission.activity.wbsCode} - `
                    : ''}
                  {submission.activity?.name ?? submission.activityId}
                </p>
                <p className='text-xs text-muted-foreground'>
                  {METHOD_LABELS[submission.method]} - {submission.pctComplete}%
                </p>
                <div className='mt-1'>
                  <ProgressSourceCell
                    kind='pending'
                    testId={`uat-progress-source-queue-${submission.id}`}
                    story={describeSource(submission.progressSource, {
                      source: submission.source,
                      at: submission.submittedAt,
                    })}
                  />
                </div>
                <BundledEntries submission={submission} />
              </div>
              {(canApproveProgress || canRejectProgress) && (
                <div className='flex gap-2'>
                  {canApproveProgress && (
                    <Button
                      size='sm'
                      onClick={() => approveSubmission.mutate(submission)}
                      disabled={approveSubmission.isPending}
                    >
                      <CheckCircle2 className='mr-1.5 h-4 w-4' />
                      Approve
                    </Button>
                  )}
                  {canRejectProgress && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        const reason = window.prompt('Rejection reason')
                        if (reason?.trim()) {
                          rejectSubmission.mutate({
                            submission,
                            reason: reason.trim(),
                          })
                        }
                      }}
                      disabled={rejectSubmission.isPending}
                    >
                      <XCircle className='mr-1.5 h-4 w-4' />
                      Reject
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className='divide-y rounded-md border'>
        {selectableActivities.map((activity) => {
          const draft = draftFor(activity)
          const milestones = milestoneRowsFor(activity)
          const assignmentAllowed = assignmentAllowedActivityIds.has(
            activity.id
          )
          const canSubmitThisActivity = canSubmitProgress && assignmentAllowed
          const extras = extrasOf(activity)
          const officialSource = describeSource(extras.progressSource, {
            source: activity.approvedProgressSource,
            at: activity.approvedProgressUpdatedAt,
          })
          const pending = activity.pendingProgress as
            | (NonNullable<ProgressSubmission> & SubmissionExtras)
            | null
            | undefined
          const pendingSource = pending
            ? describeSource(pending.progressSource, {
                source: pending.source,
                at: pending.submittedAt,
              })
            : null
          const plannedFromAllocations =
            extras.plannedQuantity?.basis === 'approved_allocations'
          return (
            <div
              key={activity.id}
              className='space-y-3 p-3'
              data-testid={`uat-progress-activity-${activity.id}`}
            >
              <div className='flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <p className='truncate text-sm font-medium'>
                      {activity.name}
                    </p>
                    <Badge variant='outline'>
                      {METHOD_LABELS[draft.method]}
                    </Badge>
                    {activity.pendingProgress && (
                      <Badge variant='secondary'>Pending</Badge>
                    )}
                    {canSubmitProgress && !assignmentOverride && (
                      <Badge
                        variant={assignmentAllowed ? 'secondary' : 'outline'}
                      >
                        {assignmentAllowed ? 'Assigned to you' : 'Not assigned'}
                      </Badge>
                    )}
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    {activity.category || '-'} - {activity.duration}d - Budget{' '}
                    {fmtUSD(activity.budget)}
                    {activity.budget === undefined &&
                      ' (Mapping details unavailable to you)'}{' '}
                    - Approved{' '}
                    <span data-testid={`uat-progress-approved-pct-${activity.id}`}>
                      {activity.pctComplete}%
                    </span>
                  </p>
                  <div className='mt-1 grid gap-2 sm:grid-cols-2'>
                    <ProgressSourceCell
                      kind='official'
                      testId={`uat-progress-source-official-${activity.id}`}
                      story={
                        activity.progressApprovalStatus === 'missing' &&
                        !extras.progressSource
                          ? null
                          : officialSource
                      }
                    />
                    {pending && (
                      <ProgressSourceCell
                        kind='pending'
                        testId={`uat-progress-source-pending-${activity.id}`}
                        story={pendingSource}
                      />
                    )}
                  </div>
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  <Select
                    value={draft.method}
                    disabled={!canConfigureProgressMethod}
                    onValueChange={(value) =>
                      patchDraft(activity.id, {
                        method: value as ProgressMethod,
                      })
                    }
                  >
                    <SelectTrigger size='sm' className='w-44'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHOD_OPTIONS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {METHOD_LABELS[method]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {canConfigureProgressMethod && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => saveMethod.mutate({ activity, draft })}
                      disabled={saveMethod.isPending}
                    >
                      <Save className='mr-1.5 h-4 w-4' />
                      Save Method
                    </Button>
                  )}
                </div>
              </div>

              {draft.method === 'quantity' && (
                <InstalledPlanned activity={activity} />
              )}

              <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_160px] lg:items-end'>
                {draft.method === 'quantity' ? (
                  <div className='grid grid-cols-3 gap-2'>
                    <div>
                      <Label className='text-xs'>Complete Qty</Label>
                      <Input
                        type='number'
                        min={0}
                        disabled={!canSubmitThisActivity}
                        value={draft.quantityComplete}
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            quantityComplete: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className='text-xs'>Planned Qty</Label>
                      {plannedFromAllocations ? (
                        // Derived by the server from the approved
                        // allocations: shown, never typed over (PC-6).
                        <Input
                          readOnly
                          disabled
                          title='Σ approved allocation quantities — set by the mapping, not typed here'
                          data-testid={`uat-progress-planned-readonly-${activity.id}`}
                          value={String(
                            extras.plannedQuantity?.planned ??
                              extras.plannedQuantity?.value ??
                              ''
                          )}
                        />
                      ) : (
                        <Input
                          type='number'
                          min={0}
                          disabled={!canSubmitThisActivity}
                          value={draft.quantityPlanned}
                          onChange={(e) =>
                            patchDraft(activity.id, {
                              quantityPlanned: e.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                    <div>
                      <Label className='text-xs'>Unit</Label>
                      <Input
                        disabled={!canSubmitThisActivity || plannedFromAllocations}
                        readOnly={plannedFromAllocations}
                        value={
                          plannedFromAllocations
                            ? (extras.plannedQuantity?.unitCode ?? '')
                            : draft.quantityUnit
                        }
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            quantityUnit: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                ) : draft.method === 'weighted_milestone' ? (
                  <div className='flex flex-wrap gap-3'>
                    {milestones.map((milestone) => (
                      <label
                        key={milestone.id}
                        className='flex items-center gap-2 rounded-md border px-3 py-2 text-sm'
                      >
                        <Checkbox
                          disabled={!canSubmitThisActivity}
                          checked={Boolean(draft.milestoneChecks[milestone.id])}
                          onCheckedChange={(checked) =>
                            patchDraft(activity.id, {
                              milestoneChecks: {
                                ...draft.milestoneChecks,
                                [milestone.id]: Boolean(checked),
                              },
                            })
                          }
                        />
                        <span>
                          {milestone.name} - {milestone.weight}%
                        </span>
                      </label>
                    ))}
                  </div>
                ) : draft.method === 'inspection' ? (
                  <div className='grid grid-cols-2 gap-2'>
                    <div>
                      <Label className='text-xs'>Inspection</Label>
                      <Select
                        value={draft.inspectionStatus}
                        disabled={!canSubmitThisActivity}
                        onValueChange={(value) =>
                          patchDraft(activity.id, { inspectionStatus: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INSPECTION_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className='text-xs'>Percent</Label>
                      <Input
                        type='number'
                        min={0}
                        max={100}
                        disabled={!canSubmitThisActivity}
                        value={draft.pctComplete}
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            pctComplete: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label className='text-xs'>Progress %</Label>
                    <div className='flex items-center gap-3'>
                      <input
                        type='range'
                        min={0}
                        max={100}
                        step={1}
                        value={draft.pctComplete}
                        disabled={!canSubmitThisActivity}
                        className='flex-1'
                        onChange={(e) =>
                          patchDraft(activity.id, {
                            pctComplete: Number(e.target.value),
                          })
                        }
                      />
                      <span className='w-10 text-right font-mono text-sm'>
                        {draft.pctComplete}%
                      </span>
                    </div>
                  </div>
                )}

                <div>
                  <Label className='text-xs'>Photo URL</Label>
                  <Input
                    value={draft.evidenceUrl}
                    disabled={!canSubmitThisActivity}
                    onChange={(e) =>
                      patchDraft(activity.id, { evidenceUrl: e.target.value })
                    }
                  />
                  <label className='mt-2 flex items-center gap-2 text-xs text-muted-foreground'>
                    <Checkbox
                      checked={draft.evidenceRequired}
                      disabled={!canConfigureProgressMethod}
                      onCheckedChange={(checked) =>
                        patchDraft(activity.id, {
                          evidenceRequired: Boolean(checked),
                        })
                      }
                    />
                    Evidence required
                  </label>
                </div>

                {canSubmitProgress && (
                  <Button
                    onClick={() => submitProgress.mutate({ activity, draft })}
                    disabled={
                      submitProgress.isPending || !canSubmitThisActivity
                    }
                    title={
                      canSubmitThisActivity
                        ? undefined
                        : 'Only assigned users can submit progress for this activity'
                    }
                  >
                    <Send className='mr-1.5 h-4 w-4' />
                    Submit
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className='rounded-md border p-3'>
        <div className='mb-3 flex flex-wrap items-center gap-2'>
          <ClipboardCheck className='h-4 w-4 text-muted-foreground' />
          <p className='text-sm font-semibold'>Daily Site Report</p>
        </div>
        <div className='grid gap-3 md:grid-cols-4'>
          <div>
            <Label className='text-xs'>Activity</Label>
            <Select
              value={selectedDailyActivityId}
              disabled={
                !canSubmitDailyReport || dailyReportActivities.length === 0
              }
              onValueChange={setDailyActivityId}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dailyReportActivities.map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                    {activity.name}
                  </SelectItem>
                ))}
                {dailyReportActivities.length === 0 && (
                  <div className='px-2 py-1.5 text-xs text-muted-foreground'>
                    No assigned activities
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className='text-xs'>Date</Label>
            <Input
              type='date'
              disabled={dailyReportDisabled}
              value={dailyDate}
              onChange={(e) => setDailyDate(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Progress %</Label>
            <Input
              type='number'
              min={0}
              max={100}
              disabled={dailyReportDisabled}
              value={dailyPct}
              onChange={(e) => setDailyPct(Number(e.target.value))}
            />
          </div>
          <div>
            <Label className='text-xs'>Workers</Label>
            <Input
              type='number'
              min={0}
              disabled={dailyReportDisabled}
              value={dailyWorkers}
              onChange={(e) => setDailyWorkers(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Equipment Hours</Label>
            <Input
              type='number'
              min={0}
              disabled={dailyReportDisabled}
              value={dailyEquipmentHours}
              onChange={(e) => setDailyEquipmentHours(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Material</Label>
            <Input
              disabled={dailyReportDisabled}
              value={dailyMaterial}
              onChange={(e) => setDailyMaterial(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Material Qty</Label>
            <Input
              type='number'
              min={0}
              disabled={dailyReportDisabled}
              value={dailyMaterialQty}
              onChange={(e) => setDailyMaterialQty(e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Photo URL</Label>
            <Input
              disabled={dailyReportDisabled}
              value={dailyPhotoUrl}
              onChange={(e) => setDailyPhotoUrl(e.target.value)}
            />
          </div>
        </div>
        <div className='mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px] lg:items-end'>
          <div>
            <Label className='text-xs'>Notes</Label>
            <Textarea
              disabled={dailyReportDisabled}
              value={dailyNotes}
              onChange={(e) => setDailyNotes(e.target.value)}
              className='min-h-20'
            />
          </div>
          <Button
            disabled={
              !canSubmitDailyReport ||
              !selectedDailyActivityId ||
              !dailyCanSubmitSelectedActivity ||
              createDailyReport.isPending
            }
            title={
              dailyCanSubmitSelectedActivity
                ? undefined
                : 'Only assigned users can submit reports for this activity'
            }
            onClick={() => createDailyReport.mutate()}
          >
            <Camera className='mr-1.5 h-4 w-4' />
            Submit Report
          </Button>
        </div>
      </div>

      {!budgetsWithheld && (
        <p className='text-xs text-muted-foreground'>
          Live estimate only. Total budget considered: {fmtUSD(ev.totalBudget)}.
          Missing actuals estimated for {ev.missingActualCount} activities;
          official reports use approved progress, cost records, and cutoff
          periods.
        </p>
      )}
    </div>
  )
}
