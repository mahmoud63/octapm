import { createFileRoute } from '@tanstack/react-router'

/**
 * Legacy path, kept so typed links to it still compile. Its parent route
 * redirects every visit to the same page under the active workspace,
 * `/o/{workspace}/company/templates` (ENT-4), before this route loads.
 */
export const Route = createFileRoute('/_authenticated/company/templates')({})
