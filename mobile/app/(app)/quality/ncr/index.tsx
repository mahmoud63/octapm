import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useNcrs } from '@/api/quality-hooks'
import { useAuthStore } from '@/auth/store'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, KPI, RecordRow, SkeletonList, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { dueState, humanise } from '@/utilities/format'

/** NCRs on the project. The server sends them all; the filters are applied here. */
export default function NcrListScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const me = useAuthStore((s) => s.user?.id ?? null)
  const permissions = usePermissions(projectId)
  const ncrs = useNcrs(projectId)
  const [mode, setMode] = useState<'all' | 'mine' | 'overdue'>('all')
  const [status, setStatus] = useState<string | null>(null)
  const [severity, setSeverity] = useState<string | null>(null)
  const [term, setTerm] = useState('')

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase()
    const now = Date.now()
    return (ncrs.data?.rows ?? [])
      .filter((n) => (mode === 'mine' ? n.ballInCourtUserId === me || n.assigneeUserId === me : mode === 'overdue' ? n.status !== 'closed' && !!n.dueDate && new Date(n.dueDate).getTime() < now : true))
      .filter((n) => (status ? n.status === status : true))
      .filter((n) => (severity ? n.severity === severity : true))
      .filter((n) => !q || [n.ref, n.description, n.responsible, n.disposition].some((v) => v?.toLowerCase().includes(q)))
  }, [ncrs.data, mode, status, severity, term, me])
  const summary = ncrs.data?.summary

  if (!projectId) {
    return (
      <Screen testID="screen-ncrs">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-ncrs">
      <FlatList
        data={rows}
        keyExtractor={(n) => n.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {permissions.allows('ncr', 'create') ? <Button title="Raise NCR" onPress={() => router.push('/quality/ncr/new')} testID="ncr-new" /> : null}
            <View style={styles.kpis}>
              <KPI label="Open" value={String(summary?.open ?? '—')} />
              <KPI label="Submitted" value={String(summary?.submitted ?? '—')} tone={(summary?.submitted ?? 0) > 0 ? 'warning' : 'default'} />
              <KPI label="Major" value={String(summary?.major ?? '—')} tone={(summary?.major ?? 0) > 0 ? 'error' : 'default'} />
              <KPI label="Overdue" value={String(summary?.overdue ?? '—')} tone={(summary?.overdue ?? 0) > 0 ? 'error' : 'default'} onPress={() => setMode('overdue')} />
            </View>
            <Input label="Find" placeholder="Reference or description" value={term} onChangeText={setTerm} autoCapitalize="none" returnKeyType="search" testID="ncr-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={mode === 'all'} onPress={() => setMode('all')} testID="ncr-chip-all" />
              <FilterChip label="Mine" selected={mode === 'mine'} onPress={() => setMode('mine')} testID="ncr-chip-mine" />
              <FilterChip label="Overdue" selected={mode === 'overdue'} onPress={() => setMode('overdue')} testID="ncr-chip-overdue" />
              {['open', 'submitted', 'closed'].map((s) => (
                <FilterChip key={s} label={humanise(s)} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`ncr-chip-${s}`} />
              ))}
              {['major', 'minor'].map((s) => (
                <FilterChip key={s} label={humanise(s)} selected={severity === s} onPress={() => setSeverity(severity === s ? null : s)} testID={`ncr-severity-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={ncrs.dataUpdatedAt || undefined} isFetching={ncrs.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const state = item.dueDate && item.status !== 'closed' ? dueState(item.dueDate) : null
          return (
            <RecordRow
              reference={item.ref}
              title={item.description ?? 'NCR'}
              status={item.status}
              meta={[`${humanise(item.severity)} severity`, item.responsible, item.assigneeUser?.name].filter(Boolean).join(' · ')}
              trailing={state?.label}
              trailingTone={state?.tone ?? 'muted'}
              onPress={() => router.push(`/quality/ncr/${item.id}`)}
              testID={`ncr-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          ncrs.isPending ? (
            <SkeletonList rows={4} />
          ) : ncrs.isError ? (
            <ErrorState message={userMessage(ncrs.error)} onRetry={() => void ncrs.refetch()} />
          ) : (
            <EmptyState title={mode === 'mine' ? 'Nothing is in your court' : 'No NCRs match'} />
          )
        }
        onRefresh={() => void ncrs.refetch()}
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
