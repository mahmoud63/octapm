import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useSafetyList } from '@/api/quality-hooks'
import { useAuthStore } from '@/auth/store'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, KPI, RecordRow, SkeletonList, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, dueState, humanise } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

/** Safety incidents and near misses on the project, filtered on the device. */
export default function SafetyListScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const me = useAuthStore((s) => s.user?.id ?? null)
  const permissions = usePermissions(projectId)
  const list = useSafetyList(projectId)
  const [mode, setMode] = useState<'all' | 'mine' | 'overdue'>('all')
  const [status, setStatus] = useState<string | null>(null)
  const [term, setTerm] = useState('')

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase()
    const now = Date.now()
    return (list.data?.rows ?? [])
      .filter((s) => (mode === 'mine' ? s.ballInCourtUserId === me || s.assigneeUserId === me : mode === 'overdue' ? s.status !== 'closed' && !!s.dueDate && new Date(s.dueDate).getTime() < now : true))
      .filter((s) => (status ? s.status === status : true))
      .filter((s) => !q || [s.ref, s.title, s.responsible].some((v) => v?.toLowerCase().includes(q)))
  }, [list.data, mode, status, term, me])
  const summary = list.data?.summary

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-safety">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-safety">
      <FlatList
        data={rows}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {permissions.allows('safety', 'create') ? <Button title="Report an incident" variant="danger" onPress={() => router.push('/quality/safety/new')} testID="safety-new" /> : null}
            <View style={styles.kpis}>
              <KPI label="Open" value={String((summary?.open ?? 0) + (summary?.investigating ?? 0))} tone={(summary?.open ?? 0) + (summary?.investigating ?? 0) > 0 ? 'warning' : 'default'} />
              <KPI label="Near misses" value={String(summary?.nearMiss ?? '—')} />
              <KPI label="LTIs" value={String(summary?.lti ?? '—')} tone={(summary?.lti ?? 0) > 0 ? 'error' : 'default'} />
              <KPI label="Lost days" value={String(summary?.lostDays ?? '—')} />
            </View>
            <Input label="Find" placeholder="Reference or title" value={term} onChangeText={setTerm} autoCapitalize="none" returnKeyType="search" testID="safety-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={mode === 'all'} onPress={() => setMode('all')} testID="safety-chip-all" />
              <FilterChip label="Mine" selected={mode === 'mine'} onPress={() => setMode('mine')} testID="safety-chip-mine" />
              <FilterChip label="Overdue" selected={mode === 'overdue'} onPress={() => setMode('overdue')} testID="safety-chip-overdue" />
              {['open', 'investigating', 'submitted', 'closed'].map((s) => (
                <FilterChip key={s} label={humanise(s)} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`safety-chip-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={list.dataUpdatedAt || undefined} isFetching={list.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const state = item.dueDate && item.status !== 'closed' ? dueState(item.dueDate) : null
          return (
            <RecordRow
              reference={item.ref}
              title={item.title}
              status={item.status}
              meta={[humanise(item.incidentType), item.date ? day(item.date) : null, item.responsible, item.lostDays ? `${item.lostDays} lost day${item.lostDays === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
              trailing={state?.label}
              trailingTone={state?.tone ?? 'muted'}
              onPress={() => router.push(`/quality/safety/${item.id}`)}
              testID={`safety-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          list.isPending ? (
            <SkeletonList rows={4} />
          ) : list.isError ? (
            <ErrorState message={userMessage(list.error)} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState title={mode === 'mine' ? 'Nothing is in your court' : 'No incidents match'} />
          )
        }
        onRefresh={() => void list.refetch()}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
