import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Loader2, ShieldAlert, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import type { PhotoRecord } from '../hooks/use-attachments'
import {
  useAnalyzePhoto,
  useApplyPhotoAnalysis,
  usePhotoAiStatus,
  usePhotoAnalysis,
  useRaisePhotoObservation,
  type PhotoAiLevel,
  type PhotoAiResult,
} from '../hooks/use-photo-assistant'

const levelVariant = (level: PhotoAiLevel) =>
  level === 'high'
    ? 'destructive'
    : level === 'medium'
      ? 'secondary'
      : 'outline'

/**
 * Inside the photo dialog: what the vision model sees — caption and tags to
 * apply, quality notes, and safety findings that can be raised as
 * observations (punch engine) with the photo attached as evidence.
 */
export function PhotoAnalysisPanel({
  projectId,
  photo,
  canEdit,
}: {
  projectId: string
  photo: PhotoRecord
  canEdit: boolean
}) {
  const { data: status } = usePhotoAiStatus(projectId)
  const { data: stored } = usePhotoAnalysis(projectId, photo.id)
  const analyze = useAnalyzePhoto(projectId)
  const apply = useApplyPhotoAnalysis(projectId)
  const raise = useRaisePhotoObservation(projectId)
  const canRaise = useCanPerform('punch', 'create')
  const [fresh, setFresh] = useState<PhotoAiResult | null>(null)
  const [raised, setRaised] = useState<
    Record<string, { ref: string; url: string }>
  >({})
  const result = fresh ?? stored ?? null
  const analysis = result?.analysis ?? null

  const run = async (force = false) => {
    try {
      setFresh(await analyze.mutateAsync({ photoId: photo.id, force }))
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  const applyPart = async (part: 'caption' | 'tags') => {
    if (!analysis) return
    try {
      await apply.mutateAsync({
        photoId: photo.id,
        ...(part === 'caption'
          ? { caption: analysis.caption, overwrite: true }
          : { tags: analysis.tags }),
      })
      toast.success(part === 'caption' ? 'Caption applied' : 'Tags added')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  const raiseFinding = async (
    finding: NonNullable<typeof analysis>['safety'][number]
  ) => {
    try {
      const created = await raise.mutateAsync({
        photoId: photo.id,
        hazard: finding.hazard,
        description: finding.description,
        severity: finding.severity,
      })
      setRaised((previous) => ({
        ...previous,
        [finding.hazard]: { ref: created.item.ref, url: created.url },
      }))
      toast.success(
        `${created.item.ref} raised${created.attached ? ' with this photo attached' : ''}`
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div
      className='space-y-2 rounded-md border border-dashed p-3'
      data-testid='uat-photo-ai'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Sparkles className='h-4 w-4 text-primary' />
        <p className='text-sm font-semibold'>What the assistant sees</p>
        {result?.analyzedAt && (
          <span className='text-xs text-muted-foreground'>
            {new Date(result.analyzedAt).toLocaleString()}
          </span>
        )}
        {canEdit && (
          <Button
            size='sm'
            variant='outline'
            className='ml-auto h-7'
            disabled={analyze.isPending || status?.enabled === false}
            onClick={() => run(Boolean(analysis))}
            data-testid='uat-photo-ai-analyze'
          >
            {analyze.isPending ? (
              <Loader2 className='mr-1 h-3 w-3 animate-spin' />
            ) : (
              <Sparkles className='mr-1 h-3 w-3' />
            )}
            {analysis ? 'Look again' : 'Analyse this photo'}
          </Button>
        )}
      </div>
      {status && !status.enabled && (
        <p className='text-xs text-muted-foreground'>
          No vision-capable AI provider is configured on this server.
        </p>
      )}
      {result?.degraded && result.reason && (
        <p className='text-xs text-muted-foreground'>{result.reason}</p>
      )}
      {analysis && (
        <div className='space-y-2 text-sm'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <Badge
              variant={levelVariant(analysis.confidence)}
              className='text-[10px]'
            >
              {analysis.confidence} confidence
            </Badge>
            {analysis.activity && (
              <Badge variant='outline'>{analysis.activity}</Badge>
            )}
            {analysis.locationHint && (
              <Badge variant='outline'>{analysis.locationHint}</Badge>
            )}
          </div>
          {analysis.scene && (
            <p className='text-xs text-muted-foreground'>{analysis.scene}</p>
          )}
          {analysis.caption && (
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs text-muted-foreground'>Caption:</span>
              <span data-testid='uat-photo-ai-caption'>{analysis.caption}</span>
              {canEdit && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-6 px-2 text-xs'
                  disabled={apply.isPending}
                  onClick={() => applyPart('caption')}
                  data-testid='uat-photo-ai-use-caption'
                >
                  Use caption
                </Button>
              )}
            </div>
          )}
          {analysis.tags.length > 0 && (
            <div className='flex flex-wrap items-center gap-1'>
              <span className='text-xs text-muted-foreground'>Tags:</span>
              {analysis.tags.map((tag) => (
                <Badge key={tag} variant='outline' className='text-[10px]'>
                  {tag}
                </Badge>
              ))}
              {canEdit && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-6 px-2 text-xs'
                  disabled={apply.isPending}
                  onClick={() => applyPart('tags')}
                  data-testid='uat-photo-ai-use-tags'
                >
                  Add tags
                </Button>
              )}
            </div>
          )}
          {analysis.quality.length > 0 && (
            <ul className='list-disc pl-4 text-xs'>
              {analysis.quality.map((note, index) => (
                <li key={index}>
                  {note.text}{' '}
                  <Badge
                    variant={levelVariant(note.severity)}
                    className='text-[10px]'
                  >
                    {note.severity}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {analysis.safety.length > 0 ? (
            <div className='space-y-1.5' data-testid='uat-photo-ai-safety'>
              <p className='flex items-center gap-1 text-xs font-medium'>
                <ShieldAlert className='h-3.5 w-3.5 text-destructive' /> Safety
                findings
              </p>
              {analysis.safety.map((finding) => {
                const done = raised[finding.hazard]
                const link = done ? workspaceLink(done.url) : null
                return (
                  <div
                    key={finding.hazard}
                    className={cn(
                      'rounded border p-2 text-xs',
                      finding.severity === 'high' && 'border-destructive/50'
                    )}
                    data-testid='uat-photo-ai-finding'
                  >
                    <div className='flex flex-wrap items-center gap-1.5'>
                      <span className='font-medium'>{finding.hazard}</span>
                      <Badge
                        variant={levelVariant(finding.severity)}
                        className='text-[10px]'
                      >
                        {finding.severity}
                      </Badge>
                      <span className='text-muted-foreground'>
                        {finding.confidence} confidence
                      </span>
                      {done && link ? (
                        <Link
                          to='/projects/$projectId'
                          params={{ projectId: link.projectId }}
                          search={link.search}
                          className='ml-auto underline-offset-2 hover:underline'
                        >
                          {done.ref}
                        </Link>
                      ) : (
                        canRaise && (
                          <Button
                            size='sm'
                            variant='outline'
                            className='ml-auto h-6 px-2'
                            disabled={raise.isPending}
                            onClick={() => raiseFinding(finding)}
                            data-testid='uat-photo-ai-raise'
                          >
                            <AlertTriangle className='mr-1 h-3 w-3' /> Raise
                            observation
                          </Button>
                        )
                      )}
                    </div>
                    {finding.description && (
                      <p className='mt-0.5 text-muted-foreground'>
                        {finding.description}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className='text-xs text-muted-foreground'>
              No safety hazard visible.
            </p>
          )}
          <AiRunFeedback
            projectId={projectId}
            messageId={result?.message?.id ?? null}
            initial={result?.message?.feedback ?? null}
            model={result?.message?.model}
          />
        </div>
      )}
    </div>
  )
}
