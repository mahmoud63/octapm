import { Ionicons } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'
import { useAuthStore } from '@/auth/store'
import { useTheme } from '@/design-system'
import { useLayout } from '@/hooks/useLayout'

/**
 * The signed-in shell.
 *
 * Five destinations, always the same five. On a phone they are a bar along
 * the bottom; on a tablet the same bar stands on the left as a rail, which
 * leaves the width for master–detail screens. Nothing here is a desktop
 * sidebar squeezed onto a phone.
 */
export default function AppLayout() {
  const status = useAuthStore((s) => s.status)
  const theme = useTheme()
  const { isExpanded } = useLayout()

  if (status === 'signedOut' || status === 'locked') return <Redirect href="/sign-in" />
  if (status === 'booting') return null

  return (
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
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: ({ color, size }) => <Ionicons name="business-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="needs-you" options={{ title: 'Needs You', tabBarIcon: ({ color, size }) => <Ionicons name="hand-right-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-outline" color={color} size={size} /> }} />
      {/* Reached from Home, Needs You and Search; not destinations of their own. */}
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="rfi" options={{ href: null }} />
      <Tabs.Screen name="tasks" options={{ href: null }} />
      <Tabs.Screen name="documents" options={{ href: null }} />
      <Tabs.Screen name="drawings" options={{ href: null }} />
      <Tabs.Screen name="site" options={{ href: null }} />
      <Tabs.Screen name="activities" options={{ href: null }} />
      <Tabs.Screen name="photos" options={{ href: null }} />
      <Tabs.Screen name="timesheets" options={{ href: null }} />
      <Tabs.Screen name="quality" options={{ href: null }} />
      <Tabs.Screen name="inventory" options={{ href: null }} />
    </Tabs>
  )
}
