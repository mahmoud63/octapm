import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { usePayApps } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, RecordRow, SkeletonList, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise, money } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

const STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'paid', 'rejected'] as const

/** Subcontractor pay applications: read for the commercial roles, submit for the party that holds one. */
export default function PayAppsScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const [status, setStatus] = useState<string | null>(null)
  const payApps = usePayApps(projectId, status ?? undefined)

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-pay-apps">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-pay-apps">
      <FlatList
        data={payApps.data ?? []}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <FilterChip label="All" selected={status === null} onPress={() => setStatus(null)} testID="pay-apps-chip-all" />
              {STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`pay-apps-chip-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={payApps.dataUpdatedAt || undefined} isFetching={payApps.isFetching} />
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.ref}
            title={item.periodLabel}
            status={item.status}
            meta={[item.commitment?.title, item.commitment?.vendor?.name, item.ballInCourt?.label].filter(Boolean).join(' · ')}
            trailing={money(item.netThisPeriod, item.commitment?.currency)}
            trailingTone={item.ballInCourt?.isYou ? 'warning' : 'muted'}
            onPress={() => router.push(`/commercial/pay-apps/${item.id}`)}
            testID={`pay-app-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          payApps.isPending ? (
            <SkeletonList rows={4} />
          ) : payApps.isError ? (
            <ErrorState message={userMessage(payApps.error)} onRetry={() => void payApps.refetch()} />
          ) : (
            <EmptyState title="No pay applications match" />
          )
        }
        onRefresh={() => void payApps.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
