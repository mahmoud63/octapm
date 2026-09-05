import { useState } from 'react'
import {
  Archive,
  Copy,
  Flag,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  FORM_TYPES,
  FORM_TYPE_LABEL,
  useFormTemplate,
  useFormTemplates,
  useTemplateMutations,
  type FormTemplate,
  type FormType,
} from '../hooks/use-forms'
import { FormTypeBadge } from './form-badges'
import { TemplateEditorDialog } from './template-editor'

const ANY = '__any'

/**
 * Templates for a project (its own plus the company library) or for the
 * company. Editing loads the full template first so section/item ids are
 * preserved.
 */
export function TemplateList({
  projectId,
  canEdit,
  onSchedule,
}: {
  /** null = company library. */
  projectId: string | null
  canEdit: boolean
  onSchedule?: (template: FormTemplate) => void
}) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState<FormType | ''>('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [editor, setEditor] = useState<{
    open: boolean
    seed: number
    templateId: string | null
    template: FormTemplate | null
  }>({ open: false, seed: 0, templateId: null, template: null })
  const { data, isLoading } = useFormTemplates(projectId, {
    scope: projectId ? 'all' : 'company',
    type,
    includeArchived,
    search,
  })
  const { data: loaded, isFetching: loadingTemplate } = useFormTemplate(
    editor.templateId && editor.template?.editable === false && projectId
      ? null
      : projectId,
    editor.templateId
  )
  const { duplicate, archive, seedStarters } = useTemplateMutations(projectId)
  const items = data?.items ?? []

  const openNew = () =>
    setEditor((current) => ({
      open: true,
      seed: current.seed + 1,
      templateId: null,
      template: null,
    }))
  const openEdit = (template: FormTemplate) =>
    setEditor((current) => ({
      open: true,
      seed: current.seed + 1,
      templateId: template.id,
      template,
    }))

  const copy = async (template: FormTemplate) => {
    try {
      const created = await duplicate.mutateAsync({ templateId: template.id })
      toast.success(
        projectId
          ? `${created.name} copied into this project`
          : `${created.name} created`
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const archiveTemplate = async (template: FormTemplate) => {
    try {
      await archive.mutateAsync(template.id)
      toast.success(`${template.name} archived`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const editorReady =
    !editor.templateId || (loaded && loaded.id === editor.templateId)

  return (
    <div className='space-y-3' data-testid='uat-template-list'>
      <div className='flex flex-wrap items-end gap-2'>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder='Template name'
          className='max-w-xs'
          data-testid='uat-template-search'
        />
        <Select
          value={type || ANY}
          onValueChange={(value) =>
            setType(value === ANY ? '' : (value as FormType))
          }
        >
          <SelectTrigger className='w-[160px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All types</SelectItem>
            {FORM_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {FORM_TYPE_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className='flex h-9 items-center gap-2 text-sm'>
          <Switch
            checked={includeArchived}
            onCheckedChange={setIncludeArchived}
          />
          Show archived
        </label>
        <div className='ml-auto flex gap-2'>
          {canEdit && !projectId && (
            <Button
              size='sm'
              variant='outline'
              disabled={seedStarters.isPending}
              onClick={() =>
                seedStarters.mutate(undefined, {
                  onSuccess: (result) =>
                    toast.success(
                      result.created
                        ? `${result.created} starter template${result.created === 1 ? '' : 's'} added`
                        : 'Starter templates are already in the library'
                    ),
                  onError: (error) => toast.error(getServerErrorMessage(error)),
                })
              }
              data-testid='uat-template-starters'
            >
              <Sparkles className='mr-2 h-4 w-4' /> Add starters
            </Button>
          )}
          {canEdit && (
            <Button size='sm' onClick={openNew} data-testid='uat-template-new'>
              <Plus className='mr-2 h-4 w-4' /> New template
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading templates…
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No templates yet.{' '}
          {canEdit
            ? projectId
              ? 'Create one here or copy one from the company library.'
              : 'Create one, or add the starter set.'
            : ''}
        </div>
      ) : (
        <ul className='grid gap-2 md:grid-cols-2'>
          {items.map((template) => (
            <li
              key={template.id}
              className='flex flex-col gap-2 rounded-md border bg-background p-3'
              data-testid='uat-template-card'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <FormTypeBadge type={template.type} />
                <span className='min-w-0 flex-1 truncate font-medium'>
                  {template.name}
                </span>
                {template.scope === 'company' && projectId && (
                  <Badge variant='secondary'>Company</Badge>
                )}
                {template.status !== 'active' && (
                  <Badge variant='outline' className='text-muted-foreground'>
                    {template.status}
                  </Badge>
                )}
                {template.isSystem && <Badge variant='outline'>Migrated</Badge>}
              </div>
              <p className='text-xs text-muted-foreground'>
                {template.itemCount} item{template.itemCount === 1 ? '' : 's'}{' '}
                in {template.sectionCount} section
                {template.sectionCount === 1 ? '' : 's'}
                {template.holdPointCount ? (
                  <span className='ml-1 inline-flex items-center gap-1'>
                    · <Flag className='h-3 w-3 text-destructive' />
                    {template.holdPointCount} hold point
                    {template.holdPointCount === 1 ? '' : 's'}
                  </span>
                ) : null}
                {template.trade ? ` · ${template.trade}` : ''} · v
                {template.version}
                {template.instanceCount
                  ? ` · used ${template.instanceCount} time${template.instanceCount === 1 ? '' : 's'}`
                  : ''}
              </p>
              {template.description && (
                <p className='line-clamp-2 text-sm'>{template.description}</p>
              )}
              <div className='mt-auto flex flex-wrap gap-1.5'>
                {onSchedule && template.status === 'active' && (
                  <Button
                    size='sm'
                    onClick={() => onSchedule(template)}
                    data-testid='uat-template-schedule'
                  >
                    Schedule
                  </Button>
                )}
                {canEdit && template.editable && (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => openEdit(template)}
                  >
                    <Pencil className='mr-1.5 h-3.5 w-3.5' /> Edit
                  </Button>
                )}
                {canEdit && (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={duplicate.isPending}
                    onClick={() => copy(template)}
                    data-testid='uat-template-copy'
                  >
                    <Copy className='mr-1.5 h-3.5 w-3.5' />
                    {projectId && template.scope === 'company'
                      ? 'Copy to project'
                      : 'Duplicate'}
                  </Button>
                )}
                {canEdit &&
                  template.editable &&
                  template.status !== 'archived' && (
                    <Button
                      size='sm'
                      variant='ghost'
                      className='text-muted-foreground'
                      disabled={archive.isPending}
                      onClick={() => archiveTemplate(template)}
                    >
                      <Archive className='mr-1.5 h-3.5 w-3.5' /> Archive
                    </Button>
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor.open && editorReady && (
        <TemplateEditorDialog
          key={`editor-${editor.seed}`}
          projectId={projectId}
          template={editor.templateId ? (loaded ?? null) : null}
          open={editor.open}
          onOpenChange={(open) =>
            setEditor((current) => ({ ...current, open }))
          }
        />
      )}
      {editor.open && !editorReady && loadingTemplate && (
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' /> Opening template…
        </div>
      )}
    </div>
  )
}
