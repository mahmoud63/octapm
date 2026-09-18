import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Tasks: the list and a record, as a stack inside the shell. */
export default function TasksLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Tasks' }} />
      <Stack.Screen name="[id]" options={{ title: 'Task' }} />
    </Stack>
  )
}
