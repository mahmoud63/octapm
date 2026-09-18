/**
 * Favourite and recently viewed sheets, per device. Not sensitive, not
 * server state: a small list kept alongside the session so it is cleared
 * with it.
 */
import { create } from 'zustand'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'

interface DrawingPrefs {
  favourites: string[]
  recents: string[]
  hydrated: boolean
  hydrate: () => Promise<void>
  toggleFavourite: (sheetId: string) => Promise<void>
  noteViewed: (sheetId: string) => Promise<void>
}

const MAX_RECENTS = 12

async function persist(state: Pick<DrawingPrefs, 'favourites' | 'recents'>) {
  await secureStorage.set(STORAGE_KEYS.drawingPrefs, JSON.stringify({ favourites: state.favourites, recents: state.recents }))
}

export const useDrawingPrefs = create<DrawingPrefs>((set, get) => ({
  favourites: [],
  recents: [],
  hydrated: false,
  hydrate: async () => {
    const raw = await secureStorage.get(STORAGE_KEYS.drawingPrefs)
    try {
      const parsed = raw ? (JSON.parse(raw) as { favourites?: string[]; recents?: string[] }) : {}
      set({ favourites: parsed.favourites ?? [], recents: parsed.recents ?? [], hydrated: true })
    } catch {
      set({ favourites: [], recents: [], hydrated: true })
    }
  },
  toggleFavourite: async (sheetId) => {
    const { favourites } = get()
    const next = favourites.includes(sheetId) ? favourites.filter((id) => id !== sheetId) : [...favourites, sheetId]
    set({ favourites: next })
    await persist({ favourites: next, recents: get().recents })
  },
  noteViewed: async (sheetId) => {
    const recents = [sheetId, ...get().recents.filter((id) => id !== sheetId)].slice(0, MAX_RECENTS)
    set({ recents })
    await persist({ favourites: get().favourites, recents })
  },
}))
