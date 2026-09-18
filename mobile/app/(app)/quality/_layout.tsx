import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import QualityHomeScreen from './index'
import InspectionsScreen from './inspections/index'
import NcrListScreen from './ncr/index'
import PunchListScreen from './punch/index'
import SafetyListScreen from './safety/index'
import MaterialTestsScreen from './tests/index'

/** Quality: the home, and the inspection, punch, NCR, safety and test stacks; on a tablet each list stays beside its record. */
export default function QualityLayout() {
  const theme = useTheme()
  return (
    <SplitGroup
      sections={[
        { prefix: '/quality/inspections', master: () => <InspectionsScreen /> },
        { prefix: '/quality/punch', master: () => <PunchListScreen /> },
        { prefix: '/quality/ncr', master: () => <NcrListScreen /> },
        { prefix: '/quality/safety', master: () => <SafetyListScreen /> },
        { prefix: '/quality/tests', master: () => <MaterialTestsScreen /> },
        { prefix: '/quality', master: () => <QualityHomeScreen /> },
      ]}
    >
      <Stack screenOptions={stackScreenOptions(theme)}>
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
    </SplitGroup>
  )
}
