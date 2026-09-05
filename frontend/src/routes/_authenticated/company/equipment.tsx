import { createFileRoute } from '@tanstack/react-router'
import { CompanyEquipmentPage } from '@/features/company/equipment'

export const Route = createFileRoute('/_authenticated/company/equipment')({
  component: CompanyEquipmentPage,
})
