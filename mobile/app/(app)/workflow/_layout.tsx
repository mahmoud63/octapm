import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import WorkflowInboxScreen from './index'

/** The workflow inbox and each instance; on a tablet the inbox stays beside the step. */
export default function WorkflowLayout() {
  const theme = useTheme()
  return (
    <SplitGroup sections={[{ prefix: '/workflow', master: () => <WorkflowInboxScreen /> }]}>
      <Stack screenOptions={stackScreenOptions(theme)}>
        <Stack.Screen name="index" options={{ title: 'Approvals' }} />
        <Stack.Screen name="[id]" options={{ title: 'Approval step' }} />
      </Stack>
    </SplitGroup>
  )
}
