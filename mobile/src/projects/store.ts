/**
 * Which project the person is working in.
 *
 * One project at a time: every project-scoped screen reads this, and leaving a
 * project forgets everything cached about it before the next one is shown, so
 * nothing from one project can be drawn on another. The choice is remembered
 * on the device (it is not sensitive) together with the workspace it belongs
 * to, and forgotten at sign-out.
 *
 * A project belongs to one workspace, and the session to one workspace at a
 * time (workspace switching doc §1): a remembered project of another
 * workspace is dropped when the session settles — never carried across —
 * and the Home screen drops a project the workspace no longer lists.
 */
import { create } from 'zustand'
import { forgetProject } from '@/api/query'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useAuthStore } from '@/auth/store'

interface ProjectState {
  currentProjectId: string | null
  /** The workspace the remembered project belongs to; null for a choice made before the app knew workspaces. */
  currentProjectOrgId: string | null
  /** True once the remembered choice has been read from the device. */
  hydrated: boolean
  hydrate: () => Promise<void>
  select: (projectId: string | null, orgId?: string | null) => Promise<void>
  clear: () => Promise<void>
  /**
   * The session settled in a workspace: a remembered project of another
   * workspace goes. One remembered before workspaces belongs to the workspace
   * the device then knew (`legacyOrgId`): kept and stamped when that is this
   * one, dropped otherwise — and dropped when the device cannot tell, rather
   * than handed to whichever workspace settles first.
   */
  ensureWorkspace: (orgId: string, legacyOrgId?: string | null) => Promise<void>
}

interface RememberedProject {
  projectId: string
  orgId: string | null
}

/** The stored form: JSON with the workspace, or the bare id the app wrote before it knew workspaces. */
export const parseRememberedProject = (raw: string | null | undefined): RememberedProject | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedProject> | string
    if (typeof parsed === 'string') return parsed ? { projectId: parsed, orgId: null } : null
    return parsed && typeof parsed.projectId === 'string' && parsed.projectId ? { projectId: parsed.projectId, orgId: typeof parsed.orgId === 'string' ? parsed.orgId : null } : null
  } catch {
    return { projectId: raw, orgId: null }
  }
}

const remember = async (projectId: string | null, orgId: string | null) => {
  if (projectId) await secureStorage.set(STORAGE_KEYS.currentProject, JSON.stringify({ projectId, orgId }))
  else await secureStorage.remove(STORAGE_KEYS.currentProject)
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,
  currentProjectOrgId: null,
  hydrated: false,

  hydrate: async () => {
    // Settle either way. A device that cannot answer has simply remembered
    // nothing, and the shell waits on this flag: if it never turned true the
    // app would sit behind a blank screen for ever.
    try {
      const remembered = parseRememberedProject(await secureStorage.get(STORAGE_KEYS.currentProject))
      set({ currentProjectId: remembered?.projectId ?? null, currentProjectOrgId: remembered?.orgId ?? null, hydrated: true })
    } catch {
      set({ currentProjectId: null, currentProjectOrgId: null, hydrated: true })
    }
  },

  select: async (projectId, orgId) => {
    const previous = get().currentProjectId
    if (previous && previous !== projectId) forgetProject(previous)
    // The project belongs to the workspace the session is in unless the caller says which.
    const owner = projectId ? (orgId ?? useAuthStore.getState().workspace?.orgId ?? null) : null
    set({ currentProjectId: projectId, currentProjectOrgId: owner, hydrated: true })
    await remember(projectId, owner)
  },

  clear: async () => {
    const previous = get().currentProjectId
    if (previous) forgetProject(previous)
    set({ currentProjectId: null, currentProjectOrgId: null, hydrated: true })
    await secureStorage.remove(STORAGE_KEYS.currentProject)
  },

  ensureWorkspace: async (orgId, legacyOrgId = null) => {
    const { currentProjectId, currentProjectOrgId } = get()
    if (!currentProjectId) return
    const owner = currentProjectOrgId ?? legacyOrgId
    if (owner !== orgId) {
      await get().clear()
      return
    }
    if (!currentProjectOrgId) {
      set({ currentProjectOrgId: orgId })
      await remember(currentProjectId, orgId)
    }
  },
}))

export const useCurrentProjectId = () => useProjectStore((s) => s.currentProjectId)

/** Whether the remembered project belongs to the given workspace (a project remembered before workspaces is taken to). */
export const projectBelongsTo = (state: Pick<ProjectState, 'currentProjectId' | 'currentProjectOrgId'>, orgId: string | null | undefined) =>
  Boolean(state.currentProjectId) && (state.currentProjectOrgId == null || !orgId || state.currentProjectOrgId === orgId)
