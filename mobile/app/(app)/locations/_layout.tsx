import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { stackScreenOptions } from '@/navigation/stackOptions'

/** Locations: the list and one entry, as a single destination rather than two tabs. */
export default function LocationsLayout() {
  const theme = useTheme()
  return (
    <Stack screenOptions={stackScreenOptions(theme)}>
      <Stack.Screen name="index" options={{ title: 'Locations' }} />
      <Stack.Screen name="[id]" options={{ title: 'Location' }} />
    </Stack>
  )
}
