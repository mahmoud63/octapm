import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { Evidence } from '@/components/Evidence'
import { ReportStatus } from '@/site/ReportStatus'
import { useConstraints, useDailyLog, useDailyLogActions, useDailyLogSettings, useProjectProgressSubmissions } from '@/api/site-hooks'
import { DAILY_LOG_SECTIONS, type DailyLogEntry, type DailyLogSection, type EntryInput } from '@/api/site-types'
import { DailyLogEntrySheet } from '@/components/DailyLogEntrySheet'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { PromptSheet } from '@/components/PromptSheet'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonList, Text, spacing, toneForStatus, useTheme } from '@/design-system'
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
      return [e.name, e.company, e.purpose, e.arrivedAt ? `arrived ${e.arrivedAt}` : null].filter(Boolean).join(' · ')
    case 'delays':
      // The description is the server's required account of what happened; older
      // entries carry only a note, so that still shows rather than nothing.
      return [humanise(e.type), e.hoursLost != null ? `${e.hoursLost} h lost` : null, e.description ?? e.notes].filter(Boolean).join(' · ')
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
  const submissions = useProjectProgressSubmissions(projectId)
  const constraints = useConstraints(projectId)
  const [adding, setAdding] = useState<DailyLogSection | null>(null)
  const [editingSummary, setEditingSummary] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null)

  const project = projects.data?.find((p) => p.id === projectId) ?? null

  // Work completed is not a section of its own. It is the progress recorded
  // against real activities on this day, read back from the register so the
  // report never holds a second opinion about how far a job has got — and read
  // from the submissions rather than from each activity's pending one, or the
  // work would leave the report at the moment it was approved.
  const worked = useMemo(
    () => (submissions.data ?? []).filter((s) => (s.submittedAt ?? s.createdAt)?.slice(0, 10) === date),
    [submissions.data, date],
  )
  const openConstraints = constraints.data?.summary.open ?? 0

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
            <ReportStatus
              date={date}
              status={log.data.status}
              preparedBy={typeof log.data.submittedBy === 'object' && log.data.submittedBy ? log.data.submittedBy.name : null}
              updatedAt={log.data.submittedAt}
              lines={[
                { id: 'work', label: 'Work completed', value: `${worked.length} activit${worked.length === 1 ? 'y' : 'ies'}`, onPress: () => router.push('/activities') },
                { id: 'manpower', label: 'Manpower', value: `${log.data.totals.workers} worker${log.data.totals.workers === 1 ? '' : 's'}` },
                { id: 'man-hours', label: 'Man-hours', value: String(log.data.totals.manHours) },
                { id: 'equipment', label: 'Equipment', value: `${log.data.totals.equipmentCount} on site` },
                { id: 'deliveries', label: 'Deliveries', value: String(log.data.totals.deliveries) },
                { id: 'visitors', label: 'Visitors', value: String(log.data.totals.visitors) },
                { id: 'delays', label: 'Delays', value: log.data.totals.hoursLost ? `${log.data.totals.hoursLost} h lost` : '0', tone: log.data.totals.hoursLost > 0 ? 'warning' : 'default' },
                { id: 'constraints', label: 'Open constraints', value: String(openConstraints), tone: openConstraints > 0 ? 'warning' : 'default', onPress: () => router.push('/activities/lookahead') },
              ]}
              action={open && canSubmit ? { title: log.data.totals.entries === 0 ? 'Start the report' : 'Continue the report', onPress: () => setAdding('manpower'), testID: 'site-continue' } : null}
            />
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
                    {[log.data.weather.condition ? humanise(log.data.weather.condition) : null, log.data.weather.tempMinC != null && log.data.weather.tempMaxC != null ? `${log.data.weather.tempMinC}–${log.data.weather.tempMaxC} °C` : null, log.data.weather.precipitationMm != null ? `${log.data.weather.precipitationMm} mm rain` : null, log.data.weather.windMaxKph != null ? `${log.data.weather.windMaxKph} km/h wind` : null].filter(Boolean).join(' · ') || log.data.weather.summary || 'Recorded'}
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

            {/* Work completed — the activities register's own progress, not a second copy of it. */}
            <Card testID="site-work-completed">
              <View style={styles.stack}>
                <View style={styles.row}>
                  <Text variant="label" label tone="muted" style={styles.grow}>
                    Work completed
                  </Text>
                  <Badge label={String(worked.length)} tone={worked.length ? 'info' : 'neutral'} />
                  {canSubmit ? <Button title="Record" variant="ghost" onPress={() => router.push('/progress')} testID="site-record-progress" /> : null}
                </View>
                {submissions.isPending ? (
                  <SkeletonList rows={2} />
                ) : worked.length === 0 ? (
                  <Text tone="muted">No progress recorded against an activity today.</Text>
                ) : (
                  worked.map((s) => (
                    <View key={s.id} style={[styles.entry, { borderColor: theme.colors.border }]} testID={`site-work-${s.id}`}>
                      <View style={styles.grow}>
                        <Text>{s.activity?.name ?? 'Activity'}</Text>
                        <Text variant="caption" tone="muted">
                          {[
                            s.pctComplete != null ? `${s.pctComplete}% complete` : null,
                            s.quantityComplete != null ? `${s.quantityComplete}${s.quantityUnit ? ` ${s.quantityUnit}` : ''} installed` : null,
                            humanise(s.status),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                        {s.notes ? <Text variant="caption">{s.notes}</Text> : null}
                      </View>
                    </View>
                  ))
                )}
              </View>
            </Card>

            {/* Photographs — the same evidence system as every other record. */}
            <Card testID="site-photos">
              {log.data.id ? (
                <Evidence
                  projectId={projectId}
                  recordType="daily_log"
                  recordId={log.data.id}
                  recordRef={`Daily report ${date}`}
                  canAdd={open && canSubmit}
                  title="Photographs"
                  emptyText="No photographs on today's report yet."
                  testID="site-evidence"
                />
              ) : (
                <Text tone="muted">Record something first; photographs attach to the day once it exists.</Text>
              )}
            </Card>

            {/* Safety and quality summarise what the day's own notes carry and hand the rest to their modules. */}
            {(['safety', 'quality'] as const).map((topic) => {
              const kinds = topic === 'safety' ? ['safety'] : ['inspection', 'issue']
              const notes = (log.data.sections.notes ?? []).filter((n) => kinds.includes(String(n.kind)))
              return (
                <Card key={topic} testID={`site-${topic}`}>
                  <View style={styles.stack}>
                    <View style={styles.row}>
                      <Text variant="label" label tone="muted" style={styles.grow}>
                        {topic === 'safety' ? 'Safety' : 'Quality'}
                      </Text>
                      <Badge label={String(notes.length)} tone={notes.length ? 'info' : 'neutral'} />
                      <Button title="Open" variant="ghost" onPress={() => router.push(topic === 'safety' ? '/quality/safety' : '/quality')} testID={`site-${topic}-open`} />
                    </View>
                    {notes.length === 0 ? (
                      <Text tone="muted">{topic === 'safety' ? 'Nothing raised on site today.' : 'No inspections or issues noted today.'}</Text>
                    ) : (
                      notes.map((n) => (
                        <Text key={n.id} testID={`site-${topic}-note-${n.id}`}>
                          {describeEntry('notes', n)}
                        </Text>
                      ))
                    )}
                    <Text variant="caption" tone="muted">
                      {topic === 'safety' ? 'Incidents and near misses are records of their own; this is what the day noted.' : 'Inspections, NCRs and tests are records of their own; this is what the day noted.'}
                    </Text>
                  </View>
                </Card>
              )
            })}

            {/* Constraints — the lookahead's own, never a second list. */}
            <Card testID="site-constraints">
              <View style={styles.stack}>
                <View style={styles.row}>
                  <Text variant="label" label tone="muted" style={styles.grow}>
                    Constraints
                  </Text>
                  <Badge label={String(openConstraints)} tone={openConstraints ? 'warning' : 'neutral'} />
                  <Button title="Lookahead" variant="ghost" onPress={() => router.push('/activities/lookahead')} testID="site-constraints-open" />
                </View>
                {constraints.isPending ? (
                  <SkeletonList rows={2} />
                ) : openConstraints === 0 ? (
                  <Text tone="muted">Nothing is holding the work up.</Text>
                ) : (
                  (constraints.data?.items ?? [])
                    .filter((c) => c.constraintStatus === 'open')
                    .slice(0, 5)
                    .map((c) => (
                      <View key={c.id} style={[styles.entry, { borderColor: theme.colors.border }]} testID={`site-constraint-${c.id}`}>
                        <View style={styles.grow}>
                          <Text>{c.constraint ?? c.name}</Text>
                          <Text variant="caption" tone="muted">
                            {[c.name, c.plannedStart ? `planned ${day(c.plannedStart)}` : null].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                      </View>
                    ))
                )}
              </View>
            </Card>

            {/* Tomorrow — the lookahead is the plan; the report only points at it. */}
            <Card testID="site-tomorrow">
              <View style={styles.stack}>
                <View style={styles.row}>
                  <Text variant="label" label tone="muted" style={styles.grow}>
                    Tomorrow
                  </Text>
                  <Button title="Lookahead" variant="ghost" onPress={() => router.push('/activities/lookahead')} testID="site-tomorrow-open" />
                </View>
                <Text tone="muted">
                  What is planned for tomorrow lives on the lookahead, with its crews, its constraints and the dates the programme holds. Anything the day needs to pass on goes in a note.
                </Text>
                {open && canSubmit ? <Button title="Leave a note for tomorrow" variant="secondary" onPress={() => setAdding('notes')} testID="site-tomorrow-note" /> : null}
              </View>
            </Card>

            <Button title="Previous reports" variant="ghost" onPress={() => router.push('/site/previous')} testID="site-previous" />

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
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  actions: { gap: spacing.sm },
})
