export const MONEY_INPUT_STEP = '0.01'

export const MONEY_PRECISION_MESSAGE =
  'Use dollars and cents only (max 2 decimal places).'

export function hasMoneyPrecision(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false
    return Math.abs(Math.round(value * 100) - value * 100) < 1e-9
  }

  const text = String(value).replace(/,/g, '').trim()
  if (!/^-?\d+(\.\d+)?$/.test(text)) return false

  const fraction = text.split('.')[1] ?? ''
  return fraction.replace(/0+$/, '').length <= 2
}

export function toMoneyNumber(value: unknown, fallback = 0): number {
  const numeric = Number(
    String(value ?? '')
      .replace(/,/g, '')
      .trim()
  )
  if (!Number.isFinite(numeric)) return fallback
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}
