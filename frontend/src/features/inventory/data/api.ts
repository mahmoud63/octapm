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

// --- goods receipt against a purchase order -------------------------------

export type PurchaseOrderLine = {
  id: string
  lineNumber: number
  itemCode: string | null
  description: string
  spec: string | null
  unit: string
  orderedQty: number
  receivedQty: number
  rejectedQty: number
  outstandingQty: number
  unitCost: number
  activityId: string | null
  activity: string | null
  inventoryItemId: string | null
  inventoryItem: { id: string; sku: string; name: string; unit: string } | null
  status: string
}

export type PurchaseOrder = {
  id: string
  ref: string
  status: string
  warehouseStatus: string
  projectId: string
  project: string | null
  supplierId: string | null
  supplier: string | null
  value: number
  currency: string
  orderDate: string | null
  promisedDate: string | null
  lines: PurchaseOrderLine[]
}

export const findPurchaseOrder = (ref: string) =>
  apiClient
    .get(`${BASE}/purchase-orders/${encodeURIComponent(ref)}`)
    .then(unwrap<PurchaseOrder>)

/**
 * `receivable` is what goods receipt wants — orders still expecting a delivery.
 * `all` is what the match wants, because an order that has been fully received
 * and wrongly invoiced is exactly the case the match exists to catch.
 */
export const listOrders = (scope: 'receivable' | 'all' = 'all') =>
  apiClient
    .get(`${BASE}/purchase-orders`, { params: { scope } })
    .then((response) => unwrap<{ items: PurchaseOrder[] }>(response).items)

export type GoodsReceiptPayload = {
  orderId: string
  warehouseId: string
  receiptNumber?: string | null
  deliveryNote?: string | null
  notes?: string | null
  lines: Array<{
    poLineId: string
    acceptedQty?: number
    rejectedQty?: number
    unitCost?: number | null
    locationId?: string | null
    batchNo?: string | null
    serialNo?: string | null
  }>
}

/**
 * What posting a delivery gives back: the receipt itself, plus enough of the
 * warehouse, the order and each line for the screen to show what arrived
 * without a second round trip.
 *
 * Declared here rather than beside the component, because it was declared in
 * both places and the two drifted — the client's copy still stopped at
 * `movements` after the server had grown the rest, which made `tsc -b` fail
 * while the running app was fine (Phase 20.6).
 */
export type GoodsReceiptResult = {
  receiptId: string
  receiptNumber: string
  movements: number
  warehouse: { id: string; name: string | null } | null
  order: {
    id: string
    ref: string
    status: string
    fullyReceived: boolean
  } | null
  lines: Array<{
    poLineId: string
    description: string | null
    unit: string | null
    itemSku: string | null
    orderedQty: number
    acceptedQty: number
    rejectedQty: number
    receivedQty: number
    remainingQty: number
    onHand: number
    status: string
  }>
}

export const postGoodsReceipt = (payload: GoodsReceiptPayload) =>
  apiClient
    .post(`${BASE}/goods-receipt`, payload)
    .then(unwrap<GoodsReceiptResult>)

// --- three-way match ------------------------------------------------------

export type MatchFlag = {
  code: string
  severity: 'blocking' | 'warning' | 'info'
  message: string
}

export type MatchLine = {
  poLineId: string
  lineNumber: number
  description: string
  unit: string
  orderedQty: number
  receivedQty: number
  rejectedQty: number
  invoicedQty: number
  orderedValue: number
  receivedValue: number
  invoicedValue: number
  orderedUnitCost: number
  invoicedUnitCost: number
  flags: MatchFlag[]
}

export type OrderMatch = {
  orderId: string
  ref: string
  supplier: string | null
  projectId: string
  verdict: 'matched' | 'check' | 'review' | 'unmatched'
  totals: { ordered: number; received: number; invoiced: number }
  invoices: Array<{
    id: string
    ref: string
    invoiceNumber: string | null
    status: string
    total: number
    costDate: string | null
  }>
  lines: MatchLine[]
}

export const matchOrder = (orderId: string) =>
  apiClient.get(`${BASE}/match/order/${orderId}`).then(unwrap<OrderMatch>)

// --- analytics ------------------------------------------------------------

/** The shape every stock list on the dashboard shares. */
export type StockRow = {
  id: string
  sku: string
  name: string
  unit: string
  category: string | null
  onHand: number
  reserved: number
  damaged: number
  quarantined: number
  averageCost: number
  value: number
  reorderLevel: number
  minStock: number
  maxStock: number | null
  leadTimeDays: number
}

export type ShortageRow = StockRow & { shortfall: number }
export type OverstockRow = StockRow & { excess: number; excessValue: number }
export type SlowMovingRow = StockRow & { lastMovedAt: string | null; daysIdle: number | null }
export type DamagedRow = StockRow & { damagedValue: number; quarantinedValue: number }

export type ActivityUsage = {
  projectId: string | null
  project: string | null
  activityId: string | null
  activityRef: string | null
  activity: string | null
  quantity: number
  value: number
}

export type VarianceRow = {
  itemId: string
  sku: string
  name: string
  unit: string
  ordered: number
  received: number
  rejected: number
  issued: number
  onHand: number
  outstanding: number
  issuedOverReceived: number
}

export type PriceTrendRow = {
  itemId: string
  sku: string
  name: string
  unit: string
  deliveries: number
  first: number
  last: number
  change: number
  changePct: number
  rising: boolean
  points: Array<{ at: string | null; unitCost: number; quantity: number }>
}

export type MaterialNeed = {
  id: string
  projectId: string
  project: string | null
  activityId: string
  activityRef: string | null
  activity: string | null
  name: string
  code: string | null
  unit: string
  required: number
  received: number
  stillNeeded: number
  onHand: number | null
  itemId: string | null
  shortfall: number
  requiredDate: string | null
  orderByDate: string | null
  leadWeeks: number
  status: string
  daysUntilRequired: number | null
}

export type InventoryAnalytics = {
  generatedAt: string
  headline: {
    totalValue: number
    itemCount: number
    lowStock: number
    outOfStock: number
    overstock: number
    damagedValue: number
    quarantinedValue: number
    issuedValue: number
    warehouseCount: number
  }
  byWarehouse: Array<{
    id: string
    name: string
    kind: string
    value: number
    lines: number
    share: number
  }>
  lowStock: ShortageRow[]
  outOfStock: ShortageRow[]
  overstock: OverstockRow[]
  slowMoving: SlowMovingRow[]
  damaged: DamagedRow[]
  usageByActivity: ActivityUsage[]
  variance: VarianceRow[]
  priceTrend: PriceTrendRow[]
  upcomingNeeds: MaterialNeed[]
  longLead: MaterialNeed[]
}

export const getAnalytics = (projectId?: string) =>
  apiClient
    .get(`${BASE}/analytics`, { params: projectId ? { projectId } : {} })
    .then(unwrap<InventoryAnalytics>)
