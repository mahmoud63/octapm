import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import MaterialTestScreen from '../../../app/(app)/quality/tests/[id]'
import MaterialTestsScreen from '../../../app/(app)/quality/tests/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { MaterialTest } from '@/api/quality-types'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { materialTest, materialTestList, pmQuality, siteEngineerQuality } from '@/testing/fixtures-quality'
import { activities } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let rows: MaterialTest[]

const serve = (permissions: PermissionMatrix = pmQuality) => {
  rows = materialTestList().rows
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/material-tests': () => ({ status: 200, body: envelope(materialTestList(rows)) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }),
    'POST /projects/p1/material-tests': (call) => {
      const body = call.body as Record<string, unknown>
      const created = materialTest({ id: 'mt9', ref: 'MT-009', testType: String(body.testType), result: 'pending', specValue: null, activityLinks: [] })
      rows = [...rows, created]
      return { status: 201, body: envelope(created) }
    },
    'PATCH /projects/p1/material-tests/mt1': (call) => {
      const body = call.body as Record<string, unknown>
      rows = rows.map((r) => (r.id === 'mt1' ? { ...r, result: String(body.result), actualValue: (body.actualValue as string) ?? r.actualValue, testDate: (body.testDate as string) ?? r.testDate, labName: (body.labName as string) ?? r.labName } : r))
      return { status: 200, body: envelope(rows.find((r) => r.id === 'mt1')) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'mt1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('material tests', () => {
  it('lists pending tests first and schedules a new one as pending', async () => {
    serve()
    const router = useRouter() as unknown as { push: jest.Mock }
    await renderScreen(<MaterialTestsScreen />)
    expect(await screen.findByText('28-day concrete cube')).toBeTruthy()
    expect(screen.getByText('7-day concrete cube')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('tests-new'))
    await fireEvent.changeText(await screen.findByTestId('prompt-test-input'), 'Rebar tensile, batch 14')
    await fireEvent.press(screen.getByTestId('prompt-test-confirm'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/material-tests')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ testType: 'Rebar tensile, batch 14', result: 'pending' })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quality/tests/mt9'))
  })

  it('records the result against the spec through a patch of the test', async () => {
    serve()
    await renderScreen(<MaterialTestScreen />)
    expect(await screen.findByText('40 MPa')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-record'))
    await fireEvent.press(await screen.findByTestId('test-result-fail'))
    await fireEvent.changeText(screen.getByTestId('test-actual'), '33 MPa')
    await fireEvent.changeText(screen.getByTestId('test-lab'), 'Gulf Labs')
    await fireEvent.press(screen.getByTestId('test-save'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    const sent = calls.find((c) => c.method === 'PATCH')!
    expect(sent.path).toBe('/projects/p1/material-tests/mt1')
    expect(sent.body).toMatchObject({ result: 'fail', actualValue: '33 MPa', labName: 'Gulf Labs' })
    expect(await screen.findByText('33 MPa')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('a site engineer sees the test but cannot record a result', async () => {
    serve(siteEngineerQuality)
    await renderScreen(<MaterialTestScreen />)
    await screen.findByText('40 MPa')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-record')).toBeNull()
  })
})
