import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useAssignments, useForecast, useHealth } from '@/api/hooks'
import { useDailyLog, usePhotos } from '@/api/site-hooks'
import type { AssignmentItem } from '@/api/types'
import { AssignmentRow } from '@/components/AssignmentRow'
import { Freshness } from '@/components/Freshness'
import { HealthDimensions, healthTone } from '@/components/HealthDimensions'
import { Card, EmptyState, ErrorState, KPI, SkeletonList, Text, spacing } from '@/design-system'
import { Counts, PhotoStrip, Provenance, QuickActions, Section } from '@/home/sections'
import type { CaptureAction } from '@/navigation/roleNav'
import { destinationForTarget, openOnWeb } from '@/navigation/links'
import { day, money } from '@/utilities/format'
import { eacQualifier, forecastNotes } from '@/utilities/forecast'

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ratio = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2))

/**
 * The project manager's home: an exception report, not a module directory.
 *
 * It answers, in this order, what needs deciding, what is at risk, what the
 * site did today and where the project stands — and only then offers actions
 * and the way through to the modules. Every figure is the server's own; a
 * value the platform did not compute renders as an em-dash rather than a
 * guess, which is why SPI is often blank beside a real slip in days.
 */
export function PmHome({ projectId, currency, actions }: { projectId: string; currency?: string; actions: CaptureAction[] }) {
  const router = useRouter()
  const assignments = useAssignments(projectId)
  const health = useHealth(projectId)
  const forecast = useForecast(projectId)
  const log = useDailyLog(projectId, localDay())
  const photos = usePhotos(projectId)

  const items = useMemo(() => assignments.data?.items ?? [], [assignments.data])
  const summary = assignments.data?.summary
  const schedule = forecast.data?.schedule ?? null
  const cost = forecast.data?.cost ?? null
  const totals = log.data?.totals ?? null
  const recent = useMemo(() => (photos.data?.items ?? []).slice(0, 12), [photos.data])

  const open = (item: AssignmentItem) => {
    const destination = destinationForTarget(item.target)
    if ('app' in destination) router.push(destination.app as never)
    else void openOnWeb(destination.web)
  }

  return (
    <>
      {/* 1 — where the project stands */}
      <Section title="Project status" testID="pm-status">
        {health.isPending ? (
          <SkeletonList rows={2} />
        ) : health.isError ? (
          <ErrorState message={userMessage(health.error)} onRetry={() => void health.refetch()} />
        ) : (
          <Card>
            <View style={styles.stack}>
              <View style={styles.kpis}>
                <KPI
                  label="Health"
                  value={health.data.overallScore != null ? String(health.data.overallScore) : '—'}
                  qualifier="of 100"
                  tone={healthTone(health.data.overallScore) === 'muted' ? 'default' : (healthTone(health.data.overallScore) as 'default' | 'error' | 'success' | 'warning')}
                />
                <KPI label="Slip" value={schedule?.slipDays != null ? `${schedule.slipDays} d` : '—'} tone={(schedule?.slipDays ?? 0) > 0 ? 'error' : 'default'} />
                <KPI label="Overrun" value={cost?.overrunPct != null ? `${cost.overrunPct}%` : '—'} tone={(cost?.overrunPct ?? 0) > 0 ? 'error' : 'default'} />
              </View>
              <HealthDimensions dimensions={health.data.dimensions} />
            </View>
          </Card>
        )}
      </Section>

      {/* 2 — what needs deciding */}
      <Section title="Needs your attention" action={{ title: 'See all', onPress: () => router.push('/needs-you'), testID: 'home-needs-you-all' }} testID="pm-needs-you">
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

      {/* 3 — what is at risk */}
      <Section title="Risks and exceptions" testID="pm-risks">
        {forecast.isPending ? (
          <SkeletonList rows={2} />
        ) : forecast.isError ? (
          <ErrorState message={userMessage(forecast.error)} onRetry={() => void forecast.refetch()} />
        ) : !forecast.data?.available ? (
          <Text tone="muted">The forecast needs a baseline and progress before it can be calculated.</Text>
        ) : (
          <Card>
            <View style={styles.stack}>
              <Counts
                items={[
                  { id: 'critical', label: 'On the critical path', value: String(schedule?.counts.critical ?? '—'), tone: (schedule?.counts.critical ?? 0) > 0 ? 'warning' : 'default', onPress: () => router.push('/activities') },
                  { id: 'at-risk', label: 'Activities at high risk', value: String(schedule?.counts.atRisk.high ?? '—'), tone: (schedule?.counts.atRisk.high ?? 0) > 0 ? 'error' : 'default', onPress: () => router.push('/activities') },
                  { id: 'cost-risk', label: 'Cost lines at risk', value: String(cost?.counts?.atRisk.high ?? '—'), tone: (cost?.counts?.atRisk.high ?? 0) > 0 ? 'error' : 'default' },
                ]}
              />
              {schedule?.criticalDriver ? (
                <Text testID="pm-critical-driver">
                  Longest slip: <Text style={styles.strong}>{schedule.criticalDriver.name}</Text>
                  {schedule.criticalDriver.slipDays != null ? ` — ${schedule.criticalDriver.slipDays} days` : ''}
                </Text>
              ) : null}
              {schedule?.projectedFinish ? (
                <Provenance>
                  Projected finish {day(schedule.projectedFinish)}
                  {schedule.plannedFinish ? ` against a planned ${day(schedule.plannedFinish)}` : ''}
                </Provenance>
              ) : null}
            </View>
          </Card>
        )}
      </Section>

      {/* 4 — what the site did */}
      <Section title="Today on site" action={{ title: 'Open the report', onPress: () => router.push('/site') }} testID="pm-today-on-site">
        {log.isPending ? (
          <SkeletonList rows={2} />
        ) : log.isError ? (
          <ErrorState message={userMessage(log.error)} onRetry={() => void log.refetch()} />
        ) : !totals || totals.entries === 0 ? (
          <Text tone="muted">Nothing has been recorded on the report for today yet.</Text>
        ) : (
          <>
            <Counts
              items={[
                { id: 'workers', label: 'Workers', value: String(totals.workers) },
                { id: 'man-hours', label: 'Man-hours', value: String(totals.manHours) },
                { id: 'companies', label: 'Companies', value: String(totals.companies) },
                { id: 'plant', label: 'Plant on site', value: String(totals.equipmentCount) },
                { id: 'deliveries', label: 'Deliveries', value: String(totals.deliveries) },
                { id: 'lost', label: 'Hours lost', value: String(totals.hoursLost), tone: totals.hoursLost > 0 ? 'warning' : 'default' },
              ]}
            />
            {log.data?.weather?.summary ? <Provenance>Weather: {log.data.weather.summary}</Provenance> : null}
          </>
        )}
      </Section>

      {/* 5 — the numbers */}
      <Section title="Schedule and cost" action={{ title: 'Project', onPress: () => router.push('/project') }} testID="pm-pulse">
        <View style={styles.kpis}>
          <KPI label="SPI" value={ratio(schedule?.spi)} tone={schedule?.spi != null && schedule.spi < 0.9 ? 'error' : 'default'} />
          <KPI label="CPI" value={ratio(schedule?.cpi)} tone={schedule?.cpi != null && schedule.cpi < 0.9 ? 'error' : 'default'} />
          <KPI label="Actual" value={money(cost?.actual ?? null, currency)} />
          <KPI label="Forecast at completion" value={money(cost?.eac ?? null, currency)} qualifier={eacQualifier(forecast.data)} tone={(cost?.overrun ?? 0) > 0 ? 'error' : 'default'} />
        </View>
        {forecastNotes(forecast.data).map((note) => (
          <Provenance key={note}>{note}</Provenance>
        ))}
      </Section>

      {/* 6 — what the field sent */}
      <Section title="Recent site photographs" action={{ title: 'All photos', onPress: () => router.push('/photos') }} testID="pm-photos">
        {photos.isPending ? <SkeletonList rows={1} /> : <PhotoStrip projectId={projectId} photos={recent} onOpen={(p) => router.push(`/photos/${p.id}` as never)} testID="pm-photo-strip" />}
      </Section>

      {/* 7 — and only now, actions */}
      <Section title="Quick actions" testID="pm-quick-actions">
        <QuickActions actions={actions} />
      </Section>
    </>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  strong: { fontFamily: 'Inter_600SemiBold' },
})
