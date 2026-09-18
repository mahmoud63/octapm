import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import DocumentsScreen from '../../../app/(app)/documents/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { register } from '@/testing/fixtures-records'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(router.push as jest.Mock).mockClear()
  ;(Sharing.shareAsync as jest.Mock).mockClear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /projects/p1/doc-control/register': (call) => ({ status: 200, body: envelope(call.query.folder === 'drawings' ? { ...register, rows: register.rows.filter((r) => r.recordType === 'drawing') } : register) }),
  })
})

describe('the document register', () => {
  it('lists documents by folder with their latest revision', async () => {
    await renderScreen(<DocumentsScreen />)
    expect(await screen.findByText('S-101 Foundation plan')).toBeTruthy()
    expect(screen.getByText('Founding level at grid A-D')).toBeTruthy()
    expect(screen.getByText(/Rev B/)).toBeTruthy()
    await fireEvent.press(screen.getByTestId('documents-folder-drawings'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/doc-control/register' && c.query.folder === 'drawings')).toBe(true))
    await waitFor(() => expect(screen.queryByText('Founding level at grid A-D')).toBeNull())
  })

  it('opens an RFI row in the app', async () => {
    await renderScreen(<DocumentsScreen />)
    await fireEvent.press(await screen.findByTestId('document-row-r1'))
    expect(router.push).toHaveBeenCalledWith('/rfi/r1')
  })

  it('opens a drawing revision by downloading it with the bearer and handing it to the system viewer', async () => {
    const FileSystem = jest.requireMock('expo-file-system/legacy') as { downloadAsync: jest.Mock }
    await renderScreen(<DocumentsScreen />)
    await fireEvent.press(await screen.findByTestId('document-row-d1'))
    await waitFor(() => expect(screen.queryByRole('alert')?.props.children ?? FileSystem.downloadAsync.mock.calls.length).toBeTruthy())
    expect(screen.queryByRole('alert')?.props.children).toBeUndefined()
    await waitFor(() => expect(FileSystem.downloadAsync).toHaveBeenCalled())
    const [url, , options] = FileSystem.downloadAsync.mock.calls.at(-1) as [string, string, { headers: Record<string, string> }]
    expect(url).toMatch(/\/projects\/p1\/doc-control\/revisions\/rev1\/download$/)
    expect(options.headers.Authorization).toBe('Bearer access-1')
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled())
  })
})
