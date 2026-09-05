import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  CONDITION_OPS,
  FIELD_TYPE_LABEL,
  useArchiveCustomFieldDefinition,
  useArchiveCustomFieldset,
  useArchiveRecordType,
  useCustomFieldDefinitions,
  useCustomFieldRecordTypes,
  useCustomFieldsets,
  useProjectFieldsets,
  useRecordTypes,
  useSaveCustomFieldDefinition,
  useSaveCustomFieldset,
  useSaveRecordType,
  useSetProjectFieldset,
  type ConditionOp,
  type CustomFieldDefinition,
  type CustomFieldDefinitionInput,
  type CustomFieldset,
  type CustomFieldType,
  type RecordTypeDefinition,
} from '../hooks/use-custom-fields'

const NONE = '__none__'
const FIELD_TYPES = Object.keys(FIELD_TYPE_LABEL) as CustomFieldType[]

// ─── field dialog ──────────────────────────────────────────────────────────

type FieldDraft = {
  label: string
  key: string
  type: CustomFieldType
  description: string
  optionsText: string
  required: boolean
  hidden: boolean
  defaultText: string
  min: string
  max: string
  minLength: string
  maxLength: string
  pattern: string
  conditionOn: boolean
  condField: string
  condOp: ConditionOp
  condValue: string
}

const optionsToText = (options: CustomFieldDefinition['options']) =>
  (options ?? [])
    .map((option) =>
      option.label && option.label !== option.value
        ? `${option.value} | ${option.label}`
        : option.value
    )
    .join('\n')

const textToOptions = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, label] = line.split('|').map((part) => part.trim())
      return { value, label: label || value }
    })

const fieldDraftFrom = (field: CustomFieldDefinition | null): FieldDraft => ({
  label: field?.label ?? '',
  key: field?.key ?? '',
  type: field?.type ?? 'text',
  description: field?.description ?? '',
  optionsText: optionsToText(field?.options ?? null),
  required: field?.required ?? false,
  hidden: field?.hidden ?? false,
  defaultText:
    field?.default === null || field?.default === undefined
      ? ''
      : Array.isArray(field.default)
        ? field.default.join(', ')
        : String(field.default),
  min: field?.validation?.min == null ? '' : String(field.validation.min),
  max: field?.validation?.max == null ? '' : String(field.validation.max),
  minLength:
    field?.validation?.minLength == null
      ? ''
      : String(field.validation.minLength),
  maxLength:
    field?.validation?.maxLength == null
      ? ''
      : String(field.validation.maxLength),
  pattern: field?.validation?.pattern ?? '',
  conditionOn: Boolean(field?.condition),
  condField: field?.condition?.field ?? '',
  condOp: field?.condition?.op ?? 'eq',
  condValue:
    field?.condition?.value === null || field?.condition?.value === undefined
      ? ''
      : Array.isArray(field.condition.value)
        ? field.condition.value.join(', ')
        : String(field.condition.value),
})

const draftToPayload = (
  draft: FieldDraft,
  isNew: boolean
): CustomFieldDefinitionInput => {
  const numeric = draft.type === 'number' || draft.type === 'money'
  const textual =
    draft.type === 'text' || draft.type === 'textarea' || draft.type === 'url'
  const validation = numeric
    ? { min: draft.min.trim() || null, max: draft.max.trim() || null }
    : draft.type === 'date'
      ? { min: draft.min.trim() || null, max: draft.max.trim() || null }
      : textual
        ? {
            minLength: draft.minLength.trim() ? Number(draft.minLength) : null,
            maxLength: draft.maxLength.trim() ? Number(draft.maxLength) : null,
            pattern: draft.pattern.trim() || null,
          }
        : null
  const op = CONDITION_OPS.find((item) => item.id === draft.condOp)
  const rawDefault = draft.defaultText.trim()
  const defaultValue = !rawDefault
    ? null
    : draft.type === 'boolean'
      ? rawDefault === 'true'
      : draft.type === 'multi_select'
        ? rawDefault
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : rawDefault
  return {
    label: draft.label.trim(),
    ...(isNew ? { key: draft.key.trim() || null } : {}),
    type: draft.type,
    description: draft.description.trim() || null,
    options:
      draft.type === 'select' || draft.type === 'multi_select'
        ? textToOptions(draft.optionsText)
        : null,
    required: draft.required,
    hidden: draft.hidden,
    default: defaultValue,
    validation,
    condition: draft.conditionOn
      ? {
          field: draft.condField.trim(),
          op: draft.condOp,
          value: op?.needsValue
            ? draft.condOp === 'in' || draft.condOp === 'nin'
              ? draft.condValue.split(',').map((item) => item.trim())
              : draft.condValue.trim()
            : null,
        }
      : null,
  }
}

