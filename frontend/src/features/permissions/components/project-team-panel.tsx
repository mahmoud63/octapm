import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ShieldCheck, Users } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useIsCompanyAdmin, useProjectEffectiveRole } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CustomFieldsAdmin } from '@/features/custom-fields/components/custom-fields-admin'
import {
  usePermissionTemplates,
  useProjectTeam,
  useSetPartyTemplate,
  useSetTeamMemberTemplate,
  type PermissionTemplate,
  type ProjectTeamMember,
} from '../hooks/use-permissions'

const NONE = '__none__'

const sourceLabels: Record<ProjectTeamMember['source'], string> = {
  template: 'Template',
  party_template: 'Party template',
  assignment: 'Project role',
  party: 'Party profile',
  org: 'Org role',
}

const humanize = (value: string | null | undefined) =>
  value ? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—'

function TemplatePicker({
  value,
  templates,
  disabled,
  placeholder,
  onChange,
  testId,
}: {
  value: string | null
  templates: PermissionTemplate[]
  disabled?: boolean
  placeholder: string
  onChange: (templateId: string | null) => void
  testId: string
}) {
  return (
    <Select
      value={value ?? NONE}
      disabled={disabled}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
    >
      <SelectTrigger data-testid={testId} className='h-8 w-56'>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {templates.map((template) => (
          <SelectItem key={template.id} value={template.id}>
            {template.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ProjectTeamPanel({ projectId }: { projectId: string }) {
  const isAdmin = useIsCompanyAdmin()
  const effectiveRole = useProjectEffectiveRole()
  const canManage = isAdmin || effectiveRole === 'pm'
  const { data, isLoading, error } = useProjectTeam(projectId)
  const { data: templateData } = usePermissionTemplates(
    {},
    { enabled: canManage }
  )
  const setMemberTemplate = useSetTeamMemberTemplate(projectId)
  const setPartyTemplate = useSetPartyTemplate(projectId)

  const templates = React.useMemo(
    () => templateData?.items ?? [],
    [templateData]
  )
  const internalTemplates = templates.filter((t) => t.kind === 'internal')
  const externalTemplates = templates.filter((t) => t.kind === 'external')

  const items = data?.items ?? []
  const parties = data?.parties ?? []

  const changeMember = async (
    member: ProjectTeamMember,
    templateId: string | null
  ) => {
    try {
      await setMemberTemplate.mutateAsync({ userId: member.userId, templateId })
      toast.success(
        templateId
          ? `${member.name} now uses the selected template.`
          : `${member.name} falls back to their role permissions.`
      )
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    }
  }

  const changeParty = async (partyId: string, templateId: string | null) => {
    try {
      await setPartyTemplate.mutateAsync({ partyId, templateId })
      toast.success(
        templateId ? 'Party template updated.' : 'Party template cleared.'
      )
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    }
  }

  return (
    <div className='space-y-6' data-testid='uat-project-team'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <h3 className='flex items-center gap-2 text-base font-semibold'>
            <Users className='size-4' /> Project team
          </h3>
          <p className='text-sm text-muted-foreground'>
            Everyone with access to this project and the permissions that govern
            them.{' '}
            {canManage ? (
              <>
                Manage templates under{' '}
                <Link
                  to='/settings/permissions'
                  className='text-primary underline-offset-2 hover:underline'
                >
                  Settings › Permissions
                </Link>
                .
              </>
            ) : (
              'Ask a project manager or company admin to change assignments.'
            )}
          </p>
        </div>
      </div>

      {error ? (
        <p className='text-sm text-destructive'>
          {getServerErrorMessage(error)}
        </p>
      ) : isLoading ? (
        <div className='space-y-2'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-10 w-full' />
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role on project</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='text-center text-muted-foreground'
                  >
                    No one is assigned to this project yet.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((member) => (
                  <TableRow
                    key={member.userId}
                    data-testid={`uat-team-member-${member.userId}`}
                  >
                    <TableCell>
                      <div className='font-medium'>{member.name}</div>
                      <div className='text-xs text-muted-foreground'>
                        {member.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap items-center gap-1'>
                        <span>
                          {humanize(
                            member.assignmentRole ??
                              member.party?.role ??
                              member.orgRole
                          )}
                        </span>
                        {member.isCompanyAdmin && (
                          <Badge variant='outline' className='gap-1'>
                            <ShieldCheck className='size-3' /> Company admin
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {member.party?.companyName ?? 'Own company'}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <TemplatePicker
                          testId={`uat-team-template-${member.userId}`}
                          value={member.template?.id ?? null}
                          templates={
                            member.party ? templates : internalTemplates
                          }
                          placeholder={
                            member.party?.template
                              ? `Party: ${member.party.template.name}`
                              : 'Role defaults'
                          }
                          disabled={setMemberTemplate.isPending}
                          onChange={(templateId) =>
                            changeMember(member, templateId)
                          }
                        />
                      ) : (
                        <span>
                          {member.template?.name ??
                            member.party?.template?.name ??
                            'Role defaults'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant='secondary'>
                        {sourceLabels[member.source]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {parties.length > 0 && (
        <div className='space-y-2'>
          <h4 className='text-sm font-semibold'>External parties</h4>
          <p className='text-xs text-muted-foreground'>
            A party template applies to every member of that company unless a
            member has their own template.
          </p>
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Party</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Template</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parties.map((party) => (
                  <TableRow key={party.id}>
                    <TableCell>{humanize(party.role)}</TableCell>
                    <TableCell>{party.companyName ?? '—'}</TableCell>
                    <TableCell>{party.memberCount}</TableCell>
                    <TableCell>
                      {canManage ? (
                        <TemplatePicker
                          testId={`uat-party-template-${party.id}`}
                          value={party.template?.id ?? null}
                          templates={externalTemplates}
                          placeholder='Party profile defaults'
                          disabled={setPartyTemplate.isPending}
                          onChange={(templateId) =>
                            changeParty(party.id, templateId)
                          }
                        />
                      ) : (
                        <span>
                          {party.template?.name ?? 'Party profile defaults'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {canManage && (
        <div className='space-y-2 rounded-md border p-4'>
          <div>
            <h3 className='text-base font-semibold'>Custom fields</h3>
            <p className='text-sm text-muted-foreground'>
              Fields only this project needs, and which company fieldset each
              record type uses here.
            </p>
          </div>
          <CustomFieldsAdmin projectId={projectId} />
        </div>
      )}
    </div>
  )
}
