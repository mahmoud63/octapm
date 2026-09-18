import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useForms } from '@/api/quality-hooks'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, RecordRow, SkeletonList, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { dueState, humanise } from '@/utilities/format'
import { PanePlaceholder, useSplitRole } from '@/navigation/split'

const STATUSES = ['scheduled', 'in_progress', 'complete', 'closed'] as const
const TYPES = ['inspection', 'itp', 'form', 'talk'] as const

/** Inspections, ITPs, forms and toolbox talks: mine and overdue first, then by status and type. */
export default function InspectionsScreen() {
  const router = useRouter()
  const splitRole = useSplitRole()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const [mode, setMode] = useState<'all' | 'mine' | 'overdue'>('all')
  const [status, setStatus] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const filters = useMemo(() => ({ ballInCourt: mode === 'mine', overdue: mode === 'overdue', status: status ?? undefined, type: type ?? undefined, search: search || undefined }), [mode, status, type, search])
  const forms = useForms(projectId, filters)
  const rows = forms.data?.items ?? []
  const summary = forms.data?.summary

  // On a tablet this list is already on the left; the stack's copy stands in for the record.
  if (splitRole === 'pane') return <PanePlaceholder />

  if (!projectId) {
    return (
      <Screen testID="screen-inspections">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-inspections">
      <FlatList
        data={rows}
        keyExtractor={(f) => f.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {permissions.allows('inspection', 'create') ? <Button title="New inspection" onPress={() => router.push('/quality/inspections/new')} testID="inspection-new" /> : null}
            <Input label="Find" placeholder="Reference or title" value={term} onChangeText={setTerm} onSubmitEditing={() => setSearch(term.trim())} onBlur={() => setSearch(term.trim())} returnKeyType="search" autoCapitalize="none" testID="inspections-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={mode === 'all'} onPress={() => setMode('all')} testID="inspections-chip-all" />
              <FilterChip label="Mine" selected={mode === 'mine'} onPress={() => setMode('mine')} testID="inspections-chip-mine" />
              <FilterChip label="Overdue" count={summary?.overdue} selected={mode === 'overdue'} onPress={() => setMode('overdue')} testID="inspections-chip-overdue" />
              {STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} count={summary?.byStatus?.[s]} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`inspections-chip-${s}`} />
              ))}
              {TYPES.map((t) => (
                <FilterChip key={t} label={t === 'itp' ? 'ITP' : t === 'talk' ? 'Toolbox talk' : humanise(t)} count={summary?.byType?.[t]} selected={type === t} onPress={() => setType(type === t ? null : t)} testID={`inspections-type-${t}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={forms.dataUpdatedAt || undefined} isFetching={forms.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const due = item.dueDate ?? item.scheduledFor
          const state = due && item.status !== 'closed' && item.status !== 'complete' ? dueState(due) : null
          return (
            <RecordRow
              reference={item.ref}
              title={item.title}
              status={item.outcome === 'fail' ? 'failed' : item.status}
              meta={[item.typeLabel ?? humanise(item.type), item.activity?.name, item.location?.name, item.assigneeUser?.name].filter(Boolean).join(' · ')}
              trailing={item.outcome ? humanise(item.outcome) : state?.label}
              trailingTone={item.outcome === 'fail' ? 'error' : item.outcome === 'pass' ? 'default' : (state?.tone ?? 'muted')}
              onPress={() => router.push(`/quality/inspections/${item.id}`)}
              testID={`inspection-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          forms.isPending ? (
            <SkeletonList rows={4} />
          ) : forms.isError ? (
            <ErrorState message={userMessage(forms.error)} onRetry={() => void forms.refetch()} />
          ) : (
            <EmptyState title={mode === 'mine' ? 'Nothing is in your court' : 'No inspections match'} body={mode === 'all' && !status && !type && !search && permissions.allows('inspection', 'create') ? 'Start one from a template with the button above.' : undefined} />
          )
        }
        onRefresh={() => void forms.refetch()}
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
