/**
 * Favourite, recently viewed and kept-offline sheets, per device. Not
 * sensitive, not server state: a small record kept alongside the session
 * so it is cleared with it. A kept sheet remembers the revision it was
 * kept at, which is how a newer revision on the server is noticed.
 */
import { create } from 'zustand'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'

export interface KeptSheet {
  revisionId: string
  revision: string
  keptAt: string
  /** The PDF on this device, when the platform could keep one (never on the web target). */
  fileUri: string | null
}

interface DrawingPrefs {
  favourites: string[]
  recents: string[]
  kept: Record<string, KeptSheet>
  hydrated: boolean
  hydrate: () => Promise<void>
  toggleFavourite: (sheetId: string) => Promise<void>
  noteViewed: (sheetId: string) => Promise<void>
  keepOffline: (sheetId: string, kept: Omit<KeptSheet, 'keptAt'>) => Promise<void>
  releaseOffline: (sheetId: string) => Promise<void>
}

const MAX_RECENTS = 12

async function persist(state: Pick<DrawingPrefs, 'favourites' | 'recents' | 'kept'>) {
  await secureStorage.set(STORAGE_KEYS.drawingPrefs, JSON.stringify({ favourites: state.favourites, recents: state.recents, kept: state.kept }))
}

export const useDrawingPrefs = create<DrawingPrefs>((set, get) => ({
  favourites: [],
  recents: [],
  kept: {},
  hydrated: false,
  hydrate: async () => {
    const raw = await secureStorage.get(STORAGE_KEYS.drawingPrefs)
    try {
      const parsed = raw ? (JSON.parse(raw) as { favourites?: string[]; recents?: string[]; kept?: Record<string, KeptSheet> }) : {}
      set({ favourites: parsed.favourites ?? [], recents: parsed.recents ?? [], kept: parsed.kept ?? {}, hydrated: true })
    } catch {
      set({ favourites: [], recents: [], kept: {}, hydrated: true })
    }
  },
  toggleFavourite: async (sheetId) => {
    const { favourites } = get()
    const next = favourites.includes(sheetId) ? favourites.filter((id) => id !== sheetId) : [...favourites, sheetId]
    set({ favourites: next })
    await persist({ ...get(), favourites: next })
  },
  noteViewed: async (sheetId) => {
    const recents = [sheetId, ...get().recents.filter((id) => id !== sheetId)].slice(0, MAX_RECENTS)
    set({ recents })
    await persist({ ...get(), recents })
  },
  keepOffline: async (sheetId, kept) => {
    const next = { ...get().kept, [sheetId]: { ...kept, keptAt: new Date().toISOString() } }
    set({ kept: next })
    await persist({ ...get(), kept: next })
  },
  releaseOffline: async (sheetId) => {
    const next = { ...get().kept }
    delete next[sheetId]
    set({ kept: next })
    await persist({ ...get(), kept: next })
  },
}))
