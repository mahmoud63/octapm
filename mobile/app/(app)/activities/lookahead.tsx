import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useLookahead, useLookaheadItemStatus, useLookaheads } from '@/api/site-hooks'
import { VARIANCE_REASONS, type LookaheadItem } from '@/api/site-types'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonList, Text, spacing, toneForStatus, useTheme } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

const STATUSES = ['planned', 'in_progress', 'done', 'not_done'] as const

function ItemCard({ item, canUpdate, busy, onStatus }: { item: LookaheadItem; canUpdate: boolean; busy: boolean; onStatus: (status: string, varianceReason?: string) => void }) {
  const theme = useTheme()
  const [reasonFor, setReasonFor] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  return (
    <Card testID={`lookahead-item-${item.id}`}>
      <View style={styles.stack}>
        <View style={styles.row}>
          <Text variant="heading" style={styles.grow}>
            {item.name}
          </Text>
          <Badge label={humanise(item.status)} tone={item.status === 'not_done' ? 'error' : toneForStatus(item.status)} />
        </View>
        <Text variant="caption" tone="muted">
          {[item.wbsCode, item.plannedStart && item.plannedFinish ? `${day(item.plannedStart)} → ${day(item.plannedFinish)}` : null, item.quantity != null ? `${item.quantity} ${item.unit ?? ''}`.trim() : null, item.pctComplete != null ? `${item.pctComplete}%` : null].filter(Boolean).join(' · ')}
        </Text>
        {item.constraint ? (
          <Text variant="caption" tone={item.constraintStatus === 'open' ? 'warning' : 'muted'}>
            Constraint{item.constraintStatus === 'open' ? ' (open)' : ''}: {item.constraint}
          </Text>
        ) : null}
        {item.varianceReason ? (
          <Text variant="caption" tone="error">
            Not done: {humanise(item.varianceReason)}
          </Text>
        ) : null}
        {canUpdate ? (
          <>
            <View style={styles.chips}>
              {STATUSES.map((s) => (
                <FilterChip
                  key={s}
                  label={humanise(s)}
                  selected={item.status === s}
                  onPress={() => {
                    if (s === 'not_done') setReasonFor(true)
                    else {
                      setReasonFor(false)
                      onStatus(s)
                    }
                  }}
                  testID={`lookahead-${item.id}-${s}`}
                />
              ))}
            </View>
            {reasonFor ? (
              <View style={[styles.reason, { borderColor: theme.colors.border }]}>
                <Text variant="caption" tone="muted">
                  Why was it not done?
                </Text>
                <View style={styles.chips}>
                  {VARIANCE_REASONS.map((r) => (
                    <FilterChip key={r} label={humanise(r)} selected={reason === r} onPress={() => setReason(r)} testID={`lookahead-${item.id}-reason-${r}`} />
                  ))}
                </View>
                <Button title="Record not done" variant="danger" disabled={!reason} loading={busy} onPress={() => reason && onStatus('not_done', reason)} testID={`lookahead-${item.id}-confirm`} />
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Card>
  )
}

/**
 * The published lookahead: the work planned for the coming weeks, with the
 * field status of each item. Not done needs a reason, because the reason is
 * what the planner acts on.
 */
export default function LookaheadScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const lookaheads = useLookaheads(projectId)
  const currentId = lookaheads.data?.summary.currentId ?? lookaheads.data?.items[0]?.id ?? null
  const lookahead = useLookahead(projectId, currentId)
  const update = useLookaheadItemStatus(projectId ?? '', currentId ?? '')
  const [failure, setFailure] = useState<string | null>(null)
  const canUpdate = permissions.allowsTransition('lookahead', 'lookahead.item_status') || permissions.allows('lookahead', 'update')

  const items = useMemo(() => lookahead.data?.items ?? [], [lookahead.data])

  if (!projectId) {
    return (
      <Screen testID="screen-lookahead">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const setStatus = (itemId: string) => (status: string, varianceReason?: string) => {
    setFailure(null)
    update.mutate({ itemId, body: { status, varianceReason } }, { onError: (error) => setFailure(userMessage(error)) })
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-lookahead">
      {lookaheads.isPending ? (
        <SkeletonList rows={3} />
      ) : lookaheads.isError ? (
        <ErrorState message={userMessage(lookaheads.error)} onRetry={() => void lookaheads.refetch()} />
      ) : !currentId ? (
        <EmptyState title="No published lookahead" body="The planner publishes the lookahead on the web platform; it appears here with the field status of each item." />
      ) : (
        <>
          <View style={styles.stack}>
            <Text variant="title">{lookahead.data?.title ?? 'Lookahead'}</Text>
            <Text variant="caption" tone="muted">
              {lookahead.data ? `${lookahead.data.weeks} week${lookahead.data.weeks === 1 ? '' : 's'} from ${day(lookahead.data.startDate)} · ${items.length} item${items.length === 1 ? '' : 's'}` : ''}
            </Text>
            <Freshness updatedAt={lookahead.dataUpdatedAt || undefined} isFetching={lookahead.isFetching} />
          </View>
          {lookahead.isPending ? <SkeletonList rows={3} /> : items.length === 0 ? <EmptyState title="No items on this lookahead" /> : items.map((item) => <ItemCard key={item.id} item={item} canUpdate={canUpdate} busy={update.isPending} onStatus={setStatus(item.id)} />)}
          {failure ? (
            <Text tone="error" accessibilityRole="alert" testID="lookahead-failure">
              {failure}
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reason: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1 },
})
