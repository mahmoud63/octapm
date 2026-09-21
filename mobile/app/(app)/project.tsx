import { useRouter } from 'expo-router'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useForecast, useHealth, useProjects } from '@/api/hooks'
import { useDailyLog, usePhotos } from '@/api/site-hooks'
import { Freshness } from '@/components/Freshness'
import { HealthDimensions, healthTone } from '@/components/HealthDimensions'
import { PhotoStrip } from '@/home/sections'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, Card, EmptyState, ErrorState, KPI, SkeletonList, Text, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, money } from '@/utilities/format'
import { useState } from 'react'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A figure the server did not send is an em-dash, never a guess. */
const num = (value: number | null | undefined, suffix = '') => (value === null || value === undefined ? '—' : `${value}${suffix}`)
const ratio = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toFixed(2))

/**
 * The project, as the server sees it: health, the schedule and cost forecast,
 * and what happened on site today.
 *
 * Every number here is computed by the platform and rendered as it arrived.
 * SPI is genuinely nullable — a project without an earned-value basis has
 * none — and it shows as an em-dash beside the slip the server did compute.
 */
export default function ProjectScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const health = useHealth(projectId)
  const forecast = useForecast(projectId)
  const log = useDailyLog(projectId, today())
  const photos = usePhotos(projectId)
  const [refreshing, setRefreshing] = useState(false)

  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const currency = project?.currency ?? undefined

  if (!projectId) {
    return (
      <Screen title="Project" testID="screen-project">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="This screen shows one project's health, forecast and site activity." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([health.refetch(), forecast.refetch(), log.refetch()])
    setRefreshing(false)
  }

  const schedule = forecast.data?.schedule ?? null
  const cost = forecast.data?.cost ?? null
  const totals = log.data?.totals ?? null

  return (
    <Screen title="Project" subtitle={project?.name} contentStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} testID="screen-project">
      <ProjectSwitch project={project} />

      {/*
        Who this job is for and on what terms. The contract value is the one
        figure here that is not everybody's, so it is asked for rather than
        assumed: the server decides, and a role without cost stays on the same
        screen with one fewer line rather than being sent somewhere else.
      */}
      <Card testID="project-facts">
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            {project?.contractNumber ?? 'Project'}
          </Text>
          <Text variant="heading">{project?.name}</Text>
          {[
            { id: 'client', label: 'Client', value: project?.clientName },
            { id: 'contractor', label: 'Main contractor', value: project?.contractorName },
            { id: 'consultant', label: 'Consultant', value: project?.consultantName },
            { id: 'where', label: 'Where', value: project?.location },
            { id: 'dates', label: 'Programme', value: project?.startDate && project?.endDate ? `${day(project.startDate)} → ${day(project.endDate)}` : null },
            ...(permissions.allows('cost', 'read') ? [{ id: 'value', label: 'Contract value', value: money(project?.contractValue ?? null, currency) }] : []),
          ]
            .filter((fact) => !!fact.value)
            .map((fact) => (
              <View key={fact.id} style={styles.fact} testID={`project-fact-${fact.id}`}>
                <Text tone="muted" style={styles.grow}>
                  {fact.label}
                </Text>
                <Text>{String(fact.value)}</Text>
              </View>
            ))}
          <View style={styles.links}>
            <Button title="Team" variant="secondary" onPress={() => router.push('/team')} testID="project-team" />
            <Button title="Activity" variant="secondary" onPress={() => router.push('/feed')} testID="project-feed" />
            <Button title="Locations" variant="secondary" onPress={() => router.push('/locations')} testID="project-locations" />
          </View>
        </View>
      </Card>

      <Card testID="project-health">
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Health
          </Text>
          {health.isPending ? (
            <SkeletonList rows={2} />
          ) : health.isError ? (
            <ErrorState message={userMessage(health.error)} onRetry={() => void health.refetch()} />
          ) : (
            <>
              <View style={styles.kpis}>
                <KPI label="Overall" value={health.data.overallScore != null ? String(health.data.overallScore) : '—'} qualifier="of 100" tone={healthTone(health.data.overallScore) === "muted" ? "default" : (healthTone(health.data.overallScore) as "default" | "error" | "success" | "warning")} />
              </View>
              <HealthDimensions dimensions={health.data.dimensions} />
            </>
          )}
        </View>
      </Card>

      <Card testID="project-forecast">
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Schedule and cost
          </Text>
          {forecast.isPending ? (
            <SkeletonList rows={2} />
          ) : forecast.isError ? (
            <ErrorState message={userMessage(forecast.error)} onRetry={() => void forecast.refetch()} />
          ) : !forecast.data?.available ? (
            <Text tone="muted">The forecast needs a baseline and progress before it can be calculated.</Text>
          ) : (
            <>
              <View style={styles.kpis}>
                <KPI label="SPI" value={ratio(schedule?.spi)} tone={schedule?.spi != null && schedule.spi < 0.9 ? 'error' : 'default'} />
                <KPI label="CPI" value={ratio(schedule?.cpi ?? null)} tone={schedule?.cpi != null && schedule.cpi < 0.9 ? 'error' : 'default'} />
                <KPI label="Slip" value={num(schedule?.slipDays, ' d')} tone={(schedule?.slipDays ?? 0) > 0 ? 'warning' : 'default'} />
              </View>
              <View style={styles.kpis}>
                <KPI label="Budget" value={money(cost?.budget ?? null, currency)} />
                <KPI label="Forecast at completion" value={money(cost?.eac ?? null, currency)} tone={(cost?.overrun ?? 0) > 0 ? 'error' : 'default'} />
                <KPI label="Actual" value={money(cost?.actual ?? null, currency)} />
              </View>
              {schedule?.criticalDriver ? (
                <Text variant="caption" tone="muted" testID="project-critical-driver">
                  Longest slip: {schedule.criticalDriver.name}
                  {schedule.criticalDriver.slipDays != null ? ` · ${schedule.criticalDriver.slipDays} days` : ''}
                </Text>
              ) : null}
              {schedule?.projectedFinish ? (
                <Text variant="caption" tone="muted">
                  Projected finish {day(schedule.projectedFinish)}
                  {schedule.plannedFinish ? ` against a planned ${day(schedule.plannedFinish)}` : ''}
                </Text>
              ) : null}
            </>
          )}
          <Freshness updatedAt={forecast.dataUpdatedAt || undefined} isFetching={forecast.isFetching && !refreshing} />
        </View>
      </Card>

      {/* What the field actually sent, which is the part of a dashboard people believe. */}
      <Card testID="project-photos">
        <View style={styles.stack}>
          <View style={styles.fact}>
            <Text variant="label" label tone="muted" style={styles.grow}>
              Recent site photographs
            </Text>
            <Button title="All photos" variant="ghost" onPress={() => router.push('/photos')} testID="project-photos-all" />
          </View>
          {photos.isPending ? <SkeletonList rows={1} /> : <PhotoStrip projectId={projectId} photos={(photos.data?.items ?? []).slice(0, 12)} onOpen={(p) => router.push(`/photos/${p.id}` as never)} testID="project-photo-strip" />}
        </View>
      </Card>

      <Card testID="project-today">
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Today on site
          </Text>
          {log.isPending ? (
            <SkeletonList rows={2} />
          ) : log.isError ? (
            <ErrorState message={userMessage(log.error)} onRetry={() => void log.refetch()} />
          ) : !totals || totals.entries === 0 ? (
            <Text tone="muted">Nothing has been recorded on the report for today yet.</Text>
          ) : (
            <>
              <View style={styles.kpis}>
                <KPI label="Workers" value={String(totals.workers)} />
                <KPI label="Man-hours" value={String(totals.manHours)} />
                <KPI label="Companies" value={String(totals.companies)} />
              </View>
              <View style={styles.kpis}>
                <KPI label="Plant" value={String(totals.equipmentCount)} qualifier={totals.idleHours ? `${totals.idleHours} idle hrs` : undefined} />
                <KPI label="Deliveries" value={String(totals.deliveries)} />
                <KPI label="Hours lost" value={String(totals.hoursLost)} tone={totals.hoursLost > 0 ? 'warning' : 'default'} />
              </View>
            </>
          )}
          <Button title="Open the daily report" variant="secondary" onPress={() => router.push('/site')} testID="project-open-report" />
        </View>
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
