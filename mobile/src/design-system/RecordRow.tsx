import { Pressable, StyleSheet, View } from 'react-native'
import { Badge, toneForStatus } from './Badge'
import { Text } from './Text'
import { useTheme } from './theme'
import { spacing, tapTarget } from './tokens'

export interface RecordRowProps {
  /** The record's own reference, as the product prints it: RFI-034, NCR-012. */
  reference: string
  title: string
  status?: string | null
  /** One line of context: project, due date, who holds it. */
  meta?: string
  /** A short trailing figure or word: "2d overdue", "£4,200". */
  trailing?: string
  trailingTone?: 'default' | 'muted' | 'error' | 'warning'
  selected?: boolean
  onPress?: () => void
}

/**
 * One record in a list, the same shape everywhere: reference, title, status,
 * one line of context. On a phone it is the whole unit of a register; on a
 * tablet it is the left pane of a master–detail view.
 */
export function RecordRow({ reference, title, status, meta, trailing, trailingTone = 'muted', selected, onPress }: RecordRowProps) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${reference}, ${title}${status ? `, ${status}` : ''}${meta ? `, ${meta}` : ''}`}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.colors.border, backgroundColor: selected ? theme.colors.infoSoft : pressed ? theme.colors.background : 'transparent' },
      ]}
    >
      <View style={styles.main}>
        <View style={styles.top}>
          <Text variant="caption" tone="brand" style={styles.reference}>
            {reference}
          </Text>
          {status ? <Badge label={status.replace(/_/g, ' ')} tone={toneForStatus(status)} /> : null}
        </View>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {meta ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text variant="caption" tone={trailingTone} style={styles.trailing}>
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: tapTarget + 16, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, gap: spacing.xxs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reference: { fontVariant: ['tabular-nums'] },
  trailing: { fontVariant: ['tabular-nums'] },
})
