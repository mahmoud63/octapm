import { Pressable, StyleSheet } from 'react-native'
import { Text, radius, spacing, useTheme } from '@/design-system'

/**
 * A pill that narrows a list. Selected chips are filled with the brand
 * colour; a count, when given, sits after the label in tabular figures.
 */
export function FilterChip({ label, count, selected, onPress, testID }: { label: string; count?: number; selected: boolean; onPress: () => void; testID?: string }) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      aria-selected={selected}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? theme.colors.brand : theme.colors.surface, borderColor: selected ? theme.colors.brand : theme.colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
      testID={testID}
    >
      <Text variant="caption" style={{ color: selected ? theme.colors.textOnBrand : theme.colors.text }}>
        {label}
        {count != null ? ` ${count}` : ''}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
})
