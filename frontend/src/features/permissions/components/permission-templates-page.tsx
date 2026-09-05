import * as React from 'react'
import { Archive, Copy, Pencil, Plus, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import type {
  PermissionAction,
  PermissionLevel,
  PermissionModule,
} from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  useArchivePermissionTemplate,
  useCreatePermissionTemplate,
  useDuplicatePermissionTemplate,
  usePermissionCatalog,
  usePermissionTemplates,
  useUpdatePermissionTemplate,
  type ClientType,
  type PermissionCatalog,
  type PermissionTemplate,
  type PermissionTemplatePayload,
  type TemplateKind,
} from '../hooks/use-permissions'

const LEVEL_ORDER: PermissionLevel[] = [
  'none',
  'read_only',
  'standard',
  'admin',
]
const INHERIT = 'inherit'

const levelTone: Record<PermissionLevel, string> = {
  none: 'text-muted-foreground',
  read_only: 'text-sky-700 dark:text-sky-300',
  standard: 'text-foreground',
  admin: 'text-amber-700 dark:text-amber-300',
}

const clientTypeLabels: Record<ClientType, string> = {
  gc: 'General contractor',
  owner: 'Owner / client',
  consultant: 'Consultant',
  subcontractor: 'Subcontractor',
}

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; template: PermissionTemplate }
  | null

type DraftGrant = {
  module: PermissionModule
  action: PermissionAction | null
  transition: string | null
}

const grantKeyOf = (grant: DraftGrant) =>
  grant.transition
    ? `${grant.module}|transition:${grant.transition}`
    : `${grant.module}|action:${grant.action}`

type Draft = {
  name: string
  description: string
  kind: TemplateKind
  clientType: ClientType | ''
  baseRole: string
  basePartyRole: string
  tools: Partial<Record<PermissionModule, PermissionLevel>>
  grants: Set<string>
}

const draftFromTemplate = (template?: PermissionTemplate): Draft => ({
  name: template?.name ?? '',
  description: template?.description ?? '',
  kind: template?.kind ?? 'internal',
  clientType: template?.clientType ?? '',
  baseRole: template?.baseRole ?? 'site_engineer',
  basePartyRole: template?.basePartyRole ?? 'contractor',
  tools: Object.fromEntries(
    (template?.tools ?? []).map((tool) => [tool.module, tool.level])
  ) as Draft['tools'],
  grants: new Set((template?.grants ?? []).map((grant) => grantKeyOf(grant))),
})

const payloadFromDraft = (draft: Draft): PermissionTemplatePayload => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  kind: draft.kind,
  clientType: draft.clientType || null,
  baseRole: draft.kind === 'internal' ? draft.baseRole || null : null,
  basePartyRole: draft.kind === 'external' ? draft.basePartyRole || null : null,
  tools: (
    Object.entries(draft.tools) as Array<[PermissionModule, PermissionLevel]>
  )
    .filter(([, level]) => Boolean(level))
    .map(([module, level]) => ({ module, level })),
  grants: [...draft.grants].map((key) => {
    const [module, rest] = key.split('|') as [PermissionModule, string]
    const [kind, name] = rest.split(':') as ['action' | 'transition', string]
    return {
      module,
      action: kind === 'action' ? (name as PermissionAction) : null,
      transition: kind === 'transition' ? name : null,
    }
  }),
})

