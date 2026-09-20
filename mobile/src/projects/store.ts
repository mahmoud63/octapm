/**
 * Which project the person is working in.
 *
 * One project at a time: every project-scoped screen reads this, and leaving a
 * project forgets everything cached about it before the next one is shown, so
 * nothing from one project can be drawn on another. The choice is remembered
 * on the device (it is not sensitive) and forgotten at sign-out.
 */
import { create } from 'zustand'
import { forgetProject } from '@/api/query'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'

interface ProjectState {
  currentProjectId: string | null
  /** True once the remembered choice has been read from the device. */
  hydrated: boolean
  hydrate: () => Promise<void>
  select: (projectId: string | null) => Promise<void>
  clear: () => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,
  hydrated: false,

  hydrate: async () => {
    // Settle either way. A device that cannot answer has simply remembered
    // nothing, and the shell waits on this flag: if it never turned true the
    // app would sit behind a blank screen for ever.
    try {
      const remembered = await secureStorage.get(STORAGE_KEYS.currentProject)
      set({ currentProjectId: remembered || null, hydrated: true })
    } catch {
      set({ currentProjectId: null, hydrated: true })
    }
  },

  select: async (projectId) => {
    const previous = get().currentProjectId
    if (previous && previous !== projectId) forgetProject(previous)
    set({ currentProjectId: projectId, hydrated: true })
    if (projectId) await secureStorage.set(STORAGE_KEYS.currentProject, projectId)
    else await secureStorage.remove(STORAGE_KEYS.currentProject)
  },

  clear: async () => {
    const previous = get().currentProjectId
    if (previous) forgetProject(previous)
    set({ currentProjectId: null, hydrated: true })
    await secureStorage.remove(STORAGE_KEYS.currentProject)
  },
}))

export const useCurrentProjectId = () => useProjectStore((s) => s.currentProjectId)
