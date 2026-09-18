import { Text as NativeText, type TextProps as NativeTextProps, type TextStyle } from 'react-native'
import { useTheme } from './theme'
import { type as typeScale } from './tokens'

type Variant = keyof typeof typeScale
type Tone = 'default' | 'muted' | 'brand' | 'onBrand' | 'success' | 'warning' | 'error' | 'link'

export interface TextProps extends NativeTextProps {
  variant?: Variant
  tone?: Tone
  align?: TextStyle['textAlign']
  /** Uppercase with letter-spacing, for section labels. */
  label?: boolean
}

/**
 * Every piece of type in the app.
 *
 * Sizes come from the scale and respect the person's dynamic type setting up
 * to a ceiling, so a large setting enlarges body copy without turning a KPI
 * into a wall.
 */
export function Text({ variant = 'body', tone = 'default', align, label, style, ...rest }: TextProps) {
  const theme = useTheme()
  const color = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    brand: theme.colors.brand,
    onBrand: theme.colors.textOnBrand,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
    link: theme.colors.link,
  }[tone]
  const scale = typeScale[label ? 'label' : variant]
  return (
    <NativeText
      maxFontSizeMultiplier={variant === 'kpi' || variant === 'display' ? 1.2 : 1.6}
      {...rest}
      style={[
        { color, textAlign: align },
        scale,
        label ? { textTransform: 'uppercase' } : null,
        style,
      ]}
    />
  )
}
