import { StyleSheet, View } from 'react-native'
import { useAuthStore } from '@/auth/store'
import { Screen } from '@/components/Screen'
import { Card, EmptyState, Text, spacing } from '@/design-system'
import { roleLabel } from '@/permissions/policy'

/**
 * Home. The field control centre: what needs you, what is happening on site,
 * what you can do right now. The full board arrives with the Home milestone;
 * this is the shell it sits in.
 */
export default function HomeScreen() {
  const user = useAuthStore((s) => s.user)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] ?? ''

  return (
    <Screen title={`${greeting}${firstName ? `, ${firstName}` : ''}`} subtitle={roleLabel(user?.role)} testID="screen-home">
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Needs You
          </Text>
          <EmptyState title="Nothing is waiting on you right now" body="When a record needs your answer, approval or action, it appears here first." style={styles.empty} />
        </View>
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  empty: { paddingVertical: spacing.md },
})
