import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import InventoryHomeScreen from '../../../app/(app)/inventory/index'
import ScanScreen from '../../../app/(app)/inventory/scan'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useInventoryPrefs } from '@/inventory/preferences'
import { useProjectStore } from '@/projects/store'
import { envelope, failure, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { scanResult, siteEngineerInventory, storekeeper, summary, warehouses } from '@/testing/fixtures-inventory'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]

const serve = (permissions: PermissionMatrix = storekeeper) => {
  calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /inventory/summary': () => ({ status: 200, body: envelope(summary) }),
    'GET /inventory/warehouses': () => ({ status: 200, body: envelope({ items: warehouses }) }),
    'GET /inventory/items/scan/CEM-42.5N': () => ({ status: 200, body: envelope(scanResult()) }),
    'GET /inventory/items/scan/NOPE-1': () => failure(404, 'ITEM_NOT_FOUND', 'No item has that code'),
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  useInventoryPrefs.setState({ warehouseByProject: {}, hydrated: true })
})

describe('inventory home', () => {
  it("shows the server's tiles, the warehouses and a door to each part the role may use", async () => {
    serve()
    await renderScreen(<InventoryHomeScreen />)
    expect(await screen.findByText('Central Warehouse')).toBeTruthy()
    expect(screen.getByText('6')).toBeTruthy()
    expect(calls.some((c) => c.path === '/inventory/summary' && c.query.projectId === 'p1')).toBe(true)
    for (const door of ['scan', 'items', 'receive', 'transfers', 'movements']) expect(screen.getByTestId(`inventory-${door}`)).toBeTruthy()
  })

  it('remembers the warehouse this device works from, per project', async () => {
    serve()
    await renderScreen(<InventoryHomeScreen />)
    await fireEvent.press(await screen.findByTestId('inventory-warehouse'))
    await fireEvent.press(await screen.findByTestId('inventory-warehouse-option-w2'))
    await waitFor(() => expect(useInventoryPrefs.getState().warehouseByProject.p1).toBe('w2'))
  })

  it('offers a site engineer no goods-in door', async () => {
    serve(siteEngineerInventory)
    await renderScreen(<InventoryHomeScreen />)
    await screen.findByTestId('inventory-scan')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('inventory-receive')).toBeNull()
    expect(screen.getByTestId('inventory-items')).toBeTruthy()
  })
})

describe('scan', () => {
  it('resolves a typed code to the item and its stock by warehouse, and opens it', async () => {
    serve()
    const router = useRouter() as unknown as { push: jest.Mock }
    await renderScreen(<ScanScreen />)
    // Codes match exactly on the server, so the screen sends what was typed, untouched.
    await fireEvent.changeText(screen.getByTestId('scan-code'), ' CEM-42.5N ')
    await fireEvent.press(screen.getByTestId('scan-lookup'))
    expect(await screen.findByTestId('scan-hit')).toBeTruthy()
    expect(screen.getByText('Cement OPC 42.5N')).toBeTruthy()
    expect(screen.getByText('Central Warehouse · Aisle A bin 1')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('scan-open'))
    expect(router.push).toHaveBeenCalledWith('/inventory/items/i1')
  })

  it('says when no item carries the code and offers another go', async () => {
    serve()
    await renderScreen(<ScanScreen />)
    await fireEvent.changeText(screen.getByTestId('scan-code'), 'NOPE-1')
    await fireEvent.press(screen.getByTestId('scan-lookup'))
    expect(await screen.findByTestId('scan-miss')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('scan-again'))
    expect(await screen.findByTestId('scan-code')).toBeTruthy()
  })
})
