import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { z } from 'zod'
import { userMessage } from '@/api/errors'
import { availableBiometric, biometricLabel, type BiometricKind } from '@/auth/biometric'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { signIn, unlock } from '@/auth/session'
import { useAuthStore } from '@/auth/store'
import { env } from '@/config/env'
import { Button, Input, Text, spacing, useTheme } from '@/design-system'
import { useLayout } from '@/hooks/useLayout'
import { Wordmark } from '@/components/Wordmark'

const schema = z.object({
  email: z.string().trim().email('Enter the email address you use for OctaPM'),
  password: z.string().min(1, 'Enter your password'),
})
type Form = z.infer<typeof schema>

/**
 * Sign in.
 *
 * The same credentials as the web platform. If a session is saved and
 * biometric unlock is on, the person is offered that first; the password is
 * always available underneath. Company SSO opens the web sign-in in the
 * system browser, because the identity provider decides that flow.
 */
export default function SignInScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { isCompact } = useLayout()
  const status = useAuthStore((s) => s.status)
  const reason = useAuthStore((s) => s.lastSignOutReason)
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled)
  const [biometric, setBiometric] = useState<BiometricKind>('none')
  const [failure, setFailure] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const passwordRef = useRef<TextInput>(null)

  const { control, handleSubmit, setValue, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  useEffect(() => {
    availableBiometric().then(setBiometric)
    secureStorage.get(STORAGE_KEYS.lastEmail).then((email) => {
      if (email) setValue('email', email)
    })
  }, [setValue])

  const submit = handleSubmit(async ({ email, password }) => {
    setFailure(null)
    try {
      const outcome = await signIn(email, password)
      // Several workspaces: the person chooses one before anything is shown (membership doc §6).
      if (outcome.kind === 'chooseWorkspace') router.replace('/choose-workspace' as never)
      else if (outcome.kind === 'noWorkspace') setFailure('Your account is not in any workspace yet. Ask for an invitation, or create a workspace on the OctaPM web platform.')
    } catch (error) {
      setFailure(userMessage(error))
    }
  })

  const tryUnlock = async () => {
    setUnlocking(true)
    setFailure(null)
    try {
      const ok = await unlock()
      if (!ok && useAuthStore.getState().status !== 'signedIn') setFailure('Unlock did not complete. Sign in with your password instead.')
    } catch (error) {
      setFailure(userMessage(error))
    } finally {
      setUnlocking(false)
    }
  }

  const locked = status === 'locked' && biometricEnabled && biometric !== 'none'

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, { backgroundColor: theme.colors.brand }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.panel, !isCompact && styles.panelWide]}>
          <Wordmark color="#fff" height={30} />
          <Text variant="display" tone="onBrand" style={styles.headline}>
            One platform, total project control
          </Text>

          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <Text variant="title">Sign in</Text>
            <Text tone="muted" style={styles.lede}>
              Use the same email and password as the OctaPM web platform.
            </Text>

            {reason === 'expired' ? (
              <Text tone="warning" accessibilityLiveRegion="polite">
                Your session ended. Sign in again to continue.
              </Text>
            ) : reason === 'revoked' ? (
              <Text tone="error" accessibilityLiveRegion="polite">
                Your access was changed by an administrator. Sign in again.
              </Text>
            ) : null}

            {locked ? (
              <Button
                title={`Unlock with ${biometricLabel(biometric)}`}
                size="lg"
                fullWidth
                loading={unlocking}
                onPress={tryUnlock}
                testID="sign-in-biometric"
              />
            ) : null}

            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <Input
                  label="Email"
                  required
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="username"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  testID="sign-in-email"
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <Input
                  ref={passwordRef}
                  label="Password"
                  required
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  testID="sign-in-password"
                />
              )}
            />

            {failure ? (
              <Text tone="error" accessibilityRole="alert" testID="sign-in-error">
                {failure}
              </Text>
            ) : null}

            <Button title="Sign in" size="lg" fullWidth loading={formState.isSubmitting} onPress={submit} testID="sign-in-submit" />

            {/*
              The alternatives sit behind a divider and a deliberate gap. They
              both leave the app for a browser, so a near-miss on "Sign in"
              must land on inert space rather than on one of them.
            */}
            <View style={styles.alternatives}>
              <View style={styles.dividerRow}>
                <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
                <Text variant="caption" tone="muted">
                  or
                </Text>
                <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
              </View>
              <Button
                title="Sign in with company SSO"
                variant="ghost"
                fullWidth
                onPress={() => WebBrowser.openBrowserAsync(`${env.webOrigin}/sign-in?sso=1`)}
                testID="sign-in-sso"
              />
              <Button
                title="Forgot password?"
                variant="ghost"
                fullWidth
                onPress={() => WebBrowser.openBrowserAsync(`${env.webOrigin}/forgot-password`)}
                testID="sign-in-forgot"
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Top-aligned, not centred: a validation message or a session notice changes
  // the card's height, and a centred card moves every control under the
  // person's thumb as it does.
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg, justifyContent: 'flex-start' },
  panel: { gap: spacing.xl, alignSelf: 'stretch' },
  panelWide: { maxWidth: 480, alignSelf: 'center', width: '100%' },
  headline: { maxWidth: 420 },
  card: { borderRadius: 16, padding: spacing.xl, gap: spacing.lg },
  lede: { marginTop: -spacing.sm },
  /** Separated from the primary action so a near-miss lands on nothing. */
  alternatives: { gap: spacing.xs, marginTop: spacing.sm },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.xs },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
})
