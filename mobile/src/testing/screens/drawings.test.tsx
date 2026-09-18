import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { router, useLocalSearchParams } from 'expo-router'
import SheetScreen from '../../../app/(app)/drawings/[id]'
import DrawingsScreen from '../../../app/(app)/drawings/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useAuthStore } from '@/auth/store'
import { useDrawingPrefs } from '@/drawings/preferences'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { pmFull, sheet, sheetList } from '@/testing/fixtures-records'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

beforeEach(async () => {
  network.__reset(null)
  queryClient.clear()
  ;(router.push as jest.Mock).mockClear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  useDrawingPrefs.setState({ favourites: [], recents: [], hydrated: true })
  await secureStorage.remove(STORAGE_KEYS.drawingPrefs)
  fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(pmFull) }),
    'GET /projects/p1/drawings/sheets': () => ({ status: 200, body: envelope(sheetList) }),
    'GET /projects/p1/drawings/sheets/offline-manifest': () => ({ status: 200, body: envelope({ generatedAt: '2026-09-18T00:00:00.000Z', items: [], totals: { sheets: 1, documents: 1, bytes: 240000 } }) }),
    'GET /projects/p1/drawings/sheets/s1': () => ({ status: 200, body: envelope(sheet()) }),
    'GET /projects/p1/drawings/sheets/s2': () => ({ status: 200, body: envelope(sheetList.items[1]!) }),
    'GET /projects/p1/drawings/sheets/s1/pins': () => ({ status: 200, body: envelope({ items: [{ id: 'pin1', sheetId: 's1', sheetRevisionId: 'sr1', x: 0.4, y: 0.6, recordType: 'punch_item', recordId: 'pl1', label: 'PL-004', color: null }] }) }),
    'GET /projects/p1/drawings/sheets/s2/pins': () => ({ status: 200, body: envelope({ items: [] }) }),
  })
})

describe('drawings', () => {
  it('lists sheets and marks the obsolete one before it is opened', async () => {
    await renderScreen(<DrawingsScreen />)
    expect(await screen.findByText('Foundation plan')).toBeTruthy()
    expect(screen.getByText('Level 2 plan')).toBeTruthy()
    expect(screen.getByText('Obsolete')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('sheet-row-s1'))
    expect(router.push).toHaveBeenCalledWith('/drawings/s1')
  })

  it('shows a current sheet with its page and pins, and remembers it as a favourite on the device', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 's1' })
    await renderScreen(<SheetScreen />)
    expect(await screen.findByText('Foundation plan')).toBeTruthy()
    expect(screen.queryByTestId('sheet-superseded')).toBeNull()
    expect(screen.getByTestId('sheet-page')).toBeTruthy()
    expect(await screen.findByText('PL-004')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('sheet-favourite'))
    await waitFor(() => expect(useDrawingPrefs.getState().favourites).toEqual(['s1']))
    expect(JSON.parse((await secureStorage.get(STORAGE_KEYS.drawingPrefs)) ?? '{}')).toMatchObject({ favourites: ['s1'], recents: ['s1'] })
  })

  it('never shows an obsolete sheet as current: the superseded warning comes first', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 's2' })
    await renderScreen(<SheetScreen />)
    expect(await screen.findByTestId('sheet-superseded')).toBeTruthy()
    expect(screen.getByText('SUPERSEDED DRAWING')).toBeTruthy()
    expect(screen.getByTestId('sheet-open-latest')).toBeTruthy()
  })
})
