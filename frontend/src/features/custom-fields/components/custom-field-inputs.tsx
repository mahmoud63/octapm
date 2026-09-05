import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
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
import { CompanyPicker, UserPicker } from '@/components/user-picker'
import {
  visibleFields,
  type CustomFieldSchemaField,
  type CustomFieldValue,
  type CustomFieldValues,
} from '../hooks/use-custom-fields'

const NONE = '__none__'

export function CustomFieldInput({
  projectId,
  field,
  value,
  onChange,
  disabled,
  id,
}: {
  projectId: string | null
  field: CustomFieldSchemaField
  value: CustomFieldValue | undefined
  onChange: (next: CustomFieldValue) => void
  disabled?: boolean
  id?: string
}) {
  const inputId = id ?? `cf-${field.key}`
  const testId = `uat-custom-field-${field.key}`
  switch (field.type) {
    case 'textarea':
      return (
        <Textarea
          id={inputId}
          rows={3}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={disabled}
          data-testid={testId}
        />
      )
    case 'number':
    case 'money':
      return (
        <Input
          id={inputId}
          type='number'
          inputMode='decimal'
          step={field.type === 'money' ? '0.01' : 'any'}
          min={field.validation?.min ?? undefined}
          max={field.validation?.max ?? undefined}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : event.target.value)
          }
          disabled={disabled}
          data-testid={testId}
        />
      )
    case 'date':
      return (
        <Input
          id={inputId}
          type='date'
          min={field.validation?.min ? String(field.validation.min) : undefined}
          max={field.validation?.max ? String(field.validation.max) : undefined}
          value={value ? String(value).slice(0, 10) : ''}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={disabled}
          data-testid={testId}
        />
      )
    case 'boolean':
      return (
        <div className='flex h-9 items-center'>
          <Switch
            id={inputId}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
            data-testid={testId}
          />
        </div>
      )
    case 'select':
      return (
        <Select
          value={value ? String(value) : NONE}
          onValueChange={(next) => onChange(next === NONE ? null : next)}
          disabled={disabled}
        >
          <SelectTrigger id={inputId} data-testid={testId}>
            <SelectValue placeholder='Choose…' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'multi_select': {
      const selected = Array.isArray(value) ? value : []
      return (
        <div
          className='flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border p-2'
          data-testid={testId}
        >
          {(field.options ?? []).map((option) => {
            const checked = selected.includes(option.value)
            const optionId = `${inputId}-${option.value}`
            return (
              <label
                key={option.value}
                htmlFor={optionId}
                className='flex items-center gap-1.5 text-sm'
              >
                <Checkbox
                  id={optionId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(state) =>
                    onChange(
                      state === true
                        ? [...selected, option.value]
                        : selected.filter((item) => item !== option.value)
                    )
                  }
                />
                {option.label}
              </label>
            )
          })}
        </div>
      )
    }
    case 'user':
      return projectId ? (
        <UserPicker
          id={inputId}
          projectId={projectId}
          value={value ? String(value) : null}
          onChange={(userId) => onChange(userId)}
          disabled={disabled}
          testId={testId}
        />
      ) : (
        <Input id={inputId} disabled placeholder='Set on a project' />
      )
    case 'company':
      return projectId ? (
        <CompanyPicker
          id={inputId}
          projectId={projectId}
          value={value ? String(value) : null}
          onChange={(companyId) => onChange(companyId)}
          disabled={disabled}
          testId={testId}
        />
      ) : (
        <Input id={inputId} disabled placeholder='Set on a project' />
      )
    case 'url':
      return (
        <Input
          id={inputId}
          type='url'
          placeholder='https://'
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={disabled}
          data-testid={testId}
        />
      )
    default:
      return (
        <Input
          id={inputId}
          maxLength={field.validation?.maxLength ?? undefined}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={disabled}
          data-testid={testId}
        />
      )
  }
}

/**
 * The custom fields of one record as a form. Hidden fields and fields whose
 * condition does not hold (given the record context and the other values)
 * are left out, matching what the server will require.
 */
export function CustomFieldsForm({
  projectId,
  fields,
  values,
  onChange,
  context = {},
  disabled,
  columns = 2,
  className,
}: {
  projectId: string | null
  fields: CustomFieldSchemaField[]
  values: CustomFieldValues
  onChange: (next: CustomFieldValues) => void
  context?: Record<string, unknown>
  disabled?: boolean
  columns?: 1 | 2
  className?: string
}) {
  const shown = visibleFields(fields, values, context)
  if (shown.length === 0) return null
  return (
    <div
      className={cn('grid gap-3', columns === 2 && 'sm:grid-cols-2', className)}
      data-testid='uat-custom-fields-form'
    >
      {shown.map((field) => (
        <div
          key={field.key}
          className={cn(
            'space-y-1',
            (field.type === 'textarea' || field.type === 'multi_select') &&
              columns === 2 &&
              'sm:col-span-2'
          )}
        >
          <Label htmlFor={`cf-${field.key}`} className='text-xs'>
            {field.label}
            {field.required && <span className='text-destructive'> *</span>}
          </Label>
          <CustomFieldInput
            projectId={projectId}
            field={field}
            value={values[field.key]}
            onChange={(next) => onChange({ ...values, [field.key]: next })}
            disabled={disabled}
          />
          {field.description && (
            <p className='text-xs text-muted-foreground'>{field.description}</p>
          )}
        </div>
      ))}
    </div>
  )
}
