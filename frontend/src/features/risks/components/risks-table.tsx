import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  FileClock,
  History,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import {
  WorkflowDecisionDialog,
  type WorkflowDecisionMode,
} from '@/features/workflows/components/workflow-decision-dialog'
import {
  type RiskCloseoutPayload,
  type RiskPayload,
  type RiskRecord,
  useApproveRiskCloseout,
  useCreateRisk,
  useArchiveRisk,
  useRejectRiskCloseout,
  useReopenRisk,
  useRisks,
  useSubmitRiskCloseout,
  useUpdateRisk,
} from '../hooks/use-risks'
import { RiskFormDialog } from './risk-form-dialog'

type RiskRegisterTarget = {
  status?: string
  source?: string
  recordId?: string
}

type DecisionTarget = {
  action: 'approve' | 'reject' | 'reopen'
  mode: WorkflowDecisionMode
  riskId: string
  label: string
}

const severityClassMap: Record<RiskRecord['severity'], string> = {
  LOW: 'bg-green-100 text-green-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
}

const statusClassMap: Record<RiskRecord['status'], string> = {
  open: 'bg-red-100 text-red-700',
  monitoring: 'bg-amber-100 text-amber-700',
  submitted: 'bg-blue-100 text-blue-700',
  closed: 'bg-green-100 text-green-700',
  archived: 'bg-zinc-100 text-zinc-700',
}

const escalationClassMap: Record<RiskRecord['escalationLevel'], string> = {
  none: 'bg-slate-100 text-slate-700',
  watch: 'bg-amber-100 text-amber-700',
  escalated: 'bg-red-100 text-red-700',
}

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  return new Date(value).toLocaleDateString()
}

const toDateInputValue = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const isOverdue = (risk: RiskRecord) =>
  Boolean(risk.dueDate) &&
  new Date(risk.dueDate as string).getTime() < Date.now() &&
  ['open', 'monitoring'].includes(risk.status)

