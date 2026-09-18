import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Photos: the gallery and one photo, as a stack inside the shell. */
export default function PhotosLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Photos' }} />
      <Stack.Screen name="[id]" options={{ title: 'Photo' }} />
    </Stack>
  )
}
