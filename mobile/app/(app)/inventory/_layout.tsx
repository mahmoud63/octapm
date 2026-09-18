import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import InventoryHomeScreen from './index'
import InventoryItemsScreen from './items/index'
import GoodsInScreen from './receive/index'
import TransfersScreen from './transfers/index'

/** Inventory: the storekeeper's home, scan, items, goods in, transfers and the ledger; on a tablet each list stays beside its record. */
export default function InventoryLayout() {
  const theme = useTheme()
  return (
    <SplitGroup
      sections={[
        { prefix: '/inventory/items', master: () => <InventoryItemsScreen /> },
        { prefix: '/inventory/receive', master: () => <GoodsInScreen /> },
        { prefix: '/inventory/transfers', master: () => <TransfersScreen /> },
        { prefix: '/inventory', master: () => <InventoryHomeScreen /> },
      ]}
    >
      <Stack screenOptions={stackScreenOptions(theme)}>
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
    </SplitGroup>
  )
}
