import type { useTheme } from '@/design-system'

type Theme = ReturnType<typeof useTheme>

/** The header every route group's stack draws, from the theme. */
export const stackScreenOptions = (theme: Theme) => ({
  headerShown: true,
  headerTintColor: theme.colors.brand,
  headerTitleStyle: { fontFamily: 'SpaceGrotesk_600SemiBold', color: theme.colors.text },
  headerStyle: { backgroundColor: theme.colors.background },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: theme.colors.background },
})
