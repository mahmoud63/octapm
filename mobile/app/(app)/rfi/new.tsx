import { zodResolver } from '@hookform/resolvers/zod'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { ScrollView, StyleSheet, View } from 'react-native'
import { z } from 'zod'
import { userMessage } from '@/api/errors'
import { useActivities, useLocations, useRfiActions, useTeam } from '@/api/record-hooks'
import { DISCIPLINES, RFI_PRIORITIES, type RfiCreate, type RfiPriority } from '@/api/record-types'
import { useAuthStore } from '@/auth/store'
import { FilterChip } from '@/components/FilterChip'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

const isoDay = /^\d{4}-\d{2}-\d{2}$/
const schema = z.object({
  subject: z.string().trim().min(3, 'Give the RFI a subject').max(200),
  question: z.string().trim().max(20000).optional(),
  specSection: z.string().trim().max(80).optional(),
  responseRequiredBy: z.string().trim().optional().refine((v) => !v || isoDay.test(v), 'Use the form YYYY-MM-DD'),
  costImpactAmount: z.string().trim().optional().refine((v) => !v || !Number.isNaN(Number(v)), 'Enter a number'),
  scheduleImpact: z.string().trim().optional().refine((v) => !v || /^\d+$/.test(v), 'Enter whole days'),
})
type Form = z.infer<typeof schema>

/**
 * Raise an RFI from the field. The project, the person and today are already
 * known; the person supplies what the office cannot: the subject, the
 * question, who should answer, where and against which activity. A draft
 * can be saved and submitted later.
 */
