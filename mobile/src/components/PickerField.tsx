import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Input, Text, radius, spacing, tapTarget, useTheme } from '@/design-system'
import { listPerformance } from '@/components/listProps'

export interface PickerOption {
  id: string
  label: string
  sublabel?: string | null
}

interface Props {
  label: string
  placeholder?: string
  options: PickerOption[]
  value: string[] | string | null
  onChange: (value: string[] | string | null) => void
  multiple?: boolean
  required?: boolean
  loading?: boolean
  error?: string
  testID?: string
}

/**
 * A field that opens a searchable list. One tap to open, one tap to choose;
 * a multi-select keeps the list open and shows the count. The list is the
 * same on a phone and a tablet, so a person always knows where the choice is.
 */
export function PickerField({ label, placeholder = 'Choose', options, value, onChange, multiple, required, loading, error, testID }: Props) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')

  const selected = useMemo(() => (Array.isArray(value) ? value : value ? [value] : []), [value])
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])
  const summary = selected.length === 0 ? null : selected.length === 1 ? (byId.get(selected[0]!)?.label ?? '1 chosen') : `${selected.length} chosen`
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q)) : options
  }, [options, term])

  const toggle = (id: string) => {
    if (multiple) {
      const next = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]
      onChange(next)
    } else {
      onChange(selected[0] === id ? null : id)
      setOpen(false)
    }
  }

  return (
    <View style={styles.wrap}>
      <Text variant="label" label tone="muted">
        {label}
        {required ? ' *' : ''}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${summary ?? placeholder}`}
        onPress={() => setOpen(true)}
        style={[styles.field, { backgroundColor: theme.colors.surface, borderColor: error ? theme.colors.error : theme.colors.border }]}
        testID={testID}
      >
        <Text tone={summary ? 'default' : 'muted'} numberOfLines={1} style={styles.grow}>
          {loading ? 'Loading…' : (summary ?? placeholder)}
        </Text>
        <Ionicons name="chevron-down" size={18} color={theme.colors.textMuted} />
      </Pressable>
      {error ? (
        <Text variant="caption" tone="error">
          {error}
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)} presentationStyle="pageSheet">
        <View style={[styles.sheet, { backgroundColor: theme.colors.background, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]} testID={testID ? `${testID}-sheet` : undefined}>
          <View style={styles.sheetHeader}>
            <Text variant="title" style={styles.grow}>
              {label}
            </Text>
            <Button title="Done" variant="ghost" onPress={() => setOpen(false)} testID={testID ? `${testID}-done` : undefined} />
          </View>
          <Input label="Find" placeholder="Type to narrow the list" value={term} onChangeText={setTerm} autoCapitalize="none" autoCorrect={false} testID={testID ? `${testID}-search` : undefined} />
          <FlatList {...listPerformance}
            data={filtered}
            keyExtractor={(o) => o.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const on = selected.includes(item.id)
              return (
                <Pressable
                  accessibilityRole={multiple ? 'checkbox' : 'radio'}
                  accessibilityState={{ checked: on }}
                  onPress={() => toggle(item.id)}
                  style={({ pressed }) => [styles.option, { borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface }]}
                  testID={testID ? `${testID}-option-${item.id}` : undefined}
                >
                  <View style={styles.grow}>
                    <Text>{item.label}</Text>
                    {item.sublabel ? (
                      <Text variant="caption" tone="muted">
                        {item.sublabel}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? theme.colors.brand : theme.colors.textMuted} />
                </Pressable>
              )
            }}
            ListEmptyComponent={
              <Text tone="muted" style={styles.empty}>
                {options.length === 0 ? 'Nothing to choose from yet.' : 'No match.'}
              </Text>
            }
            contentContainerStyle={styles.list}
          />
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  grow: { flex: 1 },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: tapTarget, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  sheet: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: tapTarget, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  empty: { padding: spacing.lg, textAlign: 'center' },
})
