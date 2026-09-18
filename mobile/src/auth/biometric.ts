/**
 * Biometric unlock.
 *
 * Face ID, Touch ID or an Android biometric unlocks a session the app already
 * holds. It proves the person is the one who signed in; it does not sign
 * anybody in. The refresh token still has to be accepted by the server, so a
 * revoked session stays revoked no matter whose face is in front of the phone.
 */
import * as LocalAuthentication from 'expo-local-authentication'
import { Platform } from 'react-native'

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none'

export async function availableBiometric(): Promise<BiometricKind> {
  if (Platform.OS === 'web') return 'none'
  const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])
  if (!hardware || !enrolled) return 'none'
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face'
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint'
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris'
  return 'none'
}

export const biometricLabel = (kind: BiometricKind): string =>
  ({ face: Platform.OS === 'ios' ? 'Face ID' : 'Face unlock', fingerprint: Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint', iris: 'Iris unlock', none: 'Biometric unlock' })[kind]

/** True if the person passed the device's check. */
export async function promptBiometric(reason = 'Unlock OctaPM'): Promise<boolean> {
  if (Platform.OS === 'web') return false
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Use password',
    disableDeviceFallback: false,
  })
  return result.success
}
