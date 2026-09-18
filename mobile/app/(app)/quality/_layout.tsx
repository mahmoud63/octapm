import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Quality: the home, and the inspection, punch, NCR, safety and test stacks. */
export default function QualityLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Quality' }} />
      <Stack.Screen name="inspections/index" options={{ title: 'Inspections' }} />
      <Stack.Screen name="inspections/new" options={{ title: 'New inspection', presentation: 'modal' }} />
      <Stack.Screen name="inspections/[id]" options={{ title: 'Inspection' }} />
      <Stack.Screen name="punch/index" options={{ title: 'Punch list' }} />
      <Stack.Screen name="punch/new" options={{ title: 'New punch item', presentation: 'modal' }} />
      <Stack.Screen name="punch/[id]" options={{ title: 'Punch item' }} />
      <Stack.Screen name="ncr/index" options={{ title: 'NCRs' }} />
      <Stack.Screen name="ncr/new" options={{ title: 'Raise NCR', presentation: 'modal' }} />
      <Stack.Screen name="ncr/[id]" options={{ title: 'NCR' }} />
      <Stack.Screen name="safety/index" options={{ title: 'Safety' }} />
      <Stack.Screen name="safety/new" options={{ title: 'Report incident', presentation: 'modal' }} />
      <Stack.Screen name="safety/[id]" options={{ title: 'Safety incident' }} />
      <Stack.Screen name="tests/index" options={{ title: 'Material tests' }} />
      <Stack.Screen name="tests/[id]" options={{ title: 'Material test' }} />
    </Stack>
  )
}
