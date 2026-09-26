import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { userMessage } from '@/api/errors'
import { abandonWorkspaceChoice, enterWorkspace } from '@/auth/session'
import { useAuthStore, workspaceKindLabel, workspaceLabel } from '@/auth/store'
import { Wordmark } from '@/components/Wordmark'
import { Badge, Button, RecordRow, Text, spacing, useTheme } from '@/design-system'
import { useLayout } from '@/hooks/useLayout'
import { roleLabel } from '@/permissions/policy'

/**
 * Choose a workspace.
 *
 * A sign-in that proved the identity but found it in several workspaces
 * ends here (membership doc §6): each workspace with its kind and the role
 * the person holds in it; choosing one completes the sign-in. A suspended
 * workspace is listed so the person knows why it cannot be entered. Nothing
 * is created here — a new workspace is made on the web platform.
 */
export default function ChooseWorkspaceScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { isCompact } = useLayout()
  const choice = useAuthStore((s) => s.pendingChoice)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const choose = async (orgId: string) => {
    setBusy(orgId)
    setFailure(null)
    try {
      await enterWorkspace(orgId)
      // The auth layout sends a signed-in person home.
    } catch (error) {
      setFailure(userMessage(error))
      setBusy(null)
    }
  }

  const back = () => {
    abandonWorkspaceChoice()
    router.replace('/sign-in')
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.colors.brand }]}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}
      keyboardShouldPersistTaps="handled"
      testID="screen-choose-workspace"
    >
      <View style={[styles.panel, !isCompact && styles.panelWide]}>
        <Wordmark color="#fff" height={30} />
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text variant="title" accessibilityRole="header">
            Choose a workspace
          </Text>
          <Text tone="muted" style={styles.lede}>
            {choice ? `${choice.identity} belongs to more than one workspace. The app works in one at a time; you can switch later from More.` : 'Sign in first to choose a workspace.'}
          </Text>
          {choice ? (
            <View style={styles.list}>
              {choice.memberships.map((m) => {
                const suspended = m.status !== 'active'
                return (
                  <RecordRow
                    key={m.orgId}
                    reference={workspaceKindLabel(m.kind)}
                    title={workspaceLabel(m)}
                    meta={suspended ? 'Your access to this workspace is suspended' : roleLabel(m.role)}
                    status={suspended ? 'suspended' : undefined}
                    onPress={suspended || busy ? undefined : () => void choose(m.orgId)}
                    testID={`choose-workspace-${m.orgId}`}
                  />
                )
              })}
            </View>
          ) : null}
          {choice ? (
            <View style={styles.badges}>
              <Badge label={`${choice.memberships.filter((m) => m.status === 'active').length} available`} tone="info" />
            </View>
          ) : null}
          {failure ? (
            <Text tone="error" accessibilityRole="alert" testID="choose-workspace-error">
              {failure}
            </Text>
          ) : null}
          <Button title="Sign in as someone else" variant="ghost" fullWidth disabled={!!busy} onPress={back} testID="choose-workspace-back" />
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg, justifyContent: 'flex-start' },
  panel: { gap: spacing.xl, alignSelf: 'stretch' },
  panelWide: { maxWidth: 480, alignSelf: 'center', width: '100%' },
  card: { borderRadius: 16, padding: spacing.xl, gap: spacing.lg },
  lede: { marginTop: -spacing.sm },
  list: { gap: spacing.xs },
  badges: { flexDirection: 'row', gap: spacing.xs },
})
