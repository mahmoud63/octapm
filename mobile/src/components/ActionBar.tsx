import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, spacing, useTheme } from '@/design-system'

export interface RecordAction {
  id: string
  title: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  onPress: () => void
  busy?: boolean
}

/**
 * The actions a person may take on a record right now, along the bottom
 * where a thumb reaches. Only actions the server allows for this person and
 * this state are passed in; an empty list renders nothing.
 */
export function ActionBar({ actions }: { actions: RecordAction[] }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  if (actions.length === 0) return null
  return (
    <View style={[styles.bar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, paddingBottom: insets.bottom + spacing.sm }]} testID="action-bar">
      {actions.map((action) => (
        <Button key={action.id} title={action.title} variant={action.variant ?? 'secondary'} onPress={action.onPress} loading={action.busy} style={styles.button} testID={`action-${action.id}`} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1 },
  button: { flexGrow: 1, minWidth: 140 },
})
