import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useAuthStore } from '@/auth/store'
import { parseRememberedProject, projectBelongsTo, useProjectStore } from './store'

/**
 * The remembered project carries its workspace (workspace switching doc §1,
 * mobile column): a project of another workspace is dropped when the session
 * settles, one remembered before workspaces is stamped once, and the shell
 * treats a mismatched project as none until then.
 */
const P_A = 'a2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
const P_B = 'b2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
const acme = { orgId: 'org-a', membershipId: 'm-a', slug: 'acme', name: 'Acme', kind: 'company', role: 'pm', isAdmin: true, isOwner: true, status: 'active' }

beforeEach(async () => {
  useProjectStore.setState({ currentProjectId: null, currentProjectOrgId: null, hydrated: false })
  useAuthStore.setState({ workspace: acme, memberships: [acme] })
  await secureStorage.remove(STORAGE_KEYS.currentProject)
})

describe('the remembered project and its workspace', () => {
  it('is stored with the workspace the session was in when it was chosen', async () => {
    await useProjectStore.getState().select(P_A)
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: P_A, currentProjectOrgId: 'org-a' })
    expect(JSON.parse((await secureStorage.get(STORAGE_KEYS.currentProject)) ?? '{}')).toEqual({ projectId: P_A, orgId: 'org-a' })
    // A caller that knows better names the workspace itself.
    await useProjectStore.getState().select(P_B, 'org-b')
    expect(useProjectStore.getState().currentProjectOrgId).toBe('org-b')
  })

  it('comes back from the device with its workspace, and reads the bare id the previous version wrote', async () => {
    await secureStorage.set(STORAGE_KEYS.currentProject, JSON.stringify({ projectId: P_A, orgId: 'org-a' }))
    await useProjectStore.getState().hydrate()
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: P_A, currentProjectOrgId: 'org-a', hydrated: true })
    await secureStorage.set(STORAGE_KEYS.currentProject, P_B)
    await useProjectStore.getState().hydrate()
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: P_B, currentProjectOrgId: null, hydrated: true })
    expect(parseRememberedProject('')).toBeNull()
    expect(parseRememberedProject('{"orgId":"x"}')).toBeNull()
    expect(parseRememberedProject('"bare"')).toEqual({ projectId: 'bare', orgId: null })
  })

  it('drops a remembered project of another workspace when the session settles, and keeps one of this workspace', async () => {
    await secureStorage.set(STORAGE_KEYS.currentProject, JSON.stringify({ projectId: P_B, orgId: 'org-b' }))
    await useProjectStore.getState().hydrate()
    await useProjectStore.getState().ensureWorkspace('org-a')
    expect(useProjectStore.getState().currentProjectId).toBeNull()
    expect(await secureStorage.get(STORAGE_KEYS.currentProject)).toBeNull()

    await secureStorage.set(STORAGE_KEYS.currentProject, JSON.stringify({ projectId: P_A, orgId: 'org-a' }))
    await useProjectStore.getState().hydrate()
    await useProjectStore.getState().ensureWorkspace('org-a')
    expect(useProjectStore.getState().currentProjectId).toBe(P_A)
  })

  it('stamps a project remembered before workspaces with the workspace the device then knew, once — and drops it anywhere else, or when that is unknown', async () => {
    // The device's old profile says A, the session settles in B: not B's project.
    await secureStorage.set(STORAGE_KEYS.currentProject, P_A)
    await useProjectStore.getState().hydrate()
    await useProjectStore.getState().ensureWorkspace('org-b', 'org-a')
    expect(useProjectStore.getState().currentProjectId).toBeNull()
    expect(await secureStorage.get(STORAGE_KEYS.currentProject)).toBeNull()
    // Nothing tells whose it was: dropped, not handed to the first workspace that settles.
    await secureStorage.set(STORAGE_KEYS.currentProject, P_A)
    await useProjectStore.getState().hydrate()
    await useProjectStore.getState().ensureWorkspace('org-a')
    expect(useProjectStore.getState().currentProjectId).toBeNull()
    // The old profile says A and the session is A's: kept, and stamped.
    await secureStorage.set(STORAGE_KEYS.currentProject, P_A)
    await useProjectStore.getState().hydrate()
    await useProjectStore.getState().ensureWorkspace('org-a', 'org-a')
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: P_A, currentProjectOrgId: 'org-a' })
    expect(JSON.parse((await secureStorage.get(STORAGE_KEYS.currentProject)) ?? '{}')).toEqual({ projectId: P_A, orgId: 'org-a' })
    // Stamped as A's, it does not follow the session into B.
    await useProjectStore.getState().ensureWorkspace('org-b')
    expect(useProjectStore.getState().currentProjectId).toBeNull()
  })

  it('tells the shell whether the project is this workspace’s', () => {
    expect(projectBelongsTo({ currentProjectId: P_A, currentProjectOrgId: 'org-a' }, 'org-a')).toBe(true)
    expect(projectBelongsTo({ currentProjectId: P_A, currentProjectOrgId: 'org-b' }, 'org-a')).toBe(false)
    // Not yet stamped, or the workspace not yet known: taken to be this one, as before workspaces.
    expect(projectBelongsTo({ currentProjectId: P_A, currentProjectOrgId: null }, 'org-a')).toBe(true)
    expect(projectBelongsTo({ currentProjectId: P_A, currentProjectOrgId: 'org-b' }, null)).toBe(true)
    expect(projectBelongsTo({ currentProjectId: null, currentProjectOrgId: null }, 'org-a')).toBe(false)
  })

  it('clears the workspace with the project', async () => {
    await useProjectStore.getState().select(P_A)
    await useProjectStore.getState().clear()
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: null, currentProjectOrgId: null })
  })
})
