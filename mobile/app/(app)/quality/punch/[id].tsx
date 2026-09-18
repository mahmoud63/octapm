import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { usePunchActions, usePunchItem } from '@/api/quality-hooks'
import type { PunchAction } from '@/api/quality-types'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { AttachmentList } from '@/components/AttachmentList'
import { Comments } from '@/components/Comments'
import { History } from '@/components/History'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, spacing } from '@/design-system'
import { appRouteForRecord, openOnWeb, webPathForTarget } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, dueState, humanise } from '@/utilities/format'

type Prompt = { action: PunchAction; title: string; label: string; required: boolean; destructive?: boolean } | null

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
 * One punch item or observation: what, where, who, by when, the photos,
 * the discussion and the history, and the transitions this person may take
 * in its current state. Closing stays with the final approver when one is
 * named; the server enforces that.
 */
export default function PunchItemScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const item = usePunchItem(projectId, id ?? null)
  const actions = usePunchActions(projectId ?? '')
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [failure, setFailure] = useState<string | null>(null)

  if (!projectId || !id) {
    return (
      <Screen testID="screen-punch-item">
        <ErrorState message="Choose a project to open this item." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (item.isPending) {
    return (
      <Screen testID="screen-punch-item">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (item.isError) {
    return (
      <Screen testID="screen-punch-item">
        <ErrorState message={userMessage(item.error)} onRetry={() => void item.refetch()} />
      </Screen>
    )
  }

  const p = item.data
  const status = p.status
  const can = (transition: string) => permissions.allowsTransition('punch', transition)
  const busy = actions.transition.isPending

  const run = async (action: PunchAction, reason?: string) => {
    setFailure(null)
    try {
      await actions.transition.mutateAsync({ itemId: p.id, action, reason })
      setPrompt(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if (status === 'draft' && can('punch.open')) bar.push({ id: 'open', title: 'Open', variant: 'primary', busy, onPress: () => void run('open') })
  if (status === 'open' && can('punch.ready_for_review')) bar.push({ id: 'ready', title: 'Ready for review', variant: 'primary', busy, onPress: () => void run('ready_for_review') })
  if ((status === 'open' || status === 'ready_for_review') && can('punch.close')) bar.push({ id: 'close', title: 'Close', variant: status === 'ready_for_review' ? 'primary' : 'secondary', busy, onPress: () => void run('close') })
  if ((status === 'closed' || status === 'ready_for_review') && can('punch.reopen')) bar.push({ id: 'reopen', title: 'Reopen', onPress: () => setPrompt({ action: 'reopen', title: 'Reopen the item', label: 'Reason', required: true }) })
  if ((status === 'open' || status === 'ready_for_review') && can('punch.dispute')) bar.push({ id: 'dispute', title: 'Dispute', onPress: () => setPrompt({ action: 'dispute', title: 'Dispute the item', label: 'Reason', required: true }) })
  if (status === 'in_dispute' && can('punch.reopen')) bar.push({ id: 'resolve', title: 'Resolve dispute', variant: 'primary', onPress: () => setPrompt({ action: 'resolve_dispute', title: 'Resolve the dispute', label: 'Outcome', required: false }) })
  if (status !== 'closed' && status !== 'void' && can('punch.void')) bar.push({ id: 'void', title: 'Void', variant: 'danger', onPress: () => setPrompt({ action: 'void', title: 'Void the item', label: 'Reason', required: true, destructive: true }) })

  const due = p.dueDate && status !== 'closed' && status !== 'void' ? dueState(p.dueDate) : null
  const sourceRoute = p.sourceRecordType && p.sourceRecordId ? appRouteForRecord(p.sourceRecordType, p.sourceRecordId) : null

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-punch-item">
        <RecordHeader reference={p.ref} title={p.title} status={status} priority={p.priority} meta={[p.kind === 'observation' ? `Observation · ${p.observationTypeLabel ?? humanise(p.observationType)}` : 'Punch item', p.trade, p.dueDate ? `${due ? due.label : 'Due'} · ${day(p.dueDate)}` : null].filter((v): v is string => !!v)} testID="punch-header" />
        <View style={styles.row}>
          <Text variant="label" label tone="muted">
            Ball in court
          </Text>
          <Badge label={status === 'closed' ? 'Closed' : (p.ballInCourtUser?.name ?? p.assigneeCompany?.name ?? 'Unassigned')} tone={p.isOverdue ? 'error' : status === 'closed' ? 'neutral' : 'info'} />
        </View>
        <Card>
          <View style={styles.stack}>
            {p.description ? <Text>{p.description}</Text> : <Text tone="muted">No description.</Text>}
            {p.kind === 'observation' ? (
              <>
                <Fact label="Hazard" value={p.hazard} />
                <Fact label="Contributing condition" value={p.contributingCondition} />
              </>
            ) : null}
            <Fact label="Assigned to" value={[p.assigneeUser?.name, p.assigneeCompany?.name].filter(Boolean).join(' · ') || null} />
            <Fact label="Manager" value={p.managerUser?.name} />
            <Fact label="Final approver" value={p.finalApproverUser?.name} />
            <Fact label="Location" value={[p.location?.name, p.locationText].filter(Boolean).join(' · ') || null} />
            <Fact label="Sheet" value={p.sheet ? [p.sheet.number, p.sheet.title].filter(Boolean).join(' ') : null} />
            <Fact label="Activity" value={p.activity ? [p.activity.activityCode ?? p.activity.code, p.activity.name].filter(Boolean).join(' · ') : null} />
            <Fact label="Reopened" value={p.reopenCount ? `${p.reopenCount} time${p.reopenCount === 1 ? '' : 's'}` : null} />
            {p.disputeReason ? <Fact label="Dispute" value={p.disputeReason} /> : null}
            {p.sourceRecordType ? (
              <View style={styles.row}>
                <Text variant="caption" tone="muted" style={styles.grow}>
                  Raised from {humanise(p.sourceRecordType)}
                </Text>
                <Button title="Open source" variant="ghost" onPress={() => (sourceRoute ? router.push(sourceRoute as never) : void openOnWeb(webPathForTarget({ projectId, module: 'quality', recordType: p.sourceRecordType, recordId: p.sourceRecordId })))} />
              </View>
            ) : null}
          </View>
        </Card>
        <Card>
          <AttachmentList projectId={projectId} recordType="punch_item" recordId={p.id} canAdd={status !== 'closed' && status !== 'void' && (permissions.allows('punch', 'update') || permissions.allows('punch', 'submit'))} />
        </Card>
        <Card>
          <Comments projectId={projectId} recordType="punch_item" recordId={p.id} />
        </Card>
        <Card>
          <History projectId={projectId} entityType="punch_item" entityId={p.id} />
        </Card>
        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="punch-failure">
            {failure}
          </Text>
        ) : null}
        <Button title="Open on the web" variant="ghost" onPress={() => void openOnWeb(webPathForTarget({ projectId, module: 'quality', child: 'defects', recordType: 'punch_item', recordId: p.id }))} />
      </Screen>
      <ActionBar actions={bar} />
      <PromptSheet visible={!!prompt} title={prompt?.title ?? ''} label={prompt?.label ?? 'Reason'} required={prompt?.required} confirmTitle={prompt ? humanise(prompt.action) : 'Confirm'} destructive={prompt?.destructive} busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(text) => prompt && void run(prompt.action, text || undefined)} testID="prompt-punch" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1 },
  fact: { gap: 2 },
})
