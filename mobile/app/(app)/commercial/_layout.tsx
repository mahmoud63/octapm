import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Commercial: change events, change orders, commitments and pay applications. */
export default function CommercialLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Commercial' }} />
      <Stack.Screen name="change-events/index" options={{ title: 'Change events' }} />
      <Stack.Screen name="change-events/new" options={{ title: 'Raise change event', presentation: 'modal' }} />
      <Stack.Screen name="change-events/[id]" options={{ title: 'Change event' }} />
      <Stack.Screen name="change-orders/index" options={{ title: 'Change orders' }} />
      <Stack.Screen name="change-orders/[id]" options={{ title: 'Change order' }} />
      <Stack.Screen name="commitments/index" options={{ title: 'Commitments' }} />
      <Stack.Screen name="commitments/[id]" options={{ title: 'Commitment' }} />
      <Stack.Screen name="pay-apps/index" options={{ title: 'Pay applications' }} />
      <Stack.Screen name="pay-apps/[id]" options={{ title: 'Pay application' }} />
    </Stack>
  )
}
