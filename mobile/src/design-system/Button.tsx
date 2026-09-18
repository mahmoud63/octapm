import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native'
import { Text } from './Text'
import { useTheme } from './theme'
import { radius, spacing, tapTarget } from './tokens'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg'

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: React.ReactNode
  fullWidth?: boolean
  style?: ViewStyle
}

/**
 * A button says exactly what happens when it is pressed. It is never smaller
 * than a fingertip, and while it works it says so rather than going quiet.
 */
export function Button({ title, variant = 'primary', size = 'md', loading, icon, fullWidth, disabled, style, ...rest }: ButtonProps) {
  const theme = useTheme()
  const isDisabled = disabled || loading
  const background = {
    primary: theme.colors.brandStrong,
    secondary: theme.colors.surface,
    ghost: 'transparent',
    danger: theme.colors.error,
  }[variant]
  const foreground = variant === 'secondary' || variant === 'ghost' ? theme.colors.brandStrong : theme.colors.textOnBrand
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' && styles.large,
        {
          backgroundColor: background,
          borderColor: variant === 'secondary' ? theme.colors.border : background,
          opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text variant="bodyStrong" style={{ color: foreground }}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: tapTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  large: { minHeight: 52, paddingHorizontal: spacing.xl },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
