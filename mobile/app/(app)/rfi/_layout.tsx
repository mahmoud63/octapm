import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import RfiListScreen from './index'

/** RFIs: the list, the form and the record; on a tablet the list stays beside the record. */
export default function RfiLayout() {
  const theme = useTheme()
  return (
    <SplitGroup sections={[{ prefix: '/rfi', master: () => <RfiListScreen /> }]}>
      <Stack screenOptions={stackScreenOptions(theme)}>
        <Stack.Screen name="index" options={{ title: 'RFIs' }} />
        <Stack.Screen name="new" options={{ title: 'New RFI', presentation: 'modal' }} />
        <Stack.Screen name="[id]" options={{ title: 'RFI' }} />
      </Stack>
    </SplitGroup>
  )
}
