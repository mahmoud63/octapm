import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useDailyLog, useDailyLogActions, useDailyLogSettings } from '@/api/site-hooks'
import { DAILY_LOG_SECTIONS, type DailyLogEntry, type DailyLogSection, type EntryInput } from '@/api/site-types'
import { DailyLogEntrySheet } from '@/components/DailyLogEntrySheet'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { PromptSheet } from '@/components/PromptSheet'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, EmptyState, ErrorState, KPI, SkeletonList, Text, spacing, toneForStatus, useTheme } from '@/design-system'
import { captureOrQueue } from '@/offline/capture'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(y!, m! - 1, d! + days, 12)
  return isoDay(next)
}
const SECTION_LABELS: Record<DailyLogSection, string> = { manpower: 'Manpower', equipment: 'Equipment', deliveries: 'Deliveries', visitors: 'Visitors', delays: 'Delays', notes: 'Notes' }

export function describeEntry(section: DailyLogSection, e: DailyLogEntry): string {
  switch (section) {
    case 'manpower':
      return [e.companyName, e.trade, e.workers != null ? `${e.workers} worker${e.workers === 1 ? '' : 's'}` : null, e.hours != null ? `${e.hours} h each` : null].filter(Boolean).join(' · ')
    case 'equipment':
      return [e.name, e.count != null ? `× ${e.count}` : null, e.hoursOperated != null ? `${e.hoursOperated} h operated` : null, e.hoursIdle ? `${e.hoursIdle} h idle` : null].filter(Boolean).join(' · ')
    case 'deliveries':
      return [e.supplierName, e.description, e.quantity != null ? `${e.quantity} ${e.unit ?? ''}`.trim() : null, e.poRef].filter(Boolean).join(' · ')
    case 'visitors':
      return [e.company, e.purpose, e.arrivedAt ? `arrived ${e.arrivedAt}` : null].filter(Boolean).join(' · ')
    case 'delays':
      return [humanise(e.type), e.hoursLost != null ? `${e.hoursLost} h lost` : null, e.notes].filter(Boolean).join(' · ')
    case 'notes':
      return [humanise(e.kind), e.text].filter(Boolean).join(': ')
  }
}

/**
 * The daily log: one day, six sections, submitted once at the end of it.
 * Entries are added as they happen and carry a replay key; the day is
 * submitted through the server's route, and approval stays on the web.
 */
