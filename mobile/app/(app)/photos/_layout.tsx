import { Stack } from 'expo-router'
import { useTheme } from '@/design-system'
import { SplitGroup } from '@/navigation/split'
import { stackScreenOptions } from '@/navigation/stackOptions'
import PhotosScreen from './index'

/** Photos: the gallery and the photo; on a tablet the gallery stays beside the photo. */
export default function PhotosLayout() {
  const theme = useTheme()
  return (
    <SplitGroup sections={[{ prefix: '/photos', master: () => <PhotosScreen /> }]}>
      <Stack screenOptions={stackScreenOptions(theme)}>
        <Stack.Screen name="index" options={{ title: 'Photos' }} />
        <Stack.Screen name="[id]" options={{ title: 'Photo' }} />
      </Stack>
    </SplitGroup>
  )
}
