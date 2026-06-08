import { createFileRoute } from '@tanstack/react-router'
import { OctaPMLanding } from '@/features/landing'

export const Route = createFileRoute('/landing')({
  component: OctaPMLanding,
})
