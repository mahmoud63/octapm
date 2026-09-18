import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { availableBiometric, biometricLabel, type BiometricKind } from '@/auth/biometric'
import { setBiometricUnlock, signOut } from '@/auth/session'
import { useAuthStore } from '@/auth/store'
import { Screen } from '@/components/Screen'
import { Button, Card, Text, spacing } from '@/design-system'
import { env } from '@/config/env'
import { useOutboxStatus } from '@/offline/useOutboxStatus'
import { roleLabel } from '@/permissions/policy'

/**
 * Everything that is not a destination: who you are, how you unlock, which
 * server this build talks to, and the way out.
 */
export default function MoreScreen() {
  const user = useAuthStore((s) => s.user)
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled)
  const [biometric, setBiometric] = useState<BiometricKind>('none')
  const [busy, setBusy] = useState(false)

  const router = useRouter()
  const outbox = useOutboxStatus()

  useEffect(() => {
    availableBiometric().then(setBiometric)
  }, [])

  return (
    <Screen title="More" testID="screen-more">
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Signed in as
          </Text>
          <Text variant="heading">{user?.name ?? '—'}</Text>
          <Text tone="muted">{user?.email ?? ''}</Text>
          <Text tone="muted">{roleLabel(user?.role)}</Text>
        </View>
      </Card>

      {biometric !== 'none' ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Unlock
            </Text>
            <Text tone="muted">
              {biometricEnabled
                ? `${biometricLabel(biometric)} unlocks your saved session on this device. Your access is still checked with the server every time.`
                : `Use ${biometricLabel(biometric)} to open OctaPM without typing your password. Your access is still checked with the server every time.`}
            </Text>
            <Button
              variant="secondary"
              title={biometricEnabled ? `Turn off ${biometricLabel(biometric)}` : `Turn on ${biometricLabel(biometric)}`}
              loading={busy}
              onPress={async () => {
                setBusy(true)
                await setBiometricUnlock(!biometricEnabled)
                setBusy(false)
              }}
            />
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Outbox
          </Text>
          <Text tone="muted">
            {outbox.attention > 0 ? `${outbox.attention} item${outbox.attention === 1 ? '' : 's'} need${outbox.attention === 1 ? 's' : ''} your attention.` : outbox.waiting > 0 ? `${outbox.waiting} item${outbox.waiting === 1 ? '' : 's'} waiting to send.` : 'Everything captured on this device has been sent.'}
          </Text>
          <Button title="Open the outbox" variant="secondary" onPress={() => router.push('/outbox')} testID="more-outbox" />
        </View>
      </Card>

      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            This build
          </Text>
          <Text tone="muted">
            Version {env.appVersion} · {env.name} · {env.apiOrigin}
          </Text>
        </View>
      </Card>

      <Button title="Sign out" variant="danger" onPress={() => signOut()} testID="sign-out" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
})
