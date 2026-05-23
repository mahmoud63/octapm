export type PlanId = 'trial' | 'individual' | 'business' | 'enterprise'
export type BillingCycle = 'monthly' | 'annual'
export type SubStatus =
  | 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

export interface Subscription {
  id: string
  plan: PlanId
  planName: string
  billingCycle: BillingCycle | null
  status: SubStatus
  hasAccess: boolean
  seats: number
  projectLimit: number | null
  aiLimit: number | null
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
