import { apiClient } from '@/services/api/client'

/**
 * Platform console additions from the integration onto the AI / BIM / Closeout /
 * Consultant baseline: AI usage (gateway ledger), feature adoption, search.
 * Counts and metadata only — the API never returns prompts, documents or
 * correspondence.
 */
const BASE = '/platform-admin'
const unwrap = <T>(response: { data: { data: T } }) => response.data.data

export type AiTotals = {
  requests: number
  ok: number
  failed: number
  blocked: number
  disabled: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostMicros: number | null
  unpricedRequests: number
  avgLatencyMs: number | null
  p95LatencyMs: number | null
}

export type AiConfiguration = {
  mode: 'live' | 'mock' | 'disabled'
  provider: string | null
  model: string | null
  fastModel: string | null
  limits: {
    dailyTokensPerOrganisation: number | null
    dailyTokensPerUser: number | null
    dailyRequestsPerUser: number | null
    maxOutputTokensPerAnswer: number | null
    note: string
  }
  pricing: string
}

export type AiUsage = {
  generatedAt: string
  windowDays: number
  organisation: string | null
  configuration: AiConfiguration
  today: AiTotals
  window: AiTotals
  byModel: Array<AiTotals & { provider: string; model: string }>
  byFeature: Array<AiTotals & { feature: string; module: string }>
  byOrganisation: Array<AiTotals & { organisation: { id: string; name: string } | null; people: number; projects: number; today: { tokens: number; requests: number }; todayShareOfLimit: number | null }>
  byUser: Array<AiTotals & { user: { id: string; name: string | null; email: string | null }; organisation: { id: string; name: string } | null }>
  failures: Array<{ status: string; errorClass: string; count: number }>
  daily: Array<{ day: string; requests: number; tokens: number; notOk: number }>
  definitions: Record<string, string>
}

export type NewFeatureDetail = {
  bim: { companies: number; projects: number; models: number; revisions: number; failedParses: number; elements: number; currentElements: number; currentElementsWithLinks: number; lastActivityAt: string | null }
  closeout: { projects: number; deliverables: number; settled: number; awaitingReview: number; projectsSubstantiallyComplete: number; projectsHandedOver: number; projectsFinalComplete: number; lastActivityAt: string | null }
  consultantReviews: { projectsWithConsultants: number; consultantCompanies: number; activeConsultants: number; invitationsSent: number; invitationsAccepted: number; projectsWithReviews: number; submissions: number; awaitingConsultant: number; overdue: number; withContractor: number; completed: number; withdrawn: number; responses: number; averageResponseMs: number | null; lastActivityAt: string | null }
}

export type FeatureAdoption = {
  generatedAt: string
  organisation: string | null
  capabilities: Array<{ key: string; label: string; companies: number; projects: number | null; projectsActive30d: number | null; records: number; lastAt: string | null }>
  byCompany: Array<{ organisation: { id: string; name: string }; projects: number; capabilities: Record<string, number>; inventoryItems: number }>
  detail: NewFeatureDetail
  definitions: Record<string, string>
}

export type PlatformSearch = {
  companies: Array<{ id: string; name: string; status: string; kind: string }>
  users: Array<{ id: string; name: string | null; email: string; status: string }>
  projects: Array<{ id: string; name: string; status: string; organisation: { id: string; name: string } }>
}

export const platformIntegrationApi = {
  aiUsage: (days: number, orgId?: string | null) => apiClient.get(`${BASE}/ai-usage`, { params: { days, ...(orgId ? { orgId } : {}) } }).then(unwrap<AiUsage>),
  features: (orgId?: string | null) => apiClient.get(`${BASE}/features`, { params: orgId ? { orgId } : {} }).then(unwrap<FeatureAdoption>),
  search: (q: string) => apiClient.get(`${BASE}/search`, { params: { q } }).then(unwrap<PlatformSearch>),
}

/** Overview, company detail and project rows gained these fields in the integration. */
export type OverviewAdditions = { ai?: { mode: string; provider: string | null; model: string | null; today: AiTotals; last7Days: AiTotals }; features?: NewFeatureDetail }
export type CompanyAdditions = {
  ai?: { windowDays: number; configuration: AiConfiguration; today: AiTotals; window: AiTotals; byFeature: AiUsage['byFeature']; byModel: AiUsage['byModel']; byUser: AiUsage['byUser']; failures: AiUsage['failures']; todayShareOfLimit: number | null }
  features?: { capabilities: Record<string, number>; projects: number; inventoryItems: number; detail: NewFeatureDetail }
}
export type ProjectFeatures = { bimModels: number; closeoutDeliverables: number; consultantReviews: number; consultantParties: number; aiCalls30d: number }
export type HealthAdditions = {
  ai?: { mode: string; provider: string | null; model: string | null; last24Hours: Array<{ status: string; errorClass: string; count: number }>; note: string }
  bim?: { last7DaysByStatus: Record<string, number>; note: string }
  emailBacklog?: { pending: number; pendingOver15Minutes: number; note: string }
}
