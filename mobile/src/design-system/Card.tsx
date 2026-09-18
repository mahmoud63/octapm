import { Pressable, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native'
import { useTheme } from './theme'
import { radius, spacing } from './tokens'

export interface CardProps extends ViewProps {
  onPress?: () => void
  padded?: boolean
  /** A strip of colour on the leading edge, for state. Always pair with a word. */
  edge?: string
  style?: ViewStyle
}

export function Card({ onPress, padded = true, edge, style, children, ...rest }: CardProps) {
  const theme = useTheme()
  const body = (
    <View
      {...rest}
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        edge ? { borderLeftWidth: 4, borderLeftColor: edge } : null,
        padded && styles.padded,
        style,
      ]}
    >
      {children}
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  padded: { padding: spacing.lg },
})
