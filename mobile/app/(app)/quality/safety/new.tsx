import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useSafetyActions } from '@/api/quality-hooks'
import { INCIDENT_TYPES } from '@/api/quality-types'
import { useActivities, useTeam } from '@/api/record-hooks'
import { FilterChip } from '@/components/FilterChip'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

const isoDay = /^\d{4}-\d{2}-\d{2}$/
const TYPE_LABELS: Record<string, string> = { near_miss: 'Near miss', first_aid: 'First aid', lti: 'Lost-time injury', fatality: 'Fatality' }
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Report an incident or a near miss: what kind, what happened, when, who is responsible for the follow-up. */
export default function NewSafetyScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ activityId?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const team = useTeam(projectId)
  const activities = useActivities(projectId)
  const actions = useSafetyActions(projectId ?? '')
  const [incidentType, setIncidentType] = useState<string>('near_miss')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today())
  const [severity, setSeverity] = useState<string | null>(null)
  const [lostDays, setLostDays] = useState('')
  const [responsible, setResponsible] = useState('')
  const [investigation, setInvestigation] = useState('')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [activityId, setActivityId] = useState<string | null>(params.activityId ?? null)
  const [dueDate, setDueDate] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const people = useMemo(() => (team.data ?? []).map((m) => ({ id: m.userId, label: m.name, sublabel: humanise(m.assignmentRole ?? m.orgRole) })), [team.data])
  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])
  const ready = title.trim().length >= 3 && isoDay.test(date) && (!dueDate || isoDay.test(dueDate)) && (!lostDays || /^\d+$/.test(lostDays))

  const save = async () => {
    if (!projectId) return
    setFailure(null)
    try {
      const created = await actions.create.mutateAsync({ incidentType, title: title.trim(), date, severity: severity ?? undefined, lostDays: lostDays ? Number(lostDays) : undefined, responsible: responsible.trim() || undefined, investigation: investigation.trim() || undefined, assigneeUserId: assigneeId ?? undefined, activityId: activityId ?? undefined, dueDate: dueDate || undefined, status: 'open' })
      router.replace(`/quality/safety/${created.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  if (!projectId) {
    return (
      <Screen testID="screen-safety-new">
        <Text tone="muted">Choose a project first.</Text>
      </Screen>
    )
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-safety-new">
      <Card>
        <View style={styles.stack}>
          <View style={styles.chips}>
            {INCIDENT_TYPES.map((t) => (
              <FilterChip key={t} label={TYPE_LABELS[t] ?? humanise(t)} selected={incidentType === t} onPress={() => setIncidentType(t)} testID={`safety-type-${t}`} />
            ))}
          </View>
          <Input label="What happened" required value={title} onChangeText={setTitle} placeholder="One line, plain words" testID="safety-title" />
          <Input label="Date" required placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} autoCapitalize="none" error={date && !isoDay.test(date) ? 'Use the form YYYY-MM-DD' : undefined} testID="safety-date" />
          <View style={styles.chips}>
            {['low', 'medium', 'high'].map((s) => (
              <FilterChip key={s} label={humanise(s)} selected={severity === s} onPress={() => setSeverity(severity === s ? null : s)} testID={`safety-severity-${s}`} />
            ))}
          </View>
          {incidentType === 'lti' || incidentType === 'fatality' ? <Input label="Lost days" value={lostDays} onChangeText={setLostDays} keyboardType="number-pad" testID="safety-lost-days" /> : null}
          <Input label="Investigation notes" value={investigation} onChangeText={setInvestigation} multiline placeholder="What was seen, who was involved, immediate actions" testID="safety-investigation" />
          <Input label="Responsible for follow-up" value={responsible} onChangeText={setResponsible} testID="safety-responsible" />
          <PickerField label="Assigned to" options={people} value={assigneeId} onChange={(v) => setAssigneeId(v as string | null)} loading={team.isPending} testID="safety-assignee" />
          <PickerField label="Activity" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="safety-activity" />
          <Input label="Closeout due" placeholder="YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} autoCapitalize="none" error={dueDate && !isoDay.test(dueDate) ? 'Use the form YYYY-MM-DD' : undefined} testID="safety-due" />
        </View>
      </Card>
      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="safety-new-failure">
          {failure}
        </Text>
      ) : null}
      <Button title="Report incident" variant="danger" size="lg" fullWidth disabled={!ready} loading={actions.create.isPending} onPress={() => void save()} testID="safety-report" />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
