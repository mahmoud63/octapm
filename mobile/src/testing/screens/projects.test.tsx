import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'
import ProjectsScreen from '../../../app/(app)/projects'
import { network } from '@/api/network'
import { keys, queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

const workspace = { projectHealth: [{ id: 'p1', name: 'Riverside Tower', overallScore: 75 }, { id: 'p2', name: 'Harbour Bridge', overallScore: 41 }] }

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(router.replace as jest.Mock).mockClear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /projects/workspace-dashboard': () => ({ status: 200, body: envelope(workspace) }),
  })
})

describe('Projects', () => {
  it('lists every project with its health, and marks the current one', async () => {
    await renderScreen(<ProjectsScreen />)
    expect(await screen.findByText('Riverside Tower')).toBeTruthy()
    expect(screen.getByText('Harbour Bridge')).toBeTruthy()
    expect(await screen.findByText('Health 75')).toBeTruthy()
    expect(screen.getByText('Health 41')).toBeTruthy()
    expect(screen.getByText(/highlighted project/)).toBeTruthy()
  })

  it('switching project forgets everything cached about the previous one and goes home', async () => {
    queryClient.setQueryData(keys.projectScoped('p1', 'rfis'), [{ id: 'r1' }])
    queryClient.setQueryData(keys.needsYou('p1'), { items: [], summary: {} })
    queryClient.setQueryData(keys.projectScoped('p2', 'rfis'), [{ id: 'r2' }])

    await renderScreen(<ProjectsScreen />)
    await fireEvent.press(await screen.findByText('Harbour Bridge'))

    await waitFor(() => expect(useProjectStore.getState().currentProjectId).toBe('p2'))
    expect(queryClient.getQueryData(keys.projectScoped('p1', 'rfis'))).toBeUndefined()
    expect(queryClient.getQueryData(keys.needsYou('p1'))).toBeUndefined()
    expect(queryClient.getQueryData(keys.projectScoped('p2', 'rfis'))).toEqual([{ id: 'r2' }])
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))
  })

  it('filters by name, contract number or location', async () => {
    await renderScreen(<ProjectsScreen />)
    await screen.findByText('Riverside Tower')
    await fireEvent.changeText(screen.getByTestId('projects-filter'), 'jeddah')
    expect(screen.queryByText('Riverside Tower')).toBeNull()
    expect(screen.getByText('Harbour Bridge')).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('projects-filter'), 'nothing here')
    expect(await screen.findByText('No project matches')).toBeTruthy()
  })
})
