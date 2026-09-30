/** Number, money and date formatting shared by the PC-5 detail drawers. */
export const formatQuantity = (value: number | null | undefined) =>
  value == null
    ? '—'
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })

export const formatMoney = (currency: string, value: number | null | undefined) =>
  value == null
    ? '—'
    : `${currency} ${Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`

export const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—'