function RiskCloseoutDialog({
  risk,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  risk: RiskRecord | null
  isPending?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (payload: RiskCloseoutPayload) => Promise<void>
}) {
  const [dueDate, setDueDate] = useState('')
  const [responsePlan, setResponsePlan] = useState('')
  const [closeoutComment, setCloseoutComment] = useState('')
  const open = Boolean(risk)

  useEffect(() => {
    if (!risk) return
    setDueDate(toDateInputValue(risk.dueDate))
    setResponsePlan(risk.responsePlan || risk.mitigation || '')
    setCloseoutComment('')
  }, [risk])

  const canSubmit = Boolean(
    dueDate && responsePlan.trim() && closeoutComment.trim()
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Submit risk closeout</DialogTitle>
          <DialogDescription>{risk?.ref}</DialogDescription>
        </DialogHeader>
        <div className='grid gap-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor='risk-closeout-due'>Mitigation Due</Label>
            <Input
              id='risk-closeout-due'
              type='date'
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='risk-closeout-plan'>Response Plan</Label>
            <Textarea
              id='risk-closeout-plan'
              value={responsePlan}
              onChange={(event) => setResponsePlan(event.target.value)}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='risk-closeout-comment'>Closeout Comment</Label>
            <Textarea
              id='risk-closeout-comment'
              value={closeoutComment}
              onChange={(event) => setCloseoutComment(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={isPending || !canSubmit}
            onClick={async () => {
              await onConfirm({
                dueDate,
                responsePlan: responsePlan.trim(),
                closeoutComment: closeoutComment.trim(),
              })
              onOpenChange(false)
            }}
          >
            <Send className='h-4 w-4' />
            {isPending ? 'Submitting...' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RisksTable({
  projectId,
  initialTarget,
}: {
  projectId: string
  initialTarget?: RiskRegisterTarget
}) {
  const { data: risks = [], isLoading } = useRisks(projectId)
  const { data: activities = [] } = useActivities(projectId)
  const createRisk = useCreateRisk(projectId)
  const updateRisk = useUpdateRisk(projectId)
  const archiveRisk = useArchiveRisk(projectId)
  const submitCloseout = useSubmitRiskCloseout(projectId)
  const approveCloseout = useApproveRiskCloseout(projectId)
  const rejectCloseout = useRejectRiskCloseout(projectId)
  const reopenRisk = useReopenRisk(projectId)

  const canCreateRisk = useCanPerform('risk', 'create')
  const canUpdateRisk = useCanPerform('risk', 'update')
  const canDeleteRisk = useCanPerform('risk', 'delete')
  const canSubmitRisk = useCanPerform('risk', 'submit', 'risk.submit')
  const canApproveRisk = useCanPerform('risk', 'approve', 'risk.approve')
  const canRejectRisk = useCanPerform('risk', 'approve', 'risk.reject')
  const canReopenRisk = useCanPerform('risk', 'approve', 'risk.reopen')

  const [editingRisk, setEditingRisk] = useState<RiskRecord | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [closeoutRisk, setCloseoutRisk] = useState<RiskRecord | null>(null)
  const [decisionTarget, setDecisionTarget] = useState<DecisionTarget | null>(
    null
  )
  const [historyRiskId, setHistoryRiskId] = useState<string | null>(
    initialTarget?.recordId || null
  )

  const filteredRisks = useMemo(() => {
    if (initialTarget?.source !== 'risk') return risks
    if (initialTarget.recordId) {
      return risks.filter((risk) => risk.id === initialTarget.recordId)
    }
    if (initialTarget.status === 'overdue') {
      return risks.filter(isOverdue)
    }
    if (initialTarget.status) {
      return risks.filter((risk) => risk.status === initialTarget.status)
    }
    return risks
  }, [initialTarget, risks])

  const summary = useMemo(
    () => ({
      open: risks.filter((risk) => risk.status === 'open').length,
      submitted: risks.filter((risk) => risk.status === 'submitted').length,
      overdue: risks.filter(isOverdue).length,
      linked: risks.filter((risk) => risk.activityLinks.length > 0).length,
    }),
    [risks]
  )

  const historyRisk =
    risks.find((risk) => risk.id === historyRiskId) || filteredRisks[0] || null
  const workflowPending =
    submitCloseout.isPending ||
    approveCloseout.isPending ||
    rejectCloseout.isPending ||
    reopenRisk.isPending

  const handleDecision = async (note: string) => {
    if (!decisionTarget) return

    if (decisionTarget.action === 'approve') {
      await approveCloseout.mutateAsync({
        riskId: decisionTarget.riskId,
        comment: note,
      })
      toast.success('Risk closeout approved')
    } else if (decisionTarget.action === 'reject') {
      await rejectCloseout.mutateAsync({
        riskId: decisionTarget.riskId,
        reason: note,
      })
      toast.success('Risk closeout disapproved')
    } else {
      await reopenRisk.mutateAsync({
        riskId: decisionTarget.riskId,
        reason: note,
      })
      toast.success('Risk reopened')
    }
  }

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>Loading risks...</p>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <h3 className='text-sm font-semibold'>Risk Register</h3>
          <div className='mt-2 flex flex-wrap gap-2'>
            <Badge variant='outline'>{summary.open} open</Badge>
            <Badge variant='outline'>{summary.submitted} PM review</Badge>
            <Badge
              variant='outline'
              className={
                summary.overdue
                  ? 'border-red-300 bg-red-100 text-red-800'
                  : undefined
              }
            >
              {summary.overdue} overdue mitigation
            </Badge>
            <Badge variant='outline'>{summary.linked} linked</Badge>
            {initialTarget?.source === 'risk' && (
              <Badge variant='outline'>Filtered: {initialTarget.status}</Badge>
            )}
          </div>
        </div>
        {canCreateRisk && (
          <Button size='sm' onClick={() => setCreateOpen(true)}>
            Add Risk
          </Button>
        )}
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm whitespace-nowrap'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>Ref</th>
              <th className='p-2 text-left font-medium'>Risk</th>
              <th className='p-2 text-left font-medium'>Activities</th>
              <th className='p-2 text-center font-medium'>Severity</th>
              <th className='p-2 text-center font-medium'>Residual</th>
              <th className='p-2 text-left font-medium'>Due</th>
              <th className='p-2 text-left font-medium'>Owner</th>
              <th className='p-2 text-center font-medium'>Escalation</th>
              <th className='p-2 text-center font-medium'>Status</th>
              <th className='p-2 text-left font-medium'>Response</th>
              <th className='p-2 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRisks.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className='p-6 text-center text-muted-foreground'
                >
                  No risks available.
                </td>
              </tr>
            ) : (
              filteredRisks.map((risk) => {
                const overdue = isOverdue(risk)
                const canEditRow =
                  canUpdateRisk &&
                  (risk.status === 'open' || risk.status === 'monitoring')

                return (
                  <tr key={risk.id} className='border-b hover:bg-muted/30'>
                    <td className='p-2 font-mono text-xs font-semibold text-blue-600'>
                      {risk.ref}
                    </td>
                    <td
                      className='max-w-80 truncate p-2'
                      title={risk.description}
                    >
                      {risk.description}
                    </td>
                    <td className='max-w-72 p-2'>
                      {risk.activityLinks.length === 0 ? (
                        <span className='text-xs text-muted-foreground'>-</span>
                      ) : (
                        <div className='flex flex-wrap gap-1'>
                          {risk.activityLinks.slice(0, 2).map((link) => (
                            <Badge
                              key={link.id || link.activityId}
                              variant='outline'
                            >
                              {link.activity?.activityCode ||
                                link.activity?.wbsCode ||
                                link.activity?.name ||
                                link.activityId.slice(0, 8)}
                            </Badge>
                          ))}
                          {risk.activityLinks.length > 2 && (
                            <Badge variant='outline'>
                              +{risk.activityLinks.length - 2}
                            </Badge>
                          )}
                        </div>
                      )}
                    </td>
                    <td className='p-2 text-center'>
                      <Badge className={severityClassMap[risk.severity]}>
                        {risk.severity}
                      </Badge>
                    </td>
                    <td className='p-2 text-center'>
                      <Badge
                        className={severityClassMap[risk.residualSeverity]}
                      >
                        {risk.residualSeverity}
                      </Badge>
                    </td>
                    <td className='p-2'>
                      <span
                        className={overdue ? 'font-medium text-red-600' : ''}
                      >
                        {formatDate(risk.dueDate)}
                      </span>
                      {overdue && (
                        <Badge className='ml-2 bg-red-100 text-red-800'>
                          overdue
                        </Badge>
                      )}
                    </td>
                    <td className='p-2 text-muted-foreground'>
                      {risk.owner || '-'}
                    </td>
                    <td className='p-2 text-center'>
                      <Badge
                        className={escalationClassMap[risk.escalationLevel]}
                      >
                        {risk.escalationLevel}
                      </Badge>
                    </td>
                    <td className='p-2 text-center'>
                      <Badge className={statusClassMap[risk.status]}>
                        {risk.status}
                      </Badge>
                    </td>
                    <td
                      className='max-w-72 truncate p-2 text-muted-foreground'
                      title={risk.responsePlan || risk.mitigation || ''}
                    >
                      {risk.responsePlan || risk.mitigation || '-'}
                    </td>
                    <td className='p-2 text-right'>
                      <div className='flex justify-end gap-1'>
                        <Button
                          size='icon'
                          variant='ghost'
                          className='size-8'
                          title='History'
                          aria-label='History'
                          onClick={() => setHistoryRiskId(risk.id)}
                        >
                          <History className='h-4 w-4' />
                        </Button>
                        {canEditRow && (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => setEditingRisk(risk)}
                          >
                            Edit
                          </Button>
                        )}
                        {canSubmitRisk &&
                          (risk.status === 'open' ||
                            risk.status === 'monitoring') && (
                            <Button
                              size='sm'
                              variant='ghost'
                              onClick={() => setCloseoutRisk(risk)}
                            >
                              <Send className='h-4 w-4' />
                              Closeout
                            </Button>
                          )}
                        {risk.status === 'submitted' && canApproveRisk && (
                          <Button
                            size='icon'
                            variant='ghost'
                            className='size-8 text-green-700'
                            title='Approve closeout'
                            aria-label='Approve closeout'
                            onClick={() =>
                              setDecisionTarget({
                                action: 'approve',
                                mode: 'approve',
                                riskId: risk.id,
                                label: risk.ref,
                              })
                            }
                          >
                            <CheckCircle2 className='h-4 w-4' />
                          </Button>
                        )}
                        {risk.status === 'submitted' && canRejectRisk && (
                          <Button
                            size='icon'
                            variant='ghost'
                            className='size-8 text-red-700'
                            title='Disapprove closeout'
                            aria-label='Disapprove closeout'
                            onClick={() =>
                              setDecisionTarget({
                                action: 'reject',
                                mode: 'reject',
                                riskId: risk.id,
                                label: risk.ref,
                              })
                            }
                          >
                            <XCircle className='h-4 w-4' />
                          </Button>
                        )}
                        {risk.status === 'closed' && canReopenRisk && (
                          <Button
                            size='icon'
                            variant='ghost'
                            className='size-8'
                            title='Reopen risk'
                            aria-label='Reopen risk'
                            onClick={() =>
                              setDecisionTarget({
                                action: 'reopen',
                                mode: 'reject',
                                riskId: risk.id,
                                label: risk.ref,
                              })
                            }
                          >
                            <RotateCcw className='h-4 w-4' />
                          </Button>
                        )}
                        {canDeleteRisk && (
                          <Button
                            size='sm'
                            variant='ghost'
                            className='text-red-600 hover:text-red-700'
                            onClick={async () => {
                              const confirmed =
                                window.confirm('Archive this risk?')
                              if (!confirmed) return

                              try {
                                await archiveRisk.mutateAsync(risk.id)
                                toast.success('Risk archived')
                              } catch {
                                toast.error('Failed to archive risk')
                              }
                            }}
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {historyRisk ? (
        <AuditHistoryPanel
          projectId={projectId}
          entityType='risk'
          entityId={historyRisk.id}
          title={`${historyRisk.ref} Audit Trail`}
          limit={12}
        />
      ) : (
        <div className='flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground'>
          <FileClock className='h-4 w-4' />
          Select a risk to view its audit trail.
        </div>
      )}

      <RiskFormDialog
        projectId={projectId}
        key={`risk-create-${createOpen ? 'open' : 'closed'}`}
        open={createOpen}
        onOpenChange={setCreateOpen}
        activities={activities}
        isSaving={createRisk.isPending}
        onSubmit={async (payload: RiskPayload) => {
          try {
            await createRisk.mutateAsync(payload)
            toast.success('Risk created')
            setCreateOpen(false)
          } catch {
            toast.error('Failed to create risk')
          }
        }}
      />

      <RiskFormDialog
        projectId={projectId}
        key={editingRisk ? `risk-edit-${editingRisk.id}` : 'risk-edit-empty'}
        open={Boolean(editingRisk)}
        onOpenChange={(open) => {
          if (!open) setEditingRisk(null)
        }}
        initialRisk={editingRisk}
        activities={activities}
        isSaving={updateRisk.isPending}
        onSubmit={async (payload: RiskPayload) => {
          if (!editingRisk) return

          try {
            await updateRisk.mutateAsync({ riskId: editingRisk.id, payload })
            toast.success('Risk updated')
            setEditingRisk(null)
          } catch {
            toast.error('Failed to update risk')
          }
        }}
      />

      <RiskCloseoutDialog
        risk={closeoutRisk}
        isPending={submitCloseout.isPending}
        onOpenChange={(open) => {
          if (!open) setCloseoutRisk(null)
        }}
        onConfirm={async (payload) => {
          if (!closeoutRisk) return
          await submitCloseout.mutateAsync({
            riskId: closeoutRisk.id,
            payload,
          })
          toast.success('Risk closeout submitted')
        }}
      />

      <WorkflowDecisionDialog
        open={Boolean(decisionTarget)}
        onOpenChange={(open) => {
          if (!open) setDecisionTarget(null)
        }}
        mode={decisionTarget?.mode ?? 'approve'}
        title={`${decisionTarget?.action === 'reopen' ? 'Reopen' : decisionTarget?.mode === 'reject' ? 'Disapprove' : 'Approve'} ${decisionTarget?.label ?? 'risk'}`}
        description={
          decisionTarget?.action === 'reopen'
            ? 'A reopen reason is required.'
            : decisionTarget?.mode === 'reject'
              ? 'A rejection reason is required.'
              : 'Add an optional PM closeout comment.'
        }
        rejectLabel={
          decisionTarget?.action === 'reopen' ? 'Reopen' : 'Disapprove'
        }
        isPending={workflowPending}
        onConfirm={handleDecision}
      />
    </div>
  )
}
