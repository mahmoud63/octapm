import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { Copy, Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * A printable QR label for a sheet. Stuck on the wall, it opens the punch
 * list on a phone with this drawing pre-selected so items can be logged on
 * the spot.
 */
export function SheetQrDialog({
  projectId,
  sheet,
  onOpenChange,
}: {
  projectId: string
  sheet: { id: string; number: string; title: string } | null
  onOpenChange: (open: boolean) => void
}) {
  const sheetId = sheet?.id ?? null
  const { data: svg, isLoading } = useQuery<string>({
    queryKey: ['sheet-qr', projectId, sheetId],
    queryFn: async () => {
      const { data } = await apiClient.get<string>(
        `/projects/${projectId}/drawings/sheets/${sheetId}/qr.svg`,
        { responseType: 'text' }
      )
      return data
    },
    enabled: Boolean(projectId && sheetId),
    staleTime: 10 * 60_000,
  })
  const link = sheetId
    ? `${window.location.origin}/projects/${projectId}/quality/defects?source=sheet_qr&recordId=${sheetId}`
    : ''

  const print = () => {
    if (!svg) return
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy the link')
    }
  }

  return (
    <Dialog
      open={Boolean(sheet)}
      onOpenChange={(next) => (next ? undefined : onOpenChange(false))}
    >
      <DialogContent data-testid='uat-sheet-qr-dialog'>
        <DialogHeader>
          <DialogTitle>QR label · {sheet?.number}</DialogTitle>
          <DialogDescription>
            Print and stick it on site. Scanning opens the punch list with{' '}
            {sheet?.number} pre-selected; anyone without access is asked to sign
            in first.
          </DialogDescription>
        </DialogHeader>
        <div className='flex justify-center rounded border bg-white p-4'>
          {isLoading || !svg ? (
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          ) : (
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
              alt={`QR code for sheet ${sheet?.number ?? ''}`}
              className='h-56 w-56'
            />
          )}
        </div>
        <p className='truncate text-xs text-muted-foreground'>{link}</p>
        <DialogFooter className='gap-2'>
          <Button variant='outline' onClick={copy}>
            <Copy className='mr-2 h-4 w-4' /> Copy link
          </Button>
          <Button
            onClick={print}
            disabled={!svg}
            data-testid='uat-sheet-qr-print'
          >
            <Printer className='mr-2 h-4 w-4' /> Open to print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
