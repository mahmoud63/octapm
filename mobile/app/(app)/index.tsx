import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useAuthStore } from '@/auth/store'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Button, Card, EmptyState, ErrorState, RecordRow, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { QualityHome, SiteEngineerHome, WarehouseHome } from '@/home/FieldHomes'
import { GeneralHome } from '@/home/GeneralHome'
import { PmHome } from '@/home/PmHome'
import { resolveCaptureActions } from '@/navigation/roleNav'
import { useOutboxStatus } from '@/offline/useOutboxStatus'
import { roleLabel } from '@/permissions/policy'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'

/**
 * Home, shaped by the job.
 *
 * A project manager opens on what needs deciding and where the project
 * stands; a site engineer on today's work with a camera to hand; a
 * storekeeper on what is arriving. They are different presentations of the
 * same canonical records — there is no role-specific data anywhere — and
 * what each person may actually do is still decided by the permission matrix
 * the server sends, never by the role.
 *
 * What used to be here, a wall of thirteen identical module buttons, has
 * moved to Controls and More where navigation belongs.
 */
export default function HomeScreen() {
  const router = useRouter()
  const theme = useTheme()
  const user = useAuthStore((s) => s.user)
  const projectId = useProjectStore((s) => s.currentProjectId)
  const hydrated = useProjectStore((s) => s.hydrated)
  const select = useProjectStore((s) => s.select)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const outbox = useOutboxStatus(projectId)
  const [refreshing, setRefreshing] = useState(false)

  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const role = user?.role ?? null
  const actions = resolveCaptureActions({ role, matrix: permissions.matrix, isCompanyAdmin: user?.isCompanyAdmin ?? false, hasProject: !!projectId })

  // One project: no need to ask. A project that is no longer listed (access
  // removed) is dropped, and with it everything cached about it.
  useEffect(() => {
    if (!hydrated || !projects.isSuccess) return
    const list = projects.data
    if (!projectId && list.length === 1) void select(list[0]!.id)
    else if (projectId && list.length > 0 && !list.some((p) => p.id === projectId)) void select(null)
  }, [hydrated, projectId, projects.isSuccess, projects.data, select])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] ?? ''

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([projects.refetch(), permissions.refetch()])
    setRefreshing(false)
  }

  const home = () => {
    if (!projectId) return null
    const props = { projectId, currency: project?.currency ?? undefined, actions }
    switch (role) {
      case 'pm':
        return <PmHome {...props} />
      case 'site_engineer':
        return <SiteEngineerHome {...props} />
      case 'quality_engineer':
        return <QualityHome {...props} />
      case 'warehouse':
        return <WarehouseHome {...props} />
      case 'qs':
      case 'cost_controller':
      case 'finance':
        return <GeneralHome {...props} emphasis="commercial" />
      case 'planning_eng':
        return <GeneralHome {...props} emphasis="schedule" />
      default:
        return <GeneralHome {...props} emphasis="general" />
    }
  }

  return (
    <Screen
      title={`${greeting}${firstName ? `, ${firstName}` : ''}`}
      subtitle={roleLabel(role)}
      contentStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      testID="screen-home"
    >
      <ProjectSwitch project={project} />

      {!projectId ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Choose a project
            </Text>
            {projects.isPending ? (
              <SkeletonList rows={3} />
            ) : projects.isError ? (
              <ErrorState message={userMessage(projects.error)} onRetry={() => void projects.refetch()} />
            ) : projects.data.length === 0 ? (
              <EmptyState title="You are not on any project yet" body="Ask your project manager to add you to a project on the OctaPM web platform." />
            ) : (
              projects.data.slice(0, 5).map((p) => (
                <RecordRow key={p.id} reference={p.contractNumber ?? p.type ?? 'Project'} title={p.name} status={p.status} meta={p.location ?? undefined} onPress={() => void select(p.id)} testID={`choose-${p.id}`} />
              ))
            )}
            {projects.data && projects.data.length > 5 ? <Button title="All projects" variant="secondary" onPress={() => router.push('/projects')} /> : null}
          </View>
        </Card>
      ) : null}

      {outbox.waiting + outbox.attention > 0 ? (
        <Card edge={outbox.attention > 0 ? theme.colors.error : theme.colors.warning} testID="home-outbox">
          <View style={styles.stack}>
            <Text variant="heading">{outbox.attention > 0 ? `${outbox.attention} item${outbox.attention === 1 ? '' : 's'} need${outbox.attention === 1 ? 's' : ''} your attention` : `${outbox.waiting} item${outbox.waiting === 1 ? '' : 's'} waiting to send`}</Text>
            <Text tone="muted">{outbox.offline ? 'They go when the signal returns.' : outbox.attention > 0 ? 'The server refused them; see why and try again or discard.' : 'Sending shortly.'}</Text>
            <Button title="Open the outbox" variant="secondary" onPress={() => router.push('/outbox')} testID="home-outbox-open" />
          </View>
        </Card>
      ) : null}

      {home()}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  stack: { gap: spacing.sm },
})
