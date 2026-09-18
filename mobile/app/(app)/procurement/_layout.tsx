import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Procurement: the overview and alerts, packages, the order register and long lead. */
export default function ProcurementLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Procurement' }} />
      <Stack.Screen name="packages/index" options={{ title: 'Packages' }} />
      <Stack.Screen name="packages/[id]" options={{ title: 'Package' }} />
      <Stack.Screen name="orders/index" options={{ title: 'Purchase orders' }} />
      <Stack.Screen name="orders/[id]" options={{ title: 'Purchase order' }} />
      <Stack.Screen name="long-lead/index" options={{ title: 'Long lead' }} />
    </Stack>
  )
}
