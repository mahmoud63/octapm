import { configure } from '@testing-library/react-native'
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

// findBy* and waitFor default to one second, which a loaded machine can miss
// while a screen's queries settle. Nothing in the app waits on real time.
configure({ asyncUtilTimeout: 5000 })

/**
 * A deterministic starting state for every test.
 *
 * The app is built on module singletons — one query client, one outbox, one
 * network signal, one auth store, one project store — and a test file shares
 * all of them across its cases. Clearing the query cache is not enough on its
 * own: `clear()` does not cancel what is already in flight, so a fetch started
 * by the previous test lands in the cache *after* the clear and the next test
 * sees an answer it never asked for. That is what made a permissions test
 * read the server's matrix where it expected the offline fallback, and it is
 * the kind of failure that moves from test to test between runs.
 *
 * This runs before any file's own `beforeEach`, so a file that sets up its own
 * state still wins.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
beforeEach(async () => {
  // The app binds the session's refresh and token into the request layer as it
  // starts. Tests get the same binding, so a call carries the token the store
  // holds — without it the request layer sees no session at all and refuses to
  // send, which is the app's correct behaviour and a confusing test failure.
  require('@/auth/session')
  mockMemory.clear()
  ;(jest.requireMock('expo-sqlite') as { __rows?: Map<string, string> }).__rows?.clear()

  const { queryClient } = require('@/api/query') as typeof import('@/api/query')
  await queryClient.cancelQueries()
  queryClient.clear()

  const { network } = require('@/api/network') as typeof import('@/api/network')
  network.__reset(null)

  const { __resetOutboxForTests } = require('@/offline/outbox') as typeof import('@/offline/outbox')
  __resetOutboxForTests()

  const { useAuthStore } = require('@/auth/store') as typeof import('@/auth/store')
  useAuthStore.setState({ status: 'signedOut', user: null, accessToken: null, accessExpiresAt: null })

  const { useProjectStore } = require('@/projects/store') as typeof import('@/projects/store')
  useProjectStore.setState({ currentProjectId: null, hydrated: false })
})

/** Nothing crosses the boundary: whatever a test left running is stopped here. */
/**
 * Leave nothing running behind the last test of a file.
 *
 * Every cached query schedules a garbage-collection timer, and the default
 * lifetime is five minutes. Clearing only on the way *in* leaves the final
 * test's timers alive, which is what held the worker open and earned the
 * "failed to exit gracefully" warning on every run. Clearing on the way out
 * destroys the queries and their timers with them.
 */
afterEach(async () => {
  const { queryClient } = require('@/api/query') as typeof import('@/api/query')
  await queryClient.cancelQueries()
  queryClient.clear()
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
    // Tests set the params of the screen under test: (useLocalSearchParams as jest.Mock).mockReturnValue({ id })
    useLocalSearchParams: jest.fn(() => ({})),
    useSegments: () => [],
    // Tests set the route of the screen under test: (usePathname as jest.Mock).mockReturnValue('/rfi/r1')
    usePathname: jest.fn(() => '/'),
  }
})

// The root layout's gesture root view, and the signature pad's SVG and capture: the pad draws through the responder system, so plain stand-ins do.
jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native')
  const chain: Record<string, unknown> = {}
  for (const m of ['minDistance', 'runOnJS', 'onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) chain[m] = () => chain
  return { Gesture: { Pan: () => chain }, GestureDetector: ({ children }: { children?: ReactNode }) => children, GestureHandlerRootView: View, ScrollView: require('react-native').ScrollView, State: {}, Directions: {} }
})
jest.mock('react-native-svg', () => {
  const React = require('react')
  const { View } = require('react-native')
  const Stub = (props: Record<string, unknown>) => React.createElement(View, { testID: props.testID as string | undefined }, props.children as ReactNode)
  return { __esModule: true, default: Stub, Svg: Stub, Polyline: Stub, Path: Stub, Line: Stub, Rect: Stub, Circle: Stub, G: Stub }
})
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==') }))

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}))
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  downloadAsync: jest.fn(async (_url: string, target: string) => ({ status: 200, uri: target })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
}))
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }))
jest.mock('react-native-webview', () => ({ WebView: () => null }))
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: jest.fn(() => [{ granted: true, canAskAgain: true }, jest.fn(async () => ({ granted: true }))]) }))
// A memory-backed SQLite that understands the four statements the key-value store uses.
jest.mock('expo-sqlite', () => {
  const rows = new Map<string, string>()
  const db = {
    execAsync: async () => undefined,
    runAsync: async (sql: string, ...params: (string | number)[]) => {
      if (sql.startsWith('INSERT OR REPLACE')) rows.set(String(params[0]), String(params[1]))
      else if (sql.startsWith('DELETE')) rows.delete(String(params[0]))
    },
    getFirstAsync: async (_sql: string, key: string) => (rows.has(key) ? { value: rows.get(key) } : null),
    getAllAsync: async (_sql: string, like: string) => [...rows.keys()].filter((k) => k.startsWith(like.replace(/%$/, ''))).map((key) => ({ key })),
  }
  return { openDatabaseAsync: jest.fn(async () => db), __rows: rows }
})

// Node's FormData refuses the { uri, name, type } file objects React Native's
// FormData accepts. Under test those objects become empty blobs with the same
// name and type, so an upload builds a real multipart request the fake server
// can record.
const RealFormData = globalThis.FormData
class TestFormData extends RealFormData {
  override append(name: string, value: unknown, filename?: string) {
    if (value && typeof value === 'object' && 'uri' in value) {
      const file = value as { name?: string; type?: string }
      super.append(name, new Blob([''], { type: file.type ?? 'application/octet-stream' }), file.name ?? filename ?? 'file')
      return
    }
    // A third argument selects the blob overload, so it is only passed when given.
    if (filename !== undefined) super.append(name, value as Blob, filename)
    else super.append(name, value as string)
  }
}
;(globalThis as { FormData: unknown }).FormData = TestFormData

jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  const frame = { x: 0, y: 0, width: 390, height: 844 }
  const passthrough = ({ children }: { children?: ReactNode }) => children ?? null
  return { SafeAreaProvider: passthrough, SafeAreaView: passthrough, useSafeAreaInsets: () => insets, useSafeAreaFrame: () => frame, initialWindowMetrics: { insets, frame } }
})
jest.mock('expo-image', () => ({ Image: () => null }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }))
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }))

// Native push and the realtime socket: inert doubles. A simulator has no push token, so the
// default device is "not a device"; the push test turns it on. Realtime's own test replaces the socket.
jest.mock('expo-device', () => {
  const state = { isDevice: false }
  return { get isDevice() { return state.isDevice }, modelName: 'Test device', __setDevice: (value: boolean) => { state.isDevice = value } }
})
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-device]' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}))
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => {
    const socket: Record<string, unknown> = { connected: false, auth: {} }
    for (const name of ['on', 'emit', 'connect', 'disconnect', 'removeAllListeners']) socket[name] = jest.fn(() => socket)
    return socket
  }),
}))

