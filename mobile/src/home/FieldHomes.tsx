import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useAssignments } from '@/api/hooks'
import { useNcrs, usePunchList, useQualityDashboard } from '@/api/quality-hooks'
import { useInventorySummary } from '@/api/inventory-hooks'
import { useProcurementOverview } from '@/api/commercial-hooks'
import { useActivitiesFull, useConstraints, useDailyLog, usePhotos } from '@/api/site-hooks'
import type { AssignmentItem } from '@/api/types'
import { AssignmentRow } from '@/components/AssignmentRow'
import { Freshness } from '@/components/Freshness'
import { EmptyState, ErrorState, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { Counts, PhotoStrip, QuickActions, Section } from '@/home/sections'
import { destinationForTarget, openOnWeb } from '@/navigation/links'
import type { CaptureAction } from '@/navigation/roleNav'
import { day, humanise } from '@/utilities/format'

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

interface HomeProps {
  projectId: string
  currency?: string
  actions: CaptureAction[]
}

function useOpenAssignment() {
  const router = useRouter()
  return (item: AssignmentItem) => {
    const destination = destinationForTarget(item.target)
    if ('app' in destination) router.push(destination.app as never)
    else void openOnWeb(destination.web)
  }
}

/**
 * The site engineer's day: what am I building, where, what is blocking it,
 * and what must I record.
 *
 * Today's work is the activity register filtered to what is live now — the
 * server's own dates and status, not a guess about what someone meant to do.
 */
export function SiteEngineerHome({ projectId, actions }: HomeProps) {
  const router = useRouter()
  const activities = useActivitiesFull(projectId)
  const assignments = useAssignments(projectId)
  const constraints = useConstraints(projectId)
  const log = useDailyLog(projectId, localDay())
  const photos = usePhotos(projectId)
  const open = useOpenAssignment()

  const today = localDay()
  const live = useMemo(() => {
    const rows = activities.data ?? []
    const current = rows.filter((a) => a.status === 'in_progress' || a.status === 'delayed')
    const startingToday = rows.filter((a) => a.startDate?.slice(0, 10) === today || a.endDate?.slice(0, 10) === today)
    return Array.from(new Map([...current, ...startingToday].map((a) => [a.id, a])).values()).slice(0, 10)
  }, [activities.data, today])
  const mine = useMemo(() => (assignments.data?.items ?? []).slice(0, 4), [assignments.data])
  const blocking = useMemo(() => (constraints.data?.items ?? []).slice(0, 5), [constraints.data])

  return (
    <>
      <Section title="Today's work" action={{ title: 'All activities', onPress: () => router.push('/activities') }} testID="site-today">
        {activities.isPending ? (
          <SkeletonList rows={4} />
        ) : activities.isError ? (
          <ErrorState message={userMessage(activities.error)} onRetry={() => void activities.refetch()} />
        ) : live.length === 0 ? (
          <EmptyState title="Nothing is in progress" body="Activities appear here once they start or are due to finish today." />
        ) : (
          live.map((a) => (
            <RecordRow
              key={a.id}
              reference={a.activityCode ?? a.wbsCode ?? 'Activity'}
              title={a.name}
              status={a.status}
              meta={[a.pctComplete != null ? `${Math.round(a.pctComplete)}%` : null, a.isCritical ? 'Critical path' : null, a.endDate ? `due ${day(a.endDate)}` : null].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push(`/activities/${a.id}` as never)}
              testID={`site-activity-${a.id}`}
            />
          ))
        )}
        <Freshness updatedAt={activities.dataUpdatedAt || undefined} isFetching={activities.isFetching} />
      </Section>

      <Section title="Blocking your work" action={{ title: 'Lookahead', onPress: () => router.push('/lookahead') }} testID="site-constraints">
        {constraints.isPending ? (
          <SkeletonList rows={2} />
        ) : constraints.isError ? (
          <ErrorState message={userMessage(constraints.error)} onRetry={() => void constraints.refetch()} />
        ) : blocking.length === 0 ? (
          <Text tone="muted">Nothing is recorded as blocking planned work.</Text>
        ) : (
          <>
            <Counts
              items={[
                { id: 'open', label: 'Open constraints', value: String(constraints.data?.summary.open ?? '—'), tone: (constraints.data?.summary.open ?? 0) > 0 ? 'warning' : 'default' },
                { id: 'overdue', label: 'Overdue', value: String(constraints.data?.summary.overdue ?? '—'), tone: (constraints.data?.summary.overdue ?? 0) > 0 ? 'error' : 'default' },
                { id: 'week', label: 'Due this week', value: String(constraints.data?.summary.dueThisWeek ?? '—') },
              ]}
            />
            {blocking.map((c) => (
              <RecordRow key={c.id} reference={c.wbsCode ?? 'Constraint'} title={c.constraint ?? c.name} status={c.constraintStatus} meta={[c.name, c.plannedStart ? `planned ${day(c.plannedStart)}` : null].filter(Boolean).join(' · ') || undefined} testID={`site-constraint-${c.id}`} />
            ))}
          </>
        )}
      </Section>

      <Section title="Assigned to you" action={{ title: 'See all', onPress: () => router.push('/needs-you') }} testID="site-mine">
        {assignments.isPending ? <SkeletonList rows={3} /> : mine.length === 0 ? <Text tone="muted">Nothing is waiting on you.</Text> : mine.map((item) => <AssignmentRow key={`${item.recordType}:${item.recordId}`} item={item} onPress={() => open(item)} />)}
      </Section>

      <Section title="Today's report" action={{ title: 'Open', onPress: () => router.push('/site') }} testID="site-report">
        <Counts
          items={[
            { id: 'workers', label: 'Workers', value: String(log.data?.totals?.workers ?? '—') },
            { id: 'entries', label: 'Entries', value: String(log.data?.totals?.entries ?? '—') },
            { id: 'lost', label: 'Hours lost', value: String(log.data?.totals?.hoursLost ?? '—'), tone: (log.data?.totals?.hoursLost ?? 0) > 0 ? 'warning' : 'default' },
          ]}
        />
      </Section>

      <Section title="Recent photographs" action={{ title: 'All photos', onPress: () => router.push('/photos') }} testID="site-photos">
        <PhotoStrip projectId={projectId} photos={(photos.data?.items ?? []).slice(0, 12)} onOpen={(p) => router.push(`/photos/${p.id}` as never)} />
      </Section>

      <Section title="Record something" testID="site-quick-actions">
        <QuickActions actions={actions} />
      </Section>
    </>
  )
}

/**
 * The quality engineer's day: what must be verified, what failed, and what is
 * waiting on their approval — the one thing a site engineer never sees.
 */
export function QualityHome({ projectId, actions }: HomeProps) {
  const router = useRouter()
  const dashboard = useQualityDashboard(projectId)
  const ncrs = useNcrs(projectId)
  const punch = usePunchList(projectId, {})
  const assignments = useAssignments(projectId)
  const photos = usePhotos(projectId)
  const open = useOpenAssignment()

  const awaitingMe = useMemo(() => (assignments.data?.items ?? []).filter((i) => /ncr|punch|inspection|form|safety|test/i.test(i.recordType)).slice(0, 5), [assignments.data])

  return (
    <>
      <Section title="Quality position" action={{ title: 'Quality', onPress: () => router.push('/quality') }} testID="quality-position">
        {dashboard.isPending ? (
          <SkeletonList rows={2} />
        ) : dashboard.isError ? (
          <ErrorState message={userMessage(dashboard.error)} onRetry={() => void dashboard.refetch()} />
        ) : (
          <Counts
            items={[
              { id: 'ncr-open', label: 'Open NCRs', value: String(ncrs.data?.summary.open ?? '—'), tone: (ncrs.data?.summary.open ?? 0) > 0 ? 'error' : 'default', onPress: () => router.push('/quality/ncr') },
              { id: 'ncr-major', label: 'Major', value: String(ncrs.data?.summary.major ?? '—'), tone: (ncrs.data?.summary.major ?? 0) > 0 ? 'error' : 'default' },
              { id: 'punch-open', label: 'Open punch', value: String(punch.data?.summary.open ?? '—'), tone: (punch.data?.summary.open ?? 0) > 0 ? 'warning' : 'default', onPress: () => router.push('/quality/punch') },
              { id: 'punch-overdue', label: 'Punch overdue', value: String(punch.data?.summary.overdue ?? '—'), tone: (punch.data?.summary.overdue ?? 0) > 0 ? 'error' : 'default' },
            ]}
          />
        )}
      </Section>

      <Section title="Waiting on you" action={{ title: 'See all', onPress: () => router.push('/needs-you') }} testID="quality-mine">
        {assignments.isPending ? (
          <SkeletonList rows={3} />
        ) : awaitingMe.length === 0 ? (
          <Text tone="muted">No quality record is waiting on you.</Text>
        ) : (
          awaitingMe.map((item) => <AssignmentRow key={`${item.recordType}:${item.recordId}`} item={item} onPress={() => open(item)} />)
        )}
      </Section>

      <Section title="By trade" testID="quality-by-trade">
        {punch.data ? (
          <Text tone="muted">
            {Object.entries(punch.data.summary.byTrade)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([trade, count]) => `${humanise(trade)} ${count}`)
              .join(' · ') || 'No punch items yet.'}
          </Text>
        ) : (
          <SkeletonList rows={1} />
        )}
      </Section>

      <Section title="Recent evidence" action={{ title: 'All photos', onPress: () => router.push('/photos') }} testID="quality-photos">
        <PhotoStrip projectId={projectId} photos={(photos.data?.items ?? []).slice(0, 12)} onOpen={(p) => router.push(`/photos/${p.id}` as never)} />
      </Section>

      <Section title="Record something" testID="quality-quick-actions">
        <QuickActions actions={actions} />
      </Section>
    </>
  )
}

