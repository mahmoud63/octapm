import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Timesheets: the list, a new sheet for a crew, and one sheet. */
export default function TimesheetsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Timesheets' }} />
      <Stack.Screen name="new" options={{ title: 'New timesheet', presentation: 'modal' }} />
      <Stack.Screen name="[id]" options={{ title: 'Timesheet' }} />
    </Stack>
  )
}
