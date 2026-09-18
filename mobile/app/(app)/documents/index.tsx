import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useRegister } from '@/api/record-hooks'
import type { RegisterRow } from '@/api/record-types'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Input, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { openApiFile } from '@/files/open'
import { appRouteForRecord, openOnWeb, webPathForTarget } from '@/navigation/links'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

/**
 * The document register: every controlled document the person may read,
 * by folder, with its latest revision. Opening a row shows the record when
 * the app has a screen for it, otherwise the latest file, otherwise the web.
 */
export default function DocumentsScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const [folder, setFolder] = useState<string>('all')
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const register = useRegister(projectId, { folder: folder === 'all' ? undefined : folder, search: search || undefined })
  const project = projects.data?.find((p) => p.id === projectId) ?? null

  const rows = useMemo(() => register.data?.rows ?? [], [register.data])

  const open = async (row: RegisterRow) => {
    setFailure(null)
    const app = appRouteForRecord(row.recordType, row.recordId)
    if (app) {
      router.push(app as never)
      return
    }
    const revision = row.currentRevision ?? row.latestRevision
    if (revision && projectId) {
      try {
        await openApiFile(`/projects/${projectId}/doc-control/revisions/${revision.id}/download`, revision.fileName ?? `${row.ref ?? row.title}.pdf`)
        return
      } catch (error) {
        setFailure(userMessage(error))
        return
      }
    }
    if (projectId) await openOnWeb(webPathForTarget({ projectId, module: 'doc-control', recordType: row.recordType, recordId: row.recordId }))
  }

  if (!projectId) {
    return (
      <Screen testID="screen-documents">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen scroll={false} testID="screen-documents">
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <ProjectSwitch project={project} />
            <Input label="Find" placeholder="Number, title or reference" value={term} onChangeText={setTerm} onSubmitEditing={() => setSearch(term.trim())} onBlur={() => setSearch(term.trim())} returnKeyType="search" autoCapitalize="none" testID="documents-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              {(register.data?.folders ?? [{ key: 'all', label: 'All documents', recordTypes: [], count: 0 }]).map((f) => (
                <FilterChip key={f.key} label={f.label} count={f.count} selected={folder === f.key} onPress={() => setFolder(f.key)} testID={`documents-folder-${f.key}`} />
              ))}
            </ScrollView>
            <Freshness updatedAt={register.dataUpdatedAt || undefined} isFetching={register.isFetching} />
            {failure ? (
              <Text variant="caption" tone="error" accessibilityRole="alert">
                {failure}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const revision = item.currentRevision ?? item.latestRevision
          return (
            <RecordRow
              reference={item.ref ?? item.documentNumber ?? humanise(item.recordType)}
              title={item.title}
              status={item.status ?? revision?.status ?? null}
              meta={[humanise(item.recordType), item.category, revision ? `Rev ${revision.revision}` : 'No revision'].filter(Boolean).join(' · ')}
              trailing={revision && !item.currentRevision ? 'Not approved' : undefined}
              trailingTone="warning"
              onPress={() => void open(item)}
              testID={`document-row-${item.recordId}`}
            />
          )
        }}
        ListEmptyComponent={
          register.isPending ? (
            <SkeletonList rows={4} />
          ) : register.isError ? (
            <ErrorState message={userMessage(register.error)} onRetry={() => void register.refetch()} />
          ) : (
            <EmptyState title={search ? 'No document matches' : 'No documents yet'} />
          )
        }
        onRefresh={() => void register.refetch()}
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
