import { z } from 'zod'

const userStatusSchema = z.union([z.literal('active'), z.literal('inactive')])
export type UserStatus = z.infer<typeof userStatusSchema>

const userRoleSchema = z.union([
  z.literal('pm'),
  z.literal('planning_eng'),
  z.literal('qs'),
  z.literal('cost_controller'),
  z.literal('procurement'),
  z.literal('warehouse'),
  z.literal('site_engineer'),
  z.literal('finance'),
])

export const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable().optional(),
  status: userStatusSchema,
  role: userRoleSchema,
  projectCount: z.number().default(0),
  lastLogin: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
})
export type User = z.infer<typeof userSchema>
