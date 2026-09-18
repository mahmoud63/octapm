import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useChangeEventActions } from '@/api/commercial-hooks'
import { CHANGE_EVENT_ORIGINS, CHANGE_EVENT_TYPES } from '@/api/commercial-types'
import { userMessage } from '@/api/errors'
import { useActivities, useLocations } from '@/api/record-hooks'
import { FilterChip } from '@/components/FilterChip'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

const decimal = /^\d+(\.\d+)?$/
const integer = /^\d+$/

/**
 * Raise a change event from the field: what changed, what kind, where it
 * came from, a rough order of magnitude and the days it may cost. Pricing,
 * quotes and conversion follow on the web.
 */
export default function NewChangeEventScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ activityId?: string; locationId?: string; origin?: string; sourceRecordType?: string; sourceRecordId?: string; title?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const activities = useActivities(projectId)
  const locations = useLocations(projectId)
  const actions = useChangeEventActions(projectId ?? '')
  const [title, setTitle] = useState(params.title ?? '')
  const [type, setType] = useState<string>('site_condition')
  const [origin, setOrigin] = useState<string>(params.origin && (CHANGE_EVENT_ORIGINS as readonly string[]).includes(params.origin) ? params.origin : 'manual')
  const [description, setDescription] = useState('')
  const [activityId, setActivityId] = useState<string | null>(params.activityId ?? null)
  const [locationId, setLocationId] = useState<string | null>(params.locationId ?? null)
  const [rom, setRom] = useState('')
  const [days, setDays] = useState('')
  const [ownerChange, setOwnerChange] = useState(false)
  const [notes, setNotes] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])
  const places = useMemo(() => (locations.data ?? []).map((l) => ({ id: l.id, label: l.fullName || l.name, sublabel: l.code })), [locations.data])
  const ready = title.trim().length >= 3 && (!rom || decimal.test(rom)) && (!days || integer.test(days))

  const save = async () => {
    if (!projectId) return
    setFailure(null)
    try {
      const created = await actions.create.mutateAsync({
        title: title.trim(),
        type,
        origin,
        description: description.trim() || undefined,
        activityId: activityId ?? undefined,
        locationId: locationId ?? undefined,
        romAmount: rom ? Number(rom) : undefined,
        scheduleImpactDays: days ? Number(days) : undefined,
        ownerChange,
        notes: notes.trim() || undefined,
        ...(params.sourceRecordType && params.sourceRecordId ? { sourceRecordType: params.sourceRecordType, sourceRecordId: params.sourceRecordId } : {}),
      })
      router.replace(`/commercial/change-events/${created.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  if (!projectId) {
    return (
      <Screen testID="screen-change-event-new">
        <Text tone="muted">Choose a project first.</Text>
      </Screen>
    )
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-change-event-new">
      <Card>
        <View style={styles.stack}>
          <Input label="What changed" required value={title} onChangeText={setTitle} placeholder="One line, plain words" testID="change-event-title" />
          <Text variant="label" label tone="muted">
            Kind
          </Text>
          <View style={styles.chips}>
            {CHANGE_EVENT_TYPES.map((t) => (
              <FilterChip key={t} label={humanise(t)} selected={type === t} onPress={() => setType(t)} testID={`change-event-type-${t}`} />
            ))}
          </View>
          <Text variant="label" label tone="muted">
            Came from
          </Text>
          <View style={styles.chips}>
            {CHANGE_EVENT_ORIGINS.map((o) => (
              <FilterChip key={o} label={humanise(o)} selected={origin === o} onPress={() => setOrigin(o)} testID={`change-event-origin-${o}`} />
            ))}
          </View>
          <Input label="Description" value={description} onChangeText={setDescription} multiline placeholder="What was found, what it affects, what is proposed" testID="change-event-description" />
          <PickerField label="Activity" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="change-event-activity" />
          <PickerField label="Location" options={places} value={locationId} onChange={(v) => setLocationId(v as string | null)} loading={locations.isPending} testID="change-event-location" />
          <Input label="Rough order of magnitude" value={rom} onChangeText={setRom} keyboardType="decimal-pad" placeholder="0" error={rom && !decimal.test(rom) ? 'Enter a number' : undefined} testID="change-event-rom" />
          <Input label="Schedule impact (days)" value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="0" error={days && !integer.test(days) ? 'Whole days' : undefined} testID="change-event-days" />
          <FilterChip label={ownerChange ? '☑  Owner-directed change' : '☐  Owner-directed change'} selected={ownerChange} onPress={() => setOwnerChange(!ownerChange)} testID="change-event-owner" />
          <Input label="Notes" value={notes} onChangeText={setNotes} multiline testID="change-event-notes" />
        </View>
      </Card>
      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="change-event-new-failure">
          {failure}
        </Text>
      ) : null}
      <Button title="Raise change event" size="lg" fullWidth disabled={!ready} loading={actions.create.isPending} onPress={() => void save()} testID="change-event-raise" />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
