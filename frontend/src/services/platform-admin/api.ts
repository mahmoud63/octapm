import { apiClient } from '@/services/api/client'

/**
 * The platform operations console API (/api/v1/platform-admin).
 * Read-only; the server is the only authority on who may call it.
 */
const unwrap = <T>(r: { data: { data: T } }): T => r.data.data

export type PageInfo = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}
export type Paged<T> = {
  items: T[]
  page: PageInfo
  definitions?: Record<string, string>
}
export type ListQuery = Record<string, string | number | undefined>

export type PlatformOperator = {
  userId: string
  email: string
  name: string
  role: string
}

export type Overview = {
  generatedAt: string
  organisations: {
    total: number
    activeStatus: number
    suspendedOrClosed: number
    company: number
    personal: number
    activeLast30Days: number
    newThisMonth: number
    withoutSubscription: number
  }
  subscriptions: {
    byPlan: Record<string, number>
    byStatus: Record<string, number>
    trial: number
    business: number
    enterprise: number
    individual: number
    canceledOrExpired: number
    pastDue: number
  }
  users: {
    total: number
    activeStatus: number
    activeLast24Hours: number
    activeLast30Days: number
    newThisMonth: number
  }
  projects: { total: number; active: number; archived: number }
  invitations: { pending: number }
  storage: { bytes: number; files: number }
  jobs: { failedLast24Hours: number; failedLast7Days: number }
  errors: { last24Hours: number; serverErrorsLast24Hours: number }
  release: {
    version: string
    sha: string | null
    builtAt: string | null
    environment: string
  }
  definitions: Record<string, string>
}

export type CompanyRow = {
  id: string
  name: string
  slug: string | null
  workspaceType: string
  status: string
  timezone: string | null
  createdAt: string
  plan: string | null
  subscriptionStatus: string | null
  seats: number | null
  activeMembers: number
  totalMembers: number
  activeProjects: number
  totalProjects: number
  lastActivityAt: string | null
  storageBytes: number
  serverErrors7d: number
  healthFlags: string[]
}

export type PlatformSubscription = {
  plan: string
  planName: string | null
  recognized: boolean
  configurationError: unknown
  status: string
  hasAccess: boolean
  seats: number
  billingCycle: string | null
  trialStartsAt: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  providerCustomerLinked: boolean
  providerSubscriptionLinked: boolean
  lastInvoiceStatus: string | null
  paymentIssue: boolean
}

export type CountRow = Record<string, string | number | null>

export type CompanyDetail = {
  company: {
    id: string
    name: string
    slug: string | null
    workspaceType: string
    status: string
    timezone: string | null
    currency: string
    createdAt: string
    security: {
      ssoEnabled: boolean
      ssoRequired: boolean
      mfaRequired: boolean
    }
  }
  subscription: PlatformSubscription | null
  members: {
    byStatus: Record<string, number>
    activeAdmins: number
    activeOwners: number
    activeGuests: number
    activeByRole: { role: string; n: number }[]
    pendingInvitations: number
    listed: number
    limit: number
    items: {
      userId: string
      name: string
      email: string
      role: string
      kind: string
      membershipStatus: string
      accountStatus: string
      isAdmin: boolean
      isOwner: boolean
      joinedAt: string | null
      lastLoginAt: string | null
    }[]
  }
  projects: {
    listed: number
    limit: number
    items: {
      id: string
      name: string
      status: string
      createdAt: string
      archivedAt: string | null
      members: number
      lastActivityAt: string | null
      recordChanges30d: number
    }[]
  }
  usage: {
    windowDays: number
    recordActivity: {
      module: string
      action: string
      events: number
      people: number
    }[]
    trackedEvents: {
      eventName: string
      module: string
      events: number
      people: number
    }[]
  }
  errors: {
    windowDays: number
    byCode: { code: string; status: number; n: number }[]
  }
  jobs: {
    windowDays: number
    byStatus: Record<string, number>
    recentFailures: {
      id: string
      type: string
      errorCode: string | null
      attempts: number
      maxAttempts: number
      updatedAt: string
    }[]
  }
  storage: { bytes: number; files: number }
  platformAccess: {
    recentViews: {
      actorEmail: string
      action: string
      statusCode: number
      occurredAt: string
    }[]
  }
}

export type UserRow = {
  id: string
  name: string
  email: string
  accountStatus: string
  createdAt: string
  lastLoginAt: string | null
  mfaEnabled: boolean
  ssoLinked: boolean
  memberships: number
  activeMemberships: number
  companies: { id: string; name: string; role: string; status: string }[]
  pendingInvitations: number
  platformOperator: boolean
}

export type ProjectRow = {
  id: string
  name: string
  status: string
  createdAt: string
  archivedAt: string | null
  organisation: { id: string; name: string }
  members: number
  lastActivityAt: string | null
  recordChanges30d: number
  modulesUsed30d: string[]
  healthFlags: string[]
}

export type SubscriptionRow = PlatformSubscription & {
  organisation: {
    id: string
    name: string
    workspaceType: string
    status: string
  }
  activeMembers: number
  updatedAt: string
}

export type ModuleUsage = {
  module: string
  events: number
  companies: number
  people: number
  shareOfActiveCompanies: number | null
  shareOfEligibleCompanies: number | null
}

export type FunnelStep = {
  key: string
  label: string
  count: number
  ofFirst: number | null
}

