import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useActivity, useActivityQuantities, useConstraints, usePendingQuantities, useProgressMethod, useProgressReview, useProgressSubmissions, useSubmitProgress } from '@/api/site-hooks'
import { useForms } from '@/api/quality-hooks'
import { useRfis } from '@/api/record-hooks'
import { useStockMovements } from '@/api/inventory-hooks'
import { QUANTITY_FIGURE_KEYS, type ProgressInput, type QuantityFigure } from '@/api/site-types'
import { useAuthStore } from '@/auth/store'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { Evidence } from '@/components/Evidence'
import { RelatedRecords } from '@/components/RelatedRecords'
import { ProgressSheet } from '@/components/ProgressSheet'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, ErrorState, KPI, SkeletonList, Text, spacing, toneForStatus, useTheme } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, dateTime, humanise } from '@/utilities/format'

/** PROGRESS SOURCE: the provenance of the official figure, as the server records it on the approved row. */
export function progressSourceLine(a: { pctComplete: number | null; approvedProgressSource?: string | null; approvedProgressUpdatedAt: string | null }): string {
  // The server answers 0 for an activity with no approved row at all (activity.service sanitizeActivity); the approved row's own stamp says whether one exists.
  if (a.approvedProgressUpdatedAt == null && a.approvedProgressSource == null) return 'No approved progress yet. Nothing recorded on site is official until the progress approvers approve it.'
  const source = a.approvedProgressSource ? humanise(a.approvedProgressSource) : 'Not recorded'
  return `Progress source: ${source}${a.approvedProgressUpdatedAt ? ` · approved ${day(a.approvedProgressUpdatedAt)}` : ''}`
}

/** One of the five figures as a line: its value in its unit with its truth, or a dash and the server's reason — never a zero in place of a withheld figure. */
export function quantityFigureLine(figure: QuantityFigure | null | undefined, withheld: { reason: string } | null | undefined): { value: string; detail: string | null } {
  const reason = figure?.notAvailable?.reason ?? (figure == null ? withheld?.reason : null) ?? null
  const value = figure?.value == null ? NaN : Number(figure.value)
  if (reason || figure == null || !Number.isFinite(value)) return { value: '—', detail: reason ?? 'Not available' }
  const unit = figure.unitCode ? ` ${figure.unitCode}` : ''
  const detail = [figure.truth ? humanise(figure.truth) : null, figure.basis ? humanise(figure.basis) : null, figure.unitMatch === false ? 'unit differs from the item' : null].filter(Boolean).join(' · ')
  return { value: `${value}${unit}`, detail: detail || null }
}

/**
 * The official installed figure the server states beside the installed one:
 * where the latest approved progress carries a legacy typed quantity as its
 * floor, the approved entries add up to less than the official figure. Both
 * are the server's; the app prints the official one as it came, with the
 * reason — it adds nothing up, and prints nothing when the server sent none.
 */
export function officialInstalledLine(figure: QuantityFigure | null | undefined): string | null {
  const official = figure?.officialInstalled
  const value = official?.value == null ? NaN : Number(official.value)
  if (!official || !Number.isFinite(value)) return null
  const unit = official.unitCode ? ` ${official.unitCode}` : ''
  return `Official installed: ${value}${unit}${official.basis ? ` — ${official.basis}` : ''}. The approved entries add up to less because earlier progress was typed, not entered.`
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <View style={styles.fact}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  )
}

/**
 * One activity: where it stands (approved), what is pending, how progress
 * is measured, and the update a person on site can submit. The approved
 * figure is the server's; the app only ever submits for approval.
 */
