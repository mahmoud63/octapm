import type { WorkspaceMembership } from '@/services/auth/types'
import { roleLabel } from '@/lib/permissions'

/** The person's standing in a workspace: role, plus owner / admin when they hold it. */
export const membershipStanding = (membership: WorkspaceMembership) => {
  const parts = [roleLabel(membership.role)]
  if (membership.isOwner) parts.push('Owner')
  else if (membership.isAdmin) parts.push('Admin')
  if (membership.status !== 'active') parts.push(membership.status)
  return parts.join(' · ')
}
