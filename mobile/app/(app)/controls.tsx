import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { EmptyState, Text, spacing, tapTarget, useTheme } from '@/design-system'
import { resolveMore } from '@/navigation/roleNav'
import { useAuthStore } from '@/auth/store'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { useProjects } from '@/api/hooks'

const ICONS: Record<string, string> = {
  site: 'today-outline',
  activities: 'git-branch-outline',
  lookahead: 'calendar-outline',
  quality: 'checkbox-outline',
  rfi: 'help-circle-outline',
  tasks: 'checkmark-circle-outline',
  drawings: 'map-outline',
  documents: 'document-text-outline',
  photos: 'images-outline',
  inventory: 'file-tray-stacked-outline',
  procurement: 'receipt-outline',
  commercial: 'cash-outline',
  workflow: 'checkmark-done-outline',
  timesheets: 'time-outline',
  users: 'people-outline',
  notifications: 'notifications-outline',
  outbox: 'cloud-upload-outline',
  parties: 'business-outline',
}

/**
 * The project control centre: every module of this project the person may
 * open, in one compact directory.
 *
 * This is navigation, not a dashboard. The numbers live on Project and on
 * Home; this screen exists so that getting from "something is wrong" to the
 * right module takes one tap rather than a tour. What it lists comes from the
 * permission matrix, so it never offers a module the server would refuse.
 */
export default function ControlsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const role = useAuthStore((s) => s.user?.role ?? null)
  const isCompanyAdmin = useAuthStore((s) => s.user?.isCompanyAdmin ?? false)
  const permissions = usePermissions(projectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null

  // Controls is about this project; what belongs to the person lives in More.
  const groups = resolveMore({ role, matrix: permissions.matrix, isCompanyAdmin, hasProject: !!projectId }).filter((g) => g.title !== 'You')

  return (
    <Screen title="Controls" subtitle={project?.name} contentStyle={styles.content} testID="screen-controls">
      <ProjectSwitch project={project} />
      {groups.length === 0 ? (
        <EmptyState title="Choose a project first" body="The control centre lists the modules of one project." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      ) : (
        groups.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text variant="label" label tone="muted">
              {group.title}
            </Text>
            <View style={styles.grid}>
              {group.entries.map((entry) => (
                <Pressable
                  key={entry.id}
                  onPress={() => router.push(entry.route as never)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.tile, { borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface }]}
                  testID={`controls-${entry.id}`}
                >
                  <Ionicons name={(ICONS[entry.id] ?? 'ellipse-outline') as never} size={20} color={theme.colors.brandStrong} />
                  <Text numberOfLines={2}>{entry.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  group: { gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexGrow: 1, flexBasis: '30%', minHeight: tapTarget + 28, gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderRadius: 12 },
})
