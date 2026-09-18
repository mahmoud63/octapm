import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Schedule in the field: activities, one activity with its progress, and the lookahead. */
export default function ActivitiesLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Activities' }} />
      <Stack.Screen name="lookahead" options={{ title: 'Lookahead' }} />
      <Stack.Screen name="[id]" options={{ title: 'Activity' }} />
    </Stack>
  )
}
