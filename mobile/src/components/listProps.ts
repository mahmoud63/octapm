import { Platform } from 'react-native'

/**
 * Rendering budget for every record list. Long registers (activities,
 * ledger, photos) are windowed so a low-end phone draws a screenful first
 * and fills in as the person scrolls; clipped rows are dropped from the
 * native view hierarchy. Spread onto every FlatList.
 */
export const listPerformance = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 10,
  updateCellsBatchingPeriod: 50,
  windowSize: 7,
  removeClippedSubviews: Platform.OS !== 'web',
} as const
