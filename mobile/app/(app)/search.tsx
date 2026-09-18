import { useEffect, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects, useSearch } from '@/api/hooks'
import { FilterChip } from '@/components/FilterChip'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Input, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { openOnWeb, webPathForSearchItem } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { day } from '@/utilities/format'

/**
 * One search box across every record the person may read: RFIs, submittals,
 * drawings, punch items, tasks and the rest. Scoped to the current project
 * by default, widened to every project with one tap.
 */
export default function SearchScreen() {
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  // The person's explicit choice wins; until they make one, the scope follows
  // the project, which may arrive a moment after first render on a cold start.
  const [scopeChoice, setScope] = useState<'project' | 'all' | null>(null)
  const scope = scopeChoice ?? (projectId ? 'project' : 'all')
  const [type, setType] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300)
    return () => clearTimeout(timer)
  }, [term])

  const results = useSearch(debounced, { types: type ? [type] : undefined, projectId: scope === 'project' && projectId ? projectId : undefined })
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const items = results.data?.items ?? []

  return (
    <Screen title="Search" scroll={false} testID="screen-search">
      <FlatList
        data={items}
        keyExtractor={(item) => `${item.type}:${item.id}`}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Input label="Search" placeholder="RFI-012, excavation, grid A-D…" value={term} onChangeText={setTerm} autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="search" testID="search-input" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              {projectId ? <FilterChip label={project ? project.name : 'This project'} selected={scope === 'project'} onPress={() => setScope('project')} testID="chip-scope-project" /> : null}
              <FilterChip label="All projects" selected={scope === 'all'} onPress={() => setScope('all')} testID="chip-scope-all" />
              {(results.data?.groups ?? []).map((group) => (
                <FilterChip key={group.type} label={group.label} count={group.count} selected={type === group.type} onPress={() => setType(type === group.type ? null : group.type)} testID={`chip-type-${group.type}`} />
              ))}
            </ScrollView>
            {results.data && debounced.trim().length >= 2 ? (
              <Text variant="caption" tone="muted" testID="search-count">
                {results.data.meta.total} result{results.data.meta.total === 1 ? '' : 's'} for “{results.data.query}”
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.identifier ?? item.typeLabel}
            title={item.title}
            status={item.status}
            meta={[item.typeLabel, scope === 'all' ? item.projectName : null, item.subtitle].filter(Boolean).join(' · ')}
            trailing={item.date ? day(item.date) : undefined}
            onPress={() => void openOnWeb(webPathForSearchItem(item))}
          />
        )}
        ListEmptyComponent={
          debounced.trim().length < 2 ? (
            <EmptyState title="Search across the project" body="RFIs, submittals, drawings, punch items, inspections, tasks, purchase orders and more. Type at least two characters." />
          ) : results.isPending ? (
            <SkeletonList rows={4} />
          ) : results.isError ? (
            <ErrorState message={userMessage(results.error)} onRetry={() => void results.refetch()} />
          ) : (
            <EmptyState title="Nothing found" body={scope === 'project' ? 'Try “All projects”, a reference number, or a different word.' : 'Try a reference number or a different word.'} />
          )
        }
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, paddingBottom: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
