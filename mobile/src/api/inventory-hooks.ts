/**
 * Server state for the inventory screens (M5). Organisation-level records
 * live under an `inventory` key; project-filtered lists live under the
 * project so they go when the project is forgotten. Every stock write
 * invalidates both, since one movement changes balances, tiles and ledgers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAppError } from '@/api/errors'
import {
  createTransfer,
  dispatchTransfer,
  getInventoryItem,
  getInventorySummary,
  getPurchaseOrder,
  listInventoryItems,
  listPurchaseOrders,
  listStockMovements,
  listTransfers,
  listWarehouseLocations,
  listWarehouses,
  moveStock,
  postGoodsReceipt,
  receiveTransfer,
  reserveStock,
  scanInventoryCode,
  type ItemFilters,
  type MovementFilters,
} from '@/api/inventory-endpoints'
import type { GoodsReceiptInput, GoodsReceiptResult, StockMoveInput, StockMoveKind, TransferCreate } from '@/api/inventory-types'
import { keys } from '@/api/query'

const inv = (...rest: readonly unknown[]) => ['inventory', ...rest] as const
const scoped = (projectId: string, ...rest: readonly unknown[]) => keys.projectScoped(projectId, 'inventory', ...rest)

function useSettle(projectId: string | null) {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: inv() })
    if (projectId) void client.invalidateQueries({ queryKey: scoped(projectId) })
  }
}

// ── Reads ──

export function useInventorySummary(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'summary'), queryFn: ({ signal }) => getInventorySummary(projectId!, signal), enabled: !!projectId })
}

export function useInventoryItems(projectId: string | null, filters: ItemFilters = {}) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'items', filters), queryFn: ({ signal }) => listInventoryItems(projectId!, filters, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useInventoryItem(itemId: string | null) {
  return useQuery({ queryKey: inv('item', itemId), queryFn: ({ signal }) => getInventoryItem(itemId!, signal), enabled: !!itemId })
}

/** Balances by warehouse come only from the scan route, so the record scans its own SKU. */
export function useItemStock(sku: string | null) {
  return useQuery({ queryKey: inv('stock', sku), queryFn: ({ signal }) => scanInventoryCode(sku!, signal), enabled: !!sku, select: (d) => d.stock })
}

export function useScan(code: string | null) {
  return useQuery({ queryKey: inv('scan', code), queryFn: ({ signal }) => scanInventoryCode(code!, signal), enabled: !!code, retry: false })
}

export function useWarehouses(projectId: string | null) {
  return useQuery({ queryKey: inv('warehouses', projectId ?? 'all'), queryFn: ({ signal }) => listWarehouses(projectId, signal), staleTime: 10 * 60_000 })
}

export function useWarehouseLocations(warehouseId: string | null) {
  return useQuery({ queryKey: inv('locations', warehouseId), queryFn: ({ signal }) => listWarehouseLocations(warehouseId!, signal), enabled: !!warehouseId, staleTime: 10 * 60_000 })
}

export function useStockMovements(filters: MovementFilters, enabled = true) {
  return useQuery({ queryKey: inv('movements', filters), queryFn: ({ signal }) => listStockMovements(filters, signal), enabled, placeholderData: (previous) => previous })
}

export function useTransfers(status?: string) {
  return useQuery({ queryKey: inv('transfers', status ?? 'all'), queryFn: ({ signal }) => listTransfers(status, signal), placeholderData: (previous) => previous })
}

export function usePurchaseOrders(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'purchase-orders'), queryFn: ({ signal }) => listPurchaseOrders(projectId!, signal), enabled: !!projectId })
}

export function usePurchaseOrder(orderId: string | null) {
  return useQuery({ queryKey: inv('purchase-order', orderId), queryFn: ({ signal }) => getPurchaseOrder(orderId!, signal), enabled: !!orderId })
}

// ── Writes: online only, never retried ──

export function useStockActions(projectId: string | null) {
  const settle = useSettle(projectId)
  const move = useMutation({ mutationFn: ({ kind, body }: { kind: Exclude<StockMoveKind, 'reserve'>; body: StockMoveInput }) => moveStock(kind, body), onSuccess: settle, retry: 0 })
  const reserve = useMutation({ mutationFn: (body: StockMoveInput) => reserveStock(body), onSuccess: settle, retry: 0 })
  return { move, reserve }
}

export function useTransferActions(projectId: string | null) {
  const settle = useSettle(projectId)
  const create = useMutation({ mutationFn: (body: TransferCreate) => createTransfer(body), onSuccess: settle, retry: 0 })
  const dispatch = useMutation({ mutationFn: (transferId: string) => dispatchTransfer(transferId), onSuccess: settle, retry: 0 })
  const receive = useMutation({ mutationFn: ({ transferId, lines }: { transferId: string; lines?: { id: string; receivedQty?: number; damagedQty?: number }[] }) => receiveTransfer(transferId, lines), onSuccess: settle, retry: 0 })
  return { create, dispatch, receive }
}

/**
 * Post a goods receipt. The receipt number is the natural key: if the
 * server already holds it, the earlier post counted and this one is
 * reported as a replay rather than a failure.
 */
export function useGoodsReceipt(projectId: string | null) {
  const settle = useSettle(projectId)
  return useMutation({
    mutationFn: async (body: GoodsReceiptInput): Promise<GoodsReceiptResult> => {
      try {
        return await postGoodsReceipt(body)
      } catch (error) {
        if (isAppError(error) && error.serverCode === 'RECEIPT_ALREADY_POSTED') {
          const details = (error.details ?? {}) as { receiptNumber?: string; receiptId?: string; orderId?: string }
          return { receiptId: details.receiptId ?? '', receiptNumber: details.receiptNumber ?? body.receiptNumber, order: { id: details.orderId ?? body.orderId }, replayed: true }
        }
        throw error
      }
    },
    onSuccess: settle,
    retry: 0,
  })
}
