import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useActivities } from '@/api/record-hooks'
import { useCrews, useTimesheetActions, useWorkers } from '@/api/site-hooks'
import type { TimesheetEntry } from '@/api/site-types'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing, useTheme } from '@/design-system'
import { captureOrQueue } from '@/offline/capture'
import { useProjectStore } from '@/projects/store'
import { newId } from '@/utilities/id'

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * A crew's day in one screen: pick the crew, the workers come with it, each
 * with the default hours against the crew's default activity; adjust and
 * save. The sheet is created with a replay key and submitted from its page.
 */
export default function NewTimesheetScreen() {
  const theme = useTheme()
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const crews = useCrews(projectId)
  const workers = useWorkers(projectId)
  const activities = useActivities(projectId)
  const actions = useTimesheetActions(projectId ?? '')
  const [date, setDate] = useState(isoDay(new Date()))
  const [crewId, setCrewId] = useState<string | null>(null)
  const [activityId, setActivityId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [hours, setHours] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const crew = useMemo(() => (crews.data ?? []).find((c) => c.id === crewId) ?? null, [crews.data, crewId])
  useEffect(() => {
    if (!crew) return
    const ids = crew.workerIds ?? crew.workers?.map((w) => w.id) ?? []
    setSelected(ids)
    setActivityId(crew.defaultActivityId ?? null)
    setHours(Object.fromEntries(ids.map((id) => [id, '8'])))
  }, [crew])

  const crewOptions = useMemo(() => (crews.data ?? []).map((c) => ({ id: c.id, label: c.name })), [crews.data])
  const workerOptions = useMemo(() => (workers.data ?? []).map((w) => ({ id: w.id, label: w.name, sublabel: w.trade })), [workers.data])
  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])
  const byId = useMemo(() => new Map((workers.data ?? []).map((w) => [w.id, w])), [workers.data])

  const entries: TimesheetEntry[] = selected.map((workerId) => ({ workerId, activityId, timeType: 'regular', hours: Number(hours[workerId] ?? '8') || 0 }))
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && entries.length > 0 && entries.every((e) => e.hours > 0 && e.hours <= 24)

  const save = async () => {
    if (!projectId) return
    setFailure(null)
    try {
      const body = { date, crewId: crewId ?? undefined, notes: notes.trim() || undefined, clientRequestId: newId(), entries }
      const outcome = await captureOrQueue({ projectId, kind: 'timesheet.create', summary: `Timesheet for ${date}`, payload: { body }, clientRequestId: body.clientRequestId }, () => actions.create.mutateAsync(body))
      if (outcome.queued) {
        router.replace('/outbox')
        return
      }
      router.replace(`/timesheets/${outcome.sent.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  if (!projectId) {
    return (
      <Screen testID="screen-timesheet-new">
        <Text tone="muted">Choose a project first.</Text>
      </Screen>
    )
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-timesheet-new">
      <Card>
        <View style={styles.stack}>
          <Input label="Date" required value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" testID="timesheet-date" />
          <PickerField label="Crew" options={crewOptions} value={crewId} onChange={(v) => setCrewId(v as string | null)} loading={crews.isPending} testID="timesheet-crew" />
          <PickerField label="Workers" placeholder="Choose the people on site" options={workerOptions} value={selected} onChange={(v) => { const ids = v as string[]; setSelected(ids); setHours((prev) => Object.fromEntries(ids.map((id) => [id, prev[id] ?? '8']))) }} multiple loading={workers.isPending} testID="timesheet-workers" />
          <PickerField label="Activity" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="timesheet-activity" />
        </View>
      </Card>
      {selected.length ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Hours per person
            </Text>
            {selected.map((id) => (
              <View key={id} style={[styles.row, { borderColor: theme.colors.border }]}>
                <Text style={styles.grow}>{byId.get(id)?.name ?? id}</Text>
                <View style={styles.hours}>
                  <Input label="Hours" value={hours[id] ?? '8'} onChangeText={(v) => setHours((prev) => ({ ...prev, [id]: v }))} keyboardType="decimal-pad" testID={`timesheet-hours-${id}`} />
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Input label="Notes" value={notes} onChangeText={setNotes} multiline testID="timesheet-notes" />
      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="timesheet-failure">
          {failure}
        </Text>
      ) : null}
      <Button title="Save timesheet" size="lg" fullWidth disabled={!ready} loading={actions.create.isPending} onPress={() => void save()} testID="timesheet-save" />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1 },
  grow: { flex: 1 },
  hours: { width: 110 },
})
