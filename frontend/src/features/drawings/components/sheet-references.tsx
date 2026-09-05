import { ArrowLeftRight, Link2, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  useBuildSheetReferences,
  useSheetReferences,
  type SheetReference,
} from '../hooks/use-drawing-assistant'

function ReferenceChip({
  reference,
  direction,
  onOpenSheet,
}: {
  reference: SheetReference
  direction: 'outgoing' | 'incoming'
  onOpenSheet?: (sheetId: string) => void
}) {
  const target =
    direction === 'outgoing' ? reference.targetSheet : reference.sheet
  const label = target?.number ?? reference.targetNumber
  const title = [
    target
      ? `${target.number} — ${target.title ?? ''}`.trim()
      : `${reference.targetNumber} is not a sheet of this project yet`,
    reference.count > 1 ? `${reference.count} mentions` : null,
    reference.samples[0] ? `“${reference.samples[0]}”` : null,
  ]
    .filter(Boolean)
    .join('\n')
  if (target && onOpenSheet) {
    return (
      <button
        type='button'
        className='inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs hover:bg-muted'
        title={title}
        onClick={() => onOpenSheet(target.id)}
        data-testid='uat-sheet-reference'
      >
        {label}
        {target.status === 'obsolete' && (
          <Badge variant='destructive' className='px-1 py-0 text-[10px]'>
            obsolete
          </Badge>
        )}
        {reference.count > 1 && (
          <span className='text-muted-foreground'>×{reference.count}</span>
        )}
      </button>
    )
  }
  return (
    <span
      className='inline-flex items-center gap-1 rounded border border-dashed px-2 py-0.5 font-mono text-xs text-muted-foreground'
      title={title}
      data-testid='uat-sheet-reference'
    >
      {label}
    </span>
  )
}

/**
 * Cross-references of the open sheet: the sheets it calls out (from the
 * text layer of its current revision) and the sheets that call it out.
 * Each chip opens the sheet in the viewer.
 */
export function SheetReferencesPanel({
  projectId,
  sheetId,
  onOpenSheet,
}: {
  projectId: string
  sheetId: string
  onOpenSheet?: (sheetId: string) => void
}) {
  const { data, isLoading } = useSheetReferences(projectId, sheetId)
  const canBuild = useCanPerform(
    'document_control',
    'submit',
    'document.revision.upload'
  )
  const build = useBuildSheetReferences(projectId)

  const rebuild = () =>
    build.mutate(sheetId, {
      onSuccess: (result) =>
        toast.success(
          result.textStatus === 'no_text'
            ? 'This revision has no text layer — references cannot be read from it'
            : result.textStatus === 'no_revision'
              ? 'Publish a revision first'
              : `${result.built} reference${result.built === 1 ? '' : 's'} found`
        ),
      onError: (error) => toast.error(getServerErrorMessage(error)),
    })

  const outgoing = data?.outgoing ?? []
  const incoming = data?.incoming ?? []
  const empty = !isLoading && outgoing.length === 0 && incoming.length === 0

  return (
    <div
      className='flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-1.5 text-xs'
      data-testid='uat-sheet-references'
    >
      <span className='inline-flex items-center gap-1 text-muted-foreground'>
        <Link2 className='h-3.5 w-3.5' /> References
      </span>
      {isLoading && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
      {outgoing.length > 0 && (
        <span className='inline-flex flex-wrap items-center gap-1'>
          {outgoing.map((reference) => (
            <ReferenceChip
              key={reference.id}
              reference={reference}
              direction='outgoing'
              onOpenSheet={onOpenSheet}
            />
          ))}
        </span>
      )}
      {incoming.length > 0 && (
        <span className='inline-flex flex-wrap items-center gap-1'>
          <span
            className='inline-flex items-center gap-1 text-muted-foreground'
            title='Sheets that call out this one'
          >
            <ArrowLeftRight className='h-3.5 w-3.5' /> Referenced by
          </span>
          {incoming.map((reference) => (
            <ReferenceChip
              key={reference.id}
              reference={reference}
              direction='incoming'
              onOpenSheet={onOpenSheet}
            />
          ))}
        </span>
      )}
      {empty && (
        <span className='text-muted-foreground'>
          {data?.builtAt
            ? 'No sheet callouts found on this revision.'
            : canBuild
              ? 'Not read yet.'
              : 'None recorded.'}
        </span>
      )}
      {canBuild && (
        <Button
          size='sm'
          variant='ghost'
          className='ml-auto h-6 px-2 text-xs'
          disabled={build.isPending}
          onClick={rebuild}
          title='Read the sheet numbers and detail callouts on the current revision'
          data-testid='uat-sheet-references-build'
        >
          {build.isPending ? (
            <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
          ) : (
            <RefreshCw className='mr-1 h-3.5 w-3.5' />
          )}
          {data?.builtAt ? 'Re-read' : 'Find references'}
        </Button>
      )}
    </div>
  )
}
