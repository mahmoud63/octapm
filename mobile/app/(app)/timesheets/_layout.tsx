import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import TimesheetsScreen from './index'

/** Timesheets: the list, the form and the sheet; on a tablet the list stays beside the sheet. */
export default function TimesheetsLayout() {
  const theme = useTheme()
  return (
    <SplitGroup sections={[{ prefix: '/timesheets', master: () => <TimesheetsScreen /> }]}>
      <Stack screenOptions={stackScreenOptions(theme)}>
        <Stack.Screen name="index" options={{ title: 'Timesheets' }} />
        <Stack.Screen name="new" options={{ title: 'New timesheet', presentation: 'modal' }} />
        <Stack.Screen name="[id]" options={{ title: 'Timesheet' }} />
      </Stack>
    </SplitGroup>
  )
}
