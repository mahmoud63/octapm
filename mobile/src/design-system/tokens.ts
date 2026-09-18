/**
 * The OctaPM brand, as the app draws it.
 *
 * The palette is the brand book's, by way of the product's theme. Semantic
 * colours are separate from the accent and are never the only carrier of a
 * status: a badge always has a word next to its colour.
 */
export const palette = {
  midnightIndigo: '#0F1B64',
  midnightIndigoDeep: '#0A1247',
  royalBlue: '#325FEC',
  azure: '#3388FF',
  azureSoft: '#EAF2FF',
  turquoise: '#13C1CE',
  charcoal: '#121B21',
  charcoalMuted: '#5A6672',
  lightGray: '#DCDEDD',
  lightGraySoft: '#F4F6FA',
  white: '#FFFFFF',
  success: '#26AC7A',
  successSoft: '#E6F6EF',
  warning: '#FDC047',
  warningSoft: '#FFF6DE',
  error: '#F2445C',
  errorSoft: '#FDE8EB',
} as const

export type ColorScheme = 'light' | 'dark'

export interface Theme {
  scheme: ColorScheme
  colors: {
    background: string
    surface: string
    surfaceRaised: string
    border: string
    text: string
    textMuted: string
    textOnBrand: string
    brand: string
    brandStrong: string
    accent: string
    link: string
    success: string
    successSoft: string
    warning: string
    warningSoft: string
    error: string
    errorSoft: string
    info: string
    infoSoft: string
    skeleton: string
    overlay: string
  }
}

export const lightTheme: Theme = {
  scheme: 'light',
  colors: {
    background: palette.lightGraySoft,
    surface: palette.white,
    surfaceRaised: palette.white,
    border: '#D8DEEA',
    text: palette.charcoal,
    textMuted: palette.charcoalMuted,
    textOnBrand: palette.white,
    brand: palette.midnightIndigo,
    brandStrong: palette.royalBlue,
    accent: palette.turquoise,
    link: palette.royalBlue,
    success: palette.success,
    successSoft: palette.successSoft,
    warning: '#B77E00',
    warningSoft: palette.warningSoft,
    error: palette.error,
    errorSoft: palette.errorSoft,
    info: palette.azure,
    infoSoft: palette.azureSoft,
    skeleton: '#E6EAF2',
    overlay: 'rgba(15, 27, 100, 0.45)',
  },
}

export const darkTheme: Theme = {
  scheme: 'dark',
  colors: {
    background: '#0B1230',
    surface: '#131C45',
    surfaceRaised: '#1A2456',
    border: '#2A3670',
    text: '#F2F5FB',
    textMuted: '#A9B3CC',
    textOnBrand: palette.white,
    brand: '#7C9BFF',
    brandStrong: '#8FB0FF',
    accent: palette.turquoise,
    link: '#8FB0FF',
    success: '#4CCB9A',
    successSoft: '#123A2E',
    warning: palette.warning,
    warningSoft: '#3E3212',
    error: '#FF6F82',
    errorSoft: '#4A1A22',
    info: '#66A8FF',
    infoSoft: '#16284F',
    skeleton: '#243060',
    overlay: 'rgba(0, 0, 0, 0.55)',
  },
}

/** A four-point grid, in density-independent pixels. */
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 999 } as const

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  mono: undefined as string | undefined,
} as const

/** Type scale. Sizes are the minimum: dynamic type may scale them up. */
export const type = {
  display: { fontSize: 28, lineHeight: 34, fontFamily: fonts.display },
  title: { fontSize: 22, lineHeight: 28, fontFamily: fonts.display },
  heading: { fontSize: 17, lineHeight: 22, fontFamily: fonts.displayMedium },
  body: { fontSize: 15, lineHeight: 21, fontFamily: fonts.body },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontFamily: fonts.bodySemibold },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fonts.body },
  label: { fontSize: 11, lineHeight: 14, fontFamily: fonts.bodySemibold, letterSpacing: 0.6 },
  kpi: { fontSize: 26, lineHeight: 30, fontFamily: fonts.display },
} as const

/** The smallest thing a finger should have to hit. */
export const tapTarget = 44

/** Width breakpoints, in dp. Layout decisions key on these, never on device names. */
export const breakpoints = { medium: 600, expanded: 900, large: 1200 } as const
