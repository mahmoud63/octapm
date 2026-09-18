import { Redirect, Stack } from 'expo-router'
import { useAuthStore } from '@/auth/store'

/** Screens for people who are not signed in. A signed-in person is sent home. */
export default function AuthLayout() {
  const status = useAuthStore((s) => s.status)
  if (status === 'signedIn') return <Redirect href="/" />
  return <Stack screenOptions={{ headerShown: false }} />
}
