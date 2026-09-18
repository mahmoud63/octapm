import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import ChangeEventsScreen from './change-events/index'
import ChangeOrdersScreen from './change-orders/index'
import CommitmentsScreen from './commitments/index'
import CommercialHomeScreen from './index'
import PayAppsScreen from './pay-apps/index'

/** Commercial: change events, change orders, commitments and pay applications; on a tablet each list stays beside its record. */
export default function CommercialLayout() {
  const theme = useTheme()
  return (
    <SplitGroup
      sections={[
        { prefix: '/commercial/change-events', master: () => <ChangeEventsScreen /> },
        { prefix: '/commercial/change-orders', master: () => <ChangeOrdersScreen /> },
        { prefix: '/commercial/commitments', master: () => <CommitmentsScreen /> },
        { prefix: '/commercial/pay-apps', master: () => <PayAppsScreen /> },
        { prefix: '/commercial', master: () => <CommercialHomeScreen /> },
      ]}
    >
      <Stack screenOptions={stackScreenOptions(theme)}>
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
    </SplitGroup>
  )
}
