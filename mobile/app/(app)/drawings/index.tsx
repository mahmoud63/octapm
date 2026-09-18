import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useOfflineManifest, useSheets } from '@/api/record-hooks'
import type { DrawingSheet } from '@/api/record-types'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Input, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useDrawingPrefs } from '@/drawings/preferences'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

type View_ = 'all' | 'favourites' | 'recent'

/**
 * The sheet register: current sheets by discipline, with search, favourites
 * and the sheets viewed recently on this device. An obsolete sheet is
 * marked as such in the list, before anyone opens it.
 */
export default function DrawingsScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const prefs = useDrawingPrefs()
  const [view, setView] = useState<View_>('all')
  const [discipline, setDiscipline] = useState<string | null>(null)
  const [status, setStatus] = useState<'current' | 'all'>('current')
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const sheets = useSheets(projectId, { search: search || undefined, discipline: discipline ?? undefined, status })
  const manifest = useOfflineManifest(projectId)
  const project = projects.data?.find((p) => p.id === projectId) ?? null

  useEffect(() => {
    if (!prefs.hydrated) void prefs.hydrate()
  }, [prefs])

  const rows = useMemo(() => {
    const items = sheets.data?.items ?? []
    if (view === 'favourites') return items.filter((s) => prefs.favourites.includes(s.id))
    if (view === 'recent') return prefs.recents.map((id) => items.find((s) => s.id === id)).filter((s): s is DrawingSheet => !!s)
    return items
  }, [sheets.data, view, prefs.favourites, prefs.recents])

  if (!projectId) {
    return (
      <Screen testID="screen-drawings">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const disciplines = sheets.data?.summary.disciplines ?? []

  return (
    <Screen scroll={false} testID="screen-drawings">
      <FlatList
        data={rows}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <ProjectSwitch project={project} />
            <Input label="Find a sheet" placeholder="Number or title" value={term} onChangeText={setTerm} onSubmitEditing={() => setSearch(term.trim())} onBlur={() => setSearch(term.trim())} returnKeyType="search" autoCapitalize="characters" testID="drawings-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={view === 'all'} onPress={() => setView('all')} testID="drawings-chip-all" />
              <FilterChip label="Favourites" count={prefs.favourites.length} selected={view === 'favourites'} onPress={() => setView('favourites')} testID="drawings-chip-favourites" />
              <FilterChip label="Recent" selected={view === 'recent'} onPress={() => setView('recent')} testID="drawings-chip-recent" />
              <FilterChip label="Include obsolete" selected={status === 'all'} onPress={() => setStatus(status === 'all' ? 'current' : 'all')} testID="drawings-chip-obsolete" />
              {disciplines.map((d) => (
                <FilterChip key={d} label={humanise(d)} selected={discipline === d} onPress={() => setDiscipline(discipline === d ? null : d)} testID={`drawings-chip-${d}`} />
              ))}
            </ScrollView>
            <View style={styles.row}>
              <Freshness updatedAt={sheets.dataUpdatedAt || undefined} isFetching={sheets.isFetching} />
              {manifest.data ? (
                <Text variant="caption" tone="muted">
                  {manifest.data.totals.sheets} sheet{manifest.data.totals.sheets === 1 ? '' : 's'} published
                </Text>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <RecordRow
            reference={item.number}
            title={item.title ?? item.number}
            status={item.status === 'obsolete' ? 'superseded' : item.currentRevision?.status ?? null}
            meta={[humanise(item.discipline), item.currentRevision ? `Rev ${item.currentRevision.revision}` : 'No published revision', prefs.favourites.includes(item.id) ? '★ Favourite' : null].filter(Boolean).join(' · ')}
            trailing={item.status === 'obsolete' ? 'Obsolete' : undefined}
            trailingTone="error"
            onPress={() => router.push(`/drawings/${item.id}`)}
            testID={`sheet-row-${item.id}`}
          />
        )}
        ListEmptyComponent={
          sheets.isPending ? (
            <SkeletonList rows={4} />
          ) : sheets.isError ? (
            <ErrorState message={userMessage(sheets.error)} onRetry={() => void sheets.refetch()} />
          ) : view === 'favourites' ? (
            <EmptyState title="No favourites yet" body="Star a sheet from its page and it appears here." />
          ) : view === 'recent' ? (
            <EmptyState title="Nothing viewed yet" />
          ) : (
            <EmptyState title={search || discipline ? 'No sheet matches' : 'No published sheets yet'} body={search || discipline ? undefined : 'Sheets appear here once a drawing set is published on the web platform.'} />
          )
        }
        onRefresh={() => void Promise.all([sheets.refetch(), manifest.refetch()])}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
