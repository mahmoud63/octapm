import { useState } from 'react'
import { Building2, User } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WorkspaceKindBadge } from '@/features/home/workspace-badge'
import { membershipStanding } from '@/features/home/workspace-standing'
import { CompanySection } from './components/company-section'
import { useConvertWorkspace } from './hooks/use-workspace'

/**
 * What a conversion does and does not do — the ownership doc's "Lifecycle
 * consequences", in one sentence the owner reads before confirming.
 */
export const CONVERSION_CONSEQUENCES =
  'Nothing moves, is copied or re-keyed: every project, record and figure stays in this workspace, only its kind and plan change. You stay the owner, the web address stays the same, and you can then invite people.'

/**
 * Workspace settings (ENT-6): the workspace's name, kind and handle, the
 * person's standing in it, and — for the owner of a personal workspace —
 * "Convert to a company workspace". A personal workspace seats one member,
 * so this is the door to working with a team.
 */
export function WorkspaceSettings() {
  const workspace = useAuthStore((state) => state.auth.workspace)
  const convert = useConvertWorkspace()
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState('')

  if (!workspace) return null
  const personal = workspace.kind === 'personal'
  const trimmed = name.trim()

  const runConversion = async () => {
    try {
      const result = await convert.mutateAsync({
        orgId: workspace.orgId,
        ...(trimmed.length >= 2 ? { name: trimmed } : {}),
      })
      setConfirming(false)
      toast.success(`${result.organisation.name} is now a company workspace`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <CompanySection
      title='Workspace'
      description='The workspace this session is in, and what kind of workspace it is.'
    >
      <div className='max-w-2xl space-y-4' data-testid='workspace-settings'>
        <Card>
          <CardHeader>
            <div className='flex items-center gap-2'>
              {personal ? (
                <User className='size-4 text-muted-foreground' />
              ) : (
                <Building2 className='size-4 text-muted-foreground' />
              )}
              <CardTitle data-testid='workspace-settings-name'>
                {workspace.name ?? workspace.segment}
              </CardTitle>
              <WorkspaceKindBadge kind={workspace.kind} />
            </div>
            <CardDescription>
              Web address <code>/o/{workspace.segment}</code> · your standing:{' '}
              {membershipStanding(workspace)}
            </CardDescription>
          </CardHeader>
          <CardContent className='text-sm text-muted-foreground'>
            {personal
              ? 'A personal workspace has one member — you — plus any guests you bring onto a project. Projects are not limited.'
              : 'A company workspace holds a team: its administrators invite people and assign them to projects.'}
          </CardContent>
        </Card>

        {personal && (
          <Card data-testid='workspace-convert-card'>
            <CardHeader>
              <CardTitle>Convert to a company workspace</CardTitle>
              <CardDescription>{CONVERSION_CONSEQUENCES}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {workspace.isOwner ? (
                <>
                  <div className='space-y-2'>
                    <Label htmlFor='workspace-convert-name'>
                      Company name (optional)
                    </Label>
                    <Input
                      id='workspace-convert-name'
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={workspace.name ?? 'Company name'}
                      maxLength={120}
                      data-testid='workspace-convert-name'
                    />
                    <p className='text-xs text-muted-foreground'>
                      Leave empty to keep the current name.
                    </p>
                  </div>
                  <Button
                    onClick={() => setConfirming(true)}
                    disabled={convert.isPending}
                    data-testid='workspace-convert'
                  >
                    <Building2 className='size-4' />
                    Convert to a company workspace
                  </Button>
                </>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  Only the workspace&apos;s owner can convert it.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent data-testid='workspace-convert-confirm'>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Convert {workspace.name ?? 'this workspace'} to a company
                workspace?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {CONVERSION_CONSEQUENCES} A company workspace cannot be turned
                back into a personal one.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={convert.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault()
                  void runConversion()
                }}
                disabled={convert.isPending}
                data-testid='workspace-convert-submit'
              >
                {convert.isPending ? 'Converting…' : 'Convert'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </CompanySection>
  )
}
