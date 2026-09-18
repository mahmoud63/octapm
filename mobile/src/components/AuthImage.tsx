import { useEffect, useState } from 'react'
import { Image, Platform, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native'
import { useAuthStore } from '@/auth/store'
import { env } from '@/config/env'
import { Skeleton, Text, useTheme } from '@/design-system'

const cache = new Map<string, string>()

/**
 * An image the API guards with the bearer. On a device the image loader can
 * send headers; on the web target the bytes are fetched first and shown from
 * an object URL. Either way the token never appears in a URL.
 */
export function AuthImage({ apiPath, style, alt, testID }: { apiPath: string; style?: StyleProp<ImageStyle>; alt: string; testID?: string }) {
  const theme = useTheme()
  const token = useAuthStore((s) => s.accessToken)
  const url = `${env.apiBase}${apiPath}`
  const [webUri, setWebUri] = useState<string | null>(Platform.OS === 'web' ? (cache.get(apiPath) ?? null) : null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (Platform.OS !== 'web' || webUri || !token) return
    let cancelled = false
    fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-OctaPM-Client': 'mobile' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const objectUrl = URL.createObjectURL(await response.blob())
        cache.set(apiPath, objectUrl)
        if (!cancelled) setWebUri(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [apiPath, url, token, webUri])

  if (failed) {
    return (
      <View style={[styles.fallback, style as StyleProp<ImageStyle>, { backgroundColor: theme.colors.skeleton }]} testID={testID}>
        <Text variant="caption" tone="muted">
          No preview
        </Text>
      </View>
    )
  }
  if (Platform.OS === 'web') {
    if (!webUri) return <Skeleton height={120} style={style as never} />
    return <Image source={{ uri: webUri }} style={style} accessibilityLabel={alt} testID={testID} />
  }
  return <Image source={{ uri: url, headers: token ? { Authorization: `Bearer ${token}`, 'X-OctaPM-Client': 'mobile' } : undefined }} style={style} accessibilityLabel={alt} onError={() => setFailed(true)} testID={testID} />
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
})
