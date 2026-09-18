import { useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useActivities, useLocations } from '@/api/record-hooks'
import { DELAY_TYPES, NOTE_KINDS, type DailyLogSection, type EntryInput } from '@/api/site-types'
import { FilterChip } from '@/components/FilterChip'
import { PickerField } from '@/components/PickerField'
import { Button, Input, Text, spacing, useTheme } from '@/design-system'
import { humanise } from '@/utilities/format'
import { newId } from '@/utilities/id'

interface FieldSpec {
  key: string
  label: string
  kind: 'text' | 'number' | 'time' | 'multiline'
  required?: boolean
  placeholder?: string
}

/** The fields each section of the daily log takes, as the API defines them. */
export const ENTRY_FIELDS: Record<DailyLogSection, FieldSpec[]> = {
  manpower: [
    { key: 'companyName', label: 'Company', kind: 'text', required: true },
    { key: 'trade', label: 'Trade', kind: 'text', placeholder: 'e.g. Steelfixers' },
    { key: 'workers', label: 'Workers', kind: 'number', required: true },
    { key: 'hours', label: 'Hours each', kind: 'number', required: true },
  ],
  equipment: [
    { key: 'name', label: 'Equipment', kind: 'text', required: true, placeholder: 'e.g. 50 t crawler crane' },
    { key: 'count', label: 'Count', kind: 'number' },
    { key: 'hoursOperated', label: 'Hours operated', kind: 'number' },
    { key: 'hoursIdle', label: 'Hours idle', kind: 'number' },
  ],
  deliveries: [
    { key: 'supplierName', label: 'Supplier', kind: 'text', required: true },
    { key: 'description', label: 'What was delivered', kind: 'text', required: true },
    { key: 'quantity', label: 'Quantity', kind: 'number' },
    { key: 'unit', label: 'Unit', kind: 'text', placeholder: 'm3, t, pcs' },
    { key: 'poRef', label: 'PO reference', kind: 'text' },
    { key: 'receivedBy', label: 'Received by', kind: 'text' },
    { key: 'deliveredAt', label: 'Delivered at', kind: 'time', placeholder: 'HH:MM' },
  ],
  visitors: [
    { key: 'company', label: 'Company or person', kind: 'text', required: true },
    { key: 'purpose', label: 'Purpose', kind: 'text' },
    { key: 'arrivedAt', label: 'Arrived', kind: 'time', placeholder: 'HH:MM' },
    { key: 'leftAt', label: 'Left', kind: 'time', placeholder: 'HH:MM' },
  ],
  delays: [{ key: 'hoursLost', label: 'Hours lost', kind: 'number', required: true }],
  notes: [{ key: 'text', label: 'Note', kind: 'multiline', required: true }],
}

const CHOICE_FIELDS: Partial<Record<DailyLogSection, { key: string; label: string; options: readonly string[] }>> = {
  delays: { key: 'type', label: 'Type of delay', options: DELAY_TYPES },
  notes: { key: 'kind', label: 'Kind', options: NOTE_KINDS },
}

const LINKS: Record<DailyLogSection, { activity: boolean; location: boolean }> = {
  manpower: { activity: true, location: true },
  equipment: { activity: true, location: false },
  deliveries: { activity: true, location: true },
  visitors: { activity: false, location: false },
  delays: { activity: true, location: false },
  notes: { activity: true, location: true },
}

/**
 * One entry for one section of the day, with the fields that section takes,
 * the activity and location links where they make sense, and a replay key
 * so a retried save cannot double the entry.
 */
export function DailyLogEntrySheet({ visible, projectId, section, busy, error, onCancel, onSave }: { visible: boolean; projectId: string; section: DailyLogSection; busy?: boolean; error?: string | null; onCancel: () => void; onSave: (body: EntryInput) => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const activities = useActivities(projectId)
  const locations = useLocations(projectId)
  const [values, setValues] = useState<Record<string, string>>({})
  const [choice, setChoice] = useState<string | null>(null)
  const [activityId, setActivityId] = useState<string | null>(null)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (visible) {
      setValues({})
      setChoice(null)
      setActivityId(null)
      setLocationId(null)
      setNotes('')
    }
  }, [visible, section])

  const fields = ENTRY_FIELDS[section]
  const choiceField = CHOICE_FIELDS[section]
  const links = LINKS[section]
  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])
  const places = useMemo(() => (locations.data ?? []).map((l) => ({ id: l.id, label: l.fullName || l.name, sublabel: l.code })), [locations.data])

  const missing = fields.filter((f) => f.required && !values[f.key]?.trim()).map((f) => f.label)
  const missingChoice = choiceField && !choice ? [choiceField.label] : []
  const ready = missing.length === 0 && missingChoice.length === 0

  const save = () => {
    const body: EntryInput = { clientRequestId: newId() }
    for (const f of fields) {
      const raw = values[f.key]?.trim()
      if (!raw) continue
      body[f.key] = f.kind === 'number' ? Number(raw) : raw
    }
    if (choiceField && choice) body[choiceField.key] = choice
    if (links.activity && activityId) body.activityId = activityId
    if (links.location && locationId) body.locationId = locationId
    if (notes.trim()) body.notes = notes.trim()
    onSave(body)
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="pageSheet">
      <View style={[styles.sheet, { backgroundColor: theme.colors.background, paddingTop: insets.top + spacing.md }]} testID={`entry-sheet-${section}`}>
        <View style={styles.header}>
          <Text variant="title" style={styles.grow}>
            Add {section === 'manpower' ? 'manpower' : section === 'notes' ? 'a note' : section === 'delays' ? 'a delay' : `${section.slice(0, -1)}`}
          </Text>
          <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} testID="entry-cancel" />
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          {choiceField ? (
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                {choiceField.label} *
              </Text>
              <View style={styles.chips}>
                {choiceField.options.map((o) => (
                  <FilterChip key={o} label={humanise(o)} selected={choice === o} onPress={() => setChoice(o)} testID={`entry-choice-${o}`} />
                ))}
              </View>
            </View>
          ) : null}
          {fields.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              required={f.required}
              placeholder={f.placeholder}
              value={values[f.key] ?? ''}
              onChangeText={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              keyboardType={f.kind === 'number' ? 'decimal-pad' : 'default'}
              multiline={f.kind === 'multiline'}
              autoCapitalize={f.kind === 'text' || f.kind === 'multiline' ? 'sentences' : 'none'}
              testID={`entry-${f.key}`}
            />
          ))}
          {links.activity ? <PickerField label="Activity" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="entry-activity" /> : null}
          {links.location ? <PickerField label="Location" options={places} value={locationId} onChange={(v) => setLocationId(v as string | null)} loading={locations.isPending} testID="entry-location" /> : null}
          {section !== 'notes' ? <Input label="Notes" value={notes} onChangeText={setNotes} multiline testID="entry-notes" /> : null}
          {!ready ? (
            <Text variant="caption" tone="muted">
              Still needed: {[...missingChoice, ...missing].join(', ')}
            </Text>
          ) : null}
          {error ? (
            <Text variant="caption" tone="error" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button title="Save entry" size="lg" fullWidth disabled={!ready} loading={busy} onPress={save} testID="entry-save" />
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md },
  grow: { flex: 1 },
  body: { gap: spacing.md },
  stack: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
