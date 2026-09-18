import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useNcrActions } from '@/api/quality-hooks'
import { useActivities, useTeam } from '@/api/record-hooks'
import { FilterChip } from '@/components/FilterChip'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

const isoDay = /^\d{4}-\d{2}-\d{2}$/

/** Raise a non-conformance: how bad, what, the proposed disposition, who fixes it and by when. */
export default function NewNcrScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ activityId?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const team = useTeam(projectId)
  const activities = useActivities(projectId)
  const actions = useNcrActions(projectId ?? '')
  const [severity, setSeverity] = useState<'major' | 'minor'>('minor')
  const [description, setDescription] = useState('')
  const [disposition, setDisposition] = useState('')
  const [responsible, setResponsible] = useState('')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [activityId, setActivityId] = useState<string | null>(params.activityId ?? null)
  const [dueDate, setDueDate] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const people = useMemo(() => (team.data ?? []).map((m) => ({ id: m.userId, label: m.name, sublabel: humanise(m.assignmentRole ?? m.orgRole) })), [team.data])
  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])
  const ready = description.trim().length >= 5 && (!dueDate || isoDay.test(dueDate))

  const save = async () => {
    if (!projectId) return
    setFailure(null)
    try {
      const created = await actions.create.mutateAsync({ severity, description: description.trim(), disposition: disposition.trim() || undefined, responsible: responsible.trim() || undefined, assigneeUserId: assigneeId ?? undefined, activityId: activityId ?? undefined, dueDate: dueDate || undefined })
      router.replace(`/quality/ncr/${created.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  if (!projectId) {
    return (
      <Screen testID="screen-ncr-new">
        <Text tone="muted">Choose a project first.</Text>
      </Screen>
    )
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-ncr-new">
      <Card>
        <View style={styles.stack}>
          <View style={styles.chips}>
            <FilterChip label="Minor" selected={severity === 'minor'} onPress={() => setSeverity('minor')} testID="ncr-severity-minor" />
            <FilterChip label="Major" selected={severity === 'major'} onPress={() => setSeverity('major')} testID="ncr-severity-major" />
          </View>
          <Text variant="caption" tone="muted">
            A major NCR costs 20 points of the quality score; a minor one, 8.
          </Text>
          <Input label="Non-conformance" required value={description} onChangeText={setDescription} multiline placeholder="What does not conform, where, and against which requirement" testID="ncr-description" />
          <Input label="Proposed disposition" value={disposition} onChangeText={setDisposition} multiline placeholder="Repair, rework, use as is, reject" testID="ncr-disposition" />
          <Input label="Responsible" value={responsible} onChangeText={setResponsible} placeholder="Person or company responsible" testID="ncr-responsible" />
          <PickerField label="Assigned to" options={people} value={assigneeId} onChange={(v) => setAssigneeId(v as string | null)} loading={team.isPending} testID="ncr-assignee" />
          <PickerField label="Activity" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="ncr-activity" />
          <Input label="Due" placeholder="YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} autoCapitalize="none" error={dueDate && !isoDay.test(dueDate) ? 'Use the form YYYY-MM-DD' : undefined} testID="ncr-due" />
        </View>
      </Card>
      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="ncr-new-failure">
          {failure}
        </Text>
      ) : null}
      <Button title="Raise NCR" size="lg" fullWidth disabled={!ready} loading={actions.create.isPending} onPress={() => void save()} testID="ncr-raise" />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
