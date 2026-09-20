import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useProcurementOverview } from '@/api/commercial-hooks'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, KPI, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { day, humanise, money } from '@/utilities/format'

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * What is due in, and when.
 *
 * Built from the orders the procurement overview already returns: anything
 * still expected, soonest first, with today and this week called out. The
 * dates are the server's `promisedDate` and `requiredBy`; nothing is guessed.
 */
export default function DeliveriesScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const overview = useProcurementOverview(projectId)

  const { due, today, week } = useMemo(() => {
    const orders = overview.data?.orders ?? []
    const outstanding = orders.filter((o) => !/closed|cancelled|received/i.test(o.warehouseStatus) && !/closed|cancelled/i.test(o.status))
    const withDate = outstanding.filter((o) => o.promisedDate || o.requiredBy)
    const sorted = withDate.slice().sort((a, b) => String(a.promisedDate ?? a.requiredBy).localeCompare(String(b.promisedDate ?? b.requiredBy)))
    const t = localDay(new Date())
    const in7 = localDay(new Date(Date.now() + 7 * 86_400_000))
    const keyOf = (o: (typeof orders)[number]) => String(o.promisedDate ?? o.requiredBy).slice(0, 10)
    return {
      due: sorted,
      today: sorted.filter((o) => keyOf(o) === t).length,
      week: sorted.filter((o) => keyOf(o) >= t && keyOf(o) <= in7).length,
    }
  }, [overview.data])

  if (!projectId) {
    return (
      <Screen title="Deliveries" testID="screen-deliveries">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="Deliveries are listed per project." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen title="Deliveries" subtitle={project?.name} contentStyle={styles.content} testID="screen-deliveries">
      <ProjectSwitch project={project} />
      <View style={styles.kpis}>
        <KPI label="Due today" value={overview.data ? String(today) : '—'} tone={today > 0 ? 'warning' : 'default'} />
        <KPI label="Next 7 days" value={overview.data ? String(week) : '—'} />
        <KPI label="Outstanding" value={overview.data ? String(due.length) : '—'} />
      </View>

      {overview.isPending ? (
        <SkeletonList rows={5} />
      ) : overview.isError ? (
        <ErrorState message={userMessage(overview.error)} onRetry={() => void overview.refetch()} />
      ) : due.length === 0 ? (
        <EmptyState title="Nothing is expected" body="Orders appear here once they carry a promised or required date and have not been fully received." />
      ) : (
        <View style={styles.group}>
          <Text variant="label" label tone="muted">
            Expected
          </Text>
          {due.slice(0, 25).map((o) => (
            <RecordRow
              key={o.id}
              reference={o.ref}
              title={o.item ?? o.supplier ?? 'Order'}
              status={o.warehouseStatus || o.status}
              meta={[o.supplier, o.promisedDate ? `promised ${day(o.promisedDate)}` : o.requiredBy ? `required ${day(o.requiredBy)}` : null, o.value != null ? money(o.value, o.currency ?? undefined) : null, humanise(o.status)].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push(`/procurement/orders/${o.id}` as never)}
              testID={`delivery-${o.id}`}
            />
          ))}
        </View>
      )}
      <Freshness updatedAt={overview.dataUpdatedAt || undefined} isFetching={overview.isFetching} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  group: { gap: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
