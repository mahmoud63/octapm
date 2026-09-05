import { useState } from 'react'
import { ArrowDown, ArrowUp, Flag, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  FORM_TYPES,
  FORM_TYPE_LABEL,
  RESPONSE_TYPES,
  RESPONSE_TYPE_LABEL,
  SIGNATURE_ROLES,
  useTemplateMutations,
  type FormTemplate,
  type FormTemplateInput,
  type FormType,
  type NumberOptions,
  type ResponseType,
  type SignatureRole,
} from '../hooks/use-forms'

type ItemDraft = {
  key: string
  id?: string
  label: string
  description: string
  responseType: ResponseType
  required: boolean
  photoRequired: boolean
  isHoldPoint: boolean
  inspectionPointType: '' | 'hold' | 'witness' | 'review'
  choices: string
  min: string
  max: string
  unit: string
  reference: string
}

type SectionDraft = {
  key: string
  id?: string
  title: string
  description: string
  items: ItemDraft[]
}

type Draft = {
  name: string
  description: string
  trade: string
  type: FormType
  status: 'draft' | 'active'
  requireSignatures: SignatureRole[]
  instructions: string
  sections: SectionDraft[]
}

let keySeed = 0
const nextKey = () => `k${(keySeed += 1)}`

const emptyItem = (): ItemDraft => ({
  key: nextKey(),
  label: '',
  description: '',
  responseType: 'pass_fail',
  required: true,
  photoRequired: false,
  isHoldPoint: false,
  inspectionPointType: '',
  choices: '',
  min: '',
  max: '',
  unit: '',
  reference: '',
})

const emptySection = (): SectionDraft => ({
  key: nextKey(),
  title: '',
  description: '',
  items: [emptyItem()],
})

const draftFrom = (template: FormTemplate | null, type: FormType): Draft => ({
  name: template?.name ?? '',
  description: template?.description ?? '',
  trade: template?.trade ?? '',
  type: template?.type ?? type,
  status: template?.status === 'draft' ? 'draft' : 'active',
  requireSignatures: template?.settings.requireSignatures ?? [],
  instructions: template?.settings.instructions ?? '',
  sections: template?.sections?.length
    ? template.sections.map((section) => ({
        key: nextKey(),
        id: section.id,
        title: section.title,
        description: section.description ?? '',
        items: section.items.map((item) => {
          const numberOptions =
            item.responseType === 'number' &&
            item.options &&
            !Array.isArray(item.options)
              ? (item.options as NumberOptions)
              : null
          return {
            key: nextKey(),
            id: item.id,
            label: item.label,
            description: item.description ?? '',
            responseType: item.responseType,
            required: item.required,
            photoRequired: item.photoRequired,
            isHoldPoint: item.isHoldPoint,
            inspectionPointType: item.inspectionPointType ?? '',
            choices: Array.isArray(item.options) ? item.options.join(', ') : '',
            min: numberOptions?.min != null ? String(numberOptions.min) : '',
            max: numberOptions?.max != null ? String(numberOptions.max) : '',
            unit: numberOptions?.unit ?? '',
            reference: item.reference ?? '',
          }
        }),
      }))
    : [emptySection()],
})

const toPayload = (draft: Draft): FormTemplateInput => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  trade: draft.trade.trim() || null,
  type: draft.type,
  status: draft.status,
  settings: {
    requireSignatures: draft.requireSignatures,
    instructions: draft.instructions.trim() || null,
  },
  sections: draft.sections.map((section) => ({
    id: section.id,
    title: section.title.trim(),
    description: section.description.trim() || null,
    items: section.items.map((item) => ({
      id: item.id,
      label: item.label.trim(),
      description: item.description.trim() || null,
      responseType: item.responseType,
      required: item.required,
      photoRequired: item.photoRequired,
      isHoldPoint: item.isHoldPoint,
      inspectionPointType: item.inspectionPointType || null,
      options:
        item.responseType === 'choice'
          ? item.choices
              .split(/[,\n]/)
              .map((value) => value.trim())
              .filter(Boolean)
          : item.responseType === 'number'
            ? {
                min: item.min.trim() === '' ? null : Number(item.min),
                max: item.max.trim() === '' ? null : Number(item.max),
                unit: item.unit.trim() || null,
              }
            : null,
      reference: item.reference.trim() || null,
    })),
  })),
})