export default function ActivityScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const me = useAuthStore((s) => s.user)
  const permissions = usePermissions(projectId)
  const activity = useActivity(projectId, id ?? null)
  const relatedRfis = useRfis(projectId, { activityId: id })
  const relatedForms = useForms(projectId, { activityId: id })
  const constraints = useConstraints(projectId)
  const issued = useStockMovements({ projectId: projectId ?? undefined, activityId: id, type: 'issue' }, !!projectId && !!id)
  const method = useProgressMethod(projectId, id ?? null)
  const submissions = useProgressSubmissions(projectId, id ?? null)
  const pendingQuantities = usePendingQuantities(projectId, id ?? null)
  const quantities = useActivityQuantities(projectId, id ?? null)
  const submit = useSubmitProgress(projectId ?? '', id ?? '')
  const [updating, setUpdating] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const review = useProgressReview(projectId ?? '', id ?? '')

  if (!projectId || !id) {
    return (
      <Screen testID="screen-activity">
        <ErrorState message="Choose a project to open this activity." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (activity.isPending) {
    return (
      <Screen testID="screen-activity">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (activity.isError) {
    return (
      <Screen testID="screen-activity">
        <ErrorState message={userMessage(activity.error)} onRetry={() => void activity.refetch()} />
      </Screen>
    )
  }

  const a = activity.data
  const assignedToMe = !!me && a.assignedEngineers.some((e) => e.id === me.id)
  const canSubmit = permissions.allows('progress', 'submit') && (assignedToMe || me?.role === 'pm' || me?.role === 'planning_eng' || permissions.allows('progress', 'approve'))
  // Permission decides who may review, never the width of the screen. A PM
  // sent here from Needs You on a phone must be able to act; the tablet shows
  // the same decision with more of the record beside it.
  const canReview = permissions.allowsTransition('progress', 'submission.approve')
  const reviewRun = async (work: () => Promise<unknown>) => {
    setFailure(null)
    try {
      await work()
      setRejecting(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }
  const open = a.status !== 'complete'

  const send = async (body: ProgressInput) => {
    setFailure(null)
    try {
      await submit.mutateAsync(body)
      setUpdating(false)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if (open && canSubmit) bar.push({ id: 'progress', title: 'Update progress', variant: 'primary', onPress: () => setUpdating(true) })
  if (permissions.allows('rfi', 'create')) bar.push({ id: 'rfi', title: 'Raise RFI', onPress: () => router.push({ pathname: '/rfi/new', params: { activityId: a.id } } as never) })

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-activity">
        <RecordHeader reference={a.activityCode ?? a.wbsCode ?? 'Activity'} title={a.name} status={a.status} meta={[a.wbsCode, humanise(a.category), a.isCritical ? 'Critical path' : null, a.isMilestone ? 'Milestone' : null].filter((v): v is string => !!v)} testID="activity-header" />

        <View style={styles.kpis}>
          <KPI label="Approved" value={a.pctComplete != null ? `${Math.round(a.pctComplete)}%` : '—'} qualifier={a.approvedProgressUpdatedAt ? day(a.approvedProgressUpdatedAt) : undefined} />
          {a.pendingProgress ? <KPI label="Pending" value={a.pendingProgress.pctComplete != null ? `${Math.round(a.pendingProgress.pctComplete)}%` : humanise(a.pendingProgress.status)} tone="warning" qualifier="awaiting approval" /> : null}
          <KPI label="Float" value={a.totalFloat != null ? `${a.totalFloat} d` : '—'} tone={a.totalFloat != null && a.totalFloat <= 0 ? 'error' : 'default'} />
          <KPI label="Duration" value={a.duration != null ? `${a.duration} d` : '—'} />
        </View>

        <Card>
          <View style={styles.stack}>
            <Text variant="caption" tone="muted" testID="activity-progress-source">
              {progressSourceLine(a)}
            </Text>
            {/* Quantities recorded on site wait for the same approvers; the count is of what is waiting, never of progress. Absent on a server without the register. */}
            {pendingQuantities.data ? (
              <View style={styles.row} testID="activity-pending-quantities">
                <Badge label={`${pendingQuantities.data.length} quantit${pendingQuantities.data.length === 1 ? 'y' : 'ies'} awaiting approval`} tone={pendingQuantities.data.length ? 'warning' : 'neutral'} />
              </View>
            ) : null}
          </View>
        </Card>

        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Dates
            </Text>
            <Fact label="Planned" value={a.startDate && a.endDate ? `${day(a.startDate)} → ${day(a.endDate)}` : null} />
            <Fact label="Early" value={a.earlyStartDate && a.earlyFinishDate ? `${day(a.earlyStartDate)} → ${day(a.earlyFinishDate)}` : null} />
            <Fact label="Late finish" value={a.lateFinishDate ? day(a.lateFinishDate) : null} />
            <Fact label="Actual" value={a.actualStart ? `${day(a.actualStart)}${a.actualFinish ? ` → ${day(a.actualFinish)}` : ' → in progress'}` : null} />
          </View>
        </Card>

        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              How progress is measured
            </Text>
            {method.data ? (
              <>
                <Text>{humanise(method.data.method)}{method.data.method === 'quantity' && method.data.plannedQuantity != null ? ` · ${method.data.plannedQuantity} ${method.data.quantityUnit ?? ''} planned` : ''}</Text>
                {method.data.evidenceRequired ? <Badge label="Evidence required" tone="warning" /> : null}
                {method.data.inspectionRequired ? <Badge label="Inspection required" tone="warning" /> : null}
                {method.data.milestoneWeights.length ? (
                  <Text variant="caption" tone="muted">
                    {method.data.milestoneWeights.map((m) => `${m.name} ${m.weight}%`).join(' · ')}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text tone="muted">{method.isPending ? 'Loading…' : 'Percent complete'}</Text>
            )}
            <Fact label="Assigned engineers" value={a.assignedEngineers.map((e) => e.name).join(', ') || null} />
            {!canSubmit && open && permissions.allows('progress', 'submit') ? (
              <Text variant="caption" tone="muted">
                Only the engineers assigned to this activity, or the planning team, can submit its progress.
              </Text>
            ) : null}
          </View>
        </Card>

        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Progress submissions
            </Text>
            {submissions.isPending ? (
              <SkeletonList rows={2} />
            ) : (submissions.data ?? []).length === 0 ? (
              <Text tone="muted">No submissions yet.</Text>
            ) : (
              (submissions.data ?? []).map((s) => (
                <View key={s.id} style={[styles.submission, { borderColor: theme.colors.border }]} testID={`submission-${s.id}`}>
                  <View style={styles.row}>
                    <Badge label={humanise(s.status)} tone={toneForStatus(s.status)} />
                    <Text>{s.pctComplete != null ? `${Math.round(s.pctComplete)}%` : s.quantityComplete != null ? `${s.quantityComplete} ${s.quantityUnit ?? ''}` : humanise(s.progressMethod)}</Text>
                    <Text variant="caption" tone="muted" style={styles.grow}>
                      {dateTime(s.submittedAt ?? s.createdAt)}
                    </Text>
                  </View>
                  {s.notes ? (
                    <Text variant="caption" tone="muted">
                      {s.notes}
                    </Text>
                  ) : null}
                  {s.rejectionReason ? (
                    <Text variant="caption" tone="error">
                      Rejected: {s.rejectionReason}
                    </Text>
                  ) : null}
                  {s.status === 'submitted' && canReview ? (
                    <View style={styles.stack}>
                      {method.data?.inspectionRequired ? (
                        <Text variant="caption" tone="warning" testID={`submission-hold-${s.id}`}>
                          Hold point: this activity needs an inspection before its progress is approved. Check the inspection record first.
                        </Text>
                      ) : null}
                      <View style={styles.row}>
                        <Button title="Approve" loading={review.approve.isPending} onPress={() => void reviewRun(() => review.approve.mutateAsync(s.id))} testID={`submission-approve-${s.id}`} />
                        <Button title="Reject" variant="danger" onPress={() => setRejecting(s.id)} testID={`submission-reject-${s.id}`} />
                      </View>
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </View>
        </Card>

        {/*
          The five quantities and the committed one, each its own truth (PC-6
          §5): received, issued, installed, certified, paid — never merged,
          never summed across units. The server hands over a figure or
          withholds it with its reason; the app prints a dash for the latter.
        */}
        {quantities.data ? (
          <Card testID="activity-quantities">
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                Quantities
              </Text>
              {QUANTITY_FIGURE_KEYS.map((key) => {
                const line = quantityFigureLine(quantities.data?.[key], quantities.data?.notAvailable)
                const official = key === 'installed' ? officialInstalledLine(quantities.data?.[key]) : null
                return (
                  <View key={key} style={styles.fact} testID={`activity-quantity-${key}`}>
                    <Text variant="caption" tone="muted">
                      {humanise(key)}
                    </Text>
                    <Text>{line.value}</Text>
                    {line.detail ? (
                      <Text variant="caption" tone="muted">
                        {line.detail}
                      </Text>
                    ) : null}
                    {official ? (
                      <Text variant="caption" tone="muted" testID="activity-quantity-installed-official">
                        {official}
                      </Text>
                    ) : null}
                  </View>
                )
              })}
            </View>
          </Card>
        ) : null}

        {/*
          What else belongs to this job. Only the registers that can genuinely
          be asked about an activity are here: RFIs, inspections, the material
          issued to it, and the constraints the lookahead holds against it.
          Punch, NCRs and tasks are not — nothing ties them to an activity — and
          neither is a location, because no activity in this schema has one.
        */}
        <RelatedRecords
          groups={[
            {
              id: 'rfis',
              title: 'RFIs',
              isPending: relatedRfis.isPending,
              emptyText: 'Nothing has been asked about this activity.',
              records: (relatedRfis.data?.rows ?? []).map((r) => ({ id: r.id, reference: r.ref, title: r.subject, status: r.status, onPress: () => router.push(`/rfi/${r.id}`) })),
            },
            {
              id: 'inspections',
              title: 'Inspections',
              isPending: relatedForms.isPending,
              emptyText: 'None have been raised against it.',
              records: (relatedForms.data?.items ?? []).map((f) => ({ id: f.id, reference: f.ref, title: f.title, status: f.status, onPress: () => router.push(`/quality/inspections/${f.id}`) })),
            },
            {
              id: 'constraints',
              title: 'Constraints',
              isPending: constraints.isPending,
              emptyText: 'Nothing is holding this activity up.',
              records: (constraints.data?.items ?? [])
                .filter((c) => c.activityId === a.id && c.constraintStatus === 'open')
                .map((c) => ({ id: c.id, reference: 'Constraint', title: c.constraint ?? c.name, onPress: () => router.push('/activities/lookahead') })),
            },
            {
              id: 'materials',
              title: 'Material issued',
              isPending: issued.isPending,
              emptyText: 'No material has been issued to it.',
              records: (issued.data ?? []).map((m) => ({
                id: m.id,
                reference: m.item?.sku ?? 'Material',
                title: m.item?.name ?? 'Issued',
                meta: `${Math.abs(Number(m.quantity))} ${m.item?.unit ?? ''}`.trim(),
                onPress: () => router.push('/inventory/movements'),
              })),
            },
          ]}
          testID="activity-related"
        />

        <Card>
          <Evidence projectId={projectId} recordType="activity" recordId={a.id} recordRef={a.activityCode ?? a.wbsCode} canAdd={permissions.allows('schedule', 'update') || permissions.allows('progress', 'submit')} />
        </Card>

        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="activity-failure">
            {failure}
          </Text>
        ) : null}
      </Screen>

      <ActionBar actions={bar} />
      <ProgressSheet visible={updating} method={method.data ?? null} approvedPct={a.pctComplete} busy={submit.isPending} error={failure} onCancel={() => setUpdating(false)} onSubmit={(body) => void send(body)} />
      <PromptSheet visible={!!rejecting} title="Reject this progress update" body="It goes back to the engineer with your reason; the approved figure stays as it is." label="Reason" required confirmTitle="Reject" destructive busy={review.reject.isPending} error={failure} onCancel={() => setRejecting(null)} onConfirm={(reason) => rejecting && void reviewRun(() => review.reject.mutateAsync({ submissionId: rejecting, reason }))} testID="prompt-reject-progress" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1 },
  fact: { gap: 2 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  submission: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1 },
})
