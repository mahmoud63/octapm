import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import MovementsScreen from '../../../app/(app)/inventory/movements/index'
import TransferScreen from '../../../app/(app)/inventory/transfers/[id]'
import TransfersScreen from '../../../app/(app)/inventory/transfers/index'
import NewTransferScreen from '../../../app/(app)/inventory/transfers/new'
import type { Transfer } from '@/api/inventory-types'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useInventoryPrefs } from '@/inventory/preferences'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { items, movements, siteEngineerInventory, storekeeper, transfer, transfers, warehouses } from '@/testing/fixtures-inventory'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let rows: Transfer[]

const serve = (permissions: PermissionMatrix = storekeeper) => {
  rows = transfers.map((t) => ({ ...t }))
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /inventory/transfers': (call) => ({ status: 200, body: envelope({ items: rows.filter((t) => !call.query.status || t.status === call.query.status) }) }),
    'GET /inventory/warehouses': () => ({ status: 200, body: envelope({ items: warehouses }) }),
    'GET /inventory/items': () => ({ status: 200, body: envelope({ items }) }),
    'GET /inventory/stock/transactions': (call) => ({ status: 200, body: envelope({ items: movements.filter((m) => !call.query.type || m.type === call.query.type) }) }),
    'POST /inventory/transfers': (call) => {
      const body = call.body as { fromWarehouseId: string; toWarehouseId: string; lines: { itemId: string; quantity: number }[]; reason?: string }
      const created = transfer({ id: 't9', ref: 'TRF-00016', fromWarehouseId: body.fromWarehouseId, toWarehouseId: body.toWarehouseId, reason: body.reason ?? null, lines: body.lines.map((l, i) => ({ id: `tl9${i}`, itemId: l.itemId, sku: null, name: null, unit: null, quantity: l.quantity, receivedQty: null, damagedQty: null })) })
      rows = [created, ...rows]
      return { status: 201, body: envelope(created) }
    },
    'POST /inventory/transfers/t1/dispatch': () => {
      rows = rows.map((t) => (t.id === 't1' ? { ...t, status: 'in_transit', dispatchedAt: '2026-09-18T07:00:00.000Z' } : t))
      return { status: 200, body: envelope(rows.find((t) => t.id === 't1')) }
    },
    'POST /inventory/transfers/t1/receive': (call) => {
      const { lines } = call.body as { lines: { id: string; receivedQty?: number; damagedQty?: number }[] }
      rows = rows.map((t) => (t.id === 't1' ? { ...t, status: 'received', receivedAt: '2026-09-18T08:00:00.000Z', lines: t.lines.map((l) => ({ ...l, receivedQty: lines.find((x) => x.id === l.id)?.receivedQty ?? null, damagedQty: lines.find((x) => x.id === l.id)?.damagedQty ?? null })) } : t))
      return { status: 200, body: envelope(rows.find((t) => t.id === 't1')) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 't1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  useInventoryPrefs.setState({ warehouseByProject: { p1: 'w1' }, hydrated: true })
})

describe('transfers', () => {
  it('lists them and lets the server filter by status', async () => {
    serve()
    await renderScreen(<TransfersScreen />)
    expect(await screen.findByText('TRF-00015')).toBeTruthy()
    expect(screen.getByText('TRF-00014')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('transfers-chip-received'))
    await waitFor(() => expect(calls.some((c) => c.path === '/inventory/transfers' && c.query.status === 'received')).toBe(true))
    await waitFor(() => expect(screen.queryByText('TRF-00015')).toBeNull())
  })

  it('drafts a transfer from the remembered warehouse with its lines and opens it', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    const router = useRouter() as unknown as { replace: jest.Mock }
    await renderScreen(<NewTransferScreen />)
    await fireEvent.press(await screen.findByTestId('transfer-to'))
    await fireEvent.press(await screen.findByTestId('transfer-to-option-w2'))
    await fireEvent.press(screen.getByTestId('transfer-item-0'))
    await fireEvent.press(await screen.findByTestId('transfer-item-0-option-i1'))
    await fireEvent.changeText(screen.getByTestId('transfer-qty-0'), '10')
    await fireEvent.changeText(screen.getByTestId('transfer-reason'), 'Raft pour next week')
    await fireEvent.press(screen.getByTestId('transfer-create'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/inventory/transfers')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ fromWarehouseId: 'w1', toWarehouseId: 'w2', reason: 'Raft pour next week', lines: [{ itemId: 'i1', quantity: 10 }] })
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/inventory/transfers/t9'))
  })

  it('dispatches a draft and then receives it line by line on the transfer routes', async () => {
    serve()
    await renderScreen(<TransferScreen />)
    expect(await screen.findByText('Central Warehouse → Riverside Site Store')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-dispatch'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/t1/dispatch'))).toBe(true))
    await fireEvent.press(await screen.findByTestId('action-receive'))
    expect((await screen.findByTestId('transfer-received-tl1')).props.value).toBe('10')
    await fireEvent.changeText(screen.getByTestId('transfer-received-tl1'), '9')
    await fireEvent.changeText(screen.getByTestId('transfer-damaged-tl1'), '1')
    await fireEvent.press(screen.getByTestId('transfer-receive-confirm'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/t1/receive'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/t1/receive'))!.body).toEqual({ lines: [{ id: 'tl1', receivedQty: 9, damagedQty: 1 }] })
    expect(await screen.findByText('9 bag of 10 bag · 1 bag damaged')).toBeTruthy()
    expect(screen.queryByTestId('action-receive')).toBeNull()
  })

  it('a site engineer sees a transfer but cannot move it', async () => {
    serve(siteEngineerInventory)
    await renderScreen(<TransferScreen />)
    await screen.findByText('Central Warehouse → Riverside Site Store')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-dispatch')).toBeNull()
  })
})

describe('the movement ledger', () => {
  it('opens on the remembered warehouse and filters by type on the server', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    await renderScreen(<MovementsScreen />)
    expect(await screen.findByText('Issue · Cement OPC 42.5N · -25 bag')).toBeTruthy()
    expect(calls.some((c) => c.path === '/inventory/stock/transactions' && c.query.warehouseId === 'w1')).toBe(true)
    await fireEvent.press(screen.getByTestId('movements-chip-receipt'))
    await waitFor(() => expect(calls.some((c) => c.path === '/inventory/stock/transactions' && c.query.type === 'receipt')).toBe(true))
    await waitFor(() => expect(screen.queryByText('Issue · Cement OPC 42.5N · -25 bag')).toBeNull())
    expect(screen.getByText('Receipt · Cement OPC 42.5N · +400 bag')).toBeTruthy()
  })
})
