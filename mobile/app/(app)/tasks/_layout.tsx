import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import TasksListScreen from './index'

/** Tasks: the list and the record; on a tablet the list stays beside the record. */
export default function TasksLayout() {
  const theme = useTheme()
  return (
    <SplitGroup sections={[{ prefix: '/tasks', master: () => <TasksListScreen /> }]}>
      <Stack screenOptions={stackScreenOptions(theme)}>
        <Stack.Screen name="index" options={{ title: 'Tasks' }} />
        <Stack.Screen name="[id]" options={{ title: 'Task' }} />
      </Stack>
    </SplitGroup>
  )
}
