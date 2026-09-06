import { Link2, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  LINK_RECORD_LABEL,
  fmtQuantity,
  useBimElement,
  useDeleteBimLink,
} from '../hooks/use-bim'
import { BimLinkActions } from './bim-link-actions'

/** One element: where it is, what it is made of, its properties, quantities and links. */
export function BimElementDialog({
  projectId,
  modelId,
  elementId,
  units,
  onOpenChange,
}: {
  projectId: string
  modelId: string
  elementId: string | null
  units: Record<string, string>
  onOpenChange: (open: boolean) => void
}) {
  const canLink = useCanPerform('bim', 'update', 'bim.link')
  const { data: element, isLoading } = useBimElement(
    projectId,
    modelId,
    elementId
  )
  const removeLink = useDeleteBimLink(projectId)

  const quantityRows: Array<[string, string]> = element
    ? (
        [
          [
            'Net volume',
            fmtQuantity(element.quantities.netVolume, units.volume),
          ],
          [
            'Gross volume',
            fmtQuantity(element.quantities.grossVolume, units.volume),
          ],
          ['Net area', fmtQuantity(element.quantities.netArea, units.area)],
          ['Gross area', fmtQuantity(element.quantities.grossArea, units.area)],
          ['Length', fmtQuantity(element.quantities.length, units.length)],
          ['Width', fmtQuantity(element.quantities.width, units.length)],
          ['Height', fmtQuantity(element.quantities.height, units.length)],
          [
            'Perimeter',
            fmtQuantity(element.quantities.perimeter, units.length),
          ],
          ['Weight', fmtQuantity(element.quantities.weight, units.mass)],
          ['Count', fmtQuantity(element.quantities.count)],
        ] as Array<[string, string]>
      ).filter(([, value]) => value !== '—')
    : []

  return (
    <Dialog open={Boolean(elementId)} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-bim-element-dialog'
      >
        {isLoading || !element ? (
          <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className='pr-6'>
                {element.name || element.typeLabel}
              </DialogTitle>
              <DialogDescription>
                {[
                  element.typeLabel,
                  element.typeName,
                  element.tag && `Tag ${element.tag}`,
                  element.spatialPath,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </DialogDescription>
            </DialogHeader>

            <div className='flex flex-wrap items-center gap-1.5'>
              <Badge variant='outline' className='font-mono text-[10px]'>
                {element.globalId}
              </Badge>
              {element.predefinedType && (
                <Badge variant='outline' className='text-[10px]'>
                  {element.predefinedType}
                </Badge>
              )}
              {element.materials.map((material) => (
                <Badge key={material} variant='outline' className='text-[10px]'>
                  {material}
                </Badge>
              ))}
            </div>

            {quantityRows.length > 0 && (
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                {quantityRows.map(([label, value]) => (
                  <div key={label} className='rounded border p-2'>
                    <p className='text-[11px] text-muted-foreground'>{label}</p>
                    <p className='font-medium tabular-nums'>{value}</p>
                  </div>
                ))}
              </div>
            )}

            <div
              className='rounded-md border'
              data-testid='uat-bim-element-links'
            >
              <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
                <Link2 className='h-4 w-4' />
                <p className='flex-1 text-sm font-medium'>
                  Linked to {element.linkCount} record
                  {element.linkCount === 1 ? '' : 's'}
                </p>
                <BimLinkActions
                  projectId={projectId}
                  modelId={modelId}
                  elementIds={[element.id]}
                  label='Link this element'
                />
              </div>
              {(element.links ?? []).length === 0 ? (
                <p className='p-3 text-sm text-muted-foreground'>
                  Not linked yet. Tie it to an activity to put it on the
                  schedule.
                </p>
              ) : (
                (element.links ?? []).map((link) => (
                  <div
                    key={link.id}
                    className='flex items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0'
                  >
                    <Badge variant='outline' className='text-[10px]'>
                      {LINK_RECORD_LABEL[link.recordType] ?? link.recordType}
                    </Badge>
                    {link.recordPath ? (
                      <a
                        href={link.recordPath}
                        className='min-w-0 flex-1 truncate text-primary hover:underline'
                      >
                        {link.recordTitle || link.recordId}
                      </a>
                    ) : (
                      <span className='min-w-0 flex-1 truncate'>
                        {link.recordTitle || link.recordId}
                      </span>
                    )}
                    {canLink && (
                      <button
                        type='button'
                        className='rounded p-1 hover:bg-muted'
                        aria-label='Remove link'
                        disabled={removeLink.isPending}
                        onClick={() =>
                          removeLink
                            .mutateAsync({ modelId, linkId: link.id })
                            .then(() => toast.success('Link removed'))
                            .catch((error) =>
                              toast.error(getServerErrorMessage(error))
                            )
                        }
                      >
                        <Trash2 className='h-3.5 w-3.5' />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {Object.entries(element.properties ?? {}).map(
              ([setName, values]) => (
                <div key={setName} className='rounded-md border'>
                  <p className='border-b px-3 py-1.5 text-xs font-medium'>
                    {setName}
                  </p>
                  <table className='w-full text-sm'>
                    <tbody>
                      {Object.entries(values).map(([key, value]) => (
                        <tr key={key} className='border-b last:border-b-0'>
                          <td className='w-1/2 px-3 py-1 text-muted-foreground'>
                            {key}
                          </td>
                          <td className='px-3 py-1'>{String(value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {Object.keys(element.properties ?? {}).length === 0 && (
              <p className='text-xs text-muted-foreground'>
                The model carries no property set for this element.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
