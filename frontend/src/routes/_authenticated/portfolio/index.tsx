import { createFileRoute } from '@tanstack/react-router'
import { PortfolioPage } from '@/features/reports/portfolio-page'

/** Portfolio (OCTA-RPT-BUILDER-023): `/portfolio`. */
export const Route = createFileRoute('/_authenticated/portfolio/')({
  component: PortfolioPage,
})
