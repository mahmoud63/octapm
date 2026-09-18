import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import type { Project } from '@/api/types'
import { Text, radius, spacing, tapTarget, useTheme } from '@/design-system'

/**
 * The project the person is working in, and the way to change it. Sits at
 * the top of every project-scoped screen so there is never any doubt which
 * project a record belongs to.
 */
export function ProjectSwitch({ project }: { project: Project | null | undefined }) {
  const theme = useTheme()
  const router = useRouter()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={project ? `Project ${project.name}. Switch project` : 'Choose a project'}
      onPress={() => router.push('/projects')}
      style={({ pressed }) => [styles.strip, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? 0.85 : 1 }]}
      testID="project-switch"
    >
      <View style={styles.text}>
        <Text variant="label" label tone="muted">
          Project
        </Text>
        <Text variant="heading" numberOfLines={1}>
          {project?.name ?? 'Choose a project'}
        </Text>
        {project?.contractNumber ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {project.contractNumber}
            {project.location ? ` · ${project.location}` : ''}
          </Text>
        ) : null}
      </View>
      <Ionicons name="swap-horizontal-outline" size={22} color={theme.colors.brand} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: tapTarget, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  text: { flex: 1, gap: 2 },
})
