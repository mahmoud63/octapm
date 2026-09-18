import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { usePayApp, usePayAppActions } from '@/api/commercial-hooks'
import { isAppError, userMessage } from '@/api/errors'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { openOnWeb } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise, money, percent } from '@/utilities/format'

/**
 * One pay application: the period, what it claims, line by line against the
 * schedule of values, and the money. The party that holds it may submit it;
 * review, approval and payment stay on the web.
 */
export default function PayAppScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const payApp = usePayApp(projectId, id ?? null)
  const actions = usePayAppActions(projectId ?? '')
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [overClaims, setOverClaims] = useState<string[]>([])

  if (!projectId || !id) {
    return (
      <Screen testID="screen-pay-app">
        <ErrorState message="Choose a project to open this pay application." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (payApp.isPending) {
    return (
      <Screen testID="screen-pay-app">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (payApp.isError) {
    return (
      <Screen testID="screen-pay-app">
        <ErrorState message={userMessage(payApp.error)} onRetry={() => void payApp.refetch()} />
      </Screen>
    )
  }

  const p = payApp.data
  const currency = p.commitment?.currency
  const canSubmit = p.status === 'draft' && permissions.allowsTransition('sub_pay_app', 'sub_pay_app.submit')

  const submit = async () => {
    setFailure(null)
    setOverClaims([])
    try {
      await actions.submit.mutateAsync(p.id)
      setConfirming(false)
    } catch (error) {
      if (isAppError(error) && error.serverCode === 'SUB_PAY_APP_OVER_CLAIM') {
        const details = error.details as { lines?: { description?: string; lineNumber?: number; capAmount?: number; approvedPct?: number }[] } | undefined
        setOverClaims((details?.lines ?? []).map((l) => `${l.lineNumber ? `${l.lineNumber}. ` : ''}${l.description ?? 'A line'}: cap ${money(l.capAmount ?? 0, currency)}${l.approvedPct != null ? ` (${percent(l.approvedPct)} approved)` : ''}`))
        setFailure('The claim is above the approved progress on some lines. Correct them on the web, then submit again.')
      } else setFailure(userMessage(error))
      setConfirming(false)
    }
  }

  const bar: RecordAction[] = []
  if (canSubmit) bar.push({ id: 'submit', title: 'Submit for review', variant: 'primary', onPress: () => setConfirming(true) })

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-pay-app">
        <RecordHeader reference={p.ref} title={p.periodLabel} status={p.status} meta={[p.commitment?.title, p.commitment?.vendor?.name, p.periodStart ? `${day(p.periodStart)} – ${p.periodEnd ? day(p.periodEnd) : '…'}` : null].filter((v): v is string => !!v)} testID="pay-app-header" />
        {p.ballInCourt.label ? (
          <View style={styles.row}>
            <Text variant="label" label tone="muted">
              Ball in court
            </Text>
            <Badge label={p.ballInCourt.label} tone={p.ballInCourt.isYou ? 'warning' : 'info'} />
          </View>
        ) : null}
        <View style={styles.kpis}>
          <KPI label="Work this period" value={money(p.workThisPeriod, currency)} />
          <KPI label="Gross this period" value={money(p.grossThisPeriod, currency)} />
          <KPI label="Retention" value={money(p.retentionThisPeriod, currency)} qualifier={percent(p.retentionRate)} />
          <KPI label="Net this period" value={money(p.netThisPeriod, currency)} tone="warning" />
          <KPI label="Paid" value={money(p.paidAmount, currency)} tone={p.paidAmount > 0 ? 'success' : 'default'} />
          <KPI label="Outstanding" value={money(p.outstanding, currency)} />
        </View>
        {p.overClaimAmount > 0 ? <Badge label={`Over-claim ${money(p.overClaimAmount, currency)}`} tone="error" /> : null}
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Lines
            </Text>
            {p.lines.map((l) => (
              <View key={l.id} style={[styles.row, styles.line, { borderColor: theme.colors.border }]} testID={`pay-app-line-${l.id}`}>
                <View style={styles.grow}>
                  <Text>{`${l.lineNumber}. ${l.description}`}</Text>
                  <Text variant="caption" tone="muted">
                    {[l.costCode, `${percent(l.cumulativePct)} to date of ${money(l.revisedScheduledAmount, currency)}`, l.approvedPct != null ? `${percent(l.approvedPct)} approved progress` : null, l.overClaimAmount > 0 ? `over-claim ${money(l.overClaimAmount, currency)}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text tone={l.overClaimAmount > 0 ? 'error' : undefined}>{money(l.thisPeriodAmount, currency)}</Text>
              </View>
            ))}
          </View>
        </Card>
        <Card>
          <View style={styles.stack}>
            <Fact label="Back charges" value={p.backCharges ? `${money(p.backCharges, currency)}${p.backChargesNote ? ` · ${p.backChargesNote}` : ''}` : null} />
            <Fact label="Other deductions" value={p.otherDeductions ? `${money(p.otherDeductions, currency)}${p.otherDeductionsNote ? ` · ${p.otherDeductionsNote}` : ''}` : null} />
            <Fact label="Materials on site" value={p.materialsOnSite ? money(p.materialsOnSite, currency) : null} />
            <Fact label="Lien waiver" value={p.waiverRequired ? 'Required' : null} />
            <Fact label="Review note" value={p.reviewNote} />
            <Fact label="Rejected" value={p.rejectedReason ? `${p.rejectionCode ? `${humanise(p.rejectionCode)}: ` : ''}${p.rejectedReason}` : null} />
            <Fact label="Notes" value={p.notes} />
            <Fact label="Submitted" value={p.submittedAt ? day(p.submittedAt) : null} />
            <Fact label="Approved" value={p.approvedAt ? day(p.approvedAt) : null} />
            <Fact label="Paid" value={p.paidAt ? day(p.paidAt) : null} />
          </View>
        </Card>
        {p.payments.length ? (
          <Card>
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                Payments
              </Text>
              {p.payments.map((pay) => (
                <View key={pay.id} style={styles.row}>
                  <Text style={styles.grow}>{[pay.paidAt ? day(pay.paidAt) : null, pay.method, pay.reference].filter(Boolean).join(' · ')}</Text>
                  <Text>{money(pay.amount, currency)}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
        {overClaims.length ? (
          <Card edge={theme.colors.error}>
            <View style={styles.stack}>
              <Text variant="heading" tone="error">
                Above the approved progress
              </Text>
              {overClaims.map((line) => (
                <Text key={line}>• {line}</Text>
              ))}
            </View>
          </Card>
        ) : null}
        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="pay-app-failure">
            {failure}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted">
          Amounts are entered, reviewed, approved and paid on the web. This phone submits a draft for review and nothing more.
        </Text>
        <Button title="Open on the web" variant="secondary" onPress={() => void openOnWeb(p.path)} testID="pay-app-web" />
      </Screen>
      <ActionBar actions={bar} />
      <PromptSheet visible={confirming} title={`Submit ${p.ref} for review`} body={`Net this period ${money(p.netThisPeriod, currency)}. Once submitted it is locked until it is reviewed.`} label="Note" confirmTitle="Submit" busy={actions.submit.isPending} error={failure} onCancel={() => setConfirming(false)} onConfirm={() => void submit()} testID="prompt-submit" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  line: { paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
})
