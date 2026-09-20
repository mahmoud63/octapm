import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useNcrActions, useNcrs } from '@/api/quality-hooks'
import type { CloseoutInput } from '@/api/quality-types'
import { useAuthStore } from '@/auth/store'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { CloseoutSheet } from '@/components/CloseoutSheet'
import { Comments } from '@/components/Comments'
import { PromptSheet } from '@/components/PromptSheet'
import { Evidence } from '@/components/Evidence'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact, WorkflowRecordCard } from '@/components/WorkflowRecordCard'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, spacing } from '@/design-system'
import { openOnWeb, webPathForTarget } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, dueState, humanise } from '@/utilities/format'

type Prompt = 'approve' | 'reject' | 'reopen' | null

/**
 * One NCR: the non-conformance, its disposition, who holds it, the closeout
 * with its evidence and the history. The assignee submits the closeout;
 * quality approves, rejects or reopens it, each through its own route.
 */
export default function NcrScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const me = useAuthStore((s) => s.user?.id ?? null)
  const permissions = usePermissions(projectId)
  const ncrs = useNcrs(projectId)
  const actions = useNcrActions(projectId ?? '')
  const [closing, setClosing] = useState(false)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const record = useMemo(() => ncrs.data?.rows.find((n) => n.id === id) ?? null, [ncrs.data, id])

  if (!projectId || !id) {
    return (
      <Screen testID="screen-ncr">
        <ErrorState message="Choose a project to open this NCR." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (ncrs.isPending) {
    return (
      <Screen testID="screen-ncr">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (ncrs.isError || !record) {
    return (
      <Screen testID="screen-ncr">
        <ErrorState message={ncrs.isError ? userMessage(ncrs.error) : 'This NCR is no longer available.'} onRetry={() => void ncrs.refetch()} />
      </Screen>
    )
  }

  const status = record.status
  const canSubmit = permissions.allowsTransition('ncr', 'ncr.submit') || record.assigneeUserId === me
  const busy = actions.submit.isPending || actions.decide.isPending

  const submit = async (body: CloseoutInput) => {
    setFailure(null)
    try {
      await actions.submit.mutateAsync({ ncrId: record.id, body })
      setClosing(false)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }
  const decide = async (action: 'approve' | 'reject' | 'reopen', text?: string) => {
    setFailure(null)
    try {
      await actions.decide.mutateAsync({ ncrId: record.id, action, text })
      setPrompt(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if (status === 'open' && canSubmit) bar.push({ id: 'submit', title: 'Submit closeout', variant: 'primary', onPress: () => setClosing(true) })
  if (status === 'submitted' && permissions.allowsTransition('ncr', 'ncr.approve')) bar.push({ id: 'approve', title: 'Approve and close', variant: 'primary', onPress: () => setPrompt('approve') })
  if (status === 'submitted' && permissions.allowsTransition('ncr', 'ncr.reject')) bar.push({ id: 'reject', title: 'Reject', variant: 'danger', onPress: () => setPrompt('reject') })
  if (status === 'closed' && permissions.allowsTransition('ncr', 'ncr.reopen')) bar.push({ id: 'reopen', title: 'Reopen', onPress: () => setPrompt('reopen') })

  const due = record.dueDate && status !== 'closed' ? dueState(record.dueDate) : null

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-ncr">
        <RecordHeader reference={record.ref} title={record.description ?? 'Non-conformance'} status={status} priority={record.severity === 'major' ? 'high' : undefined} meta={[`${humanise(record.severity)} severity`, record.dueDate ? `${due ? due.label : 'Was due'} · ${day(record.dueDate)}` : null].filter((v): v is string => !!v)} testID="ncr-header" />
        <View style={styles.row}>
          <Text variant="label" label tone="muted">
            Ball in court
          </Text>
          <Badge label={status === 'closed' ? 'Closed' : (record.ballInCourtUser?.name ?? record.assigneeUser?.name ?? record.responsible ?? 'Unassigned')} tone={status === 'closed' ? 'neutral' : due?.tone === 'error' ? 'error' : 'info'} />
        </View>
        <Card>
          <View style={styles.stack}>
            <Fact label="Disposition" value={record.disposition} />
            <Fact label="Responsible" value={record.responsible} />
            <Fact label="Assigned to" value={record.assigneeUser?.name} />
            <Fact label="Activities" value={record.activityLinks.map((l) => l.activity?.name).filter(Boolean).join(', ') || null} />
          </View>
        </Card>
        <WorkflowRecordCard record={record} onOpenFailed={setFailure} />

        <Card>
          <Evidence title="Photographs" emptyText="No photographs on this record yet." projectId={projectId} recordType="ncr" recordId={record.id} recordRef={record.ref} canAdd={permissions.allows('ncr', 'update') || permissions.allows('ncr', 'submit')} />
        </Card>
        <Card>
          <Comments projectId={projectId} recordType="ncr" recordId={record.id} />
        </Card>
        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="ncr-failure">
            {failure}
          </Text>
        ) : null}
        <Button title="Open on the web" variant="ghost" onPress={() => void openOnWeb(webPathForTarget({ projectId, module: 'quality', child: 'ncr', recordType: 'ncr', recordId: record.id }))} />
      </Screen>
      <ActionBar actions={bar} />
      <CloseoutSheet visible={closing} projectId={projectId} title={`Close out ${record.ref}`} existingRefs={record.attachmentRefs} currentDue={record.dueDate} busy={actions.submit.isPending} error={failure} onCancel={() => setClosing(false)} onSubmit={(body) => void submit(body)} />
      <PromptSheet visible={prompt === 'approve'} title="Approve the closeout" body="The NCR closes and its points return to the quality score." label="Comment" confirmTitle="Approve" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void decide('approve', t || undefined)} testID="prompt-approve" />
      <PromptSheet visible={prompt === 'reject'} title="Reject the closeout" body="The NCR goes back to open for more work." label="Reason" required confirmTitle="Reject" destructive busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void decide('reject', t)} testID="prompt-reject" />
      <PromptSheet visible={prompt === 'reopen'} title="Reopen the NCR" label="Reason" required confirmTitle="Reopen" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void decide('reopen', t)} testID="prompt-reopen" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
})
