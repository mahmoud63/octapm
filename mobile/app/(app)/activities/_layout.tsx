import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import ActivitiesScreen from './index'

/** Activities: the list, the lookahead and the record; on a tablet the list stays beside the record. */
export default function ActivitiesLayout() {
  const theme = useTheme()
  return (
    <SplitGroup sections={[{ prefix: '/activities', master: () => <ActivitiesScreen /> }]}>
      <Stack screenOptions={stackScreenOptions(theme)}>
        <Stack.Screen name="index" options={{ title: 'Activities' }} />
        <Stack.Screen name="lookahead" options={{ title: 'Lookahead' }} />
        <Stack.Screen name="[id]" options={{ title: 'Activity' }} />
      </Stack>
    </SplitGroup>
  )
}
