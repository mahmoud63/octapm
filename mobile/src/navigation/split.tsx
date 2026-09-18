import { usePathname } from 'expo-router'
import { createContext, useContext, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text, spacing, useTheme } from '@/design-system'
import { useLayout } from '@/hooks/useLayout'

/**
 * Master–detail for the expanded width class, done at the route group:
 * the section's list is drawn on the left, the group's stack on the
 * right. Rows push the record as they always did, so the record opens in
 * the right pane; back pops it to a placeholder; the list on the left
 * keeps its filters and its scroll; rotation keeps the person on the same
 * record because nothing but the width changed.
 *
 * A screen asks which side it is on: a list drawn by the stack while a
 * list is already on the left shows the placeholder instead of itself.
 */
export type SplitRole = 'master' | 'pane' | null

const SplitRoleContext = createContext<SplitRole>(null)

export const useSplitRole = (): SplitRole => useContext(SplitRoleContext)

export interface SplitSection {
  /** The route prefix this master serves; the longest match wins. */
  prefix: string
  master: () => ReactNode
}

export function SplitGroup({ sections, children }: { sections: SplitSection[]; children: ReactNode }) {
  const theme = useTheme()
  const { splitView } = useLayout()
  const pathname = usePathname()
  if (!splitView) return <>{children}</>
  const section = [...sections].sort((a, b) => b.prefix.length - a.prefix.length).find((s) => pathname === s.prefix || pathname.startsWith(`${s.prefix}/`) || pathname.startsWith(`${s.prefix}?`))
  if (!section) return <>{children}</>
  return (
    <View style={styles.row} testID="split-group">
      <View style={[styles.master, { borderColor: theme.colors.border }]} testID="split-master">
        <SplitRoleContext.Provider value="master">{section.master()}</SplitRoleContext.Provider>
      </View>
      <View style={styles.pane} testID="split-pane">
        <SplitRoleContext.Provider value="pane">{children}</SplitRoleContext.Provider>
      </View>
    </View>
  )
}

/** What the right pane shows while nothing is chosen. */
export function PanePlaceholder({ text = 'Choose a record on the left to open it here' }: { text?: string }) {
  const theme = useTheme()
  return (
    <View style={[styles.placeholder, { backgroundColor: theme.colors.background }]} testID="pane-placeholder">
      <Text tone="muted">{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  master: { width: 440, borderRightWidth: StyleSheet.hairlineWidth },
  pane: { flex: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
})
