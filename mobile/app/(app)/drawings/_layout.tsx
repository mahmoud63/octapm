import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Drawings: the sheet register and the viewer, as a stack inside the shell. */
export default function DrawingsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Drawings' }} />
      <Stack.Screen name="[id]" options={{ title: 'Sheet' }} />
    </Stack>
  )
}