export type Analytics = {
  windowDays: number
  from: string
  to: string
  denominators: {
    activeCompanies: number
    eligibleCompanies: number
    definitions: Record<string, string>
  }
  tracking: {
    trackedEventsInWindow: number
    trackingSince: string | null
    note: string | null
  }
  modules: {
    recordActivity: ModuleUsage[]
    trackedEvents: ModuleUsage[]
    mostUsed: string[]
    leastUsed: string[]
  }
  events: {
    eventName: string
    module: string
    platform: string
    events: number
    companies: number
    people: number
  }[]
  repeatUse: {
    module: string
    people: number
    repeat_people: number
    repeatRate: number | null
  }[]
  engagement: {
    dailyActivePeople: number
    weeklyActivePeople: number
    monthlyActivePeople: number
    activeInWindow: number
    returningFromPreviousWindow: number
    newAndActive: number
    lastSignInDistribution: Record<string, number>
    daily: { day: string; people: number; companies: number }[]
    signups: { day: string; new_users: number; new_companies: number }[]
    definitions: Record<string, string>
  }
  funnels: {
    key: string
    label: string
    steps: FunnelStep[]
    rejected?: number
  }[]
}

export type SystemHealth = {
  generatedAt: string
  release: {
    version: string
    sha: string | null
    builtAt: string | null
    environment: string
    uptimeSeconds: number
    node: string
  }
  database: {
    ok: boolean
    latencyMs: number
    sizeBytes?: number
    connections?: number
    queriesOver30s?: number
  }
  jobs: {
    last24HoursByStatus: Record<string, number>
    queue: {
      readyToRun: number
      scheduledLater: number
      running: number
      stuck: number
      oldestReadySince: string | null
      stuckDefinition: string
    }
    recentFailures: {
      id: string
      type: string
      errorCode: string | null
      attempts: number
      maxAttempts: number
      failedAt: string
      organisation: { id: string; name: string } | null
    }[]
  }
  worker: {
    enabledInThisProcess: boolean
    lastJobActivityAt: string | null
    note: string
  }
  scheduler: {
    enabledInThisProcess: boolean
    leaderLockHeld: boolean
    note: string
  }
  webhooks: { last7DaysByStatus: Record<string, number> }
  notifications: {
    last7Days: { channel: string; status: string; n: number }[]
    failuresByCode: { channel: string; code: string; n: number }[]
  }
  telemetry: {
    enabled: boolean
    buffered: { product: number; errors: number }
    productWritten: number
    errorWritten: number
    dropped: number
    failedFlushes: number
    lastFailureAt: string | null
    lastFailureCode: string | null
    lastFlushAt: string | null
  }
}

export type ErrorAnalytics = {
  summary: {
    last24Hours: number
    serverErrorsLast24Hours: number
    last7Days: number
    serverErrorsLast7Days: number
  }
  topCodes: { code: string; status: number; n: number }[]
  byModule: { module: string; n: number; server: number }[]
  byOrganisation: {
    organisation: { id: string; name: string | null }
    n: number
    server: number
  }[]
  topServerErrorRoutes: {
    method: string
    routePattern: string
    n: number
    server: number
  }[]
  daily: { day: string; n: number; server: number }[]
  spikes: string[]
  definitions: Record<string, string>
}

export type AuditRow = {
  id: string
  actorUserId: string
  actorEmail: string
  actorRole: string
  action: string
  targetType: string | null
  targetId: string | null
  targetOrgId: string | null
  method: string
  path: string
  queryKeys: string[]
  statusCode: number
  requestId: string | null
  occurredAt: string
}

const clean = (query: ListQuery) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== '')
  )

const BASE = '/platform-admin'

export const platformAdminApi = {
  session: () =>
    apiClient
      .get(`${BASE}/session`)
      .then(unwrap<{ operator: PlatformOperator }>),
  overview: () => apiClient.get(`${BASE}/overview`).then(unwrap<Overview>),
  companies: (query: ListQuery) =>
    apiClient
      .get(`${BASE}/companies`, { params: clean(query) })
      .then(unwrap<Paged<CompanyRow>>),
  company: (orgId: string) =>
    apiClient
      .get(`${BASE}/companies/${encodeURIComponent(orgId)}`)
      .then(unwrap<CompanyDetail>),
  users: (query: ListQuery) =>
    apiClient
      .get(`${BASE}/users`, { params: clean(query) })
      .then(unwrap<Paged<UserRow>>),
  projects: (query: ListQuery) =>
    apiClient
      .get(`${BASE}/projects`, { params: clean(query) })
      .then(unwrap<Paged<ProjectRow>>),
  subscriptions: (query: ListQuery) =>
    apiClient.get(`${BASE}/subscriptions`, { params: clean(query) }).then(
      unwrap<
        Paged<SubscriptionRow> & {
          summary: {
            total: number
            trialsEndingIn7Days: number
            pastDue: number
            cancelAtPeriodEnd: number
            unrecognizedPlan: number
          }
        }
      >
    ),
  analytics: (windowDays: number) =>
    apiClient
      .get(`${BASE}/analytics`, { params: { windowDays } })
      .then(unwrap<Analytics>),
  health: () => apiClient.get(`${BASE}/health`).then(unwrap<SystemHealth>),
  errors: () => apiClient.get(`${BASE}/errors`).then(unwrap<ErrorAnalytics>),
  audit: (query: ListQuery) =>
    apiClient
      .get(`${BASE}/audit`, { params: clean(query) })
      .then(unwrap<Paged<AuditRow>>),
}
