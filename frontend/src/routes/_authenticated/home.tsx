import { createFileRoute } from '@tanstack/react-router'
import { Home } from '@/features/home'

/** L1 Home (workspace switching doc §7): the identity's workspaces and what needs them. */
export const Route = createFileRoute('/_authenticated/home')({
  component: Home,
})
