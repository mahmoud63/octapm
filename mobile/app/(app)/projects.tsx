import { Screen } from '@/components/Screen'
import { EmptyState } from '@/design-system'

export default function ProjectsScreen() {
  return (
    <Screen title="Projects" testID="screen-projects">
      <EmptyState title="Your projects" body="Recent and favourite projects, with their health and offline status, arrive with the Projects milestone." />
    </Screen>
  )
}
