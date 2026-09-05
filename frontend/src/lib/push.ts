/** Browser-side Web Push helpers (OCTA-MOB-PWA-018). */

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

const urlBase64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(normalized)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

const registration = async () => {
  if (!pushSupported()) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export const currentPushSubscription = async () => {
  const reg = await registration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export const subscribeToPush = async (publicKey: string) => {
  const reg = await registration()
  if (!reg) throw new Error('Install or reload the app before turning on push')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error('Notifications are blocked for OctaPM in this browser')
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  const key = urlBase64ToUint8Array(publicKey)
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key.buffer as ArrayBuffer,
  })
}

export const unsubscribeFromPush = async () => {
  const existing = await currentPushSubscription()
  if (!existing) return null
  const endpoint = existing.endpoint
  await existing.unsubscribe()
  return endpoint
}

export const notificationPermission = ():
  | NotificationPermission
  | 'unsupported' => (pushSupported() ? Notification.permission : 'unsupported')
