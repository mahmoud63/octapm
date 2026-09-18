/** Inventory fixtures for the M5 tests, shaped like the live API of 2026-09-18. */
import type { InventoryItem, InventorySummary, PurchaseOrder, ScanResult, StockMovement, Transfer, Warehouse, WarehouseLocation } from '@/api/inventory-types'
import { matrix } from '@/testing/fixtures'

export const summary: InventorySummary = {
  totalValue: 673843.65,
  itemCount: 6,
  lowStock: 1,
  outOfStock: 1,
  overstock: 1,
  slowMoving: 5,
  damaged: 10,
  quarantined: 0,
  byWarehouse: [
    { id: 'w1', name: 'Central Warehouse', kind: 'central', value: 626839.62, lines: 4 },
    { id: 'w2', name: 'Riverside Site Store', kind: 'site', value: 47004.03, lines: 2 },
  ],
}

export const warehouse = (over: Partial<Warehouse> = {}): Warehouse => ({
  id: 'w1',
  code: 'WH-CENTRAL',
  name: 'Central Warehouse',
  kind: 'central',
  projectId: null,
  address: null,
  managerId: null,
  manager: null,
  status: 'active',
  notes: null,
  locationCount: 5,
  ...over,
})

export const warehouses = [warehouse(), warehouse({ id: 'w2', code: 'WH-RIVERSIDE', name: 'Riverside Site Store', kind: 'site', projectId: 'p1', locationCount: 2 })]

export const locations: WarehouseLocation[] = [
  { id: 'loc1', code: 'A-01', name: 'Aisle A bin 1', kind: 'bin', parentId: null, sortOrder: 1 },
  { id: 'loc2', code: 'YARD', name: 'Open yard', kind: 'zone', parentId: null, sortOrder: 2 },
]

export const item = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'i1',
  projectId: null,
  sku: 'CEM-42.5N',
  barcode: '5012345678900',
  qrCode: 'CEM-42.5N',
  name: 'Cement OPC 42.5N',
  description: 'Ordinary Portland cement, 50kg bag',
  category: 'Concrete',
  unit: 'bag',
  manufacturer: 'Riverstone Cement',
  model: 'OPC-42.5N',
  specification: 'BS EN 197-1 CEM I 42.5N',
  preferredSupplierId: null,
  preferredSupplier: null,
  unitCost: 6.4,
  averageCost: 6.42,
  lastPurchasePrice: 6.5,
  reorderLevel: 400,
  minStock: 200,
  maxStock: 4000,
  leadTimeDays: 7,
  isSerialised: false,
  isBatched: false,
  status: 'active',
  notes: null,
  onHand: 1008,
  reserved: 40,
  available: 968,
  inTransit: 0,
  damaged: 10,
  quarantined: 0,
  value: 6471.36,
  belowReorder: false,
  createdAt: '2026-09-07T06:31:58.036Z',
  updatedAt: '2026-09-15T17:53:24.216Z',
  ...over,
})

export const items = [item(), item({ id: 'i2', sku: 'RBR-T16', barcode: null, qrCode: 'RBR-T16', name: 'Reinforcement bar T16', category: 'Steel', unit: 'bar', onHand: 120, reserved: 0, available: 120, reorderLevel: 400, belowReorder: true, damaged: 0 })]

export const scanResult = (over: Partial<ScanResult> = {}): ScanResult => ({
  item: item(),
  stock: [
    { warehouseId: 'w1', warehouse: 'Central Warehouse', warehouseCode: 'WH-CENTRAL', locationId: 'loc1', location: 'Aisle A bin 1', locationCode: 'A-01', onHand: 800, reserved: 40, available: 760, damaged: 10, quarantined: 0 },
    { warehouseId: 'w2', warehouse: 'Riverside Site Store', warehouseCode: 'WH-RIVERSIDE', locationId: null, location: null, locationCode: null, onHand: 208, reserved: 0, available: 208, damaged: 0, quarantined: 0 },
  ],
  ...over,
})

