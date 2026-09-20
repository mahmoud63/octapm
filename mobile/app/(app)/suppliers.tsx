import { useRouter } from 'expo-router'
import { Linking, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProcurementOverview } from '@/api/commercial-hooks'
import { useProjects } from '@/api/hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, Card, EmptyState, ErrorState, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

/**
 * The suppliers on this project, with the contact details a person needs on
 * site and the lead-time reliability the platform already tracks.
 *
 * All of it arrives with the procurement overview the app already fetches —
 * the register simply never showed it.
 */
export default function SuppliersScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const overview = useProcurementOverview(projectId)

  if (!projectId) {
    return (
      <Screen title="Suppliers" testID="screen-suppliers">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="Suppliers are listed per project." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const suppliers = overview.data?.suppliers ?? []

  return (
    <Screen title="Suppliers" subtitle={project?.name} contentStyle={styles.content} testID="screen-suppliers">
      <ProjectSwitch project={project} />
      {overview.isPending ? (
        <SkeletonList rows={5} />
      ) : overview.isError ? (
        <ErrorState message={userMessage(overview.error)} onRetry={() => void overview.refetch()} />
      ) : suppliers.length === 0 ? (
        <EmptyState title="No suppliers on this project yet" body="Suppliers appear here once a purchase order or package names them." />
      ) : (
        suppliers.map((s) => (
          <Card key={s.id} testID={`supplier-${s.id}`}>
            <View style={styles.stack}>
              <Text variant="heading">{s.name}</Text>
              <Text variant="caption" tone="muted">
                {[s.code, humanise(s.status), s.tradeCategories.slice(0, 3).map(humanise).join(', ')].filter(Boolean).join(' · ')}
              </Text>
              {s.leadTimeReliability != null ? (
                <Text variant="caption" tone={s.leadTimeReliability < 0.8 ? 'warning' : 'muted'}>
                  Lead-time reliability {Math.round(s.leadTimeReliability * 100)}%
                </Text>
              ) : null}
              {s.contactName ? <Text>{s.contactName}</Text> : null}
              <View style={styles.row}>
                {s.phone ? <Button title="Call" variant="secondary" onPress={() => void Linking.openURL(`tel:${s.phone}`)} testID={`supplier-call-${s.id}`} /> : null}
                {s.email ? <Button title="Email" variant="secondary" onPress={() => void Linking.openURL(`mailto:${s.email}`)} testID={`supplier-email-${s.id}`} /> : null}
              </View>
            </View>
          </Card>
        ))
      )}
      <Freshness updatedAt={overview.dataUpdatedAt || undefined} isFetching={overview.isFetching} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.xs },
})
