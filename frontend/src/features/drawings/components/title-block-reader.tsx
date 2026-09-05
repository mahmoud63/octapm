import { useRef, useState } from 'react'
import { Loader2, ScanText } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import {
  renderRevisionImage,
  useDrawingAiStatus,
  useReadTitleBlocks,
  type TitleBlockProposal,
} from '../hooks/use-drawing-assistant'
import type { SheetRevision } from '../hooks/use-drawings'

/** Title blocks are small text on a large sheet — render wide. */
const READ_WIDTH = 2200

/**
 * Reads the title blocks of the pages the automatic reader could not — no
 * text layer, low confidence or no number — with the vision provider and
 * hands each proposal back to the review grid as an editable draft.
 */
export function TitleBlockReader({
  projectId,
  setId,
  candidates,
  onProposal,
}: {
  projectId: string
  setId: string
  /** Pending pages worth reading, best first. */
  candidates: SheetRevision[]
  onProposal: (revisionId: string, proposal: TitleBlockProposal) => void
}) {
  const { data: status } = useDrawingAiStatus(projectId)
  const read = useReadTitleBlocks(projectId, setId)
  const [progress, setProgress] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  if (!status?.vision || candidates.length === 0) return null
  const batch = candidates.slice(0, status.pageLimit)
  const busy = progress !== null || read.isPending

  const run = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    const pages: Array<{ revisionId: string; image: string }> = []
    try {
      for (const [index, row] of batch.entries()) {
        setProgress(
          `Rendering page ${row.pageNumber} (${index + 1}/${batch.length})`
        )
        const image = await renderRevisionImage(
          row,
          READ_WIDTH,
          controller.signal
        )
        if (controller.signal.aborted) return
        if (image) pages.push({ revisionId: row.id, image })
      }
      if (!pages.length) {
        toast.error('None of the pages could be rendered')
        return
      }
      setProgress(
        `Reading ${pages.length} title block${pages.length === 1 ? '' : 's'}…`
      )
      const result = await read.mutateAsync({ pages })
      if (result.degraded) {
        toast.error(result.reason || 'The assistant is not available')
        return
      }
      let filled = 0
      for (const item of result.items) {
        if (item.proposal && (item.proposal.number || item.proposal.title)) {
          onProposal(item.revisionId, item.proposal)
          filled += 1
        }
      }
      const failed = result.items.filter((item) => item.error).length
      toast.success(
        `${filled} page${filled === 1 ? '' : 's'} filled in — check and save` +
          (failed ? ` · ${failed} could not be read` : '')
      )
    } catch (error) {
      if (!controller.signal.aborted) toast.error(getServerErrorMessage(error))
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  return (
    <span className='inline-flex items-center gap-2'>
      <Button
        size='sm'
        variant='outline'
        disabled={busy}
        onClick={run}
        title={`Read the title blocks of ${batch.length} page${batch.length === 1 ? '' : 's'} the automatic reader could not (rendered here, read by ${status.model || status.provider || 'the AI provider'})`}
        data-testid='uat-drawing-ai-read'
      >
        {busy ? (
          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
        ) : (
          <ScanText className='mr-2 h-4 w-4' />
        )}
        Read with AI ({batch.length})
      </Button>
      {progress && (
        <span className='text-xs text-muted-foreground'>{progress}</span>
      )}
    </span>
  )
}