function TemplateEditorDialog({
  state,
  catalog,
  onClose,
}: {
  state: EditorState
  catalog: PermissionCatalog
  onClose: () => void
}) {
  const create = useCreatePermissionTemplate()
  const update = useUpdatePermissionTemplate()
  const isEdit = state?.mode === 'edit'
  const template = state?.mode === 'edit' ? state.template : undefined
  const [draft, setDraft] = React.useState<Draft>(() =>
    draftFromTemplate(template)
  )
  const [expanded, setExpanded] = React.useState<PermissionModule | null>(null)

  React.useEffect(() => {
    setDraft(draftFromTemplate(template))
    setExpanded(null)
  }, [template, state?.mode])

  const isPending = create.isPending || update.isPending
  const nameLocked = Boolean(template?.isSystem)

  const setLevel = (module: PermissionModule, level: string) => {
    setDraft((prev) => {
      const tools = { ...prev.tools }
      if (level === INHERIT) delete tools[module]
      else tools[module] = level as PermissionLevel
      return { ...prev, tools }
    })
  }

  const toggleGrant = (key: string, checked: boolean) => {
    setDraft((prev) => {
      const grants = new Set(prev.grants)
      if (checked) grants.add(key)
      else grants.delete(key)
      return { ...prev, grants }
    })
  }

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error('Give the template a name.')
      return
    }
    try {
      const payload = payloadFromDraft(draft)
      if (isEdit && template) {
        await update.mutateAsync({ templateId: template.id, payload })
        toast.success('Template updated.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Template created.')
      }
      onClose()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${template?.name}` : 'New permission template'}
          </DialogTitle>
          <DialogDescription>
            Set a level per module. Modules left on <em>Inherit</em> follow the
            base role. Grants add single actions on top of the level.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-2 sm:col-span-2'>
            <Label htmlFor='permission-template-name'>Name</Label>
            <Input
              id='permission-template-name'
              data-testid='uat-permission-template-name'
              value={draft.name}
              disabled={nameLocked}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder='e.g. Field lead – read-only cost'
            />
            {nameLocked && (
              <p className='text-xs text-muted-foreground'>
                System templates keep their name. Duplicate one to rename it.
              </p>
            )}
          </div>

          <div className='space-y-2 sm:col-span-2'>
            <Label htmlFor='permission-template-description'>Description</Label>
            <Textarea
              id='permission-template-description'
              value={draft.description}
              rows={2}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </div>

          <div className='space-y-2'>
            <Label>Applies to</Label>
            <Tabs
              value={draft.kind}
              onValueChange={(value) =>
                setDraft((prev) => ({ ...prev, kind: value as TemplateKind }))
              }
            >
              <TabsList className='grid w-full grid-cols-2'>
                <TabsTrigger
                  value='internal'
                  disabled={isEdit && template?.kind !== 'internal'}
                >
                  Own staff
                </TabsTrigger>
                <TabsTrigger
                  value='external'
                  disabled={isEdit && template?.kind !== 'external'}
                >
                  External party
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className='space-y-2'>
            <Label>Suited to</Label>
            <Select
              value={draft.clientType || 'any'}
              onValueChange={(value) =>
                setDraft((prev) => ({
                  ...prev,
                  clientType: value === 'any' ? '' : (value as ClientType),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='any'>Any company type</SelectItem>
                {catalog.clientTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {clientTypeLabels[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2 sm:col-span-2'>
            <Label>
              {draft.kind === 'internal' ? 'Base role' : 'Base party role'}
            </Label>
            <Select
              value={
                draft.kind === 'internal' ? draft.baseRole : draft.basePartyRole
              }
              onValueChange={(value) =>
                setDraft((prev) =>
                  prev.kind === 'internal'
                    ? { ...prev, baseRole: value }
                    : { ...prev, basePartyRole: value }
                )
              }
            >
              <SelectTrigger data-testid='uat-permission-template-base'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(draft.kind === 'internal'
                  ? catalog.roles
                  : catalog.partyRoles
                ).map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              The <strong>Standard</strong> level means whatever this base role
              can do today.
            </p>
          </div>
        </div>

        <div className='mt-2 overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase'>
              <tr>
                <th className='px-3 py-2 text-left font-medium'>Module</th>
                <th className='px-3 py-2 text-left font-medium'>Level</th>
                <th className='px-3 py-2 text-left font-medium'>Grants</th>
              </tr>
            </thead>
            <tbody>
              {catalog.modules.map((module) => {
                const level = draft.tools[module.id]
                const moduleGrants = [...draft.grants].filter((key) =>
                  key.startsWith(`${module.id}|`)
                )
                const isOpen = expanded === module.id
                return (
                  <React.Fragment key={module.id}>
                    <tr className='border-t'>
                      <td className='px-3 py-2 font-medium'>{module.label}</td>
                      <td className='px-3 py-2'>
                        <Select
                          value={level ?? INHERIT}
                          onValueChange={(value) => setLevel(module.id, value)}
                        >
                          <SelectTrigger
                            data-testid={`uat-permission-level-${module.id}`}
                            className={cn(
                              'h-8 w-40',
                              level && levelTone[level]
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={INHERIT}>Inherit</SelectItem>
                            {LEVEL_ORDER.map((id) => {
                              const meta = catalog.levels.find(
                                (item) => item.id === id
                              )
                              return (
                                <SelectItem key={id} value={id}>
                                  {meta?.label ?? id}
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className='px-3 py-2'>
                        <button
                          type='button'
                          className='text-xs text-primary underline-offset-2 hover:underline'
                          onClick={() => setExpanded(isOpen ? null : module.id)}
                        >
                          {moduleGrants.length
                            ? `${moduleGrants.length} extra`
                            : 'Add'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className='border-t bg-muted/20'>
                        <td colSpan={3} className='px-3 py-3'>
                          <div className='grid gap-3 sm:grid-cols-2'>
                            <div>
                              <p className='mb-1 text-xs font-semibold text-muted-foreground uppercase'>
                                Actions
                              </p>
                              <div className='flex flex-wrap gap-3'>
                                {module.actions.map((action) => {
                                  const key = `${module.id}|action:${action}`
                                  return (
                                    <label
                                      key={key}
                                      className='flex items-center gap-2 text-xs'
                                    >
                                      <Checkbox
                                        checked={draft.grants.has(key)}
                                        onCheckedChange={(checked) =>
                                          toggleGrant(key, checked === true)
                                        }
                                      />
                                      {action}
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                            <div>
                              <p className='mb-1 text-xs font-semibold text-muted-foreground uppercase'>
                                Transitions
                              </p>
                              {module.transitions.length ? (
                                <div className='flex flex-wrap gap-3'>
                                  {module.transitions.map((transition) => {
                                    const key = `${module.id}|transition:${transition}`
                                    return (
                                      <label
                                        key={key}
                                        className='flex items-center gap-2 text-xs'
                                      >
                                        <Checkbox
                                          checked={draft.grants.has(key)}
                                          onCheckedChange={(checked) =>
                                            toggleGrant(key, checked === true)
                                          }
                                        />
                                        {transition}
                                      </label>
                                    )
                                  })}
                                </div>
                              ) : (
                                <p className='text-xs text-muted-foreground'>
                                  No workflow transitions in this module.
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            data-testid='uat-permission-template-save'
            onClick={submit}
            disabled={isPending}
          >
            {isPending
              ? 'Saving…'
              : isEdit
                ? 'Save changes'
                : 'Create template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TemplateRow({
  template,
  onEdit,
  onDuplicate,
  onArchive,
}: {
  template: PermissionTemplate
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
}) {
  const overrides = template.tools.length
  const inUse = template.usage.projectUsers + template.usage.parties
  return (
    <div
      data-testid={`uat-permission-template-${template.id}`}
      className='flex flex-wrap items-start justify-between gap-3 rounded-md border p-3'
    >
      <div className='min-w-0 space-y-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium'>{template.name}</span>
          {template.isSystem && (
            <Badge variant='outline' className='gap-1'>
              <ShieldCheck className='size-3' /> System
            </Badge>
          )}
          <Badge variant='secondary'>
            {template.kind === 'internal' ? 'Own staff' : 'External'}
          </Badge>
          {template.clientType && (
            <Badge variant='outline'>
              {clientTypeLabels[template.clientType]}
            </Badge>
          )}
        </div>
        {template.description && (
          <p className='text-sm text-muted-foreground'>
            {template.description}
          </p>
        )}
        <p className='text-xs text-muted-foreground'>
          Base: {template.baseRole ?? template.basePartyRole ?? '—'} ·{' '}
          {overrides
            ? `${overrides} module override${overrides === 1 ? '' : 's'}`
            : 'inherits base role'}
          {template.grants.length
            ? ` · ${template.grants.length} grant${template.grants.length === 1 ? '' : 's'}`
            : ''}
          {' · '}
          {inUse
            ? `used by ${template.usage.projectUsers} user${template.usage.projectUsers === 1 ? '' : 's'}, ${template.usage.parties} part${template.usage.parties === 1 ? 'y' : 'ies'}`
            : 'not assigned yet'}
        </p>
      </div>
      <div className='flex shrink-0 gap-1'>
        <Button
          size='sm'
          variant='ghost'
          onClick={onEdit}
          aria-label='Edit template'
        >
          <Pencil className='size-4' />
        </Button>
        <Button
          size='sm'
          variant='ghost'
          onClick={onDuplicate}
          aria-label='Duplicate template'
        >
          <Copy className='size-4' />
        </Button>
        {!template.isSystem && (
          <Button
            size='sm'
            variant='ghost'
            onClick={onArchive}
            disabled={inUse > 0}
            aria-label='Archive template'
            title={
              inUse > 0 ? 'Reassign its users before archiving' : undefined
            }
          >
            <Archive className='size-4' />
          </Button>
        )}
      </div>
    </div>
  )
}

export function PermissionTemplatesPage() {
  const [kind, setKind] = React.useState<'all' | TemplateKind>('all')
  const { data: catalog, isLoading: catalogLoading } = usePermissionCatalog()
  const { data, isLoading, error } = usePermissionTemplates(
    kind === 'all' ? {} : { kind }
  )
  const duplicate = useDuplicatePermissionTemplate()
  const archive = useArchivePermissionTemplate()
  const [editor, setEditor] = React.useState<EditorState>(null)
  const [archiving, setArchiving] = React.useState<PermissionTemplate | null>(
    null
  )

  const items = data?.items ?? []

  return (
    <div className='space-y-4' data-testid='uat-permission-templates'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Tabs
          value={kind}
          onValueChange={(value) => setKind(value as typeof kind)}
        >
          <TabsList>
            <TabsTrigger value='all'>All</TabsTrigger>
            <TabsTrigger value='internal'>Own staff</TabsTrigger>
            <TabsTrigger value='external'>External</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          size='sm'
          data-testid='uat-permission-template-new'
          disabled={!catalog}
          onClick={() => setEditor({ mode: 'create' })}
        >
          <Plus className='size-4' /> New template
        </Button>
      </div>

      {error ? (
        <p className='text-sm text-destructive'>
          {getServerErrorMessage(error)}
        </p>
      ) : isLoading || catalogLoading ? (
        <div className='space-y-2'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      ) : items.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          No templates yet. Create one or duplicate a system default.
        </p>
      ) : (
        <div className='space-y-2'>
          {items.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              onEdit={() => setEditor({ mode: 'edit', template })}
              onDuplicate={async () => {
                try {
                  await duplicate.mutateAsync({ templateId: template.id })
                  toast.success(`Copied ${template.name}.`)
                } catch (err) {
                  toast.error(getServerErrorMessage(err))
                }
              }}
              onArchive={() => setArchiving(template)}
            />
          ))}
        </div>
      )}

      {catalog && (
        <TemplateEditorDialog
          state={editor}
          catalog={catalog}
          onClose={() => setEditor(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={`Archive ${archiving?.name ?? 'template'}?`}
        desc='Archived templates stop applying and disappear from pickers. You can only archive a template nobody is assigned to.'
        confirmText='Archive'
        destructive
        isLoading={archive.isPending}
        handleConfirm={async () => {
          if (!archiving) return
          try {
            await archive.mutateAsync(archiving.id)
            toast.success('Template archived.')
            setArchiving(null)
          } catch (err) {
            toast.error(getServerErrorMessage(err))
          }
        }}
      />
    </div>
  )
}
