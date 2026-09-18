import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useWorkflowActions, useWorkflowInstance } from '@/api/commercial-hooks'
import type { WorkflowResponseOption } from '@/api/commercial-types'
import { userMessage } from '@/api/errors'
import { useAuthStore } from '@/auth/store'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { appRouteForRecord, openOnWeb } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { dateTime, day, humanise } from '@/utilities/format'

const stepTone = (status: string): 'success' | 'error' | 'warning' | 'info' | 'neutral' => (status === 'completed' || status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : status === 'active' || status === 'running' || status === 'pending' ? 'warning' : 'neutral')

/**
 * One workflow instance: the record it moves, every step with who answered
 * what, and, when the current step is assigned to this person, the answers
 * the template allows. The answer goes through the respond route; the
 * server moves the record.
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
        {mine ? (
          <Card edge={theme.colors.brand} testID="workflow-my-step">
            <View style={styles.stack}>
              <Text variant="heading">{current!.name}</Text>
              {current!.description ? <Text tone="muted">{current!.description}</Text> : null}
              <Text variant="caption" tone="muted">
                {[mine.dueAt ? `Due ${day(mine.dueAt)}` : null, mine.overdue ? 'Overdue' : null].filter(Boolean).join(' · ') || 'Waiting on you'}
              </Text>
              <View style={styles.actions}>
                {current!.responses.map((r) => (
                  <Button key={r.key} title={r.label} variant={r.tone === 'negative' ? 'danger' : r.tone === 'positive' ? 'primary' : 'secondary'} onPress={() => { setFailure(null); setChoice(r) }} testID={`workflow-respond-${r.key}`} />
                ))}
              </View>
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
      </Screen>
      <PromptSheet visible={!!choice} title={choice ? `${choice.label}: ${w.recordRef ?? w.toolLabel}` : ''} body={choice?.requireComment ? 'This answer needs a comment.' : undefined} label="Comment" required={!!choice?.requireComment} confirmTitle={choice?.label ?? 'Confirm'} destructive={choice?.tone === 'negative'} busy={actions.respond.isPending} error={failure} onCancel={() => setChoice(null)} onConfirm={(text) => choice && void respond(choice, text)} testID="prompt-respond" />
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