export default function DailyLogScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ date?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const [date, setDate] = useState(params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : isoDay(new Date()))
  const log = useDailyLog(projectId, date)
  const settings = useDailyLogSettings(projectId)
  const actions = useDailyLogActions(projectId ?? '', date)
  const [adding, setAdding] = useState<DailyLogSection | null>(null)
  const [editingSummary, setEditingSummary] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null)

  const project = projects.data?.find((p) => p.id === projectId) ?? null

  if (!projectId) {
    return (
      <Screen testID="screen-daily-log">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const canSubmit = permissions.allows('progress', 'submit')
  const canUpdate = permissions.allows('progress', 'update')
  const open = log.data?.status === 'open'
  const today = isoDay(new Date())

  const save = async (section: DailyLogSection, body: EntryInput) => {
    setFailure(null)
    setQueuedNotice(null)
    try {
      // Every entry carries a replay key: sent now, or kept in the outbox until the signal returns.
      const outcome = await captureOrQueue({ projectId: projectId!, kind: 'daily-log.entry', summary: `${humanise(section)} entry for ${date}`, payload: { date, section, body }, clientRequestId: body.clientRequestId }, () => actions.addEntry.mutateAsync({ section, body }))
      setAdding(null)
      if (outcome.queued) setQueuedNotice(`Saved to the outbox. The ${humanise(section).toLowerCase()} entry will be sent when the signal returns.`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const run = async (work: () => Promise<unknown>) => {
    setFailure(null)
    try {
      await work()
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-daily-log">
        <ProjectSwitch project={project} />

        <View style={styles.dateRow}>
          <Button title="‹" variant="secondary" onPress={() => setDate(shift(date, -1))} testID="daily-log-prev" />
          <View style={styles.dateText}>
            <Text variant="heading" align="center" testID="daily-log-date">
              {day(`${date}T12:00:00`)}
            </Text>
            {log.data ? (
              <View style={styles.center}>
                <Badge label={humanise(log.data.status)} tone={toneForStatus(log.data.status)} />
              </View>
            ) : null}
          </View>
          <Button title="›" variant="secondary" disabled={date >= today} onPress={() => setDate(shift(date, 1))} testID="daily-log-next" />
        </View>
        {date !== today ? <Button title="Today" variant="ghost" onPress={() => setDate(today)} testID="daily-log-today" /> : null}

        {log.isPending ? (
          <SkeletonList rows={4} />
        ) : log.isError ? (
          <ErrorState message={userMessage(log.error)} onRetry={() => void log.refetch()} />
        ) : (
          <>
            <View style={styles.kpis}>
              <KPI label="Workers" value={String(log.data.totals.workers)} />
              <KPI label="Man-hours" value={String(log.data.totals.manHours)} />
              <KPI label="Equipment" value={String(log.data.totals.equipmentCount)} />
              <KPI label="Hours lost" value={String(log.data.totals.hoursLost)} tone={log.data.totals.hoursLost > 0 ? 'warning' : 'default'} />
            </View>
            <Freshness updatedAt={log.dataUpdatedAt || undefined} isFetching={log.isFetching} />

            <Card>
              <View style={styles.stack}>
                <View style={styles.row}>
                  <Text variant="label" label tone="muted" style={styles.grow}>
                    Weather
                  </Text>
                  {open && canUpdate && settings.data?.weatherFeedEnabled && settings.data.hasCoordinates ? <Button title="Fetch" variant="ghost" loading={actions.refreshWeather.isPending} onPress={() => void run(() => actions.refreshWeather.mutateAsync())} testID="daily-log-weather" /> : null}
                </View>
                {log.data.weather ? (
                  <Text>
                    {[log.data.weather.condition ? humanise(log.data.weather.condition) : null, log.data.weather.tempMinC != null && log.data.weather.tempMaxC != null ? `${log.data.weather.tempMinC}–${log.data.weather.tempMaxC} °C` : null, log.data.weather.rainMm != null ? `${log.data.weather.rainMm} mm rain` : null, log.data.weather.windKph != null ? `${log.data.weather.windKph} km/h wind` : null].filter(Boolean).join(' · ') || log.data.weather.summary || 'Recorded'}
                  </Text>
                ) : (
                  <Text tone="muted">No weather recorded for this day.</Text>
                )}
              </View>
            </Card>

            <Card>
              <View style={styles.stack}>
                <View style={styles.row}>
                  <Text variant="label" label tone="muted" style={styles.grow}>
                    Summary
                  </Text>
                  {open && canUpdate ? <Button title={log.data.summary ? 'Edit' : 'Write'} variant="ghost" onPress={() => setEditingSummary(true)} testID="daily-log-summary-edit" /> : null}
                </View>
                {log.data.summary ? <Text testID="daily-log-summary">{log.data.summary}</Text> : <Text tone="muted">No summary yet.</Text>}
              </View>
            </Card>

            {DAILY_LOG_SECTIONS.map((section) => {
              const entries = log.data.sections[section] ?? []
              return (
                <Card key={section} testID={`daily-log-section-${section}`}>
                  <View style={styles.stack}>
                    <View style={styles.row}>
                      <Text variant="label" label tone="muted">
                        {SECTION_LABELS[section]}
                      </Text>
                      <Badge label={String(entries.length)} tone={entries.length ? 'info' : 'neutral'} />
                      <View style={styles.grow} />
                      {open && canSubmit ? <Button title="Add" variant="ghost" onPress={() => setAdding(section)} testID={`daily-log-add-${section}`} /> : null}
                    </View>
                    {entries.length === 0 ? (
                      <Text tone="muted">Nothing recorded.</Text>
                    ) : (
                      entries.map((e) => (
                        <View key={e.id} style={[styles.entry, { borderColor: theme.colors.border }]} testID={`daily-log-entry-${e.id}`}>
                          <View style={styles.grow}>
                            <Text>{describeEntry(section, e)}</Text>
                            <Text variant="caption" tone="muted">
                              {[e.activity?.name, e.location?.name, e.party?.name, e.status !== 'approved' ? humanise(e.status) : null].filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                          {open && canSubmit ? <Button title="Remove" variant="ghost" onPress={() => void run(() => actions.removeEntry.mutateAsync({ section, entryId: e.id }))} testID={`daily-log-remove-${e.id}`} /> : null}
                        </View>
                      ))
                    )}
                  </View>
                </Card>
              )
            })}

            {queuedNotice ? (
              <Card edge={theme.colors.warning} testID="daily-log-queued">
                <View style={styles.row}>
                  <Text style={styles.grow}>{queuedNotice}</Text>
                  <Button title="Outbox" variant="ghost" onPress={() => router.push('/outbox')} testID="daily-log-open-outbox" />
                </View>
              </Card>
            ) : null}
            {failure ? (
              <Text tone="error" accessibilityRole="alert" testID="daily-log-failure">
                {failure}
              </Text>
            ) : null}

            {open && canSubmit ? (
              <View style={styles.actions}>
                {(settings.data?.copySections?.length ?? 0) > 0 ? <Button title="Copy yesterday's crews and plant" variant="secondary" loading={actions.copyPrevious.isPending} onPress={() => void run(() => actions.copyPrevious.mutateAsync(settings.data!.copySections))} testID="daily-log-copy" /> : null}
                <Button title="Submit the day" size="lg" fullWidth disabled={log.data.totals.entries === 0} loading={actions.submit.isPending} onPress={() => void run(() => actions.submit.mutateAsync())} testID="daily-log-submit" />
                <Text variant="caption" tone="muted">
                  Submitting sends the day for approval on the web platform. Entries can still be reviewed there.
                </Text>
              </View>
            ) : log.data.status === 'submitted' ? (
              <Text tone="muted">Submitted{log.data.submittedAt ? ` on ${day(log.data.submittedAt)}` : ''}; waiting for approval.</Text>
            ) : log.data.status === 'approved' ? (
              <Text tone="muted">Approved{log.data.approvedAt ? ` on ${day(log.data.approvedAt)}` : ''}.</Text>
            ) : null}
          </>
        )}
      </Screen>

      {adding ? <DailyLogEntrySheet visible projectId={projectId} section={adding} busy={actions.addEntry.isPending} error={failure} onCancel={() => setAdding(null)} onSave={(body) => void save(adding, body)} /> : null}
      <PromptSheet visible={editingSummary} title="Summary of the day" label="Summary" confirmTitle="Save" busy={actions.saveSummary.isPending} error={failure} onCancel={() => setEditingSummary(false)} onConfirm={(text) => void run(async () => { await actions.saveSummary.mutateAsync(text); setEditingSummary(false) })} testID="prompt-summary" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  center: { alignItems: 'center' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateText: { flex: 1, gap: spacing.xs, alignItems: 'center' },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  actions: { gap: spacing.sm },
})
