import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useSafetyActions, useSafetyList } from '@/api/quality-hooks'
import type { CloseoutInput } from '@/api/quality-types'
import { useAuthStore } from '@/auth/store'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { CloseoutSheet } from '@/components/CloseoutSheet'
import { Comments } from '@/components/Comments'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact, WorkflowRecordCard } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, spacing } from '@/design-system'
import { openOnWeb, webPathForTarget } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, dueState, humanise } from '@/utilities/format'

type Prompt = 'approve' | 'reject' | 'reopen' | null

/** One safety incident: what happened, the investigation, the closeout with evidence, and the decisions. */
export default function SafetyIncidentScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const me = useAuthStore((s) => s.user?.id ?? null)
  const permissions = usePermissions(projectId)
  const list = useSafetyList(projectId)
  const actions = useSafetyActions(projectId ?? '')
  const [closing, setClosing] = useState(false)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const record = useMemo(() => list.data?.rows.find((s) => s.id === id) ?? null, [list.data, id])

  if (!projectId || !id) {
    return (
      <Screen testID="screen-safety-incident">
        <ErrorState message="Choose a project to open this incident." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (list.isPending) {
    return (
      <Screen testID="screen-safety-incident">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (list.isError || !record) {
    return (
      <Screen testID="screen-safety-incident">
        <ErrorState message={list.isError ? userMessage(list.error) : 'This incident is no longer available.'} onRetry={() => void list.refetch()} />
      </Screen>
    )
  }

  const status = record.status
  const canSubmit = permissions.allowsTransition('safety', 'safety.submit') || record.assigneeUserId === me
  const busy = actions.submit.isPending || actions.decide.isPending

  const submit = async (body: CloseoutInput) => {
    setFailure(null)
    try {
      await actions.submit.mutateAsync({ incidentId: record.id, body })
      setClosing(false)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }
  const decide = async (action: 'approve' | 'reject' | 'reopen', text?: string) => {
    setFailure(null)
    try {
      await actions.decide.mutateAsync({ incidentId: record.id, action, text })
      setPrompt(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if ((status === 'open' || status === 'investigating') && canSubmit) bar.push({ id: 'submit', title: 'Submit closeout', variant: 'primary', onPress: () => setClosing(true) })
  if (status === 'submitted' && permissions.allowsTransition('safety', 'safety.approve')) bar.push({ id: 'approve', title: 'Approve and close', variant: 'primary', onPress: () => setPrompt('approve') })
  if (status === 'submitted' && permissions.allowsTransition('safety', 'safety.reject')) bar.push({ id: 'reject', title: 'Reject', variant: 'danger', onPress: () => setPrompt('reject') })
  if (status === 'closed' && permissions.allowsTransition('safety', 'safety.reopen')) bar.push({ id: 'reopen', title: 'Reopen', onPress: () => setPrompt('reopen') })

  const due = record.dueDate && status !== 'closed' ? dueState(record.dueDate) : null

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-safety-incident">
        <RecordHeader reference={record.ref} title={record.title} status={status} priority={record.incidentType === 'lti' || record.incidentType === 'fatality' ? 'urgent' : record.severity} meta={[humanise(record.incidentType), record.date ? `On ${day(record.date)}` : null, record.lostDays ? `${record.lostDays} lost day${record.lostDays === 1 ? '' : 's'}` : null, record.dueDate ? `${due ? due.label : 'Was due'} · ${day(record.dueDate)}` : null].filter((v): v is string => !!v)} testID="safety-header" />
        <View style={styles.row}>
          <Text variant="label" label tone="muted">
            Ball in court
          </Text>
          <Badge label={status === 'closed' ? 'Closed' : (record.ballInCourtUser?.name ?? record.assigneeUser?.name ?? record.responsible ?? 'Unassigned')} tone={status === 'closed' ? 'neutral' : due?.tone === 'error' ? 'error' : 'info'} />
        </View>
        <Card>
          <View style={styles.stack}>
            <Fact label="Investigation" value={record.investigation} />
            <Fact label="Responsible" value={record.responsible} />
            <Fact label="Assigned to" value={record.assigneeUser?.name} />
            <Fact label="Activities" value={record.activityLinks.map((l) => l.activity?.name).filter(Boolean).join(', ') || null} />
          </View>
        </Card>
        <WorkflowRecordCard record={record} onOpenFailed={setFailure} />
        <Card>
          <Comments projectId={projectId} recordType="safety_incident" recordId={record.id} />
        </Card>
        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="safety-failure">
            {failure}
          </Text>
        ) : null}
        <Button title="Open on the web" variant="ghost" onPress={() => void openOnWeb(webPathForTarget({ projectId, module: 'quality', child: 'safety', recordType: 'safety_incident', recordId: record.id }))} />
      </Screen>
      <ActionBar actions={bar} />
      <CloseoutSheet visible={closing} projectId={projectId} title={`Close out ${record.ref}`} existingRefs={record.attachmentRefs} currentDue={record.dueDate} busy={actions.submit.isPending} error={failure} onCancel={() => setClosing(false)} onSubmit={(body) => void submit(body)} />
      <PromptSheet visible={prompt === 'approve'} title="Approve the closeout" label="Comment" confirmTitle="Approve" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void decide('approve', t || undefined)} testID="prompt-approve" />
      <PromptSheet visible={prompt === 'reject'} title="Reject the closeout" body="The incident goes back to investigating." label="Reason" required confirmTitle="Reject" destructive busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void decide('reject', t)} testID="prompt-reject" />
      <PromptSheet visible={prompt === 'reopen'} title="Reopen the incident" label="Reason" required confirmTitle="Reopen" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void decide('reopen', t)} testID="prompt-reopen" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
})
