import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useRfis } from '@/api/record-hooks'
import { RFI_STATUSES } from '@/api/record-types'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjects } from '@/api/hooks'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { dueState, humanise } from '@/utilities/format'

type Mode = 'all' | 'mine' | 'overdue'

/**
 * Every RFI on the project the person may read, newest change first, with
 * the filters a field person reaches for: mine (ball in court), overdue,
 * and by status. Drafts are only visible to their creator and manager, as
 * the server decides.
 */
export default function RfiListScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const [mode, setMode] = useState<Mode>('all')
  const [status, setStatus] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')

  const filters = useMemo(() => ({ ballInCourt: mode === 'mine', overdue: mode === 'overdue', status: status ?? undefined, search: search || undefined }), [mode, status, search])
  const rfis = useRfis(projectId, filters)
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const rows = rfis.data?.rows ?? []
  const summary = rfis.data?.summary

  if (!projectId) {
    return (
      <Screen testID="screen-rfis">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="RFIs belong to one project at a time." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-rfis">
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <ProjectSwitch project={project} />
            {permissions.allows('rfi', 'create') ? <Button title="New RFI" onPress={() => router.push('/rfi/new')} testID="rfi-new" /> : null}
            <Input label="Find" placeholder="Reference, subject or question" value={term} onChangeText={setTerm} onSubmitEditing={() => setSearch(term.trim())} onBlur={() => setSearch(term.trim())} returnKeyType="search" autoCapitalize="none" testID="rfi-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All" selected={mode === 'all'} onPress={() => setMode('all')} testID="rfi-chip-all" />
              <FilterChip label="Ball in my court" selected={mode === 'mine'} onPress={() => setMode('mine')} testID="rfi-chip-mine" />
              <FilterChip label="Overdue" selected={mode === 'overdue'} onPress={() => setMode('overdue')} testID="rfi-chip-overdue" />
              {RFI_STATUSES.map((s) => (
                <FilterChip key={s} label={humanise(s)} count={summary ? summary[s] : undefined} selected={status === s} onPress={() => setStatus(status === s ? null : s)} testID={`rfi-chip-${s}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={rfis.dataUpdatedAt || undefined} isFetching={rfis.isFetching} />
          </View>
        }
        renderItem={({ item }) => {
          const due = item.responseRequiredBy ?? item.dueDate
          const state = due && item.status !== 'closed' ? dueState(due) : null
          return (
            <RecordRow
              reference={item.ref}
              title={item.subject}
              status={item.status}
              meta={[humanise(item.discipline), item.priority !== 'normal' ? `${humanise(item.priority)} priority` : null].filter(Boolean).join(' · ') || undefined}
              trailing={state?.label}
              trailingTone={state?.tone ?? 'muted'}
              onPress={() => router.push(`/rfi/${item.id}`)}
              testID={`rfi-row-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          rfis.isPending ? (
            <SkeletonList rows={4} />
          ) : rfis.isError ? (
            <ErrorState message={userMessage(rfis.error)} onRetry={() => void rfis.refetch()} />
          ) : (
            <EmptyState title={mode === 'mine' ? 'Nothing is in your court' : search || status ? 'No RFI matches' : 'No RFIs yet'} body={mode === 'all' && !search && !status && permissions.allows('rfi', 'create') ? 'Raise the first one from the button above.' : undefined} />
          )
        }
        ListFooterComponent={
          rfis.data?.pagination.nextCursor ? (
            <Text variant="caption" tone="muted" style={styles.footer}>
              Showing the latest {rows.length}. Narrow the list to find older RFIs.
            </Text>
          ) : null
        }
        onRefresh={() => void rfis.refetch()}
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
  footer: { paddingTop: spacing.md },
})
