import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useChangeOrders, useCommitment, usePayApp, useWorkflowActions, useWorkflowInstance } from '@/api/commercial-hooks'
import type { WorkflowResponseOption } from '@/api/commercial-types'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useAuthStore } from '@/auth/store'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { appRouteForRecord, openOnWeb } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { dateTime, day, humanise, money } from '@/utilities/format'
import { canDecideHere, confirmationText, contextFacts, isFinancialTool } from '@/workflow/context'

const stepTone = (status: string): 'success' | 'error' | 'warning' | 'info' | 'neutral' => (status === 'completed' || status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : status === 'active' || status === 'running' || status === 'pending' ? 'warning' : 'neutral')

const evidence = (count: number | null) => (count === null ? null : count === 0 ? 'None attached' : `${count} file${count === 1 ? '' : 's'} on the record`)

/**
 * One workflow instance: what is being decided and what it is worth, the
 * record it moves, every step with who answered what, and, when the current
 * step is assigned to this person, the answers the template allows. The
 * answer goes through the respond route; the server moves the record.
 *
 * Everything on the decision card comes from the server: the instance's own
 * `context` and, for the three commercial records the app can read in full,
 * the record itself. Nothing is computed here. A money decision the app
 * cannot put a figure against is not offered on the phone at all — it hands
 * over to the web platform.
 */
