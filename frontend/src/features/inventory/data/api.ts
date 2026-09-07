import { apiClient } from '@/services/api/client'

/**
 * The inventory API (OCTA-INV-STOCK-050).
 *
 * Company-level: a central store serves every project, so these are not scoped
 * to a project id. Movements carry the project and the activity or cost code
 * they are for.
 */

export type InventoryItem = {
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
  preferredSupplier: string | null
  unitCost: number
  averageCost: number
  lastPurchasePrice: number | null
  reorderLevel: number
  minStock: number
  maxStock: number | null
  leadTimeDays: number
  isSerialised: boolean
  isBatched: boolean
  status: 'active' | 'archived'
  notes: string | null
  onHand: number
  reserved: number
  available: number
  inTransit: number
  damaged: number
  quarantined: number
  value: number
  belowReorder: boolean
}

export type StockLine = {
  warehouseId: string
  warehouse: string | null
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

export type ScanResult = { item: InventoryItem; stock: StockLine[] }

export type Warehouse = {
  id: string
  code: string
  name: string
  kind: 'central' | 'project' | 'site' | 'temporary' | 'equipment_yard'
  projectId: string | null
  address: string | null
  managerId: string | null
  manager: string | null
  status: string
  notes: string | null
  locationCount?: number
}

export type WarehouseLocation = {
  id: string
  warehouseId: string
  parentId: string | null
  code: string
  name: string
  kind: 'zone' | 'aisle' | 'rack' | 'shelf' | 'bin'
  path: string
  depth: number
  status: string
}

export type StockTransaction = {
  id: string
  type: string
  itemId: string
  item?: { sku: string; name: string; unit: string }
  warehouseId: string
  warehouse: string | null
  locationId: string | null
  location: string | null
  quantity: number
  unitCost: number
  value: number
  balanceAfter: number
  projectId: string | null
  activityId: string | null
  costCodeId: string | null
  batchNo: string | null
  serialNo: string | null
  reference: string | null
  notes: string | null
  occurredAt: string | null
}

export type StockTransfer = {
  id: string
  ref: string
  status: 'draft' | 'in_transit' | 'received' | 'cancelled'
  fromWarehouseId: string
  fromWarehouse: string | null
  toWarehouseId: string
  toWarehouse: string | null
  reason: string | null
  notes: string | null
  dispatchedAt: string | null
  receivedAt: string | null
  lines: Array<{
    id: string
    itemId: string
    sku: string | null
    name: string | null
    unit: string | null
    quantity: number
    receivedQty: number
    damagedQty: number
  }>
}

export type InventorySummary = {
  totalValue: number
  itemCount: number
  lowStock: number
  outOfStock: number
  overstock: number
  slowMoving: number
  damaged: number
  quarantined: number
  issuedValue: number
  receivedValue: number
  byWarehouse: Array<{
    id: string
    name: string
    kind: string
    value: number
    lines: number
  }>
}

/** Everything the API answers with is wrapped in `{ success, data }`. */
const unwrap = <T,>(response: { data: { data: T } }) => response.data.data

const BASE = '/inventory'

export const listItems = (params: {
  search?: string
  category?: string
  lowStock?: boolean
  status?: string
} = {}) =>
  apiClient
    .get(`${BASE}/items`, { params })
    .then((response) => unwrap<{ items: InventoryItem[] }>(response).items)

export const getItem = (itemId: string) =>
  apiClient.get(`${BASE}/items/${itemId}`).then(unwrap<InventoryItem>)

/** Resolves a barcode, a QR token or a typed SKU to one item and its bins. */
export const scanCode = (code: string) =>
  apiClient
    .get(`${BASE}/items/scan/${encodeURIComponent(code)}`)
    .then(unwrap<ScanResult>)

export const createItem = (payload: Partial<InventoryItem>) =>
  apiClient.post(`${BASE}/items`, payload).then(unwrap<InventoryItem>)

export const updateItem = (itemId: string, payload: Partial<InventoryItem>) =>
  apiClient.patch(`${BASE}/items/${itemId}`, payload).then(unwrap<InventoryItem>)

export const listWarehouses = () =>
  apiClient
    .get(`${BASE}/warehouses`)
    .then((response) => unwrap<{ items: Warehouse[] }>(response).items)

export const createWarehouse = (payload: Partial<Warehouse>) =>
  apiClient.post(`${BASE}/warehouses`, payload).then(unwrap<Warehouse>)

export const listLocations = (warehouseId: string) =>
  apiClient
    .get(`${BASE}/warehouses/${warehouseId}/locations`)
    .then((response) => unwrap<{ items: WarehouseLocation[] }>(response).items)

export const createLocation = (
  warehouseId: string,
  payload: Partial<WarehouseLocation>
) =>
  apiClient
    .post(`${BASE}/warehouses/${warehouseId}/locations`, payload)
    .then(unwrap<WarehouseLocation>)

export type MovementPayload = {
  itemId: string
  warehouseId: string
  locationId?: string | null
  quantity: number
  unitCost?: number | null
  damagedQty?: number | null
  projectId?: string | null
  activityId?: string | null
  costCodeId?: string | null
  boqItemId?: string | null
  batchNo?: string | null
  serialNo?: string | null
  reference?: string | null
  notes?: string | null
}

/** A movement can touch several bins, so the API answers with a list. */
export type MovementResult = { movements: StockTransaction[] }

export const receiveStock = (payload: MovementPayload) =>
  apiClient.post(`${BASE}/stock/receive`, payload).then(unwrap<StockTransaction>)

export const issueStock = (payload: MovementPayload) =>
  apiClient.post(`${BASE}/stock/issue`, payload).then(unwrap<MovementResult>)

export const moveStock = (
  action: 'return' | 'adjust' | 'damage' | 'quarantine' | 'release',
  payload: MovementPayload
) => apiClient.post(`${BASE}/stock/${action}`, payload).then(unwrap<MovementResult>)

export const listTransactions = (params: {
  itemId?: string
  warehouseId?: string
  projectId?: string
  type?: string
  limit?: number
} = {}) =>
  apiClient
    .get(`${BASE}/stock/transactions`, { params })
    .then((response) => unwrap<{ items: StockTransaction[] }>(response).items)

export const listTransfers = (status?: string) =>
  apiClient
    .get(`${BASE}/transfers`, { params: status ? { status } : {} })
    .then((response) => unwrap<{ items: StockTransfer[] }>(response).items)

export const createTransfer = (payload: {
  fromWarehouseId: string
  toWarehouseId: string
  reason?: string | null
  lines: Array<{ itemId: string; quantity: number }>
}) => apiClient.post(`${BASE}/transfers`, payload).then(unwrap<StockTransfer>)

export const dispatchTransfer = (transferId: string) =>
  apiClient
    .post(`${BASE}/transfers/${transferId}/dispatch`)
    .then(unwrap<StockTransfer>)

export const receiveTransfer = (
  transferId: string,
  lines?: Array<{ id: string; receivedQty?: number; damagedQty?: number }>
) =>
  apiClient
    .post(`${BASE}/transfers/${transferId}/receive`, lines ? { lines } : {})
    .then(unwrap<StockTransfer>)

export const getSummary = () =>
  apiClient.get(`${BASE}/summary`).then(unwrap<InventorySummary>)
