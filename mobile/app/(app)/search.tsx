import { Screen } from '@/components/Screen'
import { EmptyState } from '@/design-system'

export default function SearchScreen() {
  return (
    <Screen title="Search" testID="screen-search">
      <EmptyState title="Find anything you can see" body="Projects, RFIs, drawings, documents, tasks, materials and more, by name or number." />
    </Screen>
  )
}
