import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { switchWorkspace } from '@/auth/session'
import { useAuthStore, workspaceKindLabel, workspaceLabel, type WorkspaceMembership } from '@/auth/store'
import { Badge, Text, radius, spacing, tapTarget, useTheme } from '@/design-system'
import { useOutboxStatus } from '@/offline/useOutboxStatus'
import { roleLabel } from '@/permissions/policy'

/**
 * The workspace the session is in, and the way to change it.
 *
 * The strip names the active workspace wherever the app shows where the
 * person is (More, the Projects tab); the sheet lists every workspace of
 * the identity with its kind and the person's role in it, marks the active
 * one, and switches on a tap. The switch is the session's one sequence
 * (auth/session.switchWorkspace): tokens, cache, project and queue move
 * together, and what is waiting to send from this workspace stays here
 * until it is active again — the sheet says so before the tap.
 *
 * Creating a workspace is not offered here; that belongs to the web
 * platform (ENT-6).
 */
export function WorkspaceStrip({ onPress, testID = 'workspace-switch' }: { onPress: () => void; testID?: string }) {
  const theme = useTheme()
  const workspace = useAuthStore((s) => s.workspace)
  const count = useAuthStore((s) => s.memberships.length)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Workspace ${workspaceLabel(workspace)}. Switch workspace`}
      onPress={onPress}
      style={({ pressed }) => [styles.strip, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? 0.85 : 1 }]}
      testID={testID}
    >
      <View style={styles.text}>
        <Text variant="label" label tone="muted">
          Workspace
        </Text>
        <Text variant="heading" numberOfLines={1} testID="workspace-name">
          {workspaceLabel(workspace)}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {[workspaceKindLabel(workspace?.kind), roleLabel(workspace?.role), count > 1 ? `${count} workspaces` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Ionicons name="swap-horizontal-outline" size={22} color={theme.colors.brand} />
    </Pressable>
  )
}

export function WorkspaceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const router = useRouter()
  const active = useAuthStore((s) => s.workspace)
  const memberships = useAuthStore((s) => s.memberships)
  const switching = useAuthStore((s) => s.switching)
  const outbox = useOutboxStatus()
  const [failure, setFailure] = useState<string | null>(null)

  const listed: WorkspaceMembership[] = memberships.length ? memberships : active ? [active] : []

  const choose = async (membership: WorkspaceMembership) => {
    if (membership.orgId === active?.orgId || membership.status !== 'active') return
    setFailure(null)
    try {
      await switchWorkspace(membership.orgId)
      onClose()
      router.replace('/')
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]} onPress={switching ? undefined : onClose} accessibilityLabel="Close" testID="workspace-backdrop">
        <Pressable style={[styles.sheet, { backgroundColor: theme.colors.background }]} onPress={(e) => e.stopPropagation()} testID="workspace-sheet">
          <View style={styles.grabber}>
            <View style={[styles.grabberBar, { backgroundColor: theme.colors.border }]} />
          </View>
          <Text variant="title">Workspace</Text>
          <Text tone="muted">
            {outbox.waiting > 0
              ? `${outbox.waiting} item${outbox.waiting === 1 ? '' : 's'} waiting to send from ${workspaceLabel(active)} will stay queued until you switch back.`
              : 'The app works in one workspace at a time. Switching changes the projects, the records and the queue.'}
          </Text>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {listed.map((m) => {
              const current = m.orgId === active?.orgId
              const suspended = m.status !== 'active'
              return (
                <Pressable
                  key={m.orgId}
                  onPress={() => void choose(m)}
                  disabled={switching || current || suspended}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current, disabled: switching || suspended }}
                  style={({ pressed }) => [styles.row, { borderColor: current ? theme.colors.brand : theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface, opacity: suspended ? 0.6 : 1 }]}
                  testID={`workspace-option-${m.orgId}`}
                >
                  <View style={styles.grow}>
                    <Text numberOfLines={1}>{workspaceLabel(m)}</Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {suspended ? 'Access suspended' : roleLabel(m.role)}
                    </Text>
                  </View>
                  <Badge label={workspaceKindLabel(m.kind)} />
                  {current ? (
                    <View testID="workspace-active">
                      <Badge label="Current" tone="success" />
                    </View>
                  ) : null}
                  {switching && !current ? <Ionicons name="hourglass-outline" size={18} color={theme.colors.textMuted} /> : null}
                </Pressable>
              )
            })}
          </ScrollView>
          {failure ? (
            <Text tone="error" accessibilityRole="alert" testID="workspace-switch-error">
              {failure}
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: tapTarget, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  text: { flex: 1, gap: 2 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, gap: spacing.md, maxHeight: '80%' },
  grabber: { alignItems: 'center', paddingBottom: spacing.xs },
  grabberBar: { width: 40, height: 4, borderRadius: 2 },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: tapTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: 12 },
  grow: { flex: 1 },
})
