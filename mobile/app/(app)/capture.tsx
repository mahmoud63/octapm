import { Redirect } from 'expo-router'

/**
 * The centre slot. Pressing it opens the capture sheet from the shell, so this
 * screen is never seen; it exists because a tab needs a route, and it sends
 * anyone who reaches it by link back to where they started.
 */
export default function CaptureRoute() {
  return <Redirect href="/" />
}
