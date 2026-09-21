import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useTeam } from '@/api/record-hooks'
import type { TeamMember } from '@/api/record-types'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { Screen } from '@/components/Screen'
import { Card, EmptyState, ErrorState, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'

/** The disciplines a construction project is actually organised into. */
const GROUPS: { id: string; title: string; roles: string[] }[] = [
  { id: 'management', title: 'Project management', roles: ['pm', 'project_manager'] },
  { id: 'site', title: 'Site', roles: ['site_engineer', 'site'] },
  { id: 'planning', title: 'Planning', roles: ['planning_engineer', 'planner'] },
  { id: 'commercial', title: 'Commercial', roles: ['qs', 'quantity_surveyor', 'cost_controller', 'cost'] },
  { id: 'quality', title: 'Quality', roles: ['quality_engineer', 'quality'] },
  { id: 'procurement', title: 'Procurement', roles: ['procurement', 'warehouse', 'storekeeper'] },
  { id: 'finance', title: 'Finance', roles: ['finance'] },
]

const groupFor = (member: TeamMember) => {
  const role = (member.assignmentRole ?? member.orgRole ?? '').toLowerCase()
  return GROUPS.find((g) => g.roles.includes(role))?.id ?? 'other'
}

/**
 * Who is on this project, by what they do.
 *
 * A person looking someone up on site is not browsing an alphabet — they want
 * the quantity surveyor, or whoever is running quality. So the list is grouped
 * by discipline, and anyone whose role does not map to one still appears under
 * "Others" rather than quietly vanishing from the team.
 */
export default function TeamScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const team = useTeam(projectId)

  const grouped = useMemo(() => {
    const members = team.data ?? []
    const known = GROUPS.map((group) => ({ ...group, members: members.filter((m) => groupFor(m) === group.id) }))
    const others = members.filter((m) => groupFor(m) === 'other')
    return [...known, ...(others.length ? [{ id: 'other', title: 'Others', roles: [], members: others }] : [])].filter((g) => g.members.length > 0)
  }, [team.data])

  if (!projectId) {
    return (
      <Screen title="Team" testID="screen-team">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" body="A team belongs to one project." action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <Screen title="Team" subtitle={project?.name} contentStyle={styles.content} testID="screen-team">
      <ProjectSwitch project={project} />

      {team.isPending ? (
        <SkeletonList rows={6} />
      ) : team.isError ? (
        <ErrorState message={userMessage(team.error)} onRetry={() => void team.refetch()} />
      ) : grouped.length === 0 ? (
        <EmptyState title="Nobody is assigned yet" body="People appear here once they are given a role on this project." />
      ) : (
        grouped.map((group) => (
          <Card key={group.id} testID={`team-group-${group.id}`}>
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                {group.title}
              </Text>
              {group.members.map((member) => (
                <RecordRow
                  key={member.userId}
                  reference={humanise(member.assignmentRole ?? member.orgRole ?? 'member')}
                  title={member.name}
                  meta={[member.party?.name, member.email].filter(Boolean).join(' · ')}
                  onPress={() => router.push(`/team/${member.userId}`)}
                  testID={`team-member-${member.userId}`}
                />
              ))}
            </View>
          </Card>
        ))
      )}
      <Freshness updatedAt={team.dataUpdatedAt || undefined} isFetching={team.isFetching} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
})
