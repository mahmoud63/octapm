/**
 * How much room there is, and therefore which layout to draw.
 *
 * Decisions key on the width the app actually has — a phone in landscape, an
 * iPad in split view, a tablet in portrait — never on the device's name.
 *
 *   compact   < 600 dp   phones; single column, bottom tabs, cards for tables
 *   medium    600–899    small tablets, large phones in landscape; two columns
 *   expanded  ≥ 900      tablets; navigation rail, master–detail, real tables
 */
import { useWindowDimensions } from 'react-native'
import { breakpoints } from '@/design-system/tokens'

export type WidthClass = 'compact' | 'medium' | 'expanded'

export interface Layout {
  width: number
  height: number
  widthClass: WidthClass
  isCompact: boolean
  isMedium: boolean
  isExpanded: boolean
  isLandscape: boolean
  /** Master–detail is worth drawing only when both panes get real room. */
  splitView: boolean
  /** How many columns a grid of cards should use. */
  columns: number
}

export function classify(width: number): WidthClass {
  if (width >= breakpoints.expanded) return 'expanded'
  if (width >= breakpoints.medium) return 'medium'
  return 'compact'
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions()
  const widthClass = classify(width)
  return {
    width,
    height,
    widthClass,
    isCompact: widthClass === 'compact',
    isMedium: widthClass === 'medium',
    isExpanded: widthClass === 'expanded',
    isLandscape: width > height,
    splitView: widthClass === 'expanded',
    columns: widthClass === 'expanded' ? (width >= breakpoints.large ? 3 : 2) : widthClass === 'medium' ? 2 : 1,
  }
}
