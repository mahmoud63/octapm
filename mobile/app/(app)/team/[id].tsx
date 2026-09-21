import { useLocalSearchParams, useRouter } from 'expo-router'
import { Linking, StyleSheet, View } from 'react-native'
import { useTeam } from '@/api/record-hooks'
import { Screen } from '@/components/Screen'
import { Button, Card, ErrorState, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

/**
 * One person on the project.
 *
 * What this can honestly show is what the platform holds about them: their
 * name, their company, the role they were given here and the one they hold in
 * their own organisation, and an email address. There is no telephone number
 * anywhere in the model, so there is no Call button — an empty one would be
 * worse than none on a site where reaching someone matters.
 */
export default function ContactScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const team = useTeam(projectId)
  const member = team.data?.find((m) => m.userId === id) ?? null

  if (team.isPending) {
    return (
      <Screen title="Contact" testID="screen-contact">
        <SkeletonList rows={3} />
      </Screen>
    )
  }
  if (!member) {
    return (
      <Screen title="Contact" testID="screen-contact">
        <ErrorState message="That person is not on this project's team." onRetry={() => router.replace('/team')} />
      </Screen>
    )
  }

  const facts: { label: string; value: string }[] = [
    { label: 'On this project', value: humanise(member.assignmentRole ?? 'member') },
    ...(member.orgRole ? [{ label: 'In their company', value: humanise(member.orgRole) }] : []),
    ...(member.party?.name ? [{ label: 'Company', value: member.party.name }] : []),
    ...(member.email ? [{ label: 'Email', value: member.email }] : []),
    ...(member.status !== 'active' ? [{ label: 'Status', value: humanise(member.status) }] : []),
  ]

  return (
    <Screen title={member.name} subtitle={member.party?.name ?? undefined} contentStyle={styles.content} testID="screen-contact">
      <Card testID="contact-facts">
        <View style={styles.stack}>
          {facts.map((fact) => (
            <View key={fact.label} style={styles.row} testID={`contact-${fact.label.toLowerCase().replace(/\s+/g, '-')}`}>
              <Text tone="muted" style={styles.grow}>
                {fact.label}
              </Text>
              <Text>{fact.value}</Text>
            </View>
          ))}
        </View>
      </Card>

      {member.email ? (
        <Button title="Send an email" onPress={() => void Linking.openURL(`mailto:${member.email}`)} testID="contact-email" />
      ) : (
        <Text tone="muted">No email address is recorded for them.</Text>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
})
