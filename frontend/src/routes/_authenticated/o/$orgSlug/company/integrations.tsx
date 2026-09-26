import { createFileRoute } from '@tanstack/react-router'
import { CompanyIntegrations } from '@/features/company/integrations'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company/integrations')({
  validateSearch: (search: Record<string, unknown>) => ({
    connected:
      typeof search.connected === 'string' ? search.connected : undefined,
  }),
  component: CompanyIntegrations,
})
