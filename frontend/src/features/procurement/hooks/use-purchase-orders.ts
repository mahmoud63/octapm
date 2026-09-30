import type { BallInCourt } from '@/components/ball-in-court'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Purchase orders (OCTA-COM-PO-053).
 *
 * A purchase order is a commitment of the "purchase order" kind: request →
 * approval → issue → the supplier acknowledging it → delivery → goods receipt
 * → invoice → payment → close.
 *
 * It carries three states rather than one, because an order that is fully
 * delivered and half invoiced cannot pick a single word. `lifecycleStatus` is
 * the one name derived from all three, and it is what the badge shows.
 */

export const PO_STATUSES = [
  'planned',
  'draft',
  'pending_approval',
  'approved',
  'issued',
  'acknowledged',
  'closed',
  'cancelled',
] as const
export type PoStatus = (typeof PO_STATUSES)[number]

export const LIFECYCLE = [
  'draft',
  'pending_approval',
  'approved',
  'issued',
  'acknowledged',
  'partially_delivered',
  'delivered',
  'partially_invoiced',
  'fully_invoiced',
  'closed',
  'cancelled',
] as const
export type LifecycleStatus = (typeof LIFECYCLE)[number]

export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  issued: 'Issued',
  acknowledged: 'Acknowledged',
  partially_delivered: 'Partially delivered',
  delivered: 'Delivered',
  partially_invoiced: 'Partially invoiced',
  fully_invoiced: 'Fully invoiced',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

/**
 * The tone each stage reads in. Waiting on someone is amber, out with the
 * supplier is brand, money settled is green, and cancelled is muted rather
 * than red — a cancelled order is a decision, not a fault.
 */
export const LIFECYCLE_TONE: Record<LifecycleStatus, string> = {
  draft: 'bg-surface text-muted-foreground',
  pending_approval: 'bg-warning/15 text-warning-foreground',
  approved: 'bg-info/15 text-info-foreground',
  issued: 'bg-brand-accent/15 text-brand-accent',
  acknowledged: 'bg-brand-accent/15 text-brand-accent',
  partially_delivered: 'bg-info/15 text-info-foreground',
  delivered: 'bg-success/15 text-success-foreground',
  partially_invoiced: 'bg-info/15 text-info-foreground',
  fully_invoiced: 'bg-success/15 text-success-foreground',
  closed: 'bg-surface text-muted-foreground',
  cancelled: 'bg-surface text-muted-foreground line-through',
}

export type PoLine = {
  id: string
  lineNumber: number
  itemCode: string | null
  description: string
  spec: string | null
  unit: string
  orderedQty: number
  receivedQty: number
  rejectedQty: number
  issuedQty: number
  outstandingQty: number
  unitCost: number
  amount: number
  activityId: string | null
  activity: { id: string; name: string; code: string | null } | null
  inventoryItemId: string | null
  inventoryItem: { id: string; sku: string; name: string } | null
  requiredDate: string | null
  promisedDate: string | null
  status: string
  notes: string | null
}

export type PurchaseOrder = {
  id: string
  projectId: string
  project: string | null
  ref: string
  item: string
  status: PoStatus
  warehouseStatus: 'not_received' | 'partial' | 'received' | 'issued'
  invoiceStatus: 'not_invoiced' | 'partially_invoiced' | 'fully_invoiced'
  lifecycleStatus: LifecycleStatus
  lifecycleLabel: string
  /** Whose move it is, derived on the server from state and permissions. */
  ballInCourt?: BallInCourt | null
  supplierId: string | null
  supplier: string | null
  supplierEmail: string | null
  commitmentId: string | null
  currency: string
  subtotal: number
  taxRate: number
  taxAmount: number
  value: number
  invoicedAmount: number
  uninvoiced: number
  deliveryLocationId: string | null
  deliveryLocation: { id: string; name: string; code: string | null } | null
  deliveryAddress: string | null
  deliveryTerms: string | null
  paymentTerms: string | null
  orderDate: string | null
  requiredBy: string | null
  promisedDate: string | null
  deliveryDate: string | null
  submittedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  rejectedReason: string | null
  acknowledgedAt: string | null
  acknowledgedRef: string | null
  cancelledAt: string | null
  cancelReason: string | null
  closedAt: string | null
  buyer: string | null
  notes: string | null
  lines: PoLine[]
  receipts: Array<{
    id: string
    receiptNumber: string
    deliveryNote: string | null
    status: string
    receivedAt: string | null
  }>
  invoices: Array<{
    id: string
    ref: string
    invoiceNumber: string | null
    status: string
    total: number
    paidTotal: number
    costDate: string | null
  }>
}

export type PurchaseOrderList = {
  items: PurchaseOrder[]
  summary: {
    total: number
    byLifecycle: Record<string, number>
    /** Order value — not committed cost (orders neither planned nor cancelled). */
    orderValue: number
    orderValueLabel?: string
    /** @deprecated alias of orderValue kept for the mobile client; not committed cost. */
    committed: number
    invoiced: number
    awaitingApproval: number
    awaitingAcknowledgement: number
  }
}

const unwrap = <T,>(response: { data: { data: T } }) => response.data.data
const base = (projectId: string) => `/projects/${projectId}/purchase-orders`

export function usePurchaseOrders(projectId: string, status?: PoStatus) {
  return useQuery({
    queryKey: ['purchase-orders', projectId, status ?? null],
    queryFn: () =>
      apiClient
        .get(base(projectId), { params: status ? { status } : {} })
        .then(unwrap<PurchaseOrderList>),
    enabled: Boolean(projectId),
  })
}

export function usePurchaseOrder(projectId: string, orderId: string | null) {
  return useQuery({
    queryKey: ['purchase-orders', projectId, 'detail', orderId],
    queryFn: () => apiClient.get(`${base(projectId)}/${orderId}`).then(unwrap<PurchaseOrder>),
    enabled: Boolean(projectId && orderId),
  })
}

export type PoTransition =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'issue'
  | 'acknowledge'
  | 'cancel'
  | 'close'

export function usePoTransition(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      orderId,
      action,
      ...payload
    }: {
      orderId: string
      action: PoTransition
      reason?: string
      acknowledgedRef?: string
      force?: boolean
    }) =>
      apiClient
        .post(`${base(projectId)}/${orderId}/${action}`, payload)
        .then(unwrap<PurchaseOrder>),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders', projectId] })
      // Committed cost moves with the order, so the budget re-reads too.
      void queryClient.invalidateQueries({ queryKey: ['budget', projectId] })
    },
  })
}

export function useUpdatePurchaseOrder(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, ...payload }: { orderId: string } & Partial<PurchaseOrder>) =>
      apiClient.patch(`${base(projectId)}/${orderId}`, payload).then(unwrap<PurchaseOrder>),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders', projectId] }),
  })
}
