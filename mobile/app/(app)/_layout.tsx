import { Ionicons } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useAuthStore } from '@/auth/store'
import { CaptureSheet } from '@/components/CaptureSheet'
import { ConnectivityBar } from '@/components/ConnectivityBar'
import { useTheme } from '@/design-system'
import { useLayout } from '@/hooks/useLayout'
import { ALL_SLOT_NAMES, HIDDEN_ROUTES, resolveCaptureActions, resolveTabs } from '@/navigation/roleNav'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'

/**
 * The signed-in shell.
 *
 * Five destinations, chosen for the job the person actually does: a site
 * engineer lands on today's work with a camera under their thumb, a project
 * manager on what needs deciding. The set is resolved from the role, the
 * permission matrix and the company-admin capability — never hard-coded here
 * — so a slot the server would refuse is simply not drawn.
 *
 * Role decides the shape. Permission decides what may be done. Nothing in
 * this file authorises anything.
 */
export default function AppLayout() {
  const status = useAuthStore((s) => s.status)
  const role = useAuthStore((s) => s.user?.role ?? null)
  const isCompanyAdmin = useAuthStore((s) => s.user?.isCompanyAdmin ?? false)
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projectHydrated = useProjectStore((s) => s.hydrated)
  const permissions = usePermissions(projectId)
  const theme = useTheme()
  const { isExpanded } = useLayout()
  const [capturing, setCapturing] = useState(false)

  if (status === 'signedOut' || status === 'locked') return <Redirect href="/sign-in" />
  // Nothing is drawn until the session and the remembered project are both in
  // hand. Fifty-seven screens ask "is there a project?" and answer "choose one
  // first" when there is not; asked a moment too early, every one of them told
  // the person to choose a project they had already chosen. Waiting here means
  // a null project id means what it says everywhere else.
  if (status === 'booting' || !projectHydrated) return null

  const context = { role, matrix: permissions.matrix, isCompanyAdmin, hasProject: !!projectId }
  const slots = resolveTabs(context)
  const captureActions = resolveCaptureActions(context)
  const shown = new Set(slots.map((s) => s.name))

  return (
    <View style={styles.root}>
      <ConnectivityBar />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarPosition: isExpanded ? 'left' : 'bottom',
          tabBarVariant: isExpanded ? 'material' : 'uikit',
          tabBarActiveTintColor: theme.colors.brandStrong,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarStyle: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
          sceneStyle: { backgroundColor: theme.colors.background },
        }}
      >
        {slots.map((slot) => (
          <Tabs.Screen
            key={slot.name}
            name={slot.name}
            options={{
              title: slot.title,
              tabBarIcon: ({ color, size }) => <Ionicons name={slot.icon as never} color={color} size={slot.capture ? size + 10 : size} />,
              // The centre slot opens the capture sheet instead of navigating.
              ...(slot.capture
                ? {
                    tabBarButton: undefined,
                    tabBarLabel: '',
                  }
                : {}),
            }}
            listeners={
              slot.capture
                ? {
                    tabPress: (event) => {
                      event.preventDefault()
                      setCapturing(true)
                    },
                  }
                : undefined
            }
          />
        ))}
        {/* Every other destination stays routable by link, and off the bar. */}
        {Array.from(new Set([...ALL_SLOT_NAMES, ...HIDDEN_ROUTES]))
          .filter((name) => !shown.has(name))
          .map((name) => (
            <Tabs.Screen key={name} name={name} options={{ href: null }} />
          ))}
      </Tabs>
      <CaptureSheet visible={capturing} actions={captureActions} onClose={() => setCapturing(false)} />
    </View>
  )
}


const styles = StyleSheet.create({ root: { flex: 1 } })
