import { useState } from 'react'
import { Archive, Pencil, Plus, Star } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { usePermissionTemplates } from '@/features/permissions/hooks/use-permissions'
import { useCompanies } from '@/features/projects/hooks/use-projects'
import { CompanySection } from './components/company-section'
import {
  useArchiveProjectTemplate,
  useCreateProjectTemplate,
  useProjectTemplates,
  useUpdateProjectTemplate,
  type ProjectTemplate,
  type ProjectTemplatePayload,
  type TemplateLocation,
  type TemplateParty,
} from './hooks/use-company'

const NONE = '__none__'
const PARTY_ROLES: TemplateParty['role'][] = [
  'owner',
  'consultant',
  'contractor',
  'subcontractor',
]

type Draft = {
  name: string
  description: string
  type: string
  contractType: string
  currency: string
  projectCalendar: string
  defaultRetentionRate: string
  weatherAllowanceDays: string
  folders: string
  locations: string
  parties: TemplateParty[]
  isDefault: boolean
}

const emptyDraft: Draft = {
  name: '',
  description: '',
  type: '',
  contractType: '',
  currency: 'USD',
  projectCalendar: 'five_day',
  defaultRetentionRate: '5',
  weatherAllowanceDays: '20',
  folders: 'Contract\nDrawings/IFC\nSubmittals\nPhotos',
  locations: '',
  parties: [],
  isDefault: false,
}

/**
 * Locations are typed as an indented outline: two spaces per level, optional
 * "(kind)" suffix, e.g. "Block A (building)" / "  Level 1 (level)".
 */
const parseLocations = (text: string): TemplateLocation[] => {
  const root: TemplateLocation[] = []
  const stack: Array<{ depth: number; node: TemplateLocation }> = []
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    const depth = Math.floor((rawLine.length - rawLine.trimStart().length) / 2)
    const match = /^(.*?)(?:\s*\((\w+)\))?$/.exec(rawLine.trim())
    const node: TemplateLocation = {
      name: (match?.[1] ?? rawLine).trim(),
      kind:
        match?.[2]?.toLowerCase() ||
        (depth === 0
          ? 'site'
          : depth === 1
            ? 'building'
            : depth === 2
              ? 'level'
              : 'area'),
      children: [],
    }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else root.push(node)
    stack.push({ depth, node })
  }
  return root
}

const stringifyLocations = (nodes: TemplateLocation[], depth = 0): string =>
  nodes
    .map(
      (node) =>
        `${'  '.repeat(depth)}${node.name} (${node.kind})` +
        (node.children?.length
          ? `\n${stringifyLocations(node.children, depth + 1)}`
          : '')
    )
    .join('\n')

const draftFrom = (template?: ProjectTemplate | null): Draft =>
  template
    ? {
        name: template.name,
        description: template.description ?? '',
        type: String(template.settings.type ?? ''),
        contractType: String(template.settings.contractType ?? ''),
        currency: String(template.settings.currency ?? 'USD'),
        projectCalendar: String(
          template.settings.projectCalendar ?? 'five_day'
        ),
        defaultRetentionRate: String(
          template.settings.defaultRetentionRate ?? '5'
        ),
        weatherAllowanceDays: String(
          template.settings.weatherAllowanceDays ?? '20'
        ),
        folders: template.folders.join('\n'),
        locations: stringifyLocations(template.locations),
        parties: template.parties,
        isDefault: template.isDefault,
      }
    : emptyDraft

const toPayload = (draft: Draft): ProjectTemplatePayload => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  settings: {
    type: draft.type.trim() || null,
    contractType: draft.contractType || null,
    currency: draft.currency.trim().toUpperCase() || 'USD',
    projectCalendar: draft.projectCalendar || null,
    defaultRetentionRate: draft.defaultRetentionRate
      ? Number(draft.defaultRetentionRate)
      : null,
    weatherAllowanceDays: draft.weatherAllowanceDays
      ? Number(draft.weatherAllowanceDays)
      : null,
  },
  folders: draft.folders
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
  locations: parseLocations(draft.locations),
  parties: draft.parties,
  isDefault: draft.isDefault,
})

