/**
 * Shapes for the inventory screens (M5): the summary tiles, the item master
 * with derived stock, per-warehouse balances from a scan, warehouses and
 * bins, the movement ledger, transfers, receivable purchase orders and the
 * goods receipt. Checked against live responses on 2026-09-18 (map §4.4).
 * Inventory is organisation-level on the server: paths carry no project,
 * and lists take `projectId` as a filter.
 */
import type { Named } from '@/api/record-types'

export interface InventorySummary {
  totalValue: number
  itemCount: number
  lowStock: number
  outOfStock: number
  overstock: number
  slowMoving: number
  damaged: number
  quarantined: number
  byWarehouse: { id: string; name: string; kind: string; value: number; lines: number }[]
  issuedValue?: number
  receivedValue?: number
}

export interface InventoryItem {
  id: string
  projectId: string | null
  sku: string
  barcode: string | null
  qrCode: string | null
  name: string
  description: string | null
  category: string | null
  unit: string
  manufacturer: string | null
  model: string | null
  specification: string | null
  preferredSupplierId: string | null
  preferredSupplier: Named | null
  unitCost: number | null
  averageCost: number | null
  lastPurchasePrice: number | null
  reorderLevel: number | null
  minStock: number | null
  maxStock: number | null
  leadTimeDays: number | null
  isSerialised: boolean
  isBatched: boolean
  status: 'active' | 'archived' | string
  notes: string | null
  onHand: number
  reserved: number
  available: number
  inTransit: number
  damaged: number
  quarantined: number
  value: number
  belowReorder: boolean
  createdAt: string
  updatedAt: string
}

export interface StockBalance {
  warehouseId: string
  warehouse: string
  warehouseCode: string | null
  locationId: string | null
  location: string | null
  locationCode: string | null
  onHand: number
  reserved: number
  available: number
  damaged: number
  quarantined: number
}

export interface ScanResult {
  item: InventoryItem
  stock: StockBalance[]
}

export interface Warehouse {
  id: string
  code: string
  name: string
  kind: 'central' | 'project' | 'site' | 'temporary' | 'equipment_yard' | string
  projectId: string | null
  address: string | null
  managerId: string | null
  manager: Named | string | null
  status: string
  notes: string | null
  locationCount: number
  createdAt?: string
}

export interface WarehouseLocation {
  id: string
  code: string
  name: string
  kind: 'zone' | 'aisle' | 'rack' | 'shelf' | 'bin' | string
  parentId: string | null
  sortOrder: number | null
}

export type MovementType = 'receipt' | 'issue' | 'return' | 'transfer_out' | 'transfer_in' | 'adjust' | 'count' | 'damage' | 'quarantine' | 'release' | 'reverse' | string
export const MOVEMENT_TYPES = ['receipt', 'issue', 'return', 'transfer_out', 'transfer_in', 'adjust', 'damage', 'quarantine', 'release'] as const

export interface StockMovement {
  id: string
  type: MovementType
  itemId: string
  item: { sku: string; name: string; unit: string } | null
  warehouseId: string
  warehouse: string | null
  locationId: string | null
  location: string | null
  quantity: number
  unitCost: number | null
  value: number | null
  balanceAfter: number | null
  projectId: string | null
  activityId: string | null
  costCodeId: string | null
  boqItemId: string | null
  batchNo: string | null
  serialNo: string | null
  reference: string | null
  notes: string | null
  performedBy: string | Named | null
  occurredAt: string
}

/** Everything the stock routes take; each route reads the subset it needs. */
export interface StockMoveInput {
  itemId: string
  warehouseId: string
  quantity: number
  locationId?: string
  projectId?: string
  activityId?: string
  costCodeId?: string
  reference?: string
  notes?: string
  batchNo?: string
  serialNo?: string
  unitCost?: number
  damagedQty?: number
}

export type StockMoveKind = 'receive' | 'issue' | 'reserve' | 'return' | 'adjust' | 'damage' | 'quarantine' | 'release'

export interface ReservationState {
  itemId: string
  warehouseId: string
  locationId: string | null
  onHand: number
  reserved: number
  available: number
  reservedBy?: string | null
}

export interface TransferLine {
  id: string
  itemId: string
  sku: string | null
  name: string | null
  unit: string | null
  quantity: number
  receivedQty: number | null
  damagedQty: number | null
  notes?: string | null
}

export type TransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled' | string

export interface Transfer {
  id: string
  ref: string
  status: TransferStatus
  fromWarehouseId: string
  fromWarehouse: string | null
  toWarehouseId: string
  toWarehouse: string | null
  reason: string | null
  notes: string | null
  dispatchedAt: string | null
  receivedAt: string | null
  lines: TransferLine[]
  createdAt: string
}

export interface TransferCreate {
  fromWarehouseId: string
  toWarehouseId: string
  lines: { itemId: string; quantity: number; notes?: string }[]
  reason?: string
}

export type PurchaseOrderStatus = 'draft' | 'issued' | 'acknowledged' | 'partial' | 'received' | 'closed' | 'cancelled' | string
/** Orders a warehouse may receive against; the server refuses the rest with `PO_NOT_ISSUED`. */
export const RECEIVABLE_PO_STATUSES = ['issued', 'acknowledged', 'partial'] as const

export interface PoLine {
  id: string
  lineNumber: number
  itemCode: string | null
  description: string
  spec: string | null
  unit: string | null
  orderedQty: number
  receivedQty: number
  rejectedQty: number
  outstandingQty: number
  unitCost: number | null
  activityId: string | null
  activity: string | Named | null
  inventoryItemId: string | null
  inventoryItem: { id: string; sku: string; name: string; unit: string } | null
  status: string
}

export interface PurchaseOrder {
  id: string
  ref: string
  status: PurchaseOrderStatus
  warehouseStatus: 'not_received' | 'partial' | 'received' | string
  projectId: string
  project: string | null
  supplierId: string | null
  supplier: string | null
  value: number | null
  currency: string | null
  orderDate: string | null
  promisedDate: string | null
  lines: PoLine[]
}

export interface GoodsReceiptInput {
  orderId: string
  warehouseId: string
  /** Generated on the device once per receipt and reused on every retry: the server's natural key. */
  receiptNumber: string
  deliveryNote?: string
  notes?: string
  lines: { poLineId: string; acceptedQty?: number; rejectedQty?: number; locationId?: string; notes?: string }[]
}

export interface GoodsReceiptResult {
  receiptId: string
  receiptNumber: string
  movements?: unknown[]
  warehouse?: string | Named | null
  order: { id: string; ref?: string; status?: string; fullyReceived?: boolean }
  lines?: unknown[]
  /** True when the server already held this receipt number: the earlier post counted. */
  replayed?: boolean
}
