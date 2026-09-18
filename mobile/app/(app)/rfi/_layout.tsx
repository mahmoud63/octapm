import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** RFIs: the list, a record, and the create form, as a stack inside the shell. */
export default function RfiLayout() {
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
      <Stack.Screen name="index" options={{ title: 'RFIs' }} />
      <Stack.Screen name="new" options={{ title: 'New RFI', presentation: 'modal' }} />
      <Stack.Screen name="[id]" options={{ title: 'RFI' }} />
    </Stack>
  )
}
