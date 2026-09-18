/**
 * Where the refresh token lives.
 *
 * On a device it is the platform keychain or keystore, through expo-secure-store.
 * On the web target, which exists for development and adaptive-layout testing
 * rather than for field use, there is no keychain; the value goes to session
 * storage so a reload survives but a closed tab does not, and the app says so.
 * Nothing is ever written in plaintext to a file.
 */
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const KEY_PREFIX = 'octapm.'

const webStore = (): Storage | null => {
  try {
    return typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis ? globalThis.sessionStorage : null
  } catch {
    return null
  }
}

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return webStore()?.getItem(KEY_PREFIX + key) ?? null
    return SecureStore.getItemAsync(KEY_PREFIX + key)
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStore()?.setItem(KEY_PREFIX + key, value)
      return
    }
    await SecureStore.setItemAsync(KEY_PREFIX + key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStore()?.removeItem(KEY_PREFIX + key)
      return
    }
    await SecureStore.deleteItemAsync(KEY_PREFIX + key)
  },
  /** True where the platform keeps secrets in hardware-backed storage. */
  isHardwareBacked: Platform.OS !== 'web',
}

export const STORAGE_KEYS = {
  refreshToken: 'session.refresh',
  biometricUnlock: 'session.biometric',
  lastEmail: 'session.email',
  /** The last known profile, so the app can open while offline. Never a token. */
  profile: 'session.profile',
} as const
