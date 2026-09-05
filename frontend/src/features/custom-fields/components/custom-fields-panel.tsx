import { useState } from 'react'
import { Loader2, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform, type PermissionModule } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  formatCustomValue,
  useCustomFieldValues,
  useSetCustomFieldValues,
  visibleFields,
  type CustomFieldValues,
  type CustomFieldValuesResponse,
} from '../hooks/use-custom-fields'
import { CustomFieldsForm } from './custom-field-inputs'

function PanelBody({
  projectId,
  recordType,
  recordId,
  recordTypeKey,
  context,
  data,
  canEdit,
  compact,
}: {
  projectId: string
  recordType: string
  recordId: string
  recordTypeKey: string | null
  context: Record<string, unknown>
  data: CustomFieldValuesResponse
  canEdit: boolean
  compact: boolean
}) {
  const save = useSetCustomFieldValues(projectId)
  const [draft, setDraft] = useState<CustomFieldValues>(() => ({
    ...data.values,
  }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.values)

  if (!canEdit) {
    const shown = visibleFields(data.fields, data.values, context)
    return (
      <dl
        className={cn(
          'grid gap-x-4 gap-y-1 text-sm',
          !compact && 'sm:grid-cols-2'
        )}
      >
        {shown.map((field) => (
          <div key={field.key} className='flex justify-between gap-3'>
            <dt className='text-muted-foreground'>{field.label}</dt>
            <dd className='text-right'>
              {formatCustomValue(field, data.values[field.key])}
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <div className='space-y-2'>
      <CustomFieldsForm
        projectId={projectId}
        fields={data.fields}
        values={draft}
        onChange={setDraft}
        context={context}
        columns={compact ? 1 : 2}
        disabled={save.isPending}
      />
      {dirty && (
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={save.isPending}
            onClick={() => setDraft({ ...data.values })}
          >
            Discard
          </Button>
          <Button
            type='button'
            size='sm'
            disabled={save.isPending}
            data-testid='uat-custom-fields-save'
            onClick={async () => {
              try {
                await save.mutateAsync({
                  recordType,
                  recordId,
                  values: draft,
                  recordTypeKey,
                  context,
                })
                toast.success('Fields saved')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {save.isPending && (
              <Loader2 className='mr-1 h-3 w-3 animate-spin' />
            )}
            Save fields
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Custom fields of one existing record: loads the schema that applies here
 * (company + project fields, fieldset, record type) with the stored values,
 * and saves edits. Renders nothing when the record type has no fields.
 */
export function CustomFieldsPanel({
  projectId,
  recordType,
  recordId,
  recordTypeKey = null,
  context = {},
  compact = false,
  title = 'Custom fields',
  className,
}: {
  projectId: string
  recordType: string
  recordId: string
  recordTypeKey?: string | null
  context?: Record<string, unknown>
  compact?: boolean
  title?: string
  className?: string
}) {
  const { data, isLoading } = useCustomFieldValues(
    projectId,
    recordType,
    recordId,
    recordTypeKey
  )
  const moduleName = (data?.module ?? 'custom_field') as PermissionModule
  const canEdit = useCanPerform(moduleName, 'update')
  if (isLoading || !data || data.fields.length === 0) return null
  const shown = visibleFields(data.fields, data.values, context)
  if (shown.length === 0 && !canEdit) return null

  return (
    <section
      className={cn('space-y-2', className)}
      data-testid='uat-custom-fields-panel'
    >
      <h4 className='flex items-center gap-2 text-sm font-semibold'>
        <SlidersHorizontal className='h-4 w-4' />
        {title}
        {data.fieldset && (
          <span className='text-xs font-normal text-muted-foreground'>
            · {data.fieldset.name}
          </span>
        )}
      </h4>
      <PanelBody
        key={`${recordId}-${JSON.stringify(data.values)}`}
        projectId={projectId}
        recordType={recordType}
        recordId={recordId}
        recordTypeKey={recordTypeKey}
        context={context}
        data={data}
        canEdit={canEdit}
        compact={compact}
      />
    </section>
  )
}
