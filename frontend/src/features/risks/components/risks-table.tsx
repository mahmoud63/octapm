import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  type RiskPayload,
  type RiskRecord,
  useCreateRisk,
  useDeleteRisk,
  useRisks,
  useUpdateRisk,
} from '../hooks/use-risks'
import { RiskFormDialog } from './risk-form-dialog'

const severityClassMap: Record<RiskRecord['severity'], string> = {
  LOW: 'bg-green-100 text-green-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
}

const statusClassMap: Record<RiskRecord['status'], string> = {
  open: 'bg-red-100 text-red-700',
  monitoring: 'bg-amber-100 text-amber-700',
  closed: 'bg-green-100 text-green-700',
}

export function RisksTable({ projectId }: { projectId: string }) {
  const { data: risks = [], isLoading } = useRisks(projectId)
  const createRisk = useCreateRisk(projectId)
  const updateRisk = useUpdateRisk(projectId)
  const deleteRisk = useDeleteRisk(projectId)

  const [editingRisk, setEditingRisk] = useState<RiskRecord | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>Loading risks…</p>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-semibold'>Risk Register</h3>
        <Button size='sm' onClick={() => setCreateOpen(true)}>
          Add Risk
        </Button>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm whitespace-nowrap'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>Ref</th>
              <th className='p-2 text-left font-medium'>Description</th>
              <th className='p-2 text-center font-medium'>Probability</th>
              <th className='p-2 text-center font-medium'>Impact</th>
              <th className='p-2 text-center font-medium'>Severity</th>
              <th className='p-2 text-left font-medium'>Mitigation</th>
              <th className='p-2 text-left font-medium'>Phase</th>
              <th className='p-2 text-left font-medium'>Owner</th>
              <th className='p-2 text-center font-medium'>Status</th>
              <th className='p-2 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {risks.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className='p-6 text-center text-muted-foreground'
                >
                  No risks available.
                </td>
              </tr>
            ) : (
              risks.map((risk) => (
                <tr key={risk.id} className='border-b hover:bg-muted/30'>
                  <td className='p-2 font-mono text-xs font-semibold text-blue-600'>
                    {risk.ref}
                  </td>
                  <td
                    className='max-w-80 truncate p-2'
                    title={risk.description}
                  >
                    {risk.description}
                  </td>
                  <td className='p-2 text-center capitalize'>
                    {risk.probability}
                  </td>
                  <td className='p-2 text-center capitalize'>{risk.impact}</td>
                  <td className='p-2 text-center'>
                    <Badge className={severityClassMap[risk.severity]}>
                      {risk.severity}
                    </Badge>
                  </td>
                  <td
                    className='max-w-60 truncate p-2 text-muted-foreground'
                    title={risk.mitigation || ''}
                  >
                    {risk.mitigation || '—'}
                  </td>
                  <td className='p-2 text-muted-foreground'>
                    {risk.phase || '—'}
                  </td>
                  <td className='p-2 text-muted-foreground'>
                    {risk.owner || '—'}
                  </td>
                  <td className='p-2 text-center'>
                    <Badge className={statusClassMap[risk.status]}>
                      {risk.status}
                    </Badge>
                  </td>
                  <td className='p-2 text-right'>
                    <div className='flex justify-end gap-1'>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => setEditingRisk(risk)}
                      >
                        Edit
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        className='text-red-600 hover:text-red-700'
                        onClick={async () => {
                          const confirmed = window.confirm('Delete this risk?')
                          if (!confirmed) return

                          try {
                            await deleteRisk.mutateAsync(risk.id)
                            toast.success('Risk deleted')
                          } catch {
                            toast.error('Failed to delete risk')
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <RiskFormDialog
        key={`risk-create-${createOpen ? 'open' : 'closed'}`}
        open={createOpen}
        onOpenChange={setCreateOpen}
        isSaving={createRisk.isPending}
        onSubmit={async (payload: RiskPayload) => {
          try {
            await createRisk.mutateAsync(payload)
            toast.success('Risk created')
            setCreateOpen(false)
          } catch {
            toast.error('Failed to create risk')
          }
        }}
      />

      <RiskFormDialog
        key={editingRisk ? `risk-edit-${editingRisk.id}` : 'risk-edit-empty'}
        open={Boolean(editingRisk)}
        onOpenChange={(open) => {
          if (!open) setEditingRisk(null)
        }}
        initialRisk={editingRisk}
        isSaving={updateRisk.isPending}
        onSubmit={async (payload: RiskPayload) => {
          if (!editingRisk) return

          try {
            await updateRisk.mutateAsync({ riskId: editingRisk.id, payload })
            toast.success('Risk updated')
            setEditingRisk(null)
          } catch {
            toast.error('Failed to update risk')
          }
        }}
      />
    </div>
  )
}