const move = <T,>(list: T[], from: number, to: number) => {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [entry] = next.splice(from, 1)
  next.splice(to, 0, entry)
  return next
}

function ItemRow({
  item,
  index,
  count,
  isItp,
  onChange,
  onMove,
  onRemove,
}: {
  item: ItemDraft
  index: number
  count: number
  isItp: boolean
  onChange: (next: ItemDraft) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    onChange({ ...item, [key]: value })
  const holdCapable = ['pass_fail', 'yes_no', 'checkbox'].includes(
    item.responseType
  )
  return (
    <div
      className='space-y-2 rounded border bg-background p-2'
      data-testid='uat-template-item'
    >
      <div className='flex flex-wrap items-start gap-2'>
        <span className='mt-2 w-6 text-right font-mono text-xs text-muted-foreground'>
          {index + 1}
        </span>
        <div className='min-w-[200px] flex-1 space-y-1'>
          <Input
            value={item.label}
            onChange={(event) => set('label', event.target.value)}
            placeholder='What to check'
            maxLength={300}
            data-testid='uat-template-item-label'
          />
          <Input
            value={item.description}
            onChange={(event) => set('description', event.target.value)}
            placeholder='Guidance (optional)'
            className='text-xs'
            maxLength={2000}
          />
        </div>
        <Select
          value={item.responseType}
          onValueChange={(value) => {
            const responseType = value as ResponseType
            onChange({
              ...item,
              responseType,
              isHoldPoint:
                item.isHoldPoint &&
                ['pass_fail', 'yes_no', 'checkbox'].includes(responseType),
            })
          }}
        >
          <SelectTrigger
            className='w-[140px]'
            data-testid='uat-template-item-type'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESPONSE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {RESPONSE_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className='flex items-center gap-1'>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='h-8 w-8'
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label='Move up'
          >
            <ArrowUp className='h-4 w-4' />
          </Button>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='h-8 w-8'
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            aria-label='Move down'
          >
            <ArrowDown className='h-4 w-4' />
          </Button>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='h-8 w-8 text-destructive'
            onClick={onRemove}
            aria-label='Remove item'
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 pl-8 text-xs'>
        <label className='flex items-center gap-1.5'>
          <Checkbox
            checked={item.required}
            onCheckedChange={(checked) => set('required', checked === true)}
          />
          Required
        </label>
        {item.responseType !== 'photo' && item.responseType !== 'signature' && (
          <label className='flex items-center gap-1.5'>
            <Checkbox
              checked={item.photoRequired}
              onCheckedChange={(checked) =>
                set('photoRequired', checked === true)
              }
            />
            Photo required
          </label>
        )}
        {isItp && holdCapable && (
          <label className='flex items-center gap-1.5'>
            <Checkbox
              checked={item.isHoldPoint}
              onCheckedChange={(checked) =>
                onChange({
                  ...item,
                  isHoldPoint: checked === true,
                  inspectionPointType:
                    checked === true && !item.inspectionPointType
                      ? 'hold'
                      : item.inspectionPointType,
                })
              }
              data-testid='uat-template-item-hold'
            />
            <Flag className='h-3 w-3 text-destructive' /> Hold point (blocks
            progress approval)
          </label>
        )}
        {isItp && (
          <Select
            value={item.inspectionPointType || '__none'}
            onValueChange={(value) =>
              set(
                'inspectionPointType',
                value === '__none'
                  ? ''
                  : (value as ItemDraft['inspectionPointType'])
              )
            }
          >
            <SelectTrigger className='h-7 w-[130px] text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='__none'>No point type</SelectItem>
              <SelectItem value='hold'>Hold point</SelectItem>
              <SelectItem value='witness'>Witness point</SelectItem>
              <SelectItem value='review'>Review point</SelectItem>
            </SelectContent>
          </Select>
        )}
        {item.responseType === 'choice' && (
          <Input
            value={item.choices}
            onChange={(event) => set('choices', event.target.value)}
            placeholder='Options, comma separated'
            className='h-7 w-64 text-xs'
          />
        )}
        {item.responseType === 'number' && (
          <span className='flex items-center gap-1'>
            <Input
              value={item.min}
              onChange={(event) => set('min', event.target.value)}
              placeholder='min'
              className='h-7 w-16 text-xs'
              inputMode='decimal'
            />
            <Input
              value={item.max}
              onChange={(event) => set('max', event.target.value)}
              placeholder='max'
              className='h-7 w-16 text-xs'
              inputMode='decimal'
            />
            <Input
              value={item.unit}
              onChange={(event) => set('unit', event.target.value)}
              placeholder='unit'
              className='h-7 w-16 text-xs'
            />
          </span>
        )}
        <Input
          value={item.reference}
          onChange={(event) => set('reference', event.target.value)}
          placeholder='Spec / drawing reference'
          className='h-7 w-48 text-xs'
          maxLength={200}
        />
      </div>
    </div>
  )
}

/**
 * Builds or edits a template: sections of items with response types,
 * required / photo flags, ITP hold and witness points, signature rules.
 */
export function TemplateEditorDialog({
  projectId,
  template,
  defaultType = 'inspection',
  open,
  onOpenChange,
  onSaved,
}: {
  /** null edits the company library. */
  projectId: string | null
  template: FormTemplate | null
  defaultType?: FormType
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (template: FormTemplate) => void
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(template, defaultType)
  )
  const { create, update } = useTemplateMutations(projectId)
  const busy = create.isPending || update.isPending
  const isItp = draft.type === 'itp'
  const itemCount = draft.sections.reduce(
    (sum, section) => sum + section.items.length,
    0
  )
  const holdPoints = draft.sections.reduce(
    (sum, section) =>
      sum + section.items.filter((item) => item.isHoldPoint).length,
    0
  )
  const structureLocked = Boolean(template?.isSystem)

  const setSection = (index: number, next: SectionDraft) =>
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section, i) =>
        i === index ? next : section
      ),
    }))

  const save = async () => {
    const payload = toPayload(draft)
    if (structureLocked) delete payload.sections
    try {
      const saved = template
        ? await update.mutateAsync({ templateId: template.id, payload })
        : await create.mutateAsync(payload)
      toast.success(`${saved.name} saved (v${saved.version})`)
      onSaved?.(saved)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const valid =
    draft.name.trim().length > 0 &&
    draft.sections.every(
      (section) =>
        section.title.trim().length > 0 &&
        section.items.every((item) => item.label.trim().length > 0)
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-4xl'
        data-testid='uat-template-editor'
      >
        <DialogHeader>
          <DialogTitle>
            {template ? `Edit ${template.name}` : 'New template'}
          </DialogTitle>
          <DialogDescription>
            {projectId
              ? 'Project template — only this project uses it.'
              : 'Company template — every project can schedule from it; copy it into a project to tailor it.'}
            {template && template.instanceCount > 0
              ? ` Used by ${template.instanceCount} inspection${template.instanceCount === 1 ? '' : 's'}; items with answers cannot be removed.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='tpl-name'>Name</Label>
            <Input
              id='tpl-name'
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder='e.g. Concrete pour ITP'
              maxLength={200}
              data-testid='uat-template-name'
            />
          </div>
          <div className='space-y-1'>
            <Label>Type</Label>
            <Select
              value={draft.type}
              onValueChange={(value) =>
                setDraft({ ...draft, type: value as FormType })
              }
              disabled={structureLocked}
            >
              <SelectTrigger data-testid='uat-template-type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORM_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {FORM_TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='tpl-trade'>Trade</Label>
            <Input
              id='tpl-trade'
              value={draft.trade}
              onChange={(event) =>
                setDraft({ ...draft, trade: event.target.value })
              }
              placeholder='Concrete, HSE, MEP…'
              maxLength={80}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='tpl-description'>Description</Label>
            <Textarea
              id='tpl-description'
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              rows={2}
            />
          </div>
          <div className='space-y-1'>
            <Label>Signatures required to complete</Label>
            <div className='flex flex-wrap gap-3 pt-1 text-sm'>
              {SIGNATURE_ROLES.map((role) => (
                <label key={role} className='flex items-center gap-1.5'>
                  <Checkbox
                    checked={draft.requireSignatures.includes(role)}
                    onCheckedChange={(checked) =>
                      setDraft({
                        ...draft,
                        requireSignatures:
                          checked === true
                            ? [...draft.requireSignatures, role]
                            : draft.requireSignatures.filter((r) => r !== role),
                      })
                    }
                  />
                  {role}
                </label>
              ))}
            </div>
          </div>
          <div className='space-y-1'>
            <Label>Status</Label>
            <label className='flex h-9 items-center gap-2 text-sm'>
              <Switch
                checked={draft.status === 'active'}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, status: checked ? 'active' : 'draft' })
                }
              />
              {draft.status === 'active'
                ? 'Active — can be scheduled'
                : 'Draft — hidden from scheduling'}
            </label>
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='tpl-instructions'>
              Instructions for the inspector
            </Label>
            <Textarea
              id='tpl-instructions'
              value={draft.instructions}
              onChange={(event) =>
                setDraft({ ...draft, instructions: event.target.value })
              }
              rows={2}
              placeholder='Shown at the top of every inspection from this template'
            />
          </div>
        </div>

        <div className='flex items-center justify-between'>
          <p className='text-sm font-semibold'>
            Checklist
            <span className='ml-2 font-normal text-muted-foreground'>
              {itemCount} item{itemCount === 1 ? '' : 's'}
              {holdPoints
                ? ` · ${holdPoints} hold point${holdPoints === 1 ? '' : 's'}`
                : ''}
            </span>
          </p>
          {!structureLocked && (
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() =>
                setDraft({
                  ...draft,
                  sections: [...draft.sections, emptySection()],
                })
              }
              data-testid='uat-template-add-section'
            >
              <Plus className='mr-1.5 h-4 w-4' /> Section
            </Button>
          )}
        </div>
        {structureLocked ? (
          <p className='rounded border border-dashed p-3 text-sm text-muted-foreground'>
            This template was created from the legacy ITP register and keeps its
            single inspection point. Duplicate it to build a fuller checklist.
          </p>
        ) : (
          <div className='space-y-3'>
            {draft.sections.map((section, sectionIndex) => (
              <div
                key={section.key}
                className='space-y-2 rounded-md border bg-muted/30 p-2'
                data-testid='uat-template-section'
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge variant='outline'>Section {sectionIndex + 1}</Badge>
                  <Input
                    value={section.title}
                    onChange={(event) =>
                      setSection(sectionIndex, {
                        ...section,
                        title: event.target.value,
                      })
                    }
                    placeholder='Section title'
                    className='min-w-[200px] flex-1'
                    maxLength={200}
                    data-testid='uat-template-section-title'
                  />
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='h-8 w-8'
                    disabled={sectionIndex === 0}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sections: move(
                          draft.sections,
                          sectionIndex,
                          sectionIndex - 1
                        ),
                      })
                    }
                    aria-label='Move section up'
                  >
                    <ArrowUp className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='h-8 w-8'
                    disabled={sectionIndex === draft.sections.length - 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sections: move(
                          draft.sections,
                          sectionIndex,
                          sectionIndex + 1
                        ),
                      })
                    }
                    aria-label='Move section down'
                  >
                    <ArrowDown className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='h-8 w-8 text-destructive'
                    disabled={draft.sections.length === 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sections: draft.sections.filter(
                          (_, i) => i !== sectionIndex
                        ),
                      })
                    }
                    aria-label='Remove section'
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
                <div className='space-y-2'>
                  {section.items.map((item, itemIndex) => (
                    <ItemRow
                      key={item.key}
                      item={item}
                      index={itemIndex}
                      count={section.items.length}
                      isItp={isItp}
                      onChange={(next) =>
                        setSection(sectionIndex, {
                          ...section,
                          items: section.items.map((entry, i) =>
                            i === itemIndex ? next : entry
                          ),
                        })
                      }
                      onMove={(direction) =>
                        setSection(sectionIndex, {
                          ...section,
                          items: move(
                            section.items,
                            itemIndex,
                            itemIndex + direction
                          ),
                        })
                      }
                      onRemove={() =>
                        setSection(sectionIndex, {
                          ...section,
                          items: section.items.filter(
                            (_, i) => i !== itemIndex
                          ),
                        })
                      }
                    />
                  ))}
                </div>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() =>
                    setSection(sectionIndex, {
                      ...section,
                      items: [...section.items, emptyItem()],
                    })
                  }
                  data-testid='uat-template-add-item'
                >
                  <Plus className='mr-1.5 h-4 w-4' /> Item
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={!valid || busy}
            data-testid='uat-template-save'
          >
            {busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {template ? 'Save changes' : 'Create template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
