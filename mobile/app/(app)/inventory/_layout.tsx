import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'

/** Inventory: the storekeeper's home, scan, items, goods in, transfers and the ledger. */
export default function InventoryLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Inventory' }} />
      <Stack.Screen name="scan" options={{ title: 'Scan' }} />
      <Stack.Screen name="items/index" options={{ title: 'Items' }} />
      <Stack.Screen name="items/[id]" options={{ title: 'Item' }} />
      <Stack.Screen name="receive/index" options={{ title: 'Goods in' }} />
      <Stack.Screen name="receive/[id]" options={{ title: 'Purchase order' }} />
      <Stack.Screen name="transfers/index" options={{ title: 'Transfers' }} />
      <Stack.Screen name="transfers/new" options={{ title: 'New transfer', presentation: 'modal' }} />
      <Stack.Screen name="transfers/[id]" options={{ title: 'Transfer' }} />
      <Stack.Screen name="movements/index" options={{ title: 'Movements' }} />
    </Stack>
  )
}