export default function WorkflowInstanceScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string; projectId?: string }>()
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const projectId = params.projectId || currentProjectId
  const me = useAuthStore((s) => s.user?.id ?? null)
  const instance = useWorkflowInstance(projectId, params.id ?? null)
  const actions = useWorkflowActions(projectId ?? '')
  const [choice, setChoice] = useState<WorkflowResponseOption | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  // The record behind the decision, for the three tools the app reads in full.
  const loaded = instance.data ?? null
  const projects = useProjects()
  const currency = projects.data?.find((p) => p.id === projectId)?.currency ?? null
  const orders = useChangeOrders(loaded?.tool === 'change_order' ? projectId : null)
  const commitment = useCommitment(projectId, loaded?.tool === 'commitment' ? loaded.recordId : null)
  const payApp = usePayApp(projectId, loaded?.tool === 'sub_pay_app' ? loaded.recordId : null)

  if (!projectId || !params.id) {
    return (
      <Screen testID="screen-workflow-instance">
        <ErrorState message="This approval could not be located." onRetry={() => router.replace('/workflow')} />
      </Screen>
    )
  }
  if (instance.isPending) {
    return (
      <Screen testID="screen-workflow-instance">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (instance.isError) {
    return (
      <Screen testID="screen-workflow-instance">
        <ErrorState message={userMessage(instance.error)} onRetry={() => void instance.refetch()} />
      </Screen>
    )
  }

  const w = instance.data
  const current = w.currentStep
  const mine = w.status === 'running' && current ? current.assignments.find((a) => a.userId === me && a.status === 'pending') : null
  const recordRoute = appRouteForRecord(w.tool, w.recordId)

  const order = w.tool === 'change_order' ? (orders.data?.find((o) => o.id === w.recordId) ?? null) : null
  const facts = contextFacts(w.tool, w.context, currency)
  // Only what the instance context does not already carry, read from the record itself.
  const extra: { label: string; value: string | null }[] = order
    ? [
        { label: 'Cost impact', value: order.costImpactSummary },
        { label: 'Schedule note', value: order.scheduleImpactSummary },
        { label: 'Affected activity', value: order.activity?.name ?? null },
        { label: 'Raised by', value: order.raisedBy },
        { label: 'Evidence', value: evidence(order.attachmentRefs?.length ?? null) },
      ]
    : commitment.data
      ? [
          { label: 'Counterparty', value: commitment.data.vendor?.name ?? commitment.data.supplier },
          { label: 'Payment terms', value: commitment.data.paymentTerms },
        ]
      : payApp.data
        ? [
            { label: 'Counterparty', value: payApp.data.commitment?.vendor?.name ?? null },
            { label: 'Period', value: payApp.data.periodLabel },
            { label: 'Retention this period', value: money(payApp.data.retentionThisPeriod, payApp.data.commitment?.currency ?? currency) },
          ]
        : []
  const canDecide = canDecideHere(w.tool, w.context)
  const enriching = w.tool === 'change_order' ? orders.isPending : w.tool === 'commitment' ? commitment.isPending : w.tool === 'sub_pay_app' ? payApp.isPending : false
  const prompt = choice ? confirmationText({ tool: w.tool, toolLabel: w.toolLabel, reference: w.recordRef, optionLabel: choice.label, positive: choice.tone !== 'negative', context: w.context, currency }) : null

  const respond = async (option: WorkflowResponseOption, comment: string) => {
    setFailure(null)
    try {
      await actions.respond.mutateAsync({ instanceId: w.id, response: option.key, comment: comment || undefined })
      setChoice(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-workflow-instance">
        <RecordHeader reference={`${w.toolLabel}${w.recordRef ? ` ${w.recordRef}` : ''}`} title={w.recordTitle ?? w.template.name ?? 'Approval'} status={w.status === 'running' ? (current?.name ?? 'running') : (w.outcome ?? w.status)} meta={[w.project?.name, w.template.name].filter((v): v is string => !!v)} testID="workflow-header" />
        {facts.length || extra.some((f) => f.value) ? (
          <Card testID="workflow-context">
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                {mine ? 'What you are approving' : 'What is being decided'}
              </Text>
              {facts.map((f) => (
                <Fact key={f.key} label={f.label} value={f.value} />
              ))}
              {extra.map((f) => (
                <Fact key={f.label} label={f.label} value={f.value} />
              ))}
              {enriching ? (
                <Text variant="caption" tone="muted">
                  Reading the rest of the record…
                </Text>
              ) : null}
            </View>
          </Card>
        ) : null}
        {mine ? (
          <Card edge={theme.colors.brand} testID="workflow-my-step">
            <View style={styles.stack}>
              <Text variant="heading">{current!.name}</Text>
              {current!.description ? <Text tone="muted">{current!.description}</Text> : null}
              <Text variant="caption" tone="muted">
                {[mine.dueAt ? `Due ${day(mine.dueAt)}` : null, mine.overdue ? 'Overdue' : null].filter(Boolean).join(' · ') || 'Waiting on you'}
              </Text>
              {canDecide ? (
                <View style={styles.actions}>
                  {current!.responses.map((r) => (
                    <Button key={r.key} title={r.label} variant={r.tone === 'negative' ? 'danger' : r.tone === 'positive' ? 'primary' : 'secondary'} onPress={() => { setFailure(null); setChoice(r) }} testID={`workflow-respond-${r.key}`} />
                  ))}
                </View>
              ) : (
                <View style={styles.stack} testID="workflow-review-on-web">
                  <Text tone="muted">This is a decision about money and the app has not been given the figure. Review it on the web platform, where the full record is available.</Text>
                  <Button title="Review on web" onPress={() => void openOnWeb(w.path ?? `/workflow/${w.id}`)} testID="workflow-review-on-web-open" />
                </View>
              )}
            </View>
          </Card>
        ) : w.status === 'running' ? (
          <Text tone="muted">{current ? `Waiting on ${current.assignments.map((a) => a.user?.name).filter(Boolean).join(', ') || 'someone else'} for "${current.name}".` : 'Running.'}</Text>
        ) : (
          <Badge label={`${humanise(w.status)}${w.outcome ? ` · ${humanise(w.outcome)}` : ''}`} tone={w.status === 'succeeded' ? 'success' : w.status === 'failed' ? 'error' : 'neutral'} />
        )}
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Steps
            </Text>
            {w.steps.map((s) => (
              <View key={s.key} style={[styles.step, { borderColor: s.key === w.currentStepKey ? theme.colors.brand : theme.colors.border }]} testID={`workflow-step-${s.key}`}>
                <View style={styles.row}>
                  <Text style={styles.grow}>{s.name}</Text>
                  <Badge label={humanise(s.result ?? s.status)} tone={stepTone(s.status)} />
                </View>
                {s.assignments.map((a) => (
                  <Text key={a.id} variant="caption" tone="muted">
                    {[a.user?.name ?? 'Assignee', a.responseLabel ? `${a.responseLabel}${a.respondedAt ? ` · ${dateTime(a.respondedAt)}` : ''}` : humanise(a.status), a.comment ? `“${a.comment}”` : null, a.isOverride ? 'override' : null].filter(Boolean).join(' · ')}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </Card>
        {w.applyError ? (
          <Text tone="error">The workflow finished but the record did not move: {w.applyError}</Text>
        ) : null}
        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="workflow-failure">
            {failure}
          </Text>
        ) : null}
        <Button title="Open the record" variant="secondary" onPress={() => (recordRoute ? router.push(recordRoute as never) : w.path ? void openOnWeb(w.path) : undefined)} testID="workflow-open-record" />
        {isFinancialTool(w.tool) && canDecide ? <Button title="Review on web" variant="ghost" onPress={() => void openOnWeb(w.path ?? `/workflow/${w.id}`)} testID="workflow-open-web" /> : null}
      </Screen>
      <PromptSheet visible={!!choice} title={prompt?.title ?? ''} body={[prompt?.body, choice?.requireComment ? 'This answer needs a comment.' : null].filter(Boolean).join('\n\n')} label="Comment" required={!!choice?.requireComment} confirmTitle={choice?.label ?? 'Confirm'} destructive={choice?.tone === 'negative'} busy={actions.respond.isPending} error={failure} onCancel={() => setChoice(null)} onConfirm={(text) => choice && void respond(choice, text)} testID="prompt-respond" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  step: { gap: 4, paddingVertical: spacing.sm, paddingLeft: spacing.sm, borderLeftWidth: 3 },
})