function TemplateDialog({
  template,
  open,
  onOpenChange,
}: {
  template: ProjectTemplate | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateProjectTemplate()
  const update = useUpdateProjectTemplate()
  const { data: companies } = useCompanies({ status: 'active' })
  const { data: permissionTemplates } = usePermissionTemplates({
    kind: 'external',
  })
  const [draft, setDraft] = useState<Draft>(() => draftFrom(template))
  const [seededFor, setSeededFor] = useState<string | null>(
    template?.id ?? null
  )
  if ((template?.id ?? null) !== seededFor) {
    setSeededFor(template?.id ?? null)
    setDraft(draftFrom(template))
  }
  const isPending = create.isPending || update.isPending
  const set = (patch: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, ...patch }))
  const setParty = (index: number, patch: Partial<TemplateParty>) =>
    setDraft((prev) => ({
      ...prev,
      parties: prev.parties.map((party, i) =>
        i === index ? { ...party, ...patch } : party
      ),
    }))

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error('Template name is required.')
      return
    }
    try {
      if (template) {
        await update.mutateAsync({
          templateId: template.id,
          payload: toPayload(draft),
        })
        toast.success('Template updated.')
      } else {
        await create.mutateAsync(toPayload(draft))
        toast.success('Template created.')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {template ? `Edit ${template.name}` : 'New project template'}
          </DialogTitle>
          <DialogDescription>
            Defaults, parties, folders and locations applied when a project
            starts from this template.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='tpl-name'>Name</Label>
            <Input
              id='tpl-name'
              data-testid='uat-template-name'
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='tpl-description'>Description</Label>
            <Textarea
              id='tpl-description'
              rows={2}
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='tpl-type'>Project type</Label>
            <Input
              id='tpl-type'
              placeholder='Residential tower'
              value={draft.type}
              onChange={(e) => set({ type: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label>Contract type</Label>
            <Select
              value={draft.contractType || NONE}
              onValueChange={(value) =>
                set({ contractType: value === NONE ? '' : value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {[
                  'lump_sum',
                  'unit_rate',
                  'remeasurement',
                  'cost_plus',
                  'design_build',
                  'epc',
                  'other',
                ].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='tpl-currency'>Currency</Label>
            <Input
              id='tpl-currency'
              maxLength={3}
              value={draft.currency}
              onChange={(e) => set({ currency: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label>Calendar</Label>
            <Select
              value={draft.projectCalendar}
              onValueChange={(value) => set({ projectCalendar: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['five_day', 'six_day', 'seven_day', 'custom'].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='tpl-retention'>Retention (%)</Label>
            <Input
              id='tpl-retention'
              type='number'
              min={0}
              max={100}
              value={draft.defaultRetentionRate}
              onChange={(e) => set({ defaultRetentionRate: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='tpl-weather'>Weather allowance (days)</Label>
            <Input
              id='tpl-weather'
              type='number'
              min={0}
              value={draft.weatherAllowanceDays}
              onChange={(e) => set({ weatherAllowanceDays: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='tpl-folders'>Document folders (one per line)</Label>
            <Textarea
              id='tpl-folders'
              rows={5}
              className='font-mono text-xs'
              value={draft.folders}
              onChange={(e) => set({ folders: e.target.value })}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='tpl-locations'>
              Locations (indent 2 spaces per level)
            </Label>
            <Textarea
              id='tpl-locations'
              rows={5}
              className='font-mono text-xs'
              placeholder={
                'Site (site)\n  Block A (building)\n    Level 1 (level)'
              }
              value={draft.locations}
              onChange={(e) => set({ locations: e.target.value })}
            />
          </div>

          <div className='space-y-2 sm:col-span-2'>
            <div className='flex items-center justify-between'>
              <Label>Parties</Label>
              <Button
                size='sm'
                variant='outline'
                onClick={() =>
                  set({
                    parties: [
                      ...draft.parties,
                      {
                        role: 'consultant',
                        companyId: null,
                        companyName: '',
                        accessLevel: 'collaborator',
                        permissionTemplateId: null,
                      },
                    ],
                  })
                }
              >
                <Plus className='size-3.5' /> Add party
              </Button>
            </div>
            {draft.parties.length === 0 && (
              <p className='text-xs text-muted-foreground'>
                No parties; the project starts with the creator only.
              </p>
            )}
            {draft.parties.map((party, index) => (
              <div
                key={index}
                className='grid gap-2 rounded-md border p-2 sm:grid-cols-4'
              >
                <Select
                  value={party.role}
                  onValueChange={(value) =>
                    setParty(index, { role: value as TemplateParty['role'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARTY_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={party.companyId || NONE}
                  onValueChange={(value) =>
                    setParty(index, {
                      companyId: value === NONE ? null : value,
                      companyName:
                        value === NONE
                          ? party.companyName
                          : (companies?.items.find((c) => c.id === value)
                              ?.name ?? null),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Company' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Decide per project</SelectItem>
                    {companies?.items.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={party.permissionTemplateId || NONE}
                  onValueChange={(value) =>
                    setParty(index, {
                      permissionTemplateId: value === NONE ? null : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Permissions' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Party defaults</SelectItem>
                    {permissionTemplates?.items.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className='flex items-center gap-1'>
                  {!party.companyId && (
                    <Input
                      placeholder='Company name'
                      value={party.companyName ?? ''}
                      onChange={(e) =>
                        setParty(index, { companyName: e.target.value })
                      }
                    />
                  )}
                  <Button
                    size='icon'
                    variant='ghost'
                    aria-label='Remove party'
                    onClick={() =>
                      set({
                        parties: draft.parties.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Archive className='size-4' />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className='flex items-center justify-between rounded-md border p-3 sm:col-span-2'>
            <div>
              <Label>Default template</Label>
              <p className='text-xs text-muted-foreground'>
                Pre-selected in the new project dialog.
              </p>
            </div>
            <Switch
              checked={draft.isDefault}
              onCheckedChange={(checked) => set({ isDefault: checked })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isPending}
            data-testid='uat-template-save'
          >
            {isPending
              ? 'Saving…'
              : template
                ? 'Save changes'
                : 'Create template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CompanyProjectTemplates() {
  const { data, isLoading } = useProjectTemplates()
  const archive = useArchiveProjectTemplate()
  const [editing, setEditing] = useState<ProjectTemplate | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const items = data?.items ?? []

  return (
    <CompanySection
      title='Project templates'
      description='Start every project with the right parties, permissions, folders and locations already in place.'
      actions={
        <Button
          size='sm'
          data-testid='uat-template-new'
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className='size-4' /> New template
        </Button>
      }
    >
      <div className='space-y-2' data-testid='uat-company-templates'>
        {isLoading ? (
          <Skeleton className='h-24 w-full' />
        ) : items.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            No templates yet. Create one and it appears in the New Project
            dialog.
          </p>
        ) : (
          items.map((template) => (
            <div
              key={template.id}
              className='flex flex-wrap items-start justify-between gap-3 rounded-md border p-3'
            >
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>{template.name}</span>
                  {template.isDefault && (
                    <Badge className='gap-1'>
                      <Star className='size-3' /> Default
                    </Badge>
                  )}
                  <Badge variant='outline'>
                    {template.usage.projects} projects
                  </Badge>
                </div>
                {template.description && (
                  <p className='text-sm text-muted-foreground'>
                    {template.description}
                  </p>
                )}
                <p className='text-xs text-muted-foreground'>
                  {template.summary.parties} parties ·{' '}
                  {template.summary.folders} folders ·{' '}
                  {template.summary.locations} locations ·{' '}
                  {template.summary.assignments} team defaults
                </p>
              </div>
              <div className='flex gap-1'>
                <Button
                  size='sm'
                  variant='ghost'
                  aria-label='Edit template'
                  onClick={() => {
                    setEditing(template)
                    setDialogOpen(true)
                  }}
                >
                  <Pencil className='size-4' />
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  aria-label='Archive template'
                  onClick={async () => {
                    try {
                      await archive.mutateAsync(template.id)
                      toast.success('Template archived.')
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                >
                  <Archive className='size-4' />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <TemplateDialog
        template={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </CompanySection>
  )
}
