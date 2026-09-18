import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer } from '@/testing/fake-server'
import { registerPushDevice, routeForNotificationResponse, startPushNotifications, unregisterPushDevice } from './push'

const P = 'a2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
const device = { set isDevice(value: boolean) { (Device as unknown as { __setDevice: (v: boolean) => void }).__setDevice(value) } }
const notifications = Notifications as unknown as Record<string, jest.Mock>
const user = { id: 'u1', email: 'pm@octapm-e2e.test', name: 'Dana', role: 'project_manager' as const, orgId: 'org', status: 'active', isCompanyAdmin: false }

describe('native push', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    device.isDevice = false
    useAuthStore.setState({ status: 'signedIn', accessToken: 'token-1', user })
    useProjectStore.setState({ currentProjectId: P, hydrated: true })
    await secureStorage.remove(STORAGE_KEYS.pushToken)
  })

  it('does nothing without a real device', async () => {
    const calls = fakeServer({})
    expect(await registerPushDevice()).toBe('unsupported')
    expect(calls).toHaveLength(0)
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled()
  })

  it('stops at a refused permission and never registers', async () => {
    device.isDevice = true
    notifications.getPermissionsAsync!.mockResolvedValueOnce({ status: 'undetermined' })
    notifications.requestPermissionsAsync!.mockResolvedValueOnce({ status: 'denied' })
    const calls = fakeServer({})
    expect(await registerPushDevice()).toBe('denied')
    expect(calls).toHaveLength(0)
    expect(await secureStorage.get(STORAGE_KEYS.pushToken)).toBeNull()
  })

  it('registers the Expo token as an expo subscription, remembers it, and removes it on sign-out', async () => {
    device.isDevice = true
    const calls = fakeServer({
      'POST /notifications/push/subscriptions': () => ({ status: 201, body: envelope({ id: 's1', provider: 'expo' }) }),
      'DELETE /notifications/push/subscriptions': () => ({ status: 200, body: envelope({ removed: 1 }) }),
    })
    expect(await registerPushDevice()).toBe('registered')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/notifications/push/subscriptions', body: { provider: 'expo', token: 'ExponentPushToken[test-device]', platform: 'ios', deviceName: 'Test device' } })
    expect(await secureStorage.get(STORAGE_KEYS.pushToken)).toBe('ExponentPushToken[test-device]')

    await unregisterPushDevice()
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ method: 'DELETE', body: { token: 'ExponentPushToken[test-device]' } })
    expect(await secureStorage.get(STORAGE_KEYS.pushToken)).toBeNull()
    // Nothing stored, nothing to remove.
    await unregisterPushDevice()
    expect(calls).toHaveLength(2)
  })

  it('reports a failed registration without throwing', async () => {
    device.isDevice = true
    fakeServer({})
    expect(await registerPushDevice()).toBe('failed')
    expect(await secureStorage.get(STORAGE_KEYS.pushToken)).toBeNull()
  })

  it('routes a tapped notification to its record, through the opener when the project differs', () => {
    const response = (data: Record<string, unknown>) => ({ notification: { request: { content: { data } } } })
    expect(routeForNotificationResponse(response({ entityType: 'rfi', entityId: 'r1', projectId: P }))).toBe('/rfi/r1')
    expect(routeForNotificationResponse(response({ entityType: 'rfi', entityId: 'r1', projectId: 'b2153ef4-0bbb-4b9a-875c-44a0f69f9a12' }))).toBe('/open?to=%2Frfi%2Fr1&projectId=b2153ef4-0bbb-4b9a-875c-44a0f69f9a12')
    expect(routeForNotificationResponse(response({ url: `/projects/${P}/tasks?recordId=t1&source=task` }))).toBe('/tasks/t1')
    expect(routeForNotificationResponse(response({}))).toBeNull()
    expect(routeForNotificationResponse(null)).toBeNull()
  })

  it('listens for taps and opens the record, falling back to the notifications list', () => {
    const stop = startPushNotifications()
    expect(notifications.setNotificationHandler).toHaveBeenCalled()
    const listener = notifications.addNotificationResponseReceivedListener!.mock.calls[0]![0] as (response: unknown) => void
    listener({ notification: { request: { content: { data: { entityType: 'ncr', entityId: 'n1', projectId: P } } } } })
    expect(router.push).toHaveBeenCalledWith('/quality/ncr/n1')
    listener({ notification: { request: { content: { data: {} } } } })
    expect(router.push).toHaveBeenCalledWith('/notifications')
    stop()
  })
})
