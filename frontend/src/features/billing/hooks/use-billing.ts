import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as billingApi from '@/services/billing/api'
import type { BillingCycle } from '@/services/billing/types'

export const useSubscription = () =>
  useQuery({ queryKey: ['billing', 'subscription'], queryFn: billingApi.getSubscription })

export const usePlans = () =>
  useQuery({ queryKey: ['billing', 'plans'], queryFn: billingApi.getPlans })

export const useTransactions = () =>
  useQuery({ queryKey: ['billing', 'transactions'], queryFn: billingApi.getTransactions })

const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['billing'] })

export const useStartTrial = () =>
  useMutation({ mutationFn: billingApi.startTrial })

export const useConfirmTrial = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: billingApi.confirmTrial,
    onSuccess: () => invalidate(qc),
  })
}

export const useSubscribe = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ plan, billingCycle, paymentMethodId }: {
      plan: 'individual' | 'business'; billingCycle: BillingCycle; paymentMethodId?: string
    }) => billingApi.subscribe(plan, billingCycle, paymentMethodId),
    onSuccess: () => invalidate(qc),
  })
}

export const useCancelSubscription = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: billingApi.cancelSubscription,
    onSuccess: () => invalidate(qc),
  })
}

export const useEnterpriseLead = () =>
  useMutation({ mutationFn: billingApi.createEnterpriseLead })
