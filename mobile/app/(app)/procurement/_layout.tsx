import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import ProcurementHomeScreen from './index'
import OrdersScreen from './orders/index'
import PackagesScreen from './packages/index'

/** Procurement: the overview and alerts, packages, the order register and long lead; on a tablet each list stays beside its record. */
export default function ProcurementLayout() {
  const theme = useTheme()
  return (
    <SplitGroup
      sections={[
        { prefix: '/procurement/packages', master: () => <PackagesScreen /> },
        { prefix: '/procurement/orders', master: () => <OrdersScreen /> },
        { prefix: '/procurement', master: () => <ProcurementHomeScreen /> },
      ]}
    >
      <Stack screenOptions={stackScreenOptions(theme)}>
        <Stack.Screen name="index" options={{ title: 'Procurement' }} />
        <Stack.Screen name="packages/index" options={{ title: 'Packages' }} />
        <Stack.Screen name="packages/[id]" options={{ title: 'Package' }} />
        <Stack.Screen name="orders/index" options={{ title: 'Purchase orders' }} />
        <Stack.Screen name="orders/[id]" options={{ title: 'Purchase order' }} />
        <Stack.Screen name="long-lead/index" options={{ title: 'Long lead' }} />
      </Stack>
    </SplitGroup>
  )
}