export const movement = (over: Partial<StockMovement> = {}): StockMovement => ({
  id: 'm1',
  type: 'issue',
  itemId: 'i1',
  item: { sku: 'CEM-42.5N', name: 'Cement OPC 42.5N', unit: 'bag' },
  warehouseId: 'w1',
  warehouse: 'Central Warehouse',
  locationId: null,
  location: null,
  quantity: -25,
  unitCost: 6.42,
  value: 160.5,
  balanceAfter: 1008,
  projectId: 'p1',
  activityId: 'a1',
  costCodeId: null,
  boqItemId: null,
  batchNo: null,
  serialNo: null,
  reference: 'REQ-014',
  notes: 'Issued to the raft pour',
  performedBy: 'u1',
  occurredAt: '2026-09-17T08:48:14.264Z',
  ...over,
})

export const movements = [movement(), movement({ id: 'm2', type: 'receipt', quantity: 400, balanceAfter: 1033, reference: 'GRN-00007', notes: null, occurredAt: '2026-09-16T10:00:00.000Z' })]

export const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: 't1',
  ref: 'TRF-00015',
  status: 'draft',
  fromWarehouseId: 'w1',
  fromWarehouse: 'Central Warehouse',
  toWarehouseId: 'w2',
  toWarehouse: 'Riverside Site Store',
  reason: 'Raft pour next week',
  notes: null,
  dispatchedAt: null,
  receivedAt: null,
  lines: [{ id: 'tl1', itemId: 'i1', sku: 'CEM-42.5N', name: 'Cement OPC 42.5N', unit: 'bag', quantity: 10, receivedQty: null, damagedQty: null }],
  createdAt: '2026-09-18T06:00:00.000Z',
  ...over,
})

export const transfers = [transfer(), transfer({ id: 't2', ref: 'TRF-00014', status: 'received', dispatchedAt: '2026-09-15T03:24:00.842Z', receivedAt: '2026-09-15T03:25:00.000Z', reason: 'Top-up', lines: [{ id: 'tl2', itemId: 'i2', sku: 'RBR-T16', name: 'Reinforcement bar T16', unit: 'bar', quantity: 40, receivedQty: 38, damagedQty: 2 }] })]

export const purchaseOrder = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po1',
  ref: 'PO-0001',
  status: 'issued',
  warehouseStatus: 'not_received',
  projectId: 'p1',
  project: 'Riverside Tower',
  supplierId: 's1',
  supplier: 'Riverstone Cement',
  value: 13700,
  currency: 'USD',
  orderDate: '2026-01-05T00:00:00.000Z',
  promisedDate: '2030-02-02T00:00:00.000Z',
  lines: [
    { id: 'l1', lineNumber: 1, itemCode: 'RBR-T16', description: 'Reinforcement bar T16', spec: null, unit: 'bar', orderedQty: 400, receivedQty: 0, rejectedQty: 0, outstandingQty: 400, unitCost: 21.5, activityId: 'a1', activity: 'Reinforced concrete frame', inventoryItemId: 'i2', inventoryItem: { id: 'i2', sku: 'RBR-T16', name: 'Reinforcement bar T16', unit: 'bar' }, status: 'ordered' },
    { id: 'l2', lineNumber: 2, itemCode: 'FWK-PLY18', description: 'Formwork plywood 18mm', spec: null, unit: 'sheet', orderedQty: 150, receivedQty: 0, rejectedQty: 0, outstandingQty: 150, unitCost: 34, activityId: null, activity: null, inventoryItemId: null, inventoryItem: null, status: 'ordered' },
  ],
  ...over,
})

export const purchaseOrders = [purchaseOrder(), purchaseOrder({ id: 'po2', ref: 'PO-0002', status: 'received', warehouseStatus: 'received', supplier: 'Gulf Aggregates', value: 8200, lines: [{ id: 'l3', lineNumber: 1, itemCode: 'AGG-20', description: 'Aggregate 20mm', spec: null, unit: 't', orderedQty: 100, receivedQty: 100, rejectedQty: 0, outstandingQty: 0, unitCost: 82, activityId: null, activity: null, inventoryItemId: null, inventoryItem: null, status: 'received' }] })]

export const storekeeper = matrix('warehouse', {
  inventory: { actions: ['read', 'create', 'update', 'submit'], transitions: ['item.manage', 'warehouse.manage', 'stock.receive', 'stock.issue', 'stock.return', 'stock.transfer', 'stock.adjust'] },
  schedule: { actions: ['read'] },
  procurement: { actions: ['read'] },
})

export const siteEngineerInventory = matrix('site_engineer', {
  inventory: { actions: ['read', 'submit', 'update'], transitions: ['stock.issue', 'stock.return'] },
  schedule: { actions: ['read'] },
})
