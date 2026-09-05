import { useState } from 'react'
import {
  CheckCircle2,
  FileText,
  History,
  Link2,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { handleServerError } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { EotAssessmentCard } from '@/features/contract/components/eot-assessment-card'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  WorkflowDecisionDialog,
  type WorkflowDecisionMode,
} from '@/features/workflows/components/workflow-decision-dialog'
import {
  useApproveEotClaim,
  useCalculateEot,
  useCreateEotClaim,
  useEotClaims,
  useRejectEotClaim,
  useSubmitEotClaim,
} from '../hooks/use-commercial'

const fmtMoney = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

type EotDecisionTarget = {
  mode: WorkflowDecisionMode
  id: string
  label: string
}

export function EotPanel({
  projectId,
  activities = [],
}: {
  projectId: string
  activities?: ScheduleActivity[]
}) {
  const { data: claims } = useEotClaims(projectId)
  const calculateMutation = useCalculateEot(projectId)
  const createMutation = useCreateEotClaim(projectId)
  const submitMutation = useSubmitEotClaim(projectId)
  const approveMutation = useApproveEotClaim(projectId)
  const rejectMutation = useRejectEotClaim(projectId)
  const canSubmitEot = useCanPerform('eot', 'submit', 'eot.submit')
  const canApproveEot = useCanPerform('eot', 'approve', 'eot.approve')
  const canRejectEot = useCanPerform('eot', 'approve', 'eot.reject')

  const [eventName, setEventName] = useState('')
  const [delayDays, setDelayDays] = useState('')
  const [eotDaysGranted, setEotDaysGranted] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [activityIds, setActivityIds] = useState<string[]>([])
  const [supportingDocumentIds, setSupportingDocumentIds] = useState('')
  const [decisionTarget, setDecisionTarget] =
    useState<EotDecisionTarget | null>(null)

  const calc = calculateMutation.data as
    | {
        effectiveDelay: number
        ldApplicableDays: number
        ldLiability: number
        criticalPathImpactDays: number
        revisedCompletionRecommendation?: string | null
        daysEntitlementSummary?: {
          recommendedEotDays?: number
          nonCompensableDelayDays?: number
        }
        claimLetter: string
      }
    | undefined

  const documentIds = supportingDocumentIds
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)

  const activityLinks = activityIds.map((activityId) => ({
    activityId,
    delayDays: Number(delayDays) || 0,
    impactBasis: analysis || undefined,
  }))

  const claimProofReady = (claim: {
    activityLinks?: unknown[]
    attachmentRefs?: unknown[]
  }) => Boolean(claim.activityLinks?.length && claim.attachmentRefs?.length)

  const decisionPending = approveMutation.isPending || rejectMutation.isPending

  const handleDecision = async (note: string) => {
    if (!decisionTarget) return

    try {
      if (decisionTarget.mode === 'approve') {
        await approveMutation.mutateAsync({
          claimId: decisionTarget.id,
          comment: note,
        })
        toast.success('EOT claim approved')
      } else {
        await rejectMutation.mutateAsync({
          claimId: decisionTarget.id,
          reason: note,
        })
        toast.success('EOT claim disapproved')
      }
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <div className='space-y-3'>
      <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-2'>
        <Input
          placeholder='Delay event name'
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
        />
        <Input
          type='number'
          min={0}
          placeholder='Delay days'
          value={delayDays}
          onChange={(e) => setDelayDays(e.target.value)}
        />
        <Input
          type='number'
          min={0}
          placeholder='EOT days granted'
          value={eotDaysGranted}
          onChange={(e) => setEotDaysGranted(e.target.value)}
        />
        <div className='flex gap-2'>
          <Button
            variant='outline'
            disabled={calculateMutation.isPending || !eventName}
            onClick={async () => {
              try {
                await calculateMutation.mutateAsync({
                  eventName,
                  delayDays: Number(delayDays) || 0,
                  eotDaysGranted: Number(eotDaysGranted) || 0,
                  affectedActivityIds: activityIds,
                  activityLinks,
                  analysis: analysis || undefined,
                })
                toast.success('EOT analysis generated')
              } catch {
                toast.error('Failed to calculate EOT')
              }
            }}
          >
            Calculate
          </Button>
          <Button
            disabled={createMutation.isPending || !eventName}
            onClick={async () => {
              try {
                await createMutation.mutateAsync({
                  eventName,
                  delayDays: Number(delayDays) || 0,
                  eotDaysGranted: Number(eotDaysGranted) || 0,
                  affectedActivityIds: activityIds,
                  activityLinks,
                  analysis: analysis || undefined,
                  supportingDocumentIds: documentIds.length
                    ? documentIds
                    : undefined,
                })
                setEventName('')
                setDelayDays('')
                setEotDaysGranted('')
                setAnalysis('')
                setActivityIds([])
                setSupportingDocumentIds('')
                toast.success('EOT claim created')
              } catch {
                toast.error('Failed to create claim')
              }
            }}
          >
            Create Claim
          </Button>
        </div>
        <div className='sm:col-span-2'>
          <Textarea
            rows={3}
            placeholder='Analysis notes'
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value)}
          />
        </div>
        <div className='sm:col-span-2'>
          <Input
            placeholder='Supporting document IDs'
            value={supportingDocumentIds}
            onChange={(e) => setSupportingDocumentIds(e.target.value)}
          />
        </div>
        <div className='sm:col-span-2'>
          <div className='grid max-h-36 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2'>
            {activities.map((activity) => (
              <label
                key={activity.id}
                className='flex items-start gap-2 rounded-sm px-2 py-1 text-xs hover:bg-muted/60'
              >
                <input
                  type='checkbox'
                  className='mt-0.5'
                  checked={activityIds.includes(activity.id)}
                  onChange={(e) => {
                    setActivityIds((prev) =>
                      e.target.checked
                        ? [...prev, activity.id]
                        : prev.filter((id) => id !== activity.id)
                    )
                  }}
                />
                <span className='min-w-0 truncate'>
                  {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                  {activity.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {calc && (
        <div className='grid grid-cols-3 gap-2'>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>Effective Delay</p>
            <p className='font-semibold'>{calc.effectiveDelay} days</p>
          </div>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>LD Days</p>
            <p className='font-semibold'>{calc.ldApplicableDays} days</p>
          </div>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>LD Liability</p>
            <p className='font-semibold'>{fmtMoney(calc.ldLiability)}</p>
          </div>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>CP Impact</p>
            <p className='font-semibold'>
              {calc.criticalPathImpactDays || 0} days
            </p>
          </div>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>Recommended Completion</p>
            <p className='font-semibold'>
              {calc.revisedCompletionRecommendation || '-'}
            </p>
          </div>
        </div>
      )}

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left'>Ref</th>
              <th className='p-2 text-left'>Event</th>
              <th className='p-2 text-right'>Delay</th>
              <th className='p-2 text-right'>EOT</th>
              <th className='p-2 text-right'>CP Impact</th>
              <th className='p-2 text-left'>Activities</th>
              <th className='p-2 text-left'>Proof</th>
              <th className='p-2 text-right'>LD</th>
              <th className='p-2 text-left'>Status</th>
              <th className='p-2 text-right'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {claims?.map((claim) => (
              <tr key={claim.id} className='border-b'>
                <td className='p-2 text-xs'>{claim.ref}</td>
                <td className='p-2 text-xs'>{claim.eventName}</td>
                <td className='p-2 text-right text-xs'>{claim.delayDays}</td>
                <td className='p-2 text-right text-xs'>
                  {claim.eotDaysGranted}
                </td>
                <td className='p-2 text-right text-xs'>
                  {claim.activityLinks?.reduce(
                    (sum, link) =>
                      sum + (Number(link.criticalPathImpactDays) || 0),
                    0
                  ) || 0}
                </td>
                <td className='max-w-56 truncate p-2 text-xs'>
                  {claim.activityLinks?.length
                    ? claim.activityLinks
                        .map((link) => link.activity?.name || link.activityId)
                        .join(', ')
                    : '-'}
                </td>
                <td className='p-2 text-xs'>
                  <span
                    className={
                      claimProofReady(claim)
                        ? 'text-green-600'
                        : 'text-amber-600'
                    }
                  >
                    {claimProofReady(claim) ? 'Ready' : 'Needs proof'}
                  </span>
                </td>
                <td className='p-2 text-right text-xs'>
                  {fmtMoney(claim.ldLiability)}
                </td>
                <td className='p-2 text-xs capitalize'>
                  <div className='flex items-center gap-2'>
                    <span>{claim.status}</span>
                    {claim.status === 'draft' &&
                      claimProofReady(claim) &&
                      canSubmitEot && (
                        <Button
                          size='sm'
                          variant='ghost'
                          disabled={submitMutation.isPending}
                          onClick={async () => {
                            try {
                              await submitMutation.mutateAsync({
                                claimId: claim.id,
                              })
                              toast.success('EOT claim submitted')
                            } catch {
                              toast.error('Failed to submit claim')
                            }
                          }}
                        >
                          Submit
                        </Button>
                      )}
                  </div>
                </td>
                <td className='p-2 text-right'>
                  {claim.status === 'submitted' && (
                    <div className='flex justify-end gap-1'>
                      {claimProofReady(claim) && canApproveEot && (
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-green-600 hover:text-green-700'
                          disabled={decisionPending}
                          onClick={() =>
                            setDecisionTarget({
                              mode: 'approve',
                              id: claim.id,
                              label: claim.ref,
                            })
                          }
                        >
                          <CheckCircle2 className='mr-2 h-4 w-4' />
                          Approve
                        </Button>
                      )}
                      {canRejectEot && (
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-red-600 hover:text-red-700'
                          disabled={decisionPending}
                          onClick={() =>
                            setDecisionTarget({
                              mode: 'reject',
                              id: claim.id,
                              label: claim.ref,
                            })
                          }
                        >
                          <XCircle className='mr-2 h-4 w-4' />
                          Disapprove
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='grid gap-3'>
        {claims?.map((claim) => {
          const cpImpact =
            claim.activityLinks?.reduce(
              (sum, link) => sum + (Number(link.criticalPathImpactDays) || 0),
              0
            ) || 0
          const historyCount = claim.approvalHistory?.length || 0
          return (
            <section key={`${claim.id}-detail`} className='rounded-md border'>
              <div className='flex flex-wrap items-start justify-between gap-2 border-b p-3'>
                <div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <p className='text-sm font-semibold'>{claim.ref}</p>
                    <Badge variant='outline' className='capitalize'>
                      {claim.status}
                    </Badge>
                    {claim.officialAt && (
                      <Badge variant='outline'>Official</Badge>
                    )}
                    <Badge variant='outline'>{historyCount} decisions</Badge>
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {claim.eventName}
                  </p>
                </div>
                <div className='text-right text-xs'>
                  <p className='font-medium'>{cpImpact} CP impact days</p>
                  <p className='text-muted-foreground'>
                    Revised recommendation:{' '}
                    {claim.revisedCompletionRecommendation
                      ? new Date(
                          claim.revisedCompletionRecommendation
                        ).toLocaleDateString()
                      : '-'}
                  </p>
                </div>
              </div>
              <Tabs defaultValue='impact' className='p-3'>
                <TabsList>
                  <TabsTrigger value='impact'>
                    <Link2 className='mr-1.5 size-3.5' />
                    Impact
                  </TabsTrigger>
                  <TabsTrigger value='evidence'>
                    <FileText className='mr-1.5 size-3.5' />
                    Evidence
                  </TabsTrigger>
                  <TabsTrigger value='history'>
                    <History className='mr-1.5 size-3.5' />
                    History
                  </TabsTrigger>
                  <TabsTrigger value='entitlement'>
                    <Sparkles className='mr-1.5 size-3.5' />
                    Entitlement
                  </TabsTrigger>
                </TabsList>
                <TabsContent value='impact' className='mt-3 space-y-2'>
                  <div className='grid gap-2 sm:grid-cols-4'>
                    <div className='rounded-md border p-2 text-xs'>
                      <p className='text-muted-foreground'>Delay</p>
                      <p className='font-semibold'>{claim.delayDays} days</p>
                    </div>
                    <div className='rounded-md border p-2 text-xs'>
                      <p className='text-muted-foreground'>EOT Entitlement</p>
                      <p className='font-semibold'>
                        {claim.eotDaysGranted} days
                      </p>
                    </div>
                    <div className='rounded-md border p-2 text-xs'>
                      <p className='text-muted-foreground'>LD Days</p>
                      <p className='font-semibold'>
                        {claim.entitlementSummaryJson?.ldApplicableDays ?? '-'}
                      </p>
                    </div>
                    <div className='rounded-md border p-2 text-xs'>
                      <p className='text-muted-foreground'>LD Liability</p>
                      <p className='font-semibold'>
                        {fmtMoney(claim.ldLiability)}
                      </p>
                    </div>
                  </div>
                  <div className='overflow-x-auto rounded-md border'>
                    <table className='w-full text-xs'>
                      <thead className='bg-muted/50'>
                        <tr>
                          <th className='p-2 text-left'>Activity</th>
                          <th className='p-2 text-right'>Float</th>
                          <th className='p-2 text-right'>Delay</th>
                          <th className='p-2 text-right'>CP Impact</th>
                          <th className='p-2 text-left'>Basis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {claim.activityLinks?.map((link) => (
                          <tr key={link.id} className='border-t'>
                            <td className='p-2'>
                              {link.activity?.name || link.activityId}
                            </td>
                            <td className='p-2 text-right'>
                              {link.floatDays ?? 0}
                            </td>
                            <td className='p-2 text-right'>
                              {link.delayDays ?? 0}
                            </td>
                            <td className='p-2 text-right'>
                              {link.criticalPathImpactDays ?? 0}
                            </td>
                            <td className='max-w-72 truncate p-2'>
                              {link.impactBasis || link.notes || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
                <TabsContent
                  value='evidence'
                  className='mt-3 grid gap-3 md:grid-cols-3'
                >
                  <div className='rounded-md border p-3 text-xs'>
                    <p className='font-medium'>Weather Delays</p>
                    <p className='mt-1 text-muted-foreground'>
                      {claim.weatherDelayLinks?.length || 0} linked events
                    </p>
                  </div>
                  <div className='rounded-md border p-3 text-xs'>
                    <p className='font-medium'>Correspondence</p>
                    <p className='mt-1 text-muted-foreground'>
                      {claim.correspondenceLinks?.length || 0} linked notices
                    </p>
                  </div>
                  <div className='rounded-md border p-3 text-xs'>
                    <p className='font-medium'>Photos & Documents</p>
                    <p className='mt-1 text-muted-foreground'>
                      {claim.attachmentRefs?.length || 0} supporting files
                    </p>
                  </div>
                </TabsContent>
                <TabsContent value='history' className='mt-3 space-y-2'>
                  <HistoryPanel
                    projectId={projectId}
                    entityType='eot_claim'
                    entityId={claim.id}
                    title={`${claim.ref} History`}
                    limit={30}
                  />
                </TabsContent>
                <TabsContent value='entitlement' className='mt-3'>
                  <EotAssessmentCard
                    projectId={projectId}
                    claimId={claim.id}
                    claimStatus={claim.status}
                  />
                </TabsContent>
              </Tabs>
            </section>
          )
        })}
      </div>
      <WorkflowDecisionDialog
        open={!!decisionTarget}
        onOpenChange={(open) => {
          if (!open) setDecisionTarget(null)
        }}
        mode={decisionTarget?.mode ?? 'approve'}
        title={`${decisionTarget?.mode === 'reject' ? 'Disapprove' : 'Approve'} ${decisionTarget?.label ?? 'EOT claim'}`}
        description={
          decisionTarget?.mode === 'reject'
            ? 'A reason is required.'
            : 'Add an optional comment.'
        }
        isPending={decisionPending}
        onConfirm={handleDecision}
      />
    </div>
  )
}