export default function NewRfiScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ activityId?: string; locationId?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const me = useAuthStore((s) => s.user)
  const team = useTeam(projectId)
  const locations = useLocations(projectId)
  const activities = useActivities(projectId)
  const actions = useRfiActions(projectId ?? '')

  const [priority, setPriority] = useState<RfiPriority>('normal')
  const [discipline, setDiscipline] = useState<string | null>(null)
  const [managerId, setManagerId] = useState<string | null>(me?.id ?? null)
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [distributionIds, setDistributionIds] = useState<string[]>([])
  const [locationId, setLocationId] = useState<string | null>(params.locationId ?? null)
  const [activityId, setActivityId] = useState<string | null>(params.activityId ?? null)
  const [costImpact, setCostImpact] = useState(false)
  const [scheduleImpactFlag, setScheduleImpactFlag] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const { control, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { subject: '', question: '', specSection: '', responseRequiredBy: '', costImpactAmount: '', scheduleImpact: '' } })

  const people = useMemo(() => (team.data ?? []).map((m) => ({ id: m.userId, label: m.name, sublabel: humanise(m.assignmentRole ?? m.orgRole) })), [team.data])
  const places = useMemo(() => (locations.data ?? []).map((l) => ({ id: l.id, label: l.fullName || l.name, sublabel: l.code })), [locations.data])
  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])

  const save = (status: 'open' | 'draft') =>
    handleSubmit(async (values) => {
      if (!projectId) return
      setFailure(null)
      const body: RfiCreate = {
        subject: values.subject,
        question: values.question || undefined,
        priority,
        status,
        discipline: discipline ?? undefined,
        specSection: values.specSection || undefined,
        managerUserId: managerId ?? undefined,
        assigneeUserIds: assigneeIds.length ? assigneeIds : undefined,
        distributionUserIds: distributionIds.length ? distributionIds : undefined,
        locationId: locationId ?? undefined,
        activityId: activityId ?? undefined,
        responseRequiredBy: values.responseRequiredBy || undefined,
        costImpact: costImpact || undefined,
        costImpactAmount: costImpact && values.costImpactAmount ? Number(values.costImpactAmount) : undefined,
        scheduleImpactFlag: scheduleImpactFlag || undefined,
        scheduleImpact: scheduleImpactFlag && values.scheduleImpact ? Number(values.scheduleImpact) : undefined,
      }
      try {
        const created = await actions.create.mutateAsync(body)
        router.replace(`/rfi/${created.id}`)
      } catch (error) {
        setFailure(userMessage(error))
      }
    })()

  if (!projectId) {
    return (
      <Screen testID="screen-rfi-new">
        <Text tone="muted">Choose a project first.</Text>
      </Screen>
    )
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-rfi-new">
      <Card>
        <View style={styles.stack}>
          <Controller control={control} name="subject" render={({ field, fieldState }) => <Input label="Subject" required value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} placeholder="What needs an answer?" testID="rfi-subject" />} />
          <Controller control={control} name="question" render={({ field, fieldState }) => <Input label="Question" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} placeholder="Describe the issue, the drawing and the grid" multiline testID="rfi-question" />} />
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Priority
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {RFI_PRIORITIES.map((p) => (
                <FilterChip key={p} label={humanise(p)} selected={priority === p} onPress={() => setPriority(p)} testID={`rfi-priority-${p}`} />
              ))}
            </ScrollView>
          </View>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Discipline
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {DISCIPLINES.map((d) => (
                <FilterChip key={d} label={humanise(d)} selected={discipline === d} onPress={() => setDiscipline(discipline === d ? null : d)} testID={`rfi-discipline-${d}`} />
              ))}
            </ScrollView>
          </View>
        </View>
      </Card>

      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            People
          </Text>
          <PickerField label="Manager" options={people} value={managerId} onChange={(v) => setManagerId(v as string | null)} loading={team.isPending} testID="rfi-manager" />
          <PickerField label="Assigned to" placeholder="Who should answer" options={people} value={assigneeIds} onChange={(v) => setAssigneeIds(v as string[])} multiple loading={team.isPending} testID="rfi-assignees" />
          <PickerField label="Distribution" placeholder="Who should know" options={people} value={distributionIds} onChange={(v) => setDistributionIds(v as string[])} multiple loading={team.isPending} testID="rfi-distribution" />
        </View>
      </Card>

      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Where and what
          </Text>
          <PickerField label="Location" options={places} value={locationId} onChange={(v) => setLocationId(v as string | null)} loading={locations.isPending} testID="rfi-location" />
          <PickerField label="Activity" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="rfi-activity" />
          <Controller control={control} name="specSection" render={({ field, fieldState }) => <Input label="Spec section" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} placeholder="e.g. 03 30 00" testID="rfi-spec" />} />
          <Controller control={control} name="responseRequiredBy" render={({ field, fieldState }) => <Input label="Response required by" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} placeholder="YYYY-MM-DD" autoCapitalize="none" testID="rfi-due" />} />
        </View>
      </Card>

      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Impact
          </Text>
          <View style={styles.chips}>
            <FilterChip label="Cost impact" selected={costImpact} onPress={() => setCostImpact((v) => !v)} testID="rfi-cost-impact" />
            <FilterChip label="Schedule impact" selected={scheduleImpactFlag} onPress={() => setScheduleImpactFlag((v) => !v)} testID="rfi-schedule-impact" />
          </View>
          {costImpact ? <Controller control={control} name="costImpactAmount" render={({ field, fieldState }) => <Input label="Estimated cost" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} keyboardType="decimal-pad" placeholder="0" testID="rfi-cost-amount" />} /> : null}
          {scheduleImpactFlag ? <Controller control={control} name="scheduleImpact" render={({ field, fieldState }) => <Input label="Schedule impact (days)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} keyboardType="number-pad" placeholder="0" testID="rfi-schedule-days" />} /> : null}
        </View>
      </Card>

      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="rfi-new-failure">
          {failure}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button title="Raise RFI" size="lg" fullWidth loading={formState.isSubmitting || actions.create.isPending} onPress={() => void save('open')} testID="rfi-raise" />
        <Button title="Save as draft" variant="secondary" fullWidth disabled={formState.isSubmitting || actions.create.isPending} onPress={() => void save('draft')} testID="rfi-draft" />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.md },
  chips: { flexDirection: 'row', gap: spacing.sm },
  actions: { gap: spacing.sm },
})
