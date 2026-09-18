import type { ReactNode } from 'react'

/**
 * What every test runs on.
 *
 * Native modules that need a device are replaced with small fakes that behave
 * like the real thing for the paths the app takes: a keychain that remembers,
 * a biometric prompt that succeeds, a network that is online. Tests that need
 * the opposite set it per test. Nothing here touches the real keychain.
 */
const mockMemory = new Map<string, string>()

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockMemory.set(key, value)
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockMemory.delete(key)
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}))

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [1, 2]),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}))

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0-test', extra: { eas: { projectId: '' } } } },
}))

jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: async () => undefined,
}))

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => undefined,
  hideAsync: async () => undefined,
}))

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: () => undefined })),
  NetworkStateType: { NONE: 'NONE', WIFI: 'WIFI', CELLULAR: 'CELLULAR' },
}))

beforeEach(() => {
  mockMemory.clear()
})

export const testMemory = mockMemory

/* eslint-disable @typescript-eslint/no-require-imports */
// Screens render inside a router; under test the router is a few plain views
// so a test can see where a screen sends people and which routes a shell
// declares, without a navigation container.
jest.mock('expo-router', () => {
  const React = require('react')
  const { Text, View } = require('react-native')
  const router = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), navigate: jest.fn() }
  const Screen = ({ name }: { name: string }) => React.createElement(Text, { testID: `route-${name}` }, name)
  const Navigator = ({ children }: { children?: ReactNode }) => React.createElement(View, { testID: 'navigator' }, children)
  return {
    useRouter: () => router,
    router,
    Redirect: ({ href }: { href: string }) => React.createElement(Text, { testID: 'redirect' }, String(href)),
    Link: ({ children }: { children?: ReactNode }) => React.createElement(Text, null, children),
    Stack: Object.assign(Navigator, { Screen }),
    Tabs: Object.assign(Navigator, { Screen }),
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
  }
})

jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  const frame = { x: 0, y: 0, width: 390, height: 844 }
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null
  return { SafeAreaProvider: passthrough, SafeAreaView: passthrough, useSafeAreaInsets: () => insets, useSafeAreaFrame: () => frame, initialWindowMetrics: { insets, frame } }
})
jest.mock('expo-image', () => ({ Image: () => null }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }))
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))
