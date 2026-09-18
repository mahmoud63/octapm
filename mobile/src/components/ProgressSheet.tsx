import { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ProgressInput, ProgressMethod } from '@/api/site-types'
import { FilterChip } from '@/components/FilterChip'
import { Button, Input, Text, spacing, useTheme } from '@/design-system'

const QUICK = [25, 50, 75, 100]

/**
 * A progress update the way the activity's method wants it: a percentage,
 * a quantity against the plan, milestones ticked, or an inspection result.
 * It is submitted for approval; nothing here changes the approved figure.
 */
export function ProgressSheet({ visible, method, approvedPct, busy, error, onCancel, onSubmit }: { visible: boolean; method: ProgressMethod | null; approvedPct: number | null; busy?: boolean; error?: string | null; onCancel: () => void; onSubmit: (body: ProgressInput) => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const kind = method?.method ?? 'percent'
  const [pct, setPct] = useState('')
  const [quantity, setQuantity] = useState('')
  const [done, setDone] = useState<Set<string>>(new Set())
  const [inspection, setInspection] = useState<'passed' | 'failed' | 'pending' | null>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (visible) {
      setPct(approvedPct != null ? String(Math.round(approvedPct)) : '')
      setQuantity('')
      setDone(new Set())
      setInspection(null)
      setNotes('')
    }
  }, [visible, approvedPct])

  const pctNumber = Number(pct)
  const quantityNumber = Number(quantity)
  const planned = method?.plannedQuantity ?? null
  const derivedPct = kind === 'quantity' && planned ? Math.min(100, Math.round((quantityNumber / planned) * 100)) : null
  const ready =
    kind === 'quantity' ? quantity.trim() !== '' && !Number.isNaN(quantityNumber) && quantityNumber >= 0 : kind === 'weighted_milestone' ? true : kind === 'inspection' ? inspection !== null : pct.trim() !== '' && !Number.isNaN(pctNumber) && pctNumber >= 0 && pctNumber <= 100

  const build = (status: 'draft' | 'submitted'): ProgressInput => {
    const base: ProgressInput = { status, source: 'mobile', progressMethod: kind, notes: notes.trim() || undefined }
    if (kind === 'quantity') return { ...base, quantityComplete: quantityNumber, quantityPlanned: planned ?? undefined, quantityUnit: method?.quantityUnit ?? undefined }
    if (kind === 'weighted_milestone') return { ...base, milestones: (method?.milestoneWeights ?? []).map((m) => ({ id: m.id, complete: done.has(m.id) })) }
    if (kind === 'inspection') return { ...base, inspectionStatus: inspection ?? 'pending' }
    return { ...base, pctComplete: pctNumber }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="pageSheet">
      <View style={[styles.sheet, { backgroundColor: theme.colors.background, paddingTop: insets.top + spacing.md }]} testID="progress-sheet">
        <View style={styles.header}>
          <Text variant="title" style={styles.grow}>
            Update progress
          </Text>
          <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          <Text tone="muted">
            {kind === 'quantity'
              ? `Measured by quantity${planned != null ? ` against ${planned} ${method?.quantityUnit ?? ''} planned` : ''}.`
              : kind === 'weighted_milestone'
                ? 'Measured by weighted milestones. Tick what is complete.'
                : kind === 'inspection'
                  ? 'Measured by inspection: passed counts as complete.'
                  : `Approved so far: ${approvedPct != null ? `${Math.round(approvedPct)}%` : 'nothing yet'}.`}
          </Text>

          {kind === 'quantity' ? (
            <>
              <Input label={`Quantity complete${method?.quantityUnit ? ` (${method.quantityUnit})` : ''}`} required value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" testID="progress-quantity" />
              {derivedPct != null ? <Text variant="caption" tone="muted">{`That is ${derivedPct}% of the plan.`}</Text> : null}
            </>
          ) : kind === 'weighted_milestone' ? (
            <View style={styles.chips}>
              {(method?.milestoneWeights ?? []).map((m) => (
                <FilterChip key={m.id} label={`${m.name} (${m.weight}%)`} selected={done.has(m.id)} onPress={() => setDone((prev) => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next })} testID={`progress-milestone-${m.id}`} />
              ))}
            </View>
          ) : kind === 'inspection' ? (
            <View style={styles.chips}>
              {(['passed', 'failed', 'pending'] as const).map((s) => (
                <FilterChip key={s} label={s[0]!.toUpperCase() + s.slice(1)} selected={inspection === s} onPress={() => setInspection(s)} testID={`progress-inspection-${s}`} />
              ))}
            </View>
          ) : (
            <>
              <View style={styles.chips}>
                {QUICK.map((q) => (
                  <FilterChip key={q} label={`${q}%`} selected={pct === String(q)} onPress={() => setPct(String(q))} testID={`progress-quick-${q}`} />
                ))}
              </View>
              <Input label="Percent complete" required value={pct} onChangeText={setPct} keyboardType="number-pad" placeholder="0–100" testID="progress-pct" />
            </>
          )}

          <Input label="Field note" value={notes} onChangeText={setNotes} multiline placeholder="What was done, what is blocking" testID="progress-notes" />
          {method?.evidenceRequired ? (
            <Text variant="caption" tone="warning">
              This activity needs evidence: add photos to it before the update can be approved.
            </Text>
          ) : null}
          {method?.inspectionRequired && kind !== 'inspection' ? (
            <Text variant="caption" tone="warning">
              An inspection is required before this progress can be approved.
            </Text>
          ) : null}
          {error ? (
            <Text variant="caption" tone="error" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button title="Submit for approval" size="lg" fullWidth disabled={!ready} loading={busy} onPress={() => onSubmit(build('submitted'))} testID="progress-submit" />
          <Button title="Save as draft" variant="secondary" fullWidth disabled={!ready || busy} onPress={() => onSubmit(build('draft'))} testID="progress-draft" />
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
