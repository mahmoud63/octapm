import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import DrawingsScreen from './index'

/** Drawings: the register and the sheet; on a tablet the register stays beside the sheet. */
export default function DrawingsLayout() {
  const theme = useTheme()
  return (
    <SplitGroup sections={[{ prefix: '/drawings', master: () => <DrawingsScreen /> }]}>
      <Stack screenOptions={stackScreenOptions(theme)}>
        <Stack.Screen name="index" options={{ title: 'Drawings' }} />
        <Stack.Screen name="[id]" options={{ title: 'Sheet' }} />
      </Stack>
    </SplitGroup>
  )
}
