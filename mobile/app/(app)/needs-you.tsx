import { Screen } from '@/components/Screen'
import { EmptyState } from '@/design-system'

export default function NeedsYouScreen() {
  return (
    <Screen title="Needs You" testID="screen-needs-you">
      <EmptyState title="Nothing is waiting on you" body="Records that need your answer, approval or action appear here, and each one opens the exact record." />
    </Screen>
  )
}
