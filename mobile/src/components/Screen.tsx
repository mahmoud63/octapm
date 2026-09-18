import { type ReactElement, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View, type RefreshControlProps, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text, spacing, useTheme } from '@/design-system'
import { useLayout } from '@/hooks/useLayout'

export interface ScreenProps {
  title?: string
  /** A line under the title: the project, a count, a date. */
  subtitle?: string
  /** Controls on the right of the title row. */
  actions?: ReactNode
  children: ReactNode
  /** Scrolls by default; a screen that owns a list turns this off and scrolls itself. */
  scroll?: boolean
  refreshControl?: ReactElement<RefreshControlProps>
  contentStyle?: ViewStyle
  testID?: string
}

/**
 * The frame every screen sits in: safe areas respected, a title that reads
 * as one, and content held to a comfortable measure on wide screens rather
 * than stretched edge to edge.
 */
export function Screen({ title, subtitle, actions, children, scroll = true, refreshControl, contentStyle, testID }: ScreenProps) {
  const insets = useSafeAreaInsets()
  const theme = useTheme()
  const { isExpanded } = useLayout()
  const header = title ? (
    <View style={styles.header}>
      <View style={styles.titles}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions}
    </View>
  ) : null

  const padding = { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg, paddingLeft: insets.left, paddingRight: insets.right }
  const measure = isExpanded ? styles.measure : null

  if (!scroll) {
    return (
      <View testID={testID} style={[styles.root, { backgroundColor: theme.colors.background }, padding]}>
        <View style={[styles.content, measure, contentStyle]}>
          {header}
          {children}
        </View>
      </View>
    )
  }
  return (
    <ScrollView testID={testID} style={[styles.root, { backgroundColor: theme.colors.background }]} contentContainerStyle={[padding]} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <View style={[styles.content, measure, contentStyle]}>
        {header}
        {children}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.lg },
  measure: { maxWidth: 1100, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  titles: { flex: 1, gap: spacing.xxs },
})