function FieldDialog({
  projectId,
  recordType,
  field,
  siblings,
  open,
  onOpenChange,
}: {
  projectId: string | null
  recordType: string
  field: CustomFieldDefinition | null
  siblings: CustomFieldDefinition[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const save = useSaveCustomFieldDefinition(projectId)
  const [draft, setDraft] = useState<FieldDraft>(() => fieldDraftFrom(field))
  const set = (patch: Partial<FieldDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }))
  const numeric = draft.type === 'number' || draft.type === 'money'
  const textual =
    draft.type === 'text' || draft.type === 'textarea' || draft.type === 'url'
  const withOptions = draft.type === 'select' || draft.type === 'multi_select'
  const op = CONDITION_OPS.find((item) => item.id === draft.condOp)

  const submit = async () => {
    if (!draft.label.trim()) {
      toast.error('Give the field a label')
      return
    }
    if (withOptions && textToOptions(draft.optionsText).length === 0) {
      toast.error('Add at least one option (one per line)')
      return
    }
    if (draft.conditionOn && !draft.condField.trim()) {
      toast.error('Pick the field the condition tests')
      return
    }
    try {
      await save.mutateAsync({
        definitionId: field?.id ?? null,
        payload: {
          ...(field ? {} : { recordType }),
          ...draftToPayload(draft, !field),
        },
      })
      toast.success(field ? 'Field updated' : 'Field added')
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{field ? 'Edit field' : 'New field'}</DialogTitle>
          <DialogDescription>
            {projectId
              ? 'Shown on this project only.'
              : 'Shown on every project, unless a fieldset leaves it out.'}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='cf-label'>Label</Label>
              <Input
                id='cf-label'
                data-testid='uat-custom-field-label'
                value={draft.label}
                onChange={(event) => set({ label: event.target.value })}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='cf-key'>Key</Label>
              <Input
                id='cf-key'
                value={draft.key}
                disabled={Boolean(field)}
                placeholder='from the label'
                onChange={(event) => set({ key: event.target.value })}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='cf-type'>Type</Label>
              <Select
                value={draft.type}
                disabled={Boolean(field && (field.valueCount ?? 0) > 0)}
                onValueChange={(value) =>
                  set({ type: value as CustomFieldType })
                }
              >
                <SelectTrigger id='cf-type' data-testid='uat-custom-field-type'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {FIELD_TYPE_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1'>
              <Label htmlFor='cf-default'>Default</Label>
              {draft.type === 'boolean' ? (
                <Select
                  value={draft.defaultText || NONE}
                  onValueChange={(value) =>
                    set({ defaultText: value === NONE ? '' : value })
                  }
                >
                  <SelectTrigger id='cf-default'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    <SelectItem value='true'>Yes</SelectItem>
                    <SelectItem value='false'>No</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id='cf-default'
                  value={draft.defaultText}
                  disabled={draft.type === 'user' || draft.type === 'company'}
                  placeholder={
                    draft.type === 'multi_select' ? 'a, b' : 'Optional'
                  }
                  onChange={(event) => set({ defaultText: event.target.value })}
                />
              )}
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='cf-description'>Help text</Label>
            <Input
              id='cf-description'
              value={draft.description}
              onChange={(event) => set({ description: event.target.value })}
            />
          </div>
          {withOptions && (
            <div className='space-y-1'>
              <Label htmlFor='cf-options'>
                Options (one per line, `value | label`)
              </Label>
              <Textarea
                id='cf-options'
                rows={4}
                data-testid='uat-custom-field-options'
                value={draft.optionsText}
                onChange={(event) => set({ optionsText: event.target.value })}
              />
            </div>
          )}
          {(numeric || draft.type === 'date') && (
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1'>
                <Label htmlFor='cf-min'>Minimum</Label>
                <Input
                  id='cf-min'
                  type={draft.type === 'date' ? 'date' : 'number'}
                  value={draft.min}
                  onChange={(event) => set({ min: event.target.value })}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='cf-max'>Maximum</Label>
                <Input
                  id='cf-max'
                  type={draft.type === 'date' ? 'date' : 'number'}
                  value={draft.max}
                  onChange={(event) => set({ max: event.target.value })}
                />
              </div>
            </div>
          )}
          {textual && (
            <div className='grid gap-3 sm:grid-cols-3'>
              <div className='space-y-1'>
                <Label htmlFor='cf-minlen'>Min length</Label>
                <Input
                  id='cf-minlen'
                  type='number'
                  min={0}
                  value={draft.minLength}
                  onChange={(event) => set({ minLength: event.target.value })}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='cf-maxlen'>Max length</Label>
                <Input
                  id='cf-maxlen'
                  type='number'
                  min={1}
                  value={draft.maxLength}
                  onChange={(event) => set({ maxLength: event.target.value })}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='cf-pattern'>Pattern (regex)</Label>
                <Input
                  id='cf-pattern'
                  value={draft.pattern}
                  onChange={(event) => set({ pattern: event.target.value })}
                />
              </div>
            </div>
          )}
          <div className='flex flex-wrap gap-6'>
            <label className='flex items-center gap-2 text-sm'>
              <Switch
                checked={draft.required}
                onCheckedChange={(checked) => set({ required: checked })}
                data-testid='uat-custom-field-required'
              />
              Required
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <Switch
                checked={draft.hidden}
                onCheckedChange={(checked) => set({ hidden: checked })}
              />
              Hidden (kept for reports)
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <Switch
                checked={draft.conditionOn}
                onCheckedChange={(checked) => set({ conditionOn: checked })}
                data-testid='uat-custom-field-conditional'
              />
              Only when…
            </label>
          </div>
          {draft.conditionOn && (
            <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-3'>
              <div className='space-y-1'>
                <Label htmlFor='cf-cond-field' className='text-xs'>
                  Field (record field or custom key)
                </Label>
                <Input
                  id='cf-cond-field'
                  list='cf-cond-keys'
                  placeholder='priority'
                  value={draft.condField}
                  onChange={(event) => set({ condField: event.target.value })}
                />
                <datalist id='cf-cond-keys'>
                  {siblings
                    .filter((item) => item.id !== field?.id)
                    .map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                </datalist>
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>Operator</Label>
                <Select
                  value={draft.condOp}
                  onValueChange={(value) =>
                    set({ condOp: value as ConditionOp })
                  }
                >
                  <SelectTrigger aria-label='Operator'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_OPS.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label htmlFor='cf-cond-value' className='text-xs'>
                  Value
                </Label>
                <Input
                  id='cf-cond-value'
                  disabled={!op?.needsValue}
                  value={draft.condValue}
                  onChange={(event) => set({ condValue: event.target.value })}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={save.isPending}
            data-testid='uat-custom-field-save'
            onClick={submit}
          >
            {save.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            {field ? 'Save changes' : 'Add field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── fieldset dialog ───────────────────────────────────────────────────────

type FieldsetEntryDraft = {
  fieldId: string
  included: boolean
  required: boolean | null
  hidden: boolean | null
}

function FieldsetDialog({
  recordType,
  fieldset,
  fields,
  open,
  onOpenChange,
}: {
  recordType: string
  fieldset: CustomFieldset | null
  fields: CustomFieldDefinition[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const save = useSaveCustomFieldset()
  const [name, setName] = useState(fieldset?.name ?? '')
  const [description, setDescription] = useState(fieldset?.description ?? '')
  const [isDefault, setIsDefault] = useState(fieldset?.isDefault ?? false)
  const [entries, setEntries] = useState<FieldsetEntryDraft[]>(() => {
    const existing = new Map(
      (fieldset?.fields ?? []).map((entry) => [entry.fieldId, entry])
    )
    const ordered = [
      ...(fieldset?.fields ?? [])
        .map((entry) => fields.find((field) => field.id === entry.fieldId))
        .filter((field): field is CustomFieldDefinition => Boolean(field)),
      ...fields.filter((field) => !existing.has(field.id)),
    ]
    return ordered.map((field) => {
      const entry = existing.get(field.id)
      return {
        fieldId: field.id,
        included: Boolean(entry) || !fieldset,
        required: entry?.required ?? null,
        hidden: entry?.hidden ?? null,
      }
    })
  })
  const labelOf = (fieldId: string) =>
    fields.find((field) => field.id === fieldId)?.label ?? fieldId
  const setEntry = (fieldId: string, patch: Partial<FieldsetEntryDraft>) =>
    setEntries((prev) =>
      prev.map((entry) =>
        entry.fieldId === fieldId ? { ...entry, ...patch } : entry
      )
    )
  const move = (index: number, direction: -1 | 1) =>
    setEntries((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Give the fieldset a name')
      return
    }
    try {
      await save.mutateAsync({
        fieldsetId: fieldset?.id ?? null,
        payload: {
          ...(fieldset ? {} : { recordType }),
          name: name.trim(),
          description: description.trim() || null,
          isDefault,
          fields: entries
            .filter((entry) => entry.included)
            .map((entry) => ({
              fieldId: entry.fieldId,
              required: entry.required,
              hidden: entry.hidden,
            })),
        },
      })
      toast.success(fieldset ? 'Fieldset updated' : 'Fieldset created')
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {fieldset ? 'Edit fieldset' : 'New fieldset'}
          </DialogTitle>
          <DialogDescription>
            Which fields a project (or a record type) shows, in what order, and
            whether each is required or hidden there.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='fs-name'>Name</Label>
            <Input
              id='fs-name'
              data-testid='uat-fieldset-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='fs-description'>Description</Label>
            <Input
              id='fs-description'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            Default for projects without an assignment
          </label>
          <div className='space-y-1'>
            <Label>Fields</Label>
            {entries.length === 0 && (
              <p className='text-xs text-muted-foreground'>
                Add fields for this record type first.
              </p>
            )}
            <ul className='divide-y rounded-md border'>
              {entries.map((entry, index) => (
                <li
                  key={entry.fieldId}
                  className='flex flex-wrap items-center gap-3 px-2 py-1.5 text-sm'
                  data-testid='uat-fieldset-entry'
                >
                  <Checkbox
                    checked={entry.included}
                    aria-label={`Include ${labelOf(entry.fieldId)}`}
                    onCheckedChange={(state) =>
                      setEntry(entry.fieldId, { included: state === true })
                    }
                  />
                  <span className='min-w-0 flex-1 truncate'>
                    {labelOf(entry.fieldId)}
                  </span>
                  {entry.included && (
                    <>
                      <label className='flex items-center gap-1 text-xs'>
                        <Checkbox
                          checked={entry.required === true}
                          onCheckedChange={(state) =>
                            setEntry(entry.fieldId, {
                              required: state === true ? true : null,
                            })
                          }
                        />
                        Required
                      </label>
                      <label className='flex items-center gap-1 text-xs'>
                        <Checkbox
                          checked={entry.hidden === true}
                          onCheckedChange={(state) =>
                            setEntry(entry.fieldId, {
                              hidden: state === true ? true : null,
                            })
                          }
                        />
                        Hidden
                      </label>
                    </>
                  )}
                  <div className='flex gap-0.5'>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      className='h-7 px-2'
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      className='h-7 px-2'
                      disabled={index === entries.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={save.isPending}
            data-testid='uat-fieldset-save'
            onClick={submit}
          >
            {save.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            {fieldset ? 'Save changes' : 'Create fieldset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── record type dialog (correspondence) ───────────────────────────────────

const CORRESPONDENCE_DIRECTIONS = ['incoming', 'outgoing']
const CORRESPONDENCE_TYPES = ['letter', 'email', 'memo', 'notice']

function RecordTypeDialog({
  tool,
  recordType,
  fieldsets,
  open,
  onOpenChange,
}: {
  tool: string
  recordType: RecordTypeDefinition | null
  fieldsets: CustomFieldset[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const save = useSaveRecordType()
  const defaults = (recordType?.settings?.defaults ?? {}) as Record<
    string,
    string | undefined
  >
  const [label, setLabel] = useState(recordType?.label ?? '')
  const [key, setKey] = useState(recordType?.key ?? '')
  const [description, setDescription] = useState(recordType?.description ?? '')
  const [fieldsetId, setFieldsetId] = useState(recordType?.fieldsetId ?? '')
  const [direction, setDirection] = useState(defaults.direction ?? '')
  const [type, setType] = useState(defaults.type ?? '')

  const submit = async () => {
    if (!label.trim()) {
      toast.error('Give the record type a name')
      return
    }
    try {
      await save.mutateAsync({
        recordTypeId: recordType?.id ?? null,
        payload: {
          ...(recordType ? {} : { tool, key: key.trim() || null }),
          label: label.trim(),
          description: description.trim() || null,
          fieldsetId: fieldsetId || null,
          settings: {
            defaults: {
              ...(direction ? { direction } : {}),
              ...(type ? { type } : {}),
            },
          },
        },
      })
      toast.success(recordType ? 'Record type updated' : 'Record type created')
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {recordType ? 'Edit record type' : 'New record type'}
          </DialogTitle>
          <DialogDescription>
            A named kind of {tool.replace(/_/g, ' ')} with its own fieldset and
            defaults — a “Site Instruction”, for example.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='rt-label'>Name</Label>
              <Input
                id='rt-label'
                data-testid='uat-record-type-label'
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='rt-key'>Key</Label>
              <Input
                id='rt-key'
                value={key}
                disabled={Boolean(recordType)}
                placeholder='from the name'
                onChange={(event) => setKey(event.target.value)}
              />
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='rt-description'>Description</Label>
            <Input
              id='rt-description'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='rt-fieldset'>Fieldset</Label>
            <Select
              value={fieldsetId || NONE}
              onValueChange={(value) =>
                setFieldsetId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger
                id='rt-fieldset'
                data-testid='uat-record-type-fieldset'
              >
                <SelectValue placeholder='Project default' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Project default</SelectItem>
                {fieldsets.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tool === 'correspondence' && (
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1'>
                <Label>Default direction</Label>
                <Select
                  value={direction || NONE}
                  onValueChange={(value) =>
                    setDirection(value === NONE ? '' : value)
                  }
                >
                  <SelectTrigger aria-label='Default direction'>
                    <SelectValue placeholder='None' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {CORRESPONDENCE_DIRECTIONS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label>Default kind</Label>
                <Select
                  value={type || NONE}
                  onValueChange={(value) =>
                    setType(value === NONE ? '' : value)
                  }
                >
                  <SelectTrigger aria-label='Default kind'>
                    <SelectValue placeholder='None' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {CORRESPONDENCE_TYPES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={save.isPending}
            data-testid='uat-record-type-save'
            onClick={submit}
          >
            {save.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            {recordType ? 'Save changes' : 'Create record type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── admin surface ─────────────────────────────────────────────────────────

function ProjectFieldsetAssignment({
  projectId,
  recordType,
}: {
  projectId: string
  recordType: string
}) {
  const { data: assignments = [] } = useProjectFieldsets(projectId)
  const { data: fieldsets = [] } = useCustomFieldsets(projectId, { recordType })
  const assign = useSetProjectFieldset(projectId)
  const current = assignments.find((item) => item.recordType === recordType)
  if (fieldsets.length === 0) return null
  return (
    <div className='flex flex-wrap items-center gap-2 text-sm'>
      <span className='text-muted-foreground'>Fieldset on this project</span>
      <Select
        value={current?.fieldsetId ?? NONE}
        disabled={assign.isPending}
        onValueChange={async (value) => {
          try {
            await assign.mutateAsync({
              recordType,
              fieldsetId: value === NONE ? null : value,
            })
            toast.success('Fieldset updated')
          } catch (error) {
            toast.error(getServerErrorMessage(error))
          }
        }}
      >
        <SelectTrigger className='w-64' data-testid='uat-project-fieldset'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Company default</SelectItem>
          {fieldsets.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
              {item.isDefault ? ' · default' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * Manage custom fields per record type. Company scope (`projectId: null`)
 * also manages fieldsets and record types; project scope manages the
 * project's own fields and which fieldset applies here.
 */
export function CustomFieldsAdmin({ projectId }: { projectId: string | null }) {
  const { data: catalogue } = useCustomFieldRecordTypes(projectId)
  const [recordType, setRecordType] = useState('rfi')
  const [includeArchived, setIncludeArchived] = useState(false)
  const { data: definitions = [], isLoading } = useCustomFieldDefinitions(
    projectId,
    { recordType, includeArchived }
  )
  const { data: fieldsets = [] } = useCustomFieldsets(projectId, {
    recordType,
    includeArchived,
  })
  const { data: recordTypesData } = useRecordTypes(recordType, {
    enabled: !projectId,
    includeArchived,
  })
  const archiveField = useArchiveCustomFieldDefinition(projectId)
  const archiveFieldset = useArchiveCustomFieldset()
  const archiveRecordType = useArchiveRecordType()
  const [fieldDialog, setFieldDialog] = useState<{
    open: boolean
    field: CustomFieldDefinition | null
    nonce: number
  }>({ open: false, field: null, nonce: 0 })
  const [fieldsetDialog, setFieldsetDialog] = useState<{
    open: boolean
    fieldset: CustomFieldset | null
    nonce: number
  }>({ open: false, fieldset: null, nonce: 0 })
  const [recordTypeDialog, setRecordTypeDialog] = useState<{
    open: boolean
    recordType: RecordTypeDefinition | null
    nonce: number
  }>({ open: false, recordType: null, nonce: 0 })

  const meta = catalogue?.recordTypes.find((item) => item.key === recordType)
  const activeFields = definitions.filter((field) => field.status === 'active')
  const canEditField = (field: CustomFieldDefinition) =>
    projectId ? field.scope === 'project' : true

  return (
    <div className='space-y-3' data-testid='uat-custom-fields-admin'>
      <div className='flex flex-wrap items-center gap-3'>
        <Select value={recordType} onValueChange={setRecordType}>
          <SelectTrigger
            className='w-64'
            data-testid='uat-custom-fields-record-type'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(catalogue?.recordTypes ?? []).map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.label}
                {item.fieldCount ? ` · ${item.fieldCount}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className='flex items-center gap-2 text-sm'>
          <Switch
            checked={includeArchived}
            onCheckedChange={setIncludeArchived}
          />
          Show archived
        </label>
        {projectId && (
          <ProjectFieldsetAssignment
            projectId={projectId}
            recordType={recordType}
          />
        )}
      </div>

      <Tabs defaultValue='fields'>
        <TabsList>
          <TabsTrigger value='fields'>Fields</TabsTrigger>
          {!projectId && <TabsTrigger value='fieldsets'>Fieldsets</TabsTrigger>}
          {!projectId && meta?.supportsRecordTypes && (
            <TabsTrigger value='record-types'>Record types</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value='fields' className='space-y-2'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <p className='text-sm text-muted-foreground'>
              {projectId
                ? 'Company fields apply here automatically; add fields only this project needs.'
                : 'Fields every project shows on this record type, in this order.'}
            </p>
            <Button
              size='sm'
              data-testid='uat-custom-field-new'
              onClick={() =>
                setFieldDialog((prev) => ({
                  open: true,
                  field: null,
                  nonce: prev.nonce + 1,
                }))
              }
            >
              <Plus className='mr-1 h-4 w-4' />
              New field
            </Button>
          </div>
          {isLoading ? (
            <p className='text-sm text-muted-foreground'>Loading…</p>
          ) : definitions.length === 0 ? (
            <p className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
              No custom fields on {meta?.label ?? 'this record type'} yet.
            </p>
          ) : (
            <ul className='divide-y rounded-md border'>
              {definitions.map((field) => (
                <li
                  key={field.id}
                  className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
                  data-testid='uat-custom-field-row'
                >
                  <span className='font-medium'>{field.label}</span>
                  <code className='rounded bg-muted px-1 text-xs'>
                    {field.key}
                  </code>
                  <Badge variant='outline'>
                    {FIELD_TYPE_LABEL[field.type]}
                  </Badge>
                  {field.scope === 'project' && (
                    <Badge variant='secondary'>Project</Badge>
                  )}
                  {field.required && <Badge>Required</Badge>}
                  {field.hidden && <Badge variant='secondary'>Hidden</Badge>}
                  {field.condition && (
                    <Badge
                      variant='outline'
                      title={`${field.condition.field} ${field.condition.op} ${String(field.condition.value ?? '')}`}
                    >
                      Conditional
                    </Badge>
                  )}
                  {field.status === 'archived' && (
                    <Badge variant='secondary'>Archived</Badge>
                  )}
                  <span className='text-xs text-muted-foreground'>
                    {field.valueCount ?? 0} value
                    {field.valueCount === 1 ? '' : 's'}
                  </span>
                  {canEditField(field) && field.status === 'active' && (
                    <div className='ml-auto flex gap-1'>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          setFieldDialog((prev) => ({
                            open: true,
                            field,
                            nonce: prev.nonce + 1,
                          }))
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={archiveField.isPending}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Archive "${field.label}"? Stored values are kept.`
                            )
                          )
                            return
                          try {
                            await archiveField.mutateAsync(field.id)
                            toast.success('Field archived')
                          } catch (error) {
                            toast.error(getServerErrorMessage(error))
                          }
                        }}
                      >
                        Archive
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {!projectId && (
          <TabsContent value='fieldsets' className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-sm text-muted-foreground'>
                A fieldset picks which fields a project or record type shows and
                which are required there. Without one, every active field shows.
              </p>
              <Button
                size='sm'
                data-testid='uat-fieldset-new'
                disabled={activeFields.length === 0}
                onClick={() =>
                  setFieldsetDialog((prev) => ({
                    open: true,
                    fieldset: null,
                    nonce: prev.nonce + 1,
                  }))
                }
              >
                <Plus className='mr-1 h-4 w-4' />
                New fieldset
              </Button>
            </div>
            {fieldsets.length === 0 ? (
              <p className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
                No fieldsets for {meta?.label ?? 'this record type'}.
              </p>
            ) : (
              <ul className='divide-y rounded-md border'>
                {fieldsets.map((fieldset) => (
                  <li
                    key={fieldset.id}
                    className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
                    data-testid='uat-fieldset-row'
                  >
                    <span className='font-medium'>{fieldset.name}</span>
                    {fieldset.isDefault && <Badge>Default</Badge>}
                    {fieldset.status === 'archived' && (
                      <Badge variant='secondary'>Archived</Badge>
                    )}
                    <span className='text-xs text-muted-foreground'>
                      {fieldset.fields.length} field
                      {fieldset.fields.length === 1 ? '' : 's'}
                      {fieldset.projectCount
                        ? ` · ${fieldset.projectCount} project${fieldset.projectCount === 1 ? '' : 's'}`
                        : ''}
                    </span>
                    {fieldset.status === 'active' && (
                      <div className='ml-auto flex gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            setFieldsetDialog((prev) => ({
                              open: true,
                              fieldset,
                              nonce: prev.nonce + 1,
                            }))
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          disabled={archiveFieldset.isPending}
                          onClick={async () => {
                            if (!window.confirm(`Archive "${fieldset.name}"?`))
                              return
                            try {
                              await archiveFieldset.mutateAsync(fieldset.id)
                              toast.success('Fieldset archived')
                            } catch (error) {
                              toast.error(getServerErrorMessage(error))
                            }
                          }}
                        >
                          Archive
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        )}

        {!projectId && meta?.supportsRecordTypes && (
          <TabsContent value='record-types' className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-sm text-muted-foreground'>
                Named kinds of {meta.label.toLowerCase()} with their own
                fieldset and defaults; people pick one when they create a
                record.
              </p>
              <Button
                size='sm'
                data-testid='uat-record-type-new'
                onClick={() =>
                  setRecordTypeDialog((prev) => ({
                    open: true,
                    recordType: null,
                    nonce: prev.nonce + 1,
                  }))
                }
              >
                <Plus className='mr-1 h-4 w-4' />
                New record type
              </Button>
            </div>
            {(recordTypesData?.items ?? []).length === 0 ? (
              <p className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
                No record types yet.
              </p>
            ) : (
              <ul className='divide-y rounded-md border'>
                {(recordTypesData?.items ?? []).map((item) => (
                  <li
                    key={item.id}
                    className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
                    data-testid='uat-record-type-row'
                  >
                    <span className='font-medium'>{item.label}</span>
                    <code className='rounded bg-muted px-1 text-xs'>
                      {item.key}
                    </code>
                    {item.fieldset && (
                      <Badge variant='outline'>{item.fieldset.name}</Badge>
                    )}
                    {item.status === 'archived' && (
                      <Badge variant='secondary'>Archived</Badge>
                    )}
                    {item.status === 'active' && (
                      <div className='ml-auto flex gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            setRecordTypeDialog((prev) => ({
                              open: true,
                              recordType: item,
                              nonce: prev.nonce + 1,
                            }))
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          disabled={archiveRecordType.isPending}
                          onClick={async () => {
                            if (!window.confirm(`Archive "${item.label}"?`))
                              return
                            try {
                              await archiveRecordType.mutateAsync(item.id)
                              toast.success('Record type archived')
                            } catch (error) {
                              toast.error(getServerErrorMessage(error))
                            }
                          }}
                        >
                          Archive
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        )}
      </Tabs>

      {fieldDialog.open && (
        <FieldDialog
          key={`${fieldDialog.field?.id ?? 'new'}-${fieldDialog.nonce}`}
          projectId={projectId}
          recordType={recordType}
          field={fieldDialog.field}
          siblings={activeFields}
          open={fieldDialog.open}
          onOpenChange={(open) => setFieldDialog((prev) => ({ ...prev, open }))}
        />
      )}
      {fieldsetDialog.open && (
        <FieldsetDialog
          key={`${fieldsetDialog.fieldset?.id ?? 'new'}-${fieldsetDialog.nonce}`}
          recordType={recordType}
          fieldset={fieldsetDialog.fieldset}
          fields={activeFields}
          open={fieldsetDialog.open}
          onOpenChange={(open) =>
            setFieldsetDialog((prev) => ({ ...prev, open }))
          }
        />
      )}
      {recordTypeDialog.open && (
        <RecordTypeDialog
          key={`${recordTypeDialog.recordType?.id ?? 'new'}-${recordTypeDialog.nonce}`}
          tool={recordType}
          recordType={recordTypeDialog.recordType}
          fieldsets={fieldsets.filter((item) => item.status === 'active')}
          open={recordTypeDialog.open}
          onOpenChange={(open) =>
            setRecordTypeDialog((prev) => ({ ...prev, open }))
          }
        />
      )}
    </div>
  )
}
