import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { getProject } from '@/api/endpoints'
import { userMessage } from '@/api/errors'
import { refreshWorkspaces, switchWorkspace } from '@/auth/session'
import { useAuthStore, workspaceLabel, type WorkspaceMembership } from '@/auth/store'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, SkeletonList, Text, spacing } from '@/design-system'
import { linkLeavesWorkspace, resolveLink, routeForResolvedLink } from '@/navigation/deepLinks'
import { useProjectStore } from '@/projects/store'

/**
 * The opener behind deep links, universal links and notification taps. It
 * switches to the workspace and the project the link names — asking first
 * when the workspace is not the one the session is in (workspace switching
 * doc §5): a link into another of the person's workspaces offers the switch
 * and never makes it silently; a link into a workspace they are not in, or
 * a project they cannot see, ends in one sentence. Then it replaces itself
 * with the record's route, so back lands on the record's own list.
 *
 * `to` is an app route; `link` is any link form the resolver accepts and is
 * what the web target uses, where the native intent hook does not run.
 * `orgId` / `orgSlug` name the workspace the link belongs to, when known.
 */
type Outcome = { kind: 'working' } | { kind: 'offer'; membership: WorkspaceMembership } | { kind: 'refused' } | { kind: 'notMember' } | { kind: 'failed'; message: string }

export default function OpenLinkScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ to?: string; projectId?: string; link?: string; orgId?: string; orgSlug?: string }>()
  const done = useRef(false)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'working' })
  const [busy, setBusy] = useState(false)
  const active = useAuthStore((s) => s.workspace)
  const memberships = useAuthStore((s) => s.memberships)

  const param = (value: unknown) => (typeof value === 'string' && value ? value : null)

  /** Where the link leads, once the workspace is settled: the project first, then the route. */
  const openTarget = async (route: string, projectId: string | null) => {
    const store = useProjectStore.getState()
    if (projectId && projectId !== store.currentProjectId) {
      // A link can name a project this person is not on; switching to it would break every screen. Ask the server first.
      const allowed = await getProject(projectId)
        .then(() => true)
        .catch(() => false)
      if (!allowed) {
        setOutcome({ kind: 'refused' })
        return
      }
      await store.select(projectId)
    }
    router.replace(routeForResolvedLink({ route, projectId: null, orgId: null, orgSlug: null }, null) as never)
  }

  const target = useRef<{ route: string; projectId: string | null } | null>(null)

  useEffect(() => {
    if (done.current) return
    done.current = true
    const run = async () => {
      let route = param(params.to)
      let projectId = param(params.projectId)
      let orgId = param(params.orgId)
      let orgSlug = param(params.orgSlug)
      if (!route && param(params.link)) {
        const resolved = resolveLink(params.link as string)
        if (resolved) {
          route = resolved.route
          projectId = resolved.projectId
          orgId = resolved.orgId
          orgSlug = resolved.orgSlug
        }
      }
      if (!route || !route.startsWith('/') || route.startsWith('//')) {
        router.replace('/')
        return
      }
      target.current = { route, projectId }
      const session = useAuthStore.getState()
      if (linkLeavesWorkspace({ orgId, orgSlug }, session.workspace ? { orgId: session.workspace.orgId, slug: session.workspace.slug } : null)) {
        const listed = () => useAuthStore.getState().memberships.find((m) => (orgId ? m.orgId === orgId : m.slug === orgSlug) && m.status === 'active') ?? null
        // A plain sign-in fills the list behind the screen; a link opened
        // before it arrived is answered from the server's list, not a guess.
        if (!listed()) await refreshWorkspaces()
        const membership = listed()
        if (!membership) {
          setOutcome({ kind: 'notMember' })
          return
        }
        // The handle named the workspace the session is already in (its slug
        // was not known yet): nothing to switch.
        if (membership.orgId === useAuthStore.getState().workspace?.orgId) {
          await openTarget(route, projectId)
          return
        }
        // The person decides; nothing is switched behind them.
        setOutcome({ kind: 'offer', membership })
        return
      }
      await openTarget(route, projectId)
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the link the screen was opened with
  }, [params.link, params.orgId, params.orgSlug, params.projectId, params.to, router])

  const acceptSwitch = async (membership: WorkspaceMembership) => {
    setBusy(true)
    try {
      await switchWorkspace(membership.orgId)
      const next = target.current
      if (next) await openTarget(next.route, next.projectId)
    } catch (error) {
      setOutcome({ kind: 'failed', message: userMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen testID="screen-open">
      {outcome.kind === 'offer' ? (
        <View style={styles.stack} testID="open-workspace-offer">
          <Text variant="title" accessibilityRole="header">
            This link belongs to {workspaceLabel(outcome.membership)}
          </Text>
          <Text tone="muted">
            You are working in {workspaceLabel(active)}. Switching changes the workspace for the whole app; anything waiting to send from {workspaceLabel(active)} stays queued until you come back.
          </Text>
          <Button title={`Switch to ${workspaceLabel(outcome.membership)}`} loading={busy} onPress={() => void acceptSwitch(outcome.membership)} testID="open-switch-workspace" />
          <Button title={`Stay in ${workspaceLabel(active)}`} variant="secondary" disabled={busy} onPress={() => router.replace('/')} testID="open-stay" />
        </View>
      ) : outcome.kind === 'notMember' ? (
        <EmptyState
          title="You are not in that workspace"
          body={`The link belongs to a workspace you are not a member of${memberships.length ? `; you are in ${memberships.map((m) => workspaceLabel(m)).join(', ')}` : ''}. Ask its administrator for an invitation.`}
          action={{ title: 'Home', onPress: () => router.replace('/') }}
        />
      ) : outcome.kind === 'refused' ? (
        <EmptyState
          title="You are not on that project"
          body="The link points at a project you do not have access to. Ask the project manager to add you, or open one of your own projects."
          action={{ title: 'My projects', onPress: () => router.replace('/projects') }}
        />
      ) : outcome.kind === 'failed' ? (
        <EmptyState title="The workspace could not be switched" body={outcome.message} action={{ title: 'Home', onPress: () => router.replace('/') }} />
      ) : (
        <SkeletonList rows={3} />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
})
