import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { userMessage } from '@/api/errors'
import { useAssignments, useForecast, useHealth } from '@/api/hooks'
import type { AssignmentItem } from '@/api/types'
import { AssignmentRow } from '@/components/AssignmentRow'
import { Freshness } from '@/components/Freshness'
import { HealthDimensions } from '@/components/HealthDimensions'
import { EmptyState, ErrorState, SkeletonList, Text } from '@/design-system'
import { Counts, QuickActions, Section } from '@/home/sections'
import { destinationForTarget, openOnWeb } from '@/navigation/links'
import type { CaptureAction } from '@/navigation/roleNav'
import { money } from '@/utilities/format'

const ratio = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2))

/**
 * The home for the commercial and planning roles, and for any role the app
 * has not been taught yet: what needs deciding, then where the project
 * stands.
 *
 * `emphasis` shifts what leads — money for the commercial roles, the
 * programme for planning — without changing where a single figure comes
 * from. Different presentations of the same canonical records, never
 * different data.
 */
export function GeneralHome({ projectId, currency, actions, emphasis }: { projectId: string; currency?: string; actions: CaptureAction[]; emphasis: 'commercial' | 'schedule' | 'general' }) {
  const router = useRouter()
  const assignments = useAssignments(projectId)
  const health = useHealth(projectId)
  const forecast = useForecast(projectId)

  const items = useMemo(() => assignments.data?.items ?? [], [assignments.data])
  const summary = assignments.data?.summary
  const schedule = forecast.data?.schedule ?? null
  const cost = forecast.data?.cost ?? null

  const open = (item: AssignmentItem) => {
    const destination = destinationForTarget(item.target)
    if ('app' in destination) router.push(destination.app as never)
    else void openOnWeb(destination.web)
  }

  const money_ = (
    <Counts
      items={[
        { id: 'budget', label: 'Budget', value: money(cost?.budget ?? null, currency) },
        { id: 'eac', label: 'Forecast at completion', value: money(cost?.eac ?? null, currency), tone: (cost?.overrun ?? 0) > 0 ? 'error' : 'default' },
        { id: 'actual', label: 'Actual to date', value: money(cost?.actual ?? null, currency) },
        { id: 'overrun', label: 'Overrun', value: cost?.overrunPct != null ? `${cost.overrunPct}%` : '—', tone: (cost?.overrunPct ?? 0) > 0 ? 'error' : 'default' },
      ]}
    />
  )

  const programme = (
    <Counts
      items={[
        { id: 'spi', label: 'SPI', value: ratio(schedule?.spi), tone: schedule?.spi != null && schedule.spi < 0.9 ? 'error' : 'default' },
        { id: 'slip', label: 'Slip', value: schedule?.slipDays != null ? `${schedule.slipDays} d` : '—', tone: (schedule?.slipDays ?? 0) > 0 ? 'error' : 'default' },
        { id: 'critical', label: 'On the critical path', value: String(schedule?.counts.critical ?? '—'), onPress: () => router.push('/activities') },
        { id: 'at-risk', label: 'At high risk', value: String(schedule?.counts.atRisk.high ?? '—'), tone: (schedule?.counts.atRisk.high ?? 0) > 0 ? 'error' : 'default' },
      ]}
    />
  )

  return (
    <>
      <Section title="Needs your attention" action={{ title: 'See all', onPress: () => router.push('/needs-you'), testID: 'home-needs-you-all' }} testID="general-needs-you">
        <Counts
          items={[
            { id: 'overdue', label: 'Overdue', value: String(summary?.overdue ?? '—'), tone: (summary?.overdue ?? 0) > 0 ? 'error' : 'default', onPress: () => router.push('/needs-you') },
            { id: 'ball', label: 'Ball in court', value: String(summary?.ballInCourt ?? '—'), tone: (summary?.ballInCourt ?? 0) > 0 ? 'warning' : 'default', onPress: () => router.push('/needs-you') },
            { id: 'total', label: 'Open items', value: String(summary?.total ?? '—'), onPress: () => router.push('/needs-you') },
          ]}
        />
        {assignments.isPending ? (
          <SkeletonList rows={3} />
        ) : assignments.isError ? (
          <ErrorState message={userMessage(assignments.error)} onRetry={() => void assignments.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="Nothing is waiting on you" body="When a record needs your answer or approval it appears here first." />
        ) : (
          items.slice(0, 4).map((item) => <AssignmentRow key={`${item.recordType}:${item.recordId}`} item={item} onPress={() => open(item)} />)
        )}
        <Freshness updatedAt={assignments.dataUpdatedAt || undefined} isFetching={assignments.isFetching} />
      </Section>

      {forecast.data?.available ? (
        <Section title={emphasis === 'commercial' ? 'The commercial position' : 'The programme'} action={{ title: 'Project', onPress: () => router.push('/project') }} testID="general-position">
          {emphasis === 'commercial' ? money_ : programme}
          {emphasis === 'commercial' ? programme : money_}
        </Section>
      ) : null}

      <Section title="Project health" action={{ title: 'Project', onPress: () => router.push('/project') }} testID="general-health">
        {health.isPending ? (
          <SkeletonList rows={2} />
        ) : health.isError ? (
          <ErrorState message={userMessage(health.error)} onRetry={() => void health.refetch()} />
        ) : (
          <HealthDimensions dimensions={health.data.dimensions} />
        )}
      </Section>

      {actions.length > 0 ? (
        <Section title="Record something" testID="general-quick-actions">
          <QuickActions actions={actions} />
        </Section>
      ) : (
        <Text tone="muted">You have no recording rights on this project; everything here is read-only for your role.</Text>
      )}
    </>
  )
}
