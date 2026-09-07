import { createFileRoute } from '@tanstack/react-router'
import { InventoryWorkspace } from '@/features/inventory'

export const Route = createFileRoute('/_authenticated/inventory')({
  component: InventoryWorkspace,
})
