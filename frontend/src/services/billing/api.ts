import { apiClient } from '@/services/api/client'
import type {
  Subscription, PlansResponse, Transaction, BillingCycle,
} from './types'

const unwrap = <T>(r: { data: { data: T } }): T => r.data.data

export const getSubscription = () =>
  apiClient.get('/billing/subscription').then(unwrap<Subscription>)

export const getPlans = () =>
  apiClient.get('/billing/plans').then(unwrap<PlansResponse>)

export const getTransactions = () =>
  apiClient.get('/billing/transactions').then(unwrap<Transaction[]>)

export const startTrial = () =>
  apiClient.post('/billing/trial/start').then(unwrap<{ clientSecret: string }>)

export const confirmTrial = (paymentMethodId: string) =>
  apiClient
    .post('/billing/trial/confirm', { paymentMethodId })
    .then(unwrap<Subscription>)

export const subscribe = (plan: 'individual' | 'business', billingCycle: BillingCycle) =>
  apiClient.post('/billing/subscribe', { plan, billingCycle }).then(unwrap<Subscription>)

export const cancelSubscription = () =>
  apiClient.post('/billing/cancel').then(unwrap<Subscription>)

export const createEnterpriseLead = (seatsBand: 'lte_100' | 'gt_100') =>
  apiClient.post('/billing/enterprise-lead', { seatsBand }).then(unwrap)
