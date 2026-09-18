/**
 * Native push notifications.
 *
 * On a device the app asks for permission once, obtains its Expo push token
 * and registers it on the server's push subscription route as provider
 * "expo"; the server then sends every notification the person has push
 * enabled for through Expo's service. The token is remembered on the device
 * only so that sign-out can remove it from the server. A tap on a
 * notification opens the record it names through the deep-link resolver.
 *
 * The web target has no native push (the web platform's own Web Push serves
 * browsers) and a simulator has no token, so both report "unsupported" and
 * nothing else happens. Registration never blocks sign-in and never fails
 * it: a refused permission or a failed request is logged and forgotten.
 */
import { Platform } from 'react-native'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { api, run } from '@/api/client'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { env } from '@/config/env'
import { resolveNotificationData, routeForResolvedLink } from '@/navigation/deepLinks'
import { useProjectStore } from '@/projects/store'
import { log } from '@/utilities/logger'

export type PushRegistration = 'registered' | 'unsupported' | 'denied' | 'failed'

export const pushSupported = () => Platform.OS !== 'web' && Device.isDevice

/** Ask, obtain the token and register it. Safe to call after every sign-in: the server upserts by token. */
export async function registerPushDevice(): Promise<PushRegistration> {
  if (!pushSupported()) return 'unsupported'
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'OctaPM', importance: Notifications.AndroidImportance.DEFAULT })
    }
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') {
      log.info('notification', 'push permission not granted', { status })
      return 'denied'
    }
    const token = (await Notifications.getExpoPushTokenAsync(env.easProjectId ? { projectId: env.easProjectId } : undefined)).data
    await run(() => api.POST('/notifications/push/subscriptions', { body: { provider: 'expo', token, platform: Platform.OS, deviceName: Device.modelName ?? undefined } as never }) as never)
    await secureStorage.set(STORAGE_KEYS.pushToken, token)
    log.info('notification', 'push device registered', { platform: Platform.OS })
    return 'registered'
  } catch (error) {
    log.warn('notification', 'push registration failed', { message: error instanceof Error ? error.message : String(error) })
    return 'failed'
  }
}

/** Remove this device's token from the server; called before the session ends, while the token can still be presented. */
export async function unregisterPushDevice(): Promise<void> {
  const token = await secureStorage.get(STORAGE_KEYS.pushToken).catch(() => null)
  if (!token) return
  await secureStorage.remove(STORAGE_KEYS.pushToken).catch(() => undefined)
  try {
    await run(() => api.DELETE('/notifications/push/subscriptions', { body: { token } as never }) as never)
  } catch (error) {
    log.warn('notification', 'push device could not be removed', { message: error instanceof Error ? error.message : String(error) })
  }
}

type ResponseLike = { notification: { request: { content: { data?: Record<string, unknown> | null } } } }

/** The app route a tapped notification opens, through the opener when the project must change. Null when it names nothing. */
export function routeForNotificationResponse(response: ResponseLike | null | undefined): string | null {
  const data = response?.notification?.request?.content?.data as { entityType?: string | null; entityId?: string | null; projectId?: string | null; url?: string | null } | null | undefined
  const resolved = resolveNotificationData(data)
  if (!resolved) return null
  return routeForResolvedLink(resolved, useProjectStore.getState().currentProjectId)
}

const openResponse = (response: ResponseLike | null | undefined) => {
  const route = routeForNotificationResponse(response) ?? '/notifications'
  try {
    router.push(route as never)
  } catch (error) {
    log.warn('navigation', 'notification tap could not be opened', { route, message: String(error) })
  }
}

/** Show notifications while the app is open and route taps. Native only; returns a stop function. */
export function startPushNotifications(): () => void {
  if (Platform.OS === 'web') return () => undefined
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    })
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => openResponse(response as unknown as ResponseLike))
    // A cold start from a notification: the response that launched the app.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) openResponse(response as unknown as ResponseLike)
      })
      .catch(() => undefined)
    return () => subscription.remove()
  } catch (error) {
    log.warn('notification', 'push listeners could not start', { message: String(error) })
    return () => undefined
  }
}
