import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { usePunchList } from '@/api/quality-hooks'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, KPI, RecordRow, SkeletonList, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { dueState, humanise } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'
import { listPerformance } from '@/components/listProps'

const STATUSES = ['draft', 'open', 'ready_for_review', 'in_dispute', 'closed'] as const

/** Punch items and observations: mine first, overdue next, then by status. */
export default function PunchListScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const params = useLocalSearchParams<{ kind?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const [kind, setKind] = useState<'punch' | 'observation' | 'all'>(params.kind === 'observation' ? 'observation' : 'punch')
  const [mode, setMode] = useState<'all' | 'mine' | 'overdue'>('all')
  const [status, setStatus] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const filters = useMemo(() => ({ kind, ballInCourt: mode === 'mine', overdue: mode === 'overdue', status: status ?? undefined, search: search || undefined }), [kind, mode, status, search])
  const list = usePunchList(projectId, filters)
  const rows = list.data?.items ?? []
  const summary = list.data?.summary

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-punch">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-punch">
      <FlatList {...listPerformance}
        data={rows}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {permissions.allows('punch', 'create') ? <Button title={kind === 'observation' ? 'New observation' : 'New punch item'} onPress={() => router.push({ pathname: '/quality/punch/new', params: { kind: kind === 'observation' ? 'observation' : 'punch' } } as never)} testID="punch-new" /> : null}
            <View style={styles.kpis}>
              <KPI label="Open" value={String(summary?.open ?? '—')} />
              <KPI label="Overdue" value={String(summary?.overdue ?? '—')} tone={(summary?.overdue ?? 0) > 0 ? 'error' : 'default'} onPress={() => setMode('overdue')} />
            </View>
            <Input label="Find" placeholder="Reference, title or trade" value={term} onChangeText={setTerm} onSubmitEditing={() => setSearch(term.trim())} onBlur={() => setSearch(term.trim())} returnKeyType="search" autoCapitalize="none" testID="punch-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="Punch" selected={kind === 'punch'} onPress={() => setKind('punch')} testID="punch-kind-punch" />
              <FilterChip label="Observations" selected={kind === 'observation'} onPress={() => setKind('observation')} testID="punch-kind-observation" />
              <FilterChip label="Both" selected={kind === 'all'} onPress={() => setKind('all')} testID="punch-kind-all" />
              <FilterChip label="Mine" selected={mode === 'mine'} onPress={() => setMode(mode === 'mine' ? 'all' : 'mine')} testID="punch-chip-mine" />
              <FilterChip label="Overdue" selected={mode === 'overdue'} onPress={() => setMode(mode === 'overdue' ? 'all' : 'overdue')} testID="punch-chip-overdue" />
              {STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} count={summary?.byStatus?.[s]} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`punch-chip-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={list.dataUpdatedAt || undefined} isFetching={list.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const state = item.dueDate && item.status !== 'closed' && item.status !== 'void' ? dueState(item.dueDate) : null
          return (
            <RecordRow
              reference={item.ref}
              title={item.title}
              status={item.status}
              meta={[item.kind === 'observation' ? (item.observationTypeLabel ?? humanise(item.observationType)) : item.trade, item.assigneeCompany?.name ?? item.assigneeUser?.name, item.location?.name ?? item.locationText, item.priority !== 'normal' ? `${humanise(item.priority)} priority` : null].filter(Boolean).join(' · ')}
              trailing={state?.label}
              trailingTone={item.isOverdue ? 'error' : (state?.tone ?? 'muted')}
              onPress={() => router.push(`/quality/punch/${item.id}`)}
              testID={`punch-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          list.isPending ? (
            <SkeletonList rows={4} />
          ) : list.isError ? (
            <ErrorState message={userMessage(list.error)} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState title={mode === 'mine' ? 'Nothing is in your court' : kind === 'observation' ? 'No observations match' : 'No punch items match'} />
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
  kpis: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
