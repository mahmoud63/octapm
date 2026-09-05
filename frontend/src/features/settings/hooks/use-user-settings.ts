import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthUser } from '@/services/auth/types'
import { apiClient } from '@/services/api/client'
import { useAuthStore } from '@/stores/auth-store'
import type { fonts } from '@/config/fonts'

export const userSettingsKey = ['user-settings'] as const

export const languages = [
  { label: 'English', value: 'en' },
  { label: 'French', value: 'fr' },
  { label: 'German', value: 'de' },
  { label: 'Spanish', value: 'es' },
  { label: 'Portuguese', value: 'pt' },
  { label: 'Russian', value: 'ru' },
  { label: 'Japanese', value: 'ja' },
  { label: 'Korean', value: 'ko' },
  { label: 'Chinese', value: 'zh' },
] as const

export const displayNavigationItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'users', label: 'Users' },
  { id: 'help-center', label: 'Help Center' },
] as const

export type UserLanguage = (typeof languages)[number]['value']
export type UserFont = (typeof fonts)[number]
export type UserTheme = 'light' | 'dark' | 'system'
export type DisplayNavigationItemId =
  (typeof displayNavigationItems)[number]['id']

export interface UserSettingsResponse {
  user: AuthUser
  profile: {
    username: string
    email: string
    bio: string
    urls: Array<{ value: string }>
  }
  account: {
    name: string
    dob: string | null
    language: UserLanguage
  }
  appearance: {
    theme: UserTheme
    font: UserFont
  }
  display: {
    items: DisplayNavigationItemId[]
  }
}

export type UpdateProfileSettingsPayload = {
  username: string
  bio?: string | null
  urls?: Array<{ value: string }>
}

export type UpdateAccountSettingsPayload = {
  name: string
  dob?: string | null
  language: UserLanguage
}

export type UpdateAppearanceSettingsPayload = {
  theme: UserTheme
  font: UserFont
}

export type UpdateDisplaySettingsPayload = {
  items: DisplayNavigationItemId[]
}

const getSettings = (response: {
  data: { data: UserSettingsResponse }
}): UserSettingsResponse => response.data.data

const useSettingsMutation = <Payload>(path: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: Payload) =>
      apiClient.patch(path, payload).then(getSettings),
    onSuccess: (settings) => {
      queryClient.setQueryData(userSettingsKey, settings)
      useAuthStore.getState().auth.setUser(settings.user)
    },
  })
}

export function useUserSettings() {
  return useQuery<UserSettingsResponse>({
    queryKey: userSettingsKey,
    queryFn: () => apiClient.get('/auth/me/settings').then(getSettings),
  })
}

export const useUpdateProfileSettings = () =>
  useSettingsMutation<UpdateProfileSettingsPayload>('/auth/me/profile')

export const useUpdateAccountSettings = () =>
  useSettingsMutation<UpdateAccountSettingsPayload>('/auth/me/account')

export const useUpdateAppearanceSettings = () =>
  useSettingsMutation<UpdateAppearanceSettingsPayload>('/auth/me/appearance')

export const useUpdateDisplaySettings = () =>
  useSettingsMutation<UpdateDisplaySettingsPayload>('/auth/me/display')
