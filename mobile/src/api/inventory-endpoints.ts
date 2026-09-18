/**
 * Inventory calls (M5). All paths are organisation-level (`/inventory/…`);
 * the project is a filter. Stock mutations are not replay-safe on the
 * server, so nothing here retries them; only the goods receipt has a natural
 * key, the receipt number the device generates once and reuses.
 */
import { api, run } from '@/api/client'
import type {
  GoodsReceiptInput,
  GoodsReceiptResult,
  InventoryItem,
  InventorySummary,
  MovementType,
  PurchaseOrder,
  ReservationState,
  ScanResult,
  StockMoveInput,
  StockMoveKind,
  StockMovement,
  Transfer,
  TransferCreate,
  Warehouse,
  WarehouseLocation,
} from '@/api/inventory-types'

type Query = Record<string, string | number | boolean | undefined>
type PathParams = Record<string, string>

const get = <T>(path: string, options: { path?: PathParams; query?: Query; signal?: AbortSignal } = {}) =>
  run<T>(() => api.GET(path as never, { params: { path: options.path, query: options.query }, signal: options.signal } as never) as never)

const send = <T>(method: 'POST' | 'PATCH', path: string, options: { path?: PathParams; body?: unknown } = {}) =>
  run<T>(() => (api[method] as typeof api.POST)(path as never, { params: { path: options.path }, body: options.body } as never) as never)

const rows = <T>(data: { items?: T[] } | T[]): T[] => (Array.isArray(data) ? data : (data.items ?? []))

// ── Summary, items, scan ──

export const getInventorySummary = (projectId: string, signal?: AbortSignal) => get<InventorySummary>('/inventory/summary', { query: { projectId }, signal })

export interface ItemFilters {
  search?: string
  category?: string
  lowStock?: boolean
  status?: 'active' | 'archived'
}

export const listInventoryItems = async (projectId: string, filters: ItemFilters = {}, signal?: AbortSignal) =>
  rows(await get<{ items: InventoryItem[] }>('/inventory/items', { query: { projectId, search: filters.search || undefined, category: filters.category, lowStock: filters.lowStock ? true : undefined, status: filters.status }, signal }))

export const getInventoryItem = (itemId: string, signal?: AbortSignal) => get<InventoryItem>('/inventory/items/{itemId}', { path: { itemId }, signal })

/** Exact match on barcode, QR code or SKU. Items only: the server has no bin, warehouse or order barcodes. */
export const scanInventoryCode = (code: string, signal?: AbortSignal) => get<ScanResult>('/inventory/items/scan/{code}', { path: { code }, signal })

// ── Warehouses ──

export const listWarehouses = async (projectId: string | null, signal?: AbortSignal) => rows(await get<{ items: Warehouse[] }>('/inventory/warehouses', { query: { projectId: projectId ?? undefined }, signal }))

export const listWarehouseLocations = async (warehouseId: string, signal?: AbortSignal) => rows(await get<{ items: WarehouseLocation[] }>('/inventory/warehouses/{warehouseId}/locations', { path: { warehouseId }, signal }))

// ── Stock movements ──

export const moveStock = (kind: Exclude<StockMoveKind, 'reserve'>, body: StockMoveInput) => send<StockMovement | { movements: StockMovement[]; costPosted?: boolean; costNote?: string | null }>('POST', `/inventory/stock/${kind}`, { body })

export const reserveStock = (body: StockMoveInput) => send<ReservationState>('POST', '/inventory/stock/reserve', { body })

export interface MovementFilters {
  itemId?: string
  warehouseId?: string
  projectId?: string
  activityId?: string
  type?: MovementType
  limit?: number
}

export const listStockMovements = async (filters: MovementFilters = {}, signal?: AbortSignal) =>
  rows(await get<{ items: StockMovement[] }>('/inventory/stock/transactions', { query: { itemId: filters.itemId, warehouseId: filters.warehouseId, projectId: filters.projectId, activityId: filters.activityId, type: filters.type, limit: filters.limit ?? 100 }, signal }))

// ── Transfers ──

export const listTransfers = async (status?: string, signal?: AbortSignal) => rows(await get<{ items: Transfer[] } | Transfer[]>('/inventory/transfers', { query: { status }, signal }))

export const createTransfer = (body: TransferCreate) => send<Transfer>('POST', '/inventory/transfers', { body })

export const dispatchTransfer = (transferId: string) => send<Transfer>('POST', '/inventory/transfers/{transferId}/dispatch', { path: { transferId }, body: {} })

export const receiveTransfer = (transferId: string, lines?: { id: string; receivedQty?: number; damagedQty?: number }[]) =>
  send<Transfer>('POST', '/inventory/transfers/{transferId}/receive', { path: { transferId }, body: lines ? { lines } : {} })

// ── Purchase orders and goods receipt ──

/** Every order on the project; the receivable ones are picked on the device, since the server's `scope=receivable` filter disagrees with its own receipt rule. */
export const listPurchaseOrders = async (projectId: string, signal?: AbortSignal) => rows(await get<{ items: PurchaseOrder[] } | PurchaseOrder[]>('/inventory/purchase-orders', { query: { projectId, scope: 'all' }, signal }))

/** By id, never by ref: refs repeat across projects in an organisation. */
export const getPurchaseOrder = (orderId: string, signal?: AbortSignal) => get<PurchaseOrder>('/inventory/purchase-orders/{ref}', { path: { ref: orderId }, signal })

export const postGoodsReceipt = (body: GoodsReceiptInput) => send<GoodsReceiptResult>('POST', '/inventory/goods-receipt', { body })
