import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import ReceiveScreen, { receiptNumberFor } from '../../../app/(app)/inventory/receive/[id]'
import GoodsInScreen from '../../../app/(app)/inventory/receive/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useInventoryPrefs } from '@/inventory/preferences'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { locations, purchaseOrder, purchaseOrders, siteEngineerInventory, storekeeper, warehouses } from '@/testing/fixtures-inventory'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let posted: string[]

const serve = (permissions: PermissionMatrix = storekeeper) => {
  posted = []
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /inventory/purchase-orders': () => ({ status: 200, body: envelope({ items: purchaseOrders }) }),
    'GET /inventory/purchase-orders/po1': () => ({ status: 200, body: envelope(purchaseOrder()) }),
    'GET /inventory/warehouses': () => ({ status: 200, body: envelope({ items: warehouses }) }),
    'GET /inventory/warehouses/w1/locations': () => ({ status: 200, body: envelope({ items: locations }) }),
    'POST /inventory/goods-receipt': (call) => {
      const body = call.body as { receiptNumber: string; orderId: string }
      if (posted.includes(body.receiptNumber)) return { status: 409, body: { success: false, error: { code: 'RECEIPT_ALREADY_POSTED', message: 'This receipt was already posted', details: { receiptNumber: body.receiptNumber, receiptId: 'rcpt1', orderId: body.orderId } } } }
      posted.push(body.receiptNumber)
      return { status: 201, body: envelope({ receiptId: 'rcpt1', receiptNumber: body.receiptNumber, movements: [], warehouse: 'Central Warehouse', order: { id: 'po1', ref: 'PO-0001', status: 'partial', fullyReceived: false }, lines: [] }) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'po1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  useInventoryPrefs.setState({ warehouseByProject: { p1: 'w1' }, hydrated: true })
})

describe('goods in', () => {
  it('makes a receipt number once per delivery from a device id', () => {
    expect(receiptNumberFor('1ef2d18f-1ee2-4f4e-8543-c66ecd9378fa')).toBe('GRN-M-1EF2D18F1E')
  })

  it('lists the orders awaiting delivery first, and every order on request', async () => {
    serve()
    await renderScreen(<GoodsInScreen />)
    expect(await screen.findByText('Riverstone Cement')).toBeTruthy()
    expect(screen.queryByText('Gulf Aggregates')).toBeNull()
    await fireEvent.press(screen.getByTestId('goods-in-chip-all'))
    expect(await screen.findByText('Gulf Aggregates')).toBeTruthy()
    expect(calls.some((c) => c.path === '/inventory/purchase-orders' && c.query.scope === 'all' && c.query.projectId === 'p1')).toBe(true)
  })

  it('receives a delivery against the order with the lines pre-filled, one receipt number, into the remembered warehouse', async () => {
    serve()
    await renderScreen(<ReceiveScreen />)
    expect(await screen.findByText('1. Reinforcement bar T16')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('receipt-start'))
    expect((await screen.findByTestId('receipt-accepted-l1')).props.value).toBe('400')
    expect(screen.getByTestId('receipt-accepted-l2').props.value).toBe('150')
    await fireEvent.changeText(screen.getByTestId('receipt-accepted-l1'), '380')
    await fireEvent.changeText(screen.getByTestId('receipt-rejected-l1'), '20')
    await fireEvent.changeText(screen.getByTestId('receipt-delivery-note'), 'DN-4471')
    await fireEvent.press(screen.getByTestId('receipt-post'))
    await waitFor(() => expect(calls.some((c) => c.path === '/inventory/goods-receipt')).toBe(true))
    const sent = calls.find((c) => c.path === '/inventory/goods-receipt')!.body as Record<string, unknown>
    expect(sent).toMatchObject({ orderId: 'po1', warehouseId: 'w1', deliveryNote: 'DN-4471', lines: [{ poLineId: 'l1', acceptedQty: 380, rejectedQty: 20 }, { poLineId: 'l2', acceptedQty: 150 }] })
    expect(String(sent.receiptNumber)).toMatch(/^GRN-M-[A-Z0-9]{10}$/)
    expect(await screen.findByTestId('receipt-posted')).toBeTruthy()
    expect(screen.getByText('Received')).toBeTruthy()
    expect(screen.getByText('Order now Partial')).toBeTruthy()
  })

  it('treats a receipt the server already holds as done, not as a failure', async () => {
    serve()
    await renderScreen(<ReceiveScreen />)
    await fireEvent.press(await screen.findByTestId('receipt-start'))
    const number = (await screen.findByTestId('receipt-number')).props.children.join('')
    posted.push(number.replace('Receipt ', ''))
    await fireEvent.press(screen.getByTestId('receipt-post'))
    expect(await screen.findByText('Already received')).toBeTruthy()
    expect(screen.queryByTestId('receipt-failure')).toBeNull()
  })

  it('will not post more than the order still owes', async () => {
    serve()
    await renderScreen(<ReceiveScreen />)
    await fireEvent.press(await screen.findByTestId('receipt-start'))
    await fireEvent.changeText(await screen.findByTestId('receipt-accepted-l1'), '500')
    expect(await screen.findByText(/more than the 400 bar still due/)).toBeTruthy()
    expect(screen.getByTestId('receipt-post').props.accessibilityState?.disabled).toBe(true)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('a site engineer sees the order but cannot receive against it', async () => {
    serve(siteEngineerInventory)
    await renderScreen(<ReceiveScreen />)
    await screen.findByText('1. Reinforcement bar T16')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('receipt-start')).toBeNull()
  })
})
