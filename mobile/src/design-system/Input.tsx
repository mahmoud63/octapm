import { forwardRef } from 'react'
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native'
import { Text } from './Text'
import { useTheme } from './theme'
import { radius, spacing, tapTarget, type as typeScale } from './tokens'

export interface InputProps extends TextInputProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
}

/**
 * A labelled field. The label is always visible (a placeholder that vanishes
 * is not a label), a required field says so, and an error sits under the
 * field it belongs to in words, not just in red.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input({ label, error, hint, required, style, ...rest }, ref) {
  const theme = useTheme()
  return (
    <View style={styles.wrap}>
      <Text variant="caption" tone="muted" style={styles.label}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={theme.colors.textMuted}
        {...rest}
        style={[
          styles.input,
          typeScale.body,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.error : theme.colors.border,
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="caption" tone="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { marginLeft: spacing.xxs },
  input: {
    minHeight: tapTarget + 4,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
})
