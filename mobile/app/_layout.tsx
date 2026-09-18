import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter'
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk'
import { QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { queryClient } from '@/api/query'
import { analytics } from '@/analytics'
import { bootstrap } from '@/auth/session'
import { useAuthStore } from '@/auth/store'
import { env } from '@/config/env'
import { ThemeProvider, useTheme } from '@/design-system'
import { log } from '@/utilities/logger'

SplashScreen.preventAutoHideAsync().catch(() => undefined)

/**
 * The root of the app.
 *
 * Fonts, theme, the query cache and the session all start here. The splash
 * screen stays up until the session has been checked, so the first frame a
 * person sees is either their workspace or the sign-in screen, never a flash
 * of the wrong one.
 */
export default function RootLayout() {
  const [fontsReady] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold })
  const status = useAuthStore((s) => s.status)

  useEffect(() => {
    analytics.configure(() => undefined, { env: env.name, appVersion: env.appVersion })
    bootstrap().catch((error) => log.error('auth', 'session bootstrap failed', { message: String(error) }))
  }, [])

  useEffect(() => {
    if (fontsReady && status !== 'booting') SplashScreen.hideAsync().catch(() => undefined)
  }, [fontsReady, status])

  if (!fontsReady) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <Chrome />
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function Chrome() {
  const theme = useTheme()
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="+not-found" options={{ headerShown: true, title: 'Not found' }} />
      </Stack>
    </>
  )
}
