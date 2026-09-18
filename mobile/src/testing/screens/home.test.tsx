import { screen, waitFor } from '@testing-library/react-native'
import HomeScreen from '../../../app/(app)/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer } from '@/testing/fake-server'
import { assignments, health, notification, page, pmMatrix, projects, user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

const routes = {
  'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
  'GET /projects/p1/assignments/mine': () => ({ status: 200, body: envelope(assignments) }),
  'GET /projects/p1/health': () => ({ status: 200, body: envelope(health) }),
  'GET /notifications/summary': () => ({ status: 200, body: envelope({ unread: 4, read: 2, archived: 0, recent: [notification(), notification({ id: 'n2', title: 'RFI-001 was answered', status: 'read' })] }) }),
  'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmMatrix) }),
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('Home', () => {
  it('shows the project, what needs the person, what is due, the health and the notifications', async () => {
    fakeServer(routes)
    await renderScreen(<HomeScreen />)

    expect(screen.getByText(/Good (morning|afternoon|evening), Dana/)).toBeTruthy()
    expect(await screen.findByText('Riverside Tower')).toBeTruthy()
    expect(await screen.findByText('Founding level at grid A-D')).toBeTruthy()
    // The overdue NCR is listed under Needs You and again under Today.
    expect(screen.getAllByText('Honeycombing in column C4')).toHaveLength(2)
    expect(screen.getAllByText(/Ball in court/).length).toBeGreaterThan(0)
    expect(await screen.findByTestId('health-supplyChain')).toBeTruthy()
    expect(screen.getByText('71')).toBeTruthy()
    expect(screen.getByText(/2 items awaiting review/)).toBeTruthy()
    expect(await screen.findByText('4 unread')).toBeTruthy()
    expect(screen.getByText('Change order VO-01 needs approval')).toBeTruthy()
    // The RFI form exists, so a project manager gets that quick action and the record screens.
    expect(await screen.findByTestId('quick-rfi')).toBeTruthy()
    expect(screen.getByTestId('records-rfi')).toBeTruthy()
    expect(screen.getByTestId('records-documents')).toBeTruthy()
  })

  it('opens the only project without asking', async () => {
    useProjectStore.setState({ currentProjectId: null, hydrated: true })
    fakeServer({ ...routes, 'GET /projects': () => ({ status: 200, body: envelope(page([projects[0]!])) }) })
    await renderScreen(<HomeScreen />)
    await waitFor(() => expect(useProjectStore.getState().currentProjectId).toBe('p1'))
  })

  it('asks which project when there are several and none is chosen', async () => {
    useProjectStore.setState({ currentProjectId: null, hydrated: true })
    fakeServer(routes)
    await renderScreen(<HomeScreen />)
    expect(await screen.findAllByText('Choose a project')).not.toHaveLength(0)
    expect(screen.getByText('Harbour Bridge')).toBeTruthy()
    expect(screen.queryByText('Needs You')).toBeNull()
  })

  it('drops a project the person no longer has, and everything cached about it', async () => {
    useProjectStore.setState({ currentProjectId: 'p9', hydrated: true })
    queryClient.setQueryData(['project', 'p9', 'rfis'], [{ id: 'stale' }])
    fakeServer(routes)
    await renderScreen(<HomeScreen />)
    await waitFor(() => expect(useProjectStore.getState().currentProjectId).toBeNull())
    expect(queryClient.getQueryData(['project', 'p9', 'rfis'])).toBeUndefined()
    expect(await screen.findAllByText('Choose a project')).not.toHaveLength(0)
  })

  it('says when the person is on no project at all', async () => {
    useProjectStore.setState({ currentProjectId: null, hydrated: true })
    fakeServer({ ...routes, 'GET /projects': () => ({ status: 200, body: envelope(page([])) }) })
    await renderScreen(<HomeScreen />)
    expect(await screen.findByText('You are not on any project yet')).toBeTruthy()
  })
})
