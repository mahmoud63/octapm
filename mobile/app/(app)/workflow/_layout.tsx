import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** The workflow inbox: the steps waiting on this person, and each instance. */
export default function WorkflowLayout() {
  const theme = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: theme.colors.brand,
        headerTitleStyle: { fontFamily: 'SpaceGrotesk_600SemiBold', color: theme.colors.text },
        headerStyle: { backgroundColor: theme.colors.background },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Approvals' }} />
      <Stack.Screen name="[id]" options={{ title: 'Approval step' }} />
    </Stack>
  )
}
