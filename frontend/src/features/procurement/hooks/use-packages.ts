import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { apiClient } from '@/services/api/client'

type ApiErrorResponse = { error?: { message?: string } }
const apiErrorMessage = (err: AxiosError<ApiErrorResponse>, fallback: string) =>
  err.response?.data?.error?.message ?? fallback
import type { BallInCourt } from '@/components/ball-in-court'

/**
 * Procurement packages, and the quote enquiries raised against them.
 *
 * The comparison engine is the one Commercial uses for subcontract bidding —
 * it already understood a purchase order as the thing being awarded. Nothing
 * here rebuilds it; this is the buyer's way in, so they never have to know
 * which module the machinery lives in.
 */

export type ProcurementPackage = {
  id: string
  packageNumber: string
  title: string
  description: string | null
  status: string
  requiredOnSiteDate: string | null
  latestOrderDate: string | null
  leadWeeks: number
  activityId: string | null
  activity?: { id: string; name: string; activityCode?: string | null } | null
  supplierId: string | null
  supplier?: { id: string; name: string } | null
  riskLevel?: string | null
  daysOfFloat?: number | null
  ballInCourt?: BallInCourt | null
}

export type QuoteEnquiry = {
  id: string
  ref: string
  title: string
  status: string
  dueAt: string | null
  currency: string
  commitmentType: string
  invitedSuppliers: number
  quotesReceived: number
  createdAt: string
}

const packagesKey = (projectId: string) => ['procurement-packages', projectId]
const quotesKey = (projectId: string, packageId: string) => [
  'procurement-quotes',
  projectId,
  packageId,
]

export function useProcurementPackages(projectId: string) {
  return useQuery<ProcurementPackage[]>({
    queryKey: packagesKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/procurement/packages`)
        .then((r) => r.data.data?.items ?? r.data.data ?? []),
    enabled: Boolean(projectId),
  })
}

export function usePackageQuotes(projectId: string, packageId: string | null) {
  return useQuery<QuoteEnquiry[]>({
    queryKey: quotesKey(projectId, packageId ?? 'none'),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/procurement/packages/${packageId}/quotes`)
        .then((r) => r.data.data?.items ?? []),
    enabled: Boolean(projectId && packageId),
  })
}

/**
 * Ask suppliers to price a package.
 *
 * Everything the enquiry needs — title, description, currency, and the date the
 * quotes are wanted by — is already on the package, so nothing is retyped. The
 * commitment type is chosen server-side, because asking a buyer to pick
 * "purchase order" over "subcontract" is asking them to know which engine they
 * are standing in.
 */
export function useRequestQuotes(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (packageId: string) =>
      apiClient
        .post(`/projects/${projectId}/procurement/packages/${packageId}/quotes`, {})
        .then((r) => r.data.data),
    onSuccess: async (_data, packageId) => {
      toast.success('Quote enquiry opened — invite the suppliers you want to price it')
      await qc.invalidateQueries({ queryKey: quotesKey(projectId, packageId) })
      await qc.invalidateQueries({ queryKey: packagesKey(projectId) })
    },
    onError: (error: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(error, 'Could not open the quote enquiry'))
    },
  })
}
