import { useState } from 'react'

/** List state: filters reset the page to 1. */
export function useListState<T extends Record<string, string>>(initial: T) {
  const [filters, setFilters] = useState<T>(initial)
  const [page, setPage] = useState(1)
  const set = (key: keyof T) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }
  return { filters, set, page, setPage }
}
