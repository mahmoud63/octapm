import { Link } from 'expo-router'
import { Screen } from '@/components/Screen'
import { EmptyState } from '@/design-system'

export default function NotFoundScreen() {
  return (
    <Screen>
      <EmptyState title="That page is not here" body="The link may be out of date, or the record may have moved." />
      <Link href="/" style={{ textAlign: 'center' }}>
        Go to Home
      </Link>
    </Screen>
  )
}
