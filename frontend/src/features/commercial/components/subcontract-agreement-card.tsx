import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { apiClient } from '@/services/api/client'
import { Button } from '@/components/ui/button'

/**
 * The subcontract agreement, assembled rather than typed.
 *
 * Everything a subcontract says is already in the system by the time it is
 * written — our company, the vendor's profile, the project, the value, the
 * schedule of values, the programme, the insurance, and the scope matrix. This
 * prints it.
 *
 * The gaps are named, not counted: "not ready" without a list is a dead end,
 * and the person looking at this screen is the one who has to close them.
 */

type Agreement = {
  readiness: { ready: boolean; gaps: string[] }
  header: { title: string; ref: string }
  money: { currency: string; revised: number; retentionRate: number }
  scope: { status: string | null }
}

export function SubcontractAgreementCard({
  projectId,
  commitmentId,
  commitmentRef,
}: {
  projectId: string
  commitmentId: string
  commitmentRef: string
}) {
  const canExport = useCanPerform('commitment', 'export')
  const agreement = useQuery({
    queryKey: ['subcontract-agreement', projectId, commitmentId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/commitments/${commitmentId}/agreement`)
        .then((response) => response.data.data as Agreement),
    enabled: Boolean(projectId && commitmentId),
  })

  const download = async () => {
    try {
      const response = await apiClient.get(
        `/projects/${projectId}/commitments/${commitmentId}/agreement.pdf`,
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(response.data as Blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${commitmentRef}-subcontract-agreement.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  if (agreement.isPending) {
    return (
      <div className='flex justify-center rounded-md border py-8'>
        <Loader2 className='size-5 animate-spin text-muted-foreground' />
      </div>
    )
  }
  if (!agreement.data) return null

  const { readiness } = agreement.data

  return (
    <div className='rounded-md border p-3' data-testid='uat-subcontract-agreement'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-sm font-medium'>Subcontract agreement</p>
          <p className='text-xs text-muted-foreground'>
            Assembled from the vendor profile, the schedule of values, the programme,
            the insurance requirements and the agreed scope. Nothing is retyped.
          </p>
        </div>
        {canExport && (
          <Button size='sm' variant='outline' onClick={download} data-testid='uat-agreement-download'>
            <Download className='me-1.5 size-3.5' />
            {readiness.ready ? 'Generate agreement' : 'Generate draft'}
          </Button>
        )}
      </div>

      {readiness.ready ? (
        <p
          className='mt-3 flex items-center gap-1.5 text-sm text-success-foreground'
          data-testid='uat-agreement-ready'
        >
          <CheckCircle2 className='size-4' />
          Ready to issue for signature.
        </p>
      ) : (
        <div className='mt-3' data-testid='uat-agreement-gaps'>
          <p className='flex items-center gap-1.5 text-sm text-warning-foreground'>
            <AlertTriangle className='size-4' />
            Outstanding before this should be signed:
          </p>
          <ul className='mt-1.5 space-y-1'>
            {readiness.gaps.map((gap) => (
              <li key={gap} className='ps-6 text-sm text-muted-foreground'>
                {gap}
              </li>
            ))}
          </ul>
          <p className='mt-2 ps-6 text-xs text-muted-foreground'>
            A draft can still be generated for review; it is stamped so nobody signs it
            by mistake.
          </p>
        </div>
      )}
    </div>
  )
}
