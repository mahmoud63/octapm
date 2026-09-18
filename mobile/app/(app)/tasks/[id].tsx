import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useTask, useTaskActions } from '@/api/record-hooks'
import type { TaskStatus } from '@/api/record-types'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Button, Card, ErrorState, Input, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { openOnWeb } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, dateTime, dueState, humanise, relative } from '@/utilities/format'

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
 * One task: what, for whom, by when, the conversation on it and the way to
 * move it along. Closing goes through the close route so the server stamps
 * who closed it and when.
 */
export default function TaskDetailScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const task = useTask(id ?? null)
  const permissions = usePermissions(task.data?.projectId ?? currentProjectId)
  const actions = useTaskActions()
  const [closing, setClosing] = useState(false)
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  if (task.isPending) {
    return (
      <Screen testID="screen-task">
        <SkeletonList rows={5} />
      </Screen>
    )
  }
  if (task.isError) {
    return (
      <Screen testID="screen-task">
        <ErrorState message={userMessage(task.error)} onRetry={() => void task.refetch()} />
      </Screen>
    )
  }

  const record = task.data
  const open = record.status !== 'done' && record.status !== 'canceled'
  const canUpdate = permissions.allows('task', 'update')
  const canClose = permissions.allowsTransition('task', 'task.close') || canUpdate
  const canComment = permissions.allowsTransition('task', 'task.comment') || permissions.allows('task', 'submit')

  const setStatus = async (status: TaskStatus) => {
    setFailure(null)
    try {
      await actions.update.mutateAsync({ taskId: record.id, body: { status } })
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const comment = async () => {
    const body = draft.trim()
    if (!body) return
    setFailure(null)
    try {
      await actions.comment.mutateAsync({ taskId: record.id, body })
      setDraft('')
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if (open && canUpdate && record.status !== 'in_progress') bar.push({ id: 'start', title: 'Start', onPress: () => void setStatus('in_progress'), busy: actions.update.isPending })
  if (open && canUpdate && record.status !== 'blocked') bar.push({ id: 'block', title: 'Blocked', onPress: () => void setStatus('blocked'), busy: actions.update.isPending })
  if (open && canClose) bar.push({ id: 'close', title: 'Mark done', variant: 'primary', onPress: () => setClosing(true) })

  const state = record.dueDate && open ? dueState(record.dueDate) : null

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-task">
        <RecordHeader reference={record.taskNumber} title={record.title} status={record.status} priority={record.priority} meta={[humanise(record.label), record.project?.name, record.dueDate ? `${open ? state?.label : 'Was due'} · ${day(record.dueDate)}` : null].filter((v): v is string => !!v)} testID="task-header" />

        <Card>
          <View style={styles.stack}>
            {record.description ? <Text>{record.description}</Text> : <Text tone="muted">No description.</Text>}
            <Fact label="Assigned to" value={record.assignee?.name ?? record.assigneeName} />
            <Fact label="Activity" value={record.activity ? [record.activity.activityCode, record.activity.name].filter(Boolean).join(' · ') : null} />
            <Fact label="Raised by" value={record.createdBy?.name} />
            <Fact label="Closed" value={record.closedAt ? dateTime(record.closedAt) : null} />
          </View>
        </Card>

        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Comments
            </Text>
            {record.comments.length === 0 ? (
              <Text tone="muted">No comments yet.</Text>
            ) : (
              record.comments.map((c) => (
                <View key={c.id} style={[styles.comment, { borderColor: theme.colors.border }]} testID={`task-comment-${c.id}`}>
                  <View style={styles.row}>
                    <Text variant="caption" style={styles.author}>
                      {c.author?.name ?? 'Someone'}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {relative(c.createdAt)}
                    </Text>
                  </View>
                  <Text>{c.body}</Text>
                </View>
              ))
            )}
            {canComment ? (
              <>
                <Input label="Add a comment" value={draft} onChangeText={setDraft} multiline placeholder="What happened, what is needed" testID="task-comment-input" />
                <Button title="Post comment" variant="secondary" disabled={!draft.trim()} loading={actions.comment.isPending} onPress={() => void comment()} testID="task-comment-post" />
              </>
            ) : null}
          </View>
        </Card>

        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              History
            </Text>
            {record.history.length === 0 ? (
              <Text tone="muted">No history yet.</Text>
            ) : (
              record.history.map((h) => (
                <View key={h.id} style={[styles.comment, { borderColor: theme.colors.border }]}>
                  <Text>
                    {humanise(h.action)}
                    {h.fromStatus || h.toStatus ? `: ${humanise(h.fromStatus) || '—'} → ${humanise(h.toStatus) || '—'}` : ''}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {h.actor?.name ?? 'System'} · {dateTime(h.occurredAt ?? h.createdAt)}
                    {h.comment ? ` · ${h.comment}` : ''}
                  </Text>
                </View>
              ))
            )}
          </View>
        </Card>

        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="task-failure">
            {failure}
          </Text>
        ) : null}
        <Button title="Open on the web" variant="ghost" onPress={() => void openOnWeb(`/tasks?recordId=${record.id}`)} />
        <Button title="Back to tasks" variant="ghost" onPress={() => router.back()} />
      </Screen>

      <ActionBar actions={bar} />
      <PromptSheet
        visible={closing}
        title="Mark the task done"
        label="Closing note"
        placeholder="What was done"
        confirmTitle="Mark done"
        busy={actions.close.isPending}
        error={failure}
        onCancel={() => setClosing(false)}
        onConfirm={(text) => {
          setFailure(null)
          actions.close.mutate({ taskId: record.id, comment: text || undefined }, { onSuccess: () => setClosing(false), onError: (error) => setFailure(userMessage(error)) })
        }}
        testID="prompt-close-task"
      />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  fact: { gap: 2 },
  comment: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  author: { fontFamily: 'Inter_600SemiBold' },
})
