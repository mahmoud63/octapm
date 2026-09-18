import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import InventoryItemScreen from '../../../app/(app)/inventory/items/[id]'
import InventoryItemsScreen from '../../../app/(app)/inventory/items/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useInventoryPrefs } from '@/inventory/preferences'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { item, items, locations, movements, scanResult, siteEngineerInventory, storekeeper, warehouses } from '@/testing/fixtures-inventory'
import { activities } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]

const serve = (permissions: PermissionMatrix = storekeeper) => {
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /inventory/items': (call) => ({ status: 200, body: envelope({ items: items.filter((i) => (call.query.lowStock ? i.belowReorder : true)) }) }),
    'GET /inventory/items/i1': () => ({ status: 200, body: envelope(item()) }),
    'GET /inventory/items/scan/CEM-42.5N': () => ({ status: 200, body: envelope(scanResult()) }),
    'GET /inventory/stock/transactions': () => ({ status: 200, body: envelope({ items: movements }) }),
    'GET /inventory/warehouses': () => ({ status: 200, body: envelope({ items: warehouses }) }),
    'GET /inventory/warehouses/w1/locations': () => ({ status: 200, body: envelope({ items: locations }) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'POST /inventory/stock/issue': () => ({ status: 201, body: envelope({ movements: [], costPosted: true }) }),
    'POST /inventory/stock/reserve': (call) => ({ status: 200, body: envelope({ itemId: 'i1', warehouseId: 'w1', locationId: null, onHand: 1008, reserved: 40 + Number((call.body as { quantity: number }).quantity), available: 968 - Number((call.body as { quantity: number }).quantity) }) }),
    'POST /inventory/stock/adjust': () => ({ status: 201, body: envelope({ id: 'm9' }) }),
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'i1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  useInventoryPrefs.setState({ warehouseByProject: { p1: 'w1' }, hydrated: true })
})

describe('the item list', () => {
  it('lists items with their stock and asks the server for low stock only', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    await renderScreen(<InventoryItemsScreen />)
    expect(await screen.findByText('Cement OPC 42.5N')).toBeTruthy()
    expect(screen.getByText('Reinforcement bar T16')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('items-chip-low'))
    await waitFor(() => expect(calls.some((c) => c.path === '/inventory/items' && c.query.lowStock === 'true')).toBe(true))
    await waitFor(() => expect(screen.queryByText('Cement OPC 42.5N')).toBeNull())
    expect(screen.getByText('Reinforcement bar T16')).toBeTruthy()
  })
})

describe('an item', () => {
  it('shows the balances, where the stock sits, the recent movements and every movement a storekeeper may make', async () => {
    serve()
    await renderScreen(<InventoryItemScreen />)
    expect(await screen.findByText('Cement OPC 42.5N')).toBeTruthy()
    expect(await screen.findByText('Central Warehouse · Aisle A bin 1')).toBeTruthy()
    expect(await screen.findByText('Issue · -25 bag')).toBeTruthy()
    for (const kind of ['issue', 'return', 'reserve', 'receive', 'adjust', 'damage', 'quarantine', 'release']) expect(screen.getByTestId(`item-move-${kind}`)).toBeTruthy()
    expect(calls.some((c) => c.path === '/inventory/stock/transactions' && c.query.itemId === 'i1')).toBe(true)
  })

  it('issues stock to an activity from the remembered warehouse, once, through the issue route', async () => {
    serve()
    await renderScreen(<InventoryItemScreen />)
    await fireEvent.press(await screen.findByTestId('item-move-issue'))
    expect((await screen.findByTestId('move-send')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('move-quantity'), '25')
    // An issue needs somewhere for the cost to go.
    expect(screen.getByTestId('move-send').props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(screen.getByTestId('move-activity'))
    await fireEvent.press(await screen.findByTestId('move-activity-option-a1'))
    await fireEvent.changeText(screen.getByTestId('move-reference'), 'REQ-015')
    await fireEvent.press(screen.getByTestId('move-send'))
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').length).toBe(1))
    const sent = calls.find((c) => c.method === 'POST')!
    expect(sent.path).toBe('/inventory/stock/issue')
    expect(sent.body).toEqual({ itemId: 'i1', warehouseId: 'w1', quantity: 25, projectId: 'p1', activityId: 'a1', reference: 'REQ-015' })
    expect(await screen.findByTestId('item-notice')).toBeTruthy()
    expect(screen.getByTestId('item-notice').props.children).toMatch(/Issue to site/)
  })

  it('releases a reservation as a negative quantity on the reserve route', async () => {
    serve()
    await renderScreen(<InventoryItemScreen />)
    await fireEvent.press(await screen.findByTestId('item-move-reserve'))
    await fireEvent.press(await screen.findByTestId('move-direction-remove'))
    await fireEvent.changeText(screen.getByTestId('move-quantity'), '5')
    await fireEvent.press(screen.getByTestId('move-send'))
    await waitFor(() => expect(calls.some((c) => c.path === '/inventory/stock/reserve')).toBe(true))
    expect(calls.find((c) => c.path === '/inventory/stock/reserve')!.body).toMatchObject({ itemId: 'i1', warehouseId: 'w1', quantity: -5 })
    expect((await screen.findByTestId('item-notice')).props.children).toMatch(/Released 5 bag/)
  })

  it('refuses to send a movement while offline, and never queues it', async () => {
    serve()
    await renderScreen(<InventoryItemScreen />)
    await fireEvent.press(await screen.findByTestId('item-move-adjust'))
    await fireEvent.changeText(await screen.findByTestId('move-quantity'), '3')
    await fireEvent.changeText(screen.getByTestId('move-notes'), 'Miscount at stocktake')
    network.__reset(false)
    await fireEvent.press(screen.getByTestId('move-send'))
    expect((await screen.findByTestId('move-failure')).props.children).toMatch(/offline/)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('says the outcome is unknown when the reply is lost, and does not retry by itself', async () => {
    serve()
    const real = globalThis.fetch
    let posts = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (request.method === 'POST') {
        posts += 1
        throw new TypeError('Failed to fetch')
      }
      return real(input, init)
    }) as typeof fetch
    await renderScreen(<InventoryItemScreen />)
    await fireEvent.press(await screen.findByTestId('item-move-adjust'))
    await fireEvent.changeText(await screen.findByTestId('move-quantity'), '3')
    await fireEvent.changeText(screen.getByTestId('move-notes'), 'Miscount at stocktake')
    await fireEvent.press(screen.getByTestId('move-send'))
    expect((await screen.findByTestId('move-failure')).props.children).toMatch(/may or may not/)
    expect(posts).toBe(1)
    expect(screen.getByText('Send again anyway')).toBeTruthy()
  })

  it('a site engineer may issue, return and reserve, but not receive, adjust or write off', async () => {
    serve(siteEngineerInventory)
    await renderScreen(<InventoryItemScreen />)
    await screen.findByTestId('item-move-issue')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.getByTestId('item-move-return')).toBeTruthy()
    expect(screen.getByTestId('item-move-reserve')).toBeTruthy()
    for (const kind of ['receive', 'adjust', 'damage', 'quarantine', 'release']) expect(screen.queryByTestId(`item-move-${kind}`)).toBeNull()
  })
})
