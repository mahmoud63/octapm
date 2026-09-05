import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  currentPushSubscription,
  notificationPermission,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push'

export interface PushDeviceStatus {
  supported: boolean
  configured: boolean
  publicKey: string | null
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  endpoint: string | null
  devices: Array<{
    id: string
    endpoint: string
    platform: string | null
    userAgent: string | null
    lastUsedAt: string | null
    createdAt: string | null
  }>
}

export const pushStatusKey = ['push', 'status'] as const

export const usePushDevice = () => {
  const qc = useQueryClient()
  const status = useQuery<PushDeviceStatus>({
    queryKey: pushStatusKey,
    queryFn: async () => {
      const { data } = await apiClient.get<{
        data: {
          configured: boolean
          publicKey: string | null
          items: PushDeviceStatus['devices']
        }
      }>('/notifications/push/subscriptions')
      const subscription = await currentPushSubscription().catch(() => null)
      return {
        supported: pushSupported(),
        configured: data.data.configured,
        publicKey: data.data.publicKey,
        permission: notificationPermission(),
        subscribed: Boolean(subscription),
        endpoint: subscription?.endpoint ?? null,
        devices: data.data.items,
      }
    },
  })

  const enable = useMutation({
    mutationFn: async () => {
      const key = status.data?.publicKey
      if (!key) throw new Error('Push is not configured on this server yet')
      const subscription = await subscribeToPush(key)
      await apiClient.post(
        '/notifications/push/subscriptions',
        subscription.toJSON()
      )
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pushStatusKey }),
  })

  const disable = useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeFromPush()
      if (endpoint) {
        await apiClient.delete('/notifications/push/subscriptions', {
          data: { endpoint },
        })
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pushStatusKey }),
  })

  const test = useMutation({
    mutationFn: () =>
      apiClient
        .post('/notifications/push/test')
        .then(
          (response) => response.data.data as { sent: number; failed: number }
        ),
  })

  const forget = useMutation({
    mutationFn: (endpoint: string) =>
      apiClient.delete('/notifications/push/subscriptions', {
        data: { endpoint },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: pushStatusKey }),
  })

  return { status, enable, disable, test, forget }
}
