import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useFormActions, useFormTemplates } from '@/api/quality-hooks'
import { useActivities, useLocations, useTeam } from '@/api/record-hooks'
import { FilterChip } from '@/components/FilterChip'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing } from '@/design-system'
import { captureOrQueue } from '@/offline/capture'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'
import { newId } from '@/utilities/id'

const isoDay = /^\d{4}-\d{2}-\d{2}$/

/**
 * Start an inspection from a template: what, where, against which activity,
 * for whom and by when. The instance is created with a replay key and, when
 * asked, started at once so the checklist is ready on the next screen.
 */
export default function NewInspectionScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ activityId?: string; locationId?: string; templateId?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const templates = useFormTemplates(projectId)
  const team = useTeam(projectId)
  const locations = useLocations(projectId)
  const activities = useActivities(projectId)
  const actions = useFormActions(projectId ?? '')
  const [templateId, setTemplateId] = useState<string | null>(params.templateId ?? null)
  const [title, setTitle] = useState('')
  const [activityId, setActivityId] = useState<string | null>(params.activityId ?? null)
  const [locationId, setLocationId] = useState<string | null>(params.locationId ?? null)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [startNow, setStartNow] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)

  const templateOptions = useMemo(() => (templates.data ?? []).map((t) => ({ id: t.id, label: t.name, sublabel: [t.typeLabel, t.trade, `${t.itemCount} item${t.itemCount === 1 ? '' : 's'}`, t.holdPointCount ? `${t.holdPointCount} hold point${t.holdPointCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') })), [templates.data])
  const people = useMemo(() => (team.data ?? []).map((m) => ({ id: m.userId, label: m.name, sublabel: humanise(m.assignmentRole ?? m.orgRole) })), [team.data])
  const places = useMemo(() => (locations.data ?? []).map((l) => ({ id: l.id, label: l.fullName || l.name, sublabel: l.code })), [locations.data])
  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])
  const template = templates.data?.find((t) => t.id === templateId) ?? null
  const ready = !!templateId && (!dueDate || isoDay.test(dueDate))

  const create = async () => {
    if (!projectId || !templateId) return
    setFailure(null)
    try {
      const body = { templateId, title: title.trim() || undefined, activityId: activityId ?? undefined, locationId: locationId ?? undefined, assigneeUserId: assigneeId ?? undefined, dueDate: dueDate || undefined, startNow, clientRequestId: newId(), clientCreatedAt: new Date().toISOString() }
      const outcome = await captureOrQueue({ projectId, kind: 'form.create', summary: body.title ?? template?.name ?? 'Inspection', payload: { body }, clientRequestId: body.clientRequestId }, () => actions.create.mutateAsync(body))
      if (outcome.queued) {
        router.replace('/outbox')
        return
      }
      router.replace(`/quality/inspections/${outcome.sent.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  if (!projectId) {
    return (
      <Screen testID="screen-inspection-new">
        <Text tone="muted">Choose a project first.</Text>
      </Screen>
    )
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-inspection-new">
      <Card>
        <View style={styles.stack}>
          <PickerField label="Template" required options={templateOptions} value={templateId} onChange={(v) => setTemplateId(v as string | null)} loading={templates.isPending} placeholder={templates.data && templates.data.length === 0 ? 'No active templates on this project' : 'Choose a checklist'} testID="inspection-template" />
          {template?.settings?.instructions ? <Text tone="muted">{template.settings.instructions}</Text> : null}
          <Input label="Title" placeholder={template?.name ?? 'Defaults to the template name'} value={title} onChangeText={setTitle} testID="inspection-title" />
          <PickerField label="Activity" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="inspection-activity" />
          <PickerField label="Location" options={places} value={locationId} onChange={(v) => setLocationId(v as string | null)} loading={locations.isPending} testID="inspection-location" />
          <PickerField label="Assigned to" options={people} value={assigneeId} onChange={(v) => setAssigneeId(v as string | null)} loading={team.isPending} testID="inspection-assignee" />
          <Input label="Due" placeholder="YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} autoCapitalize="none" error={dueDate && !isoDay.test(dueDate) ? 'Use the form YYYY-MM-DD' : undefined} testID="inspection-due" />
          <View style={styles.chips}>
            <FilterChip label="Start now" selected={startNow} onPress={() => setStartNow(true)} testID="inspection-start-now" />
            <FilterChip label="Schedule for later" selected={!startNow} onPress={() => setStartNow(false)} testID="inspection-schedule" />
          </View>
        </View>
      </Card>
      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="inspection-new-failure">
          {failure}
        </Text>
      ) : null}
      <Button title={startNow ? 'Start inspection' : 'Schedule inspection'} size="lg" fullWidth disabled={!ready} loading={actions.create.isPending} onPress={() => void create()} testID="inspection-create" />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
