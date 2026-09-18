/**
 * The warehouse this device works from, per project. Not sensitive, not
 * server state: kept alongside the session so it is cleared with it.
 */
import { create } from 'zustand'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'

interface InventoryPrefs {
  warehouseByProject: Record<string, string>
  hydrated: boolean
  hydrate: () => Promise<void>
  setWarehouse: (projectId: string, warehouseId: string | null) => Promise<void>
}

export const useInventoryPrefs = create<InventoryPrefs>((set, get) => ({
  warehouseByProject: {},
  hydrated: false,
  hydrate: async () => {
    const raw = await secureStorage.get(STORAGE_KEYS.inventoryPrefs)
    try {
      const parsed = raw ? (JSON.parse(raw) as { warehouseByProject?: Record<string, string> }) : {}
      set({ warehouseByProject: parsed.warehouseByProject ?? {}, hydrated: true })
    } catch {
      set({ warehouseByProject: {}, hydrated: true })
    }
  },
  setWarehouse: async (projectId, warehouseId) => {
    const next = { ...get().warehouseByProject }
    if (warehouseId) next[projectId] = warehouseId
    else delete next[projectId]
    set({ warehouseByProject: next })
    await secureStorage.set(STORAGE_KEYS.inventoryPrefs, JSON.stringify({ warehouseByProject: next }))
  },
}))

/** The remembered warehouse for a project, hydrating on first use. */
export function useRememberedWarehouse(projectId: string | null) {
  const prefs = useInventoryPrefs()
  if (!prefs.hydrated) void prefs.hydrate()
  const warehouseId = projectId ? (prefs.warehouseByProject[projectId] ?? null) : null
  return { warehouseId, remember: (id: string | null) => (projectId ? prefs.setWarehouse(projectId, id) : Promise.resolve()), hydrated: prefs.hydrated }
}
