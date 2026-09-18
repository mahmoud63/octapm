import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { useChangeEvents } from '@/api/commercial-hooks'
import { CHANGE_EVENT_STATUSES, CHANGE_EVENT_TYPES } from '@/api/commercial-types'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, RecordRow, SkeletonList, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { humanise, money } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/** Change events on the project; status, type and search are applied by the server. */
export default function ChangeEventsScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const [status, setStatus] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [q, setQ] = useState('')
  const filters = useMemo(() => ({ status: status ?? undefined, type: type ?? undefined, q: q || undefined }), [status, type, q])
  const events = useChangeEvents(projectId, filters)
  const currency = projects.data?.find((p) => p.id === projectId)?.currency
  const rows = events.data?.items ?? []
  const summary = events.data?.summary

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-change-events">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-change-events">
      <FlatList
        data={rows}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {permissions.allows('change_event', 'create') ? <Button title="Raise change event" onPress={() => router.push('/commercial/change-events/new')} testID="change-event-new" /> : null}
            <Input label="Find" placeholder="Reference or title" value={term} onChangeText={setTerm} onSubmitEditing={() => setQ(term.trim())} onBlur={() => setQ(term.trim())} returnKeyType="search" autoCapitalize="none" testID="change-events-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={status === null} onPress={() => setStatus(null)} testID="change-events-chip-all" />
              {CHANGE_EVENT_STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} count={summary?.byStatus?.[s]} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`change-events-chip-${s}`} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              {CHANGE_EVENT_TYPES.map((t) => (
                <FilterChip key={t} label={humanise(t)} selected={type === t} onPress={() => setType(type === t ? null : t)} testID={`change-events-type-${t}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={events.dataUpdatedAt || undefined} isFetching={events.isFetching} />
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.ref}
            title={item.title}
            status={item.status}
            meta={[humanise(item.type), item.activity?.name, item.rfqCounts.open ? `${item.rfqCounts.open} quote${item.rfqCounts.open === 1 ? '' : 's'} out` : null, item.changeOrder ? `→ ${item.changeOrder.ref}` : null].filter(Boolean).join(' · ')}
            trailing={money(item.totals.estimate, currency)}
            onPress={() => router.push(`/commercial/change-events/${item.id}`)}
            testID={`change-event-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          events.isPending ? (
            <SkeletonList rows={4} />
          ) : events.isError ? (
            <ErrorState message={userMessage(events.error)} onRetry={() => void events.refetch()} />
          ) : (
            <EmptyState title="No change events match" />
          )
        }
        onRefresh={() => void events.refetch()}
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
