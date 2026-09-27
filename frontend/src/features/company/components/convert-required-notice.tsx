import { Link } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { Building2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * The server's refusal of a second member in a personal workspace (ENT-6).
 * A personal workspace seats its owner and guests; a direct add, a workspace
 * or project invitation, or a company-directory invitation is answered 409
 * with this code, which names the way out: convert the workspace first.
 */
export const PERSONAL_WORKSPACE_CONVERT_REQUIRED =
  'PERSONAL_WORKSPACE_CONVERT_REQUIRED'

export function isConvertRequiredError(error: unknown): boolean {
  if (!(error instanceof AxiosError)) return false
  const data = error.response?.data as
    | { error?: { code?: string } }
    | undefined
  return data?.error?.code === PERSONAL_WORKSPACE_CONVERT_REQUIRED
}

/**
 * The conversion prompt an invitation attempt in a personal workspace lands
 * on (switching doc §6: Invite people on a personal workspace opens the
 * conversion prompt). The owner is taken to the workspace settings, where
 * the conversion is explained and confirmed; anybody else is told whom to
 * ask. Presentation only: the server decides, this only shows the way.
 */
export function ConvertRequiredNotice({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  const workspace = useAuthStore((state) => state.auth.workspace)
  if (!workspace) return null
  return (
    <Alert data-testid='convert-required-prompt'>
      <Building2 className='size-4' />
      <AlertTitle>Convert to a company workspace to add people</AlertTitle>
      <AlertDescription className='space-y-3'>
        <p>
          A personal workspace has one member — its owner — plus guests
          invited onto a project as an external party.{' '}
          {workspace.isOwner
            ? 'Convert it to a company workspace to invite your team: nothing moves, and you stay the owner.'
            : 'Ask its owner to convert it to a company workspace.'}
        </p>
        {workspace.isOwner && (
          <Button asChild size='sm'>
            <Link
              to='/o/$orgSlug/company/workspace'
              params={{ orgSlug: workspace.segment }}
              onClick={onNavigate}
              data-testid='convert-required-open'
            >
              Convert to a company workspace
            </Link>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
