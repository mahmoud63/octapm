export type PlanId = 'trial' | 'individual' | 'business' | 'enterprise'
export type BillingCycle = 'monthly' | 'annual'
export type SubStatus =
  | 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

/** A plan's limits; null on a limit means unlimited. */
export interface SubscriptionLimits {
  projectLimit: number | null
  aiLimit: number | null
}

/**
 * A subscription as the server reads it. A stored plan outside the catalogue
 * is a configuration fault, never a tier: `recognized` is false, `planName`
 * and `limits` are null, `configurationError` says why, and `plan` is the
 * stored identifier when the server judged it safe to echo (null otherwise).
 */
export interface Subscription {
  id: string
  plan: string | null
  recognized: boolean
  planName: string | null
  billingCycle: BillingCycle | null
  status: SubStatus
  hasAccess: boolean
  seats: number
  /** Absent when the plan is not recognized; read `limits` instead. */
  projectLimit?: number | null
  /** Absent when the plan is not recognized; read `limits` instead. */
  aiLimit?: number | null
  limits: SubscriptionLimits | null
  configurationError: { code: 'SUBSCRIPTION_PLAN_UNKNOWN'; message: string } | null
  aiGenerationsUsed: number
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  paymentMethod: {
    brand: string | null; last4: string | null
    expMonth: number | null; expYear: number | null
  } | null
}

export interface PlanCard {
  id: PlanId
  name: string
  projectLimit: number | null
  aiLimit: number | null
  seats: number | null
  monthly: number | null
  annual: number | null
  isCurrent: boolean
  isEnterprise: boolean
}

export interface PlansResponse {
  currentPlan: PlanId | null
  plans: PlanCard[]
}

export interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  status: 'paid' | 'failed'
}