/**
 * The storekeeper's day: what is arriving, what is waiting to be received,
 * and what is running out. No progress and no money — this role cannot read
 * either, and showing them would be showing what the server refuses.
 */
export function WarehouseHome({ projectId, actions }: HomeProps) {
  const router = useRouter()
  const summary = useInventorySummary(projectId)
  const overview = useProcurementOverview(projectId)

  const expected = useMemo(() => {
    const orders = overview.data?.orders ?? []
    return orders
      .filter((o) => !/closed|cancelled|received/i.test(o.warehouseStatus) && !/closed|cancelled/i.test(o.status))
      .sort((a, b) => String(a.promisedDate ?? a.requiredBy ?? '').localeCompare(String(b.promisedDate ?? b.requiredBy ?? '')))
      .slice(0, 8)
  }, [overview.data])

  return (
    <>
      <Section title="The store" action={{ title: 'Stock', onPress: () => router.push('/inventory') }} testID="warehouse-store">
        {summary.isPending ? (
          <SkeletonList rows={2} />
        ) : summary.isError ? (
          <ErrorState message={userMessage(summary.error)} onRetry={() => void summary.refetch()} />
        ) : (
          <Counts
            items={[
              { id: 'items', label: 'Items', value: String(summary.data?.itemCount ?? '—'), onPress: () => router.push('/inventory/items') },
              { id: 'low', label: 'Below minimum', value: String(summary.data?.lowStock ?? '—'), tone: (summary.data?.lowStock ?? 0) > 0 ? 'warning' : 'default' },
              { id: 'out', label: 'Out of stock', value: String(summary.data?.outOfStock ?? '—'), tone: (summary.data?.outOfStock ?? 0) > 0 ? 'error' : 'default' },
              { id: 'expected', label: 'Orders to receive', value: overview.data ? String(expected.length) : '—', onPress: () => router.push('/receive') },
              { id: 'damaged', label: 'Damaged', value: String(summary.data?.damaged ?? '—'), tone: (summary.data?.damaged ?? 0) > 0 ? 'warning' : 'default' },
              { id: 'quarantined', label: 'Quarantined', value: String(summary.data?.quarantined ?? '—'), tone: (summary.data?.quarantined ?? 0) > 0 ? 'warning' : 'default' },
            ]}
          />
        )}
      </Section>

      <Section title="Expected in" action={{ title: 'Deliveries', onPress: () => router.push('/receive') }} testID="warehouse-expected">
        {overview.isPending ? (
          <SkeletonList rows={3} />
        ) : expected.length === 0 ? (
          <Text tone="muted">Nothing is outstanding.</Text>
        ) : (
          expected.map((o) => (
            <RecordRow
              key={o.id}
              reference={o.ref}
              title={o.item ?? o.supplier ?? 'Order'}
              status={o.warehouseStatus || o.status}
              meta={[o.supplier, o.promisedDate ? `promised ${day(o.promisedDate)}` : o.requiredBy ? `required ${day(o.requiredBy)}` : null].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push(`/procurement/orders/${o.id}` as never)}
              testID={`warehouse-order-${o.id}`}
            />
          ))
        )}
      </Section>

      <Section title="Record something" testID="warehouse-quick-actions">
        <QuickActions actions={actions} />
      </Section>
    </>
  )
}

export const styles = StyleSheet.create({ stack: { gap: spacing.sm }, row: { flexDirection: 'row', gap: spacing.sm } })
export { View }
