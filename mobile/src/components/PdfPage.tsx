import { useEffect, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { AppError, fromStatus, userMessage } from '@/api/errors'
import { network } from '@/api/network'
import { useAuthStore } from '@/auth/store'
import { env } from '@/config/env'
import { ErrorState, Skeleton, Text, spacing } from '@/design-system'

/**
 * One page of a PDF the API guards with the bearer, with the platform's own
 * zoom and pan.
 *
 * Web target: the bytes are fetched with the token and shown in the
 * browser's viewer, opened at the sheet's page and fitted to width.
 * iOS: the file is saved to the app cache and shown in a WebView, which
 * renders PDFs natively. Android: a WebView does not render PDFs by itself;
 * a bundled pdf.js viewer is on the native verification list, and until
 * then the sheet opens in the system viewer through the share sheet.
 */
export function PdfPage({ apiPath, page, fileName, testID }: { apiPath: string; page?: number | null; fileName?: string | null; testID?: string }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; uri: string } | { status: 'error'; message: string }>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const load = async () => {
      try {
        if (network.isKnownOffline()) throw new AppError('OFFLINE')
        const token = useAuthStore.getState().accessToken
        if (!token) throw new AppError('AUTH_REQUIRED')
        const url = `${env.apiBase}${apiPath}`
        const headers = { Authorization: `Bearer ${token}`, 'X-OctaPM-Client': 'mobile' }
        if (Platform.OS === 'web') {
          const response = await fetch(url, { headers })
          if (!response.ok) throw fromStatus(response.status, await response.json().catch(() => null), response.headers.get('x-request-id'))
          const blob = await response.blob()
          objectUrl = URL.createObjectURL(blob)
          if (!cancelled) setState({ status: 'ready', uri: `${objectUrl}#page=${page ?? 1}&zoom=page-width` })
          return
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy')
        const target = `${FileSystem.cacheDirectory ?? ''}sheet-${(fileName ?? 'sheet').replace(/[^\w.-]+/g, '_')}`
        const result = await FileSystem.downloadAsync(url, target, { headers })
        if (result.status >= 400) throw fromStatus(result.status, undefined, null)
        if (!cancelled) setState({ status: 'ready', uri: result.uri })
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: userMessage(error) })
      }
    }
    void load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [apiPath, page, fileName])

  if (state.status === 'loading') {
    return (
      <View style={styles.frame} testID={testID}>
        <Skeleton height={320} />
        <Text variant="caption" tone="muted">
          Loading the sheet…
        </Text>
      </View>
    )
  }
  if (state.status === 'error') {
    return (
      <View style={styles.frame} testID={testID}>
        <ErrorState message={state.message} />
      </View>
    )
  }

  if (Platform.OS === 'web') {
    // react-native-web has no iframe; the DOM element is used directly on this target only.
    const Frame = 'iframe' as unknown as React.ComponentType<Record<string, unknown>>
    return (
      <View style={styles.frame} testID={testID}>
        <Frame src={state.uri} title={fileName ?? 'Sheet'} style={{ width: '100%', height: 640, border: 0 }} />
      </View>
    )
  }

  // Loaded here, not at the top: the package has no web implementation and must stay out of the web bundle's module graph at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview')
  return (
    <View style={styles.frame} testID={testID}>
      <WebView source={{ uri: state.uri }} style={styles.web} originWhitelist={['*']} allowFileAccess allowFileAccessFromFileURLs allowUniversalAccessFromFileURLs setBuiltInZoomControls setDisplayZoomControls={false} />
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { gap: spacing.sm, minHeight: 320 },
  web: { height: 640, backgroundColor: 'transparent' },
})
