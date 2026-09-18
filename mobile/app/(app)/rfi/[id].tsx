import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useRfi, useRfiActions } from '@/api/record-hooks'
import type { RfiAction, RfiDetail } from '@/api/record-types'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { AttachmentList } from '@/components/AttachmentList'
import { Comments } from '@/components/Comments'
import { History } from '@/components/History'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { openOnWeb } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, dueState, humanise, money, relative } from '@/utilities/format'

type Prompt = { kind: 'respond' } | { kind: 'answer' } | { kind: 'reject' } | { kind: 'close' } | { kind: 'reopen' } | null

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
 * One RFI: the question, the official answer, the thread, who holds it, and
 * the actions this person may take in its current state. Every action is a
 * server transition; nothing here edits a status.
 */
export default function RfiDetailScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const rfi = useRfi(projectId, id ?? null)
  const actions = useRfiActions(projectId ?? '')
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [official, setOfficial] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (!projectId || !id) {
    return (
      <Screen testID="screen-rfi">
        <ErrorState message="Choose a project to open this RFI." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }

  if (rfi.isPending) {
    return (
      <Screen testID="screen-rfi">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (rfi.isError) {
    return (
      <Screen testID="screen-rfi">
        <ErrorState message={userMessage(rfi.error)} onRetry={() => void rfi.refetch()} />
      </Screen>
    )
  }

  const record: RfiDetail = rfi.data
  const status = record.status
  const canAnswer = permissions.allowsTransition('rfi', 'rfi.answer')
  const canSubmit = permissions.allows('rfi', 'submit')
  const busy = actions.act.isPending || actions.respond.isPending || actions.convert.isPending

  const run = async (action: RfiAction, body: Record<string, unknown> = {}) => {
    setFailure(null)
    try {
      await actions.act.mutateAsync({ rfiId: record.id, action, body })
      setPrompt(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const respond = async (body: string) => {
    setFailure(null)
    try {
      await actions.respond.mutateAsync({ rfiId: record.id, body, isOfficial: official && canAnswer })
      setPrompt(null)
      setOfficial(false)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if (status === 'draft' && permissions.allowsTransition('rfi', 'rfi.submit')) bar.push({ id: 'submit', title: 'Submit RFI', variant: 'primary', onPress: () => void run('submit'), busy })
  if (status === 'open' && canAnswer) bar.push({ id: 'answer', title: 'Answer', variant: 'primary', onPress: () => setPrompt({ kind: 'answer' }) })
  if (status === 'answered' && permissions.allowsTransition('rfi', 'rfi.approve')) bar.push({ id: 'approve', title: 'Approve and close', variant: 'primary', onPress: () => void run('approve'), busy })
  if (status === 'answered' && permissions.allowsTransition('rfi', 'rfi.reject')) bar.push({ id: 'reject', title: 'Reject answer', variant: 'danger', onPress: () => setPrompt({ kind: 'reject' }) })
  if (status !== 'closed' && status !== 'archived' && permissions.allowsTransition('rfi', 'rfi.close')) bar.push({ id: 'close', title: 'Close', onPress: () => setPrompt({ kind: 'close' }) })
  if ((status === 'closed' || status === 'answered') && permissions.allowsTransition('rfi', 'rfi.reopen')) bar.push({ id: 'reopen', title: 'Reopen', onPress: () => setPrompt({ kind: 'reopen' }) })
  if (!record.changeOrderId && (status === 'answered' || status === 'closed') && permissions.allows('change_order', 'create')) {
    bar.push({
      id: 'convert',
      title: 'Convert to change',
      onPress: () => {
        setFailure(null)
        actions.convert.mutate({ rfiId: record.id }, { onError: (error) => setFailure(userMessage(error)) })
      },
      busy: actions.convert.isPending,
    })
  }
  if (status !== 'closed' && status !== 'archived' && canSubmit) bar.push({ id: 'respond', title: 'Add response', variant: 'secondary', onPress: () => setPrompt({ kind: 'respond' }) })

  const due = record.responseRequiredBy ?? record.dueDate
  const dueLine = due ? (status === 'closed' ? `Was due ${day(due)}` : `${dueState(due).label} · ${day(due)}`) : null
  const ballInCourt = status === 'closed' ? 'Closed' : (record.ballInCourtUser?.name ?? record.manager?.name ?? 'Unassigned')

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-rfi">
        <RecordHeader reference={record.ref} title={record.subject} status={status} priority={record.priority} meta={[humanise(record.discipline), record.revision > 0 ? `Revision ${record.revision}` : null, dueLine].filter((v): v is string => !!v)} testID="rfi-header" />

        <Card>
          <View style={styles.stack}>
            <View style={styles.row}>
              <Text variant="label" label tone="muted">
                Ball in court
              </Text>
              <Badge label={ballInCourt} tone={status === 'closed' ? 'neutral' : record.isOverdue ? 'error' : 'info'} />
            </View>
            {record.question ? <Text>{record.question}</Text> : <Text tone="muted">No question text.</Text>}
          </View>
        </Card>

        <Card edge={record.officialResponse ? theme.colors.success : undefined}>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Official answer
            </Text>
            {record.officialResponse ? (
              <>
                <Text testID="rfi-official-answer">{record.officialResponse.body}</Text>
                <Text variant="caption" tone="muted">
                  {record.officialResponse.author?.name ?? 'Unknown'} · {relative(record.officialResponse.createdAt)}
                </Text>
              </>
            ) : (
              <Text tone="muted">{status === 'open' ? 'Waiting for an answer.' : status === 'draft' ? 'Not submitted yet.' : 'No official answer recorded.'}</Text>
            )}
          </View>
        </Card>

        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Responses
            </Text>
            {record.responses.length === 0 ? (
              <Text tone="muted">No responses yet.</Text>
            ) : (
              record.responses.map((response) => (
                <View key={response.id} style={[styles.response, { borderColor: theme.colors.border }]} testID={`rfi-response-${response.id}`}>
                  <View style={styles.row}>
                    <Text variant="caption" style={styles.author}>
                      {response.author?.name ?? 'Unknown'}
                    </Text>
                    {response.isOfficial ? <Badge label="Official" tone="success" /> : null}
                    <Text variant="caption" tone="muted">
                      {relative(response.createdAt)}
                    </Text>
                  </View>
                  <Text>{response.body}</Text>
                </View>
              ))
            )}
          </View>
        </Card>

        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Details
            </Text>
            <Fact label="Manager" value={record.manager?.name} />
            <Fact label="Assigned to" value={record.assignees.map((p) => p.name).join(', ') || null} />
            <Fact label="Distribution" value={record.distribution.map((p) => p.name).join(', ') || null} />
            <Fact label="Location" value={record.location?.name} />
            <Fact label="Activity" value={record.activity ? [record.activity.activityCode, record.activity.name].filter(Boolean).join(' · ') : null} />
            <Fact label="Spec section" value={record.specSection} />
            <Fact label="Raised" value={record.raisedDate ? day(record.raisedDate) : null} />
            <Fact label="Response required by" value={record.responseRequiredBy ? day(record.responseRequiredBy) : null} />
            <Fact label="Answered" value={record.answeredDate ? day(record.answeredDate) : null} />
            <Fact label="Cost impact" value={record.costImpact ? (record.costImpactAmount != null ? money(record.costImpactAmount, null) : 'Yes') : null} />
            <Fact label="Schedule impact" value={record.scheduleImpactFlag ? `${record.scheduleImpact ?? 0} day${record.scheduleImpact === 1 ? '' : 's'}` : null} />
            {record.changeOrderId ? <Fact label="Change order" value="Converted" /> : null}
          </View>
        </Card>

        <Card>
          <AttachmentList projectId={projectId} recordType="rfi" recordId={record.id} canAdd={permissions.allows('rfi', 'update') || canSubmit} />
        </Card>
        <Card>
          <Comments projectId={projectId} recordType="rfi" recordId={record.id} />
        </Card>
        <Card>
          <History projectId={projectId} entityType="rfi" entityId={record.id} />
        </Card>

        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="rfi-failure">
            {failure}
          </Text>
        ) : null}
        <Button title="Open on the web" variant="ghost" onPress={() => void openOnWeb(record.path)} />
      </Screen>

      <ActionBar actions={bar} />

      <PromptSheet
        visible={prompt?.kind === 'respond'}
        title="Add a response"
        label="Response"
        required
        confirmTitle="Post response"
        busy={actions.respond.isPending}
        error={failure}
        toggle={canAnswer ? { label: 'This is the official answer', value: official, onChange: setOfficial } : undefined}
        onCancel={() => setPrompt(null)}
        onConfirm={(text) => void respond(text)}
        testID="prompt-respond"
      />
      <PromptSheet visible={prompt?.kind === 'answer'} title="Answer the RFI" body="The answer becomes the official response and the RFI moves to answered." label="Answer" required confirmTitle="Record answer" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(text) => void run('answer', { response: text })} testID="prompt-answer" />
      <PromptSheet visible={prompt?.kind === 'reject'} title="Reject the answer" body="The RFI goes back to open for a better answer." label="Reason" required confirmTitle="Reject" destructive busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(text) => void run('reject', { reason: text })} testID="prompt-reject" />
      <PromptSheet visible={prompt?.kind === 'close'} title="Close the RFI" label="Closing comment" required confirmTitle="Close RFI" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(text) => void run('close', { comment: text })} testID="prompt-close" />
      <PromptSheet visible={prompt?.kind === 'reopen'} title="Reopen the RFI" body="A new revision starts; the previous answer stays in the history." label="Reason" required confirmTitle="Reopen" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(text) => void run('reopen', { reason: text })} testID="prompt-reopen" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  fact: { gap: 2 },
  response: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  author: { fontFamily: 'Inter_600SemiBold' },
})
