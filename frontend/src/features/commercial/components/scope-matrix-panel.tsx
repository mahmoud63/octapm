import { useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ALLOCATED_KINDS,
  KIND_LABEL,
  PARTIES,
  PARTY_SHORT,
  SCOPE_KINDS,
  useSaveScopeMatrix,
  useScopeDecision,
  useScopeMatrix,
  type ScopeItem,
  type ScopeKind,
  type ScopeParty,
} from '../hooks/use-scope-matrix'

/**
 * Scope and responsibility.
 *
 * Construction disputes come overwhelmingly from unclear boundaries — who
 * supplies the crane, who takes the waste away, who calls the inspection. Each
 * one is a row here with a party against it, and the matrix cannot be agreed
 * while any row of work is still unowned.
 *
 * The allocation is radio buttons across the parties rather than a dropdown,
 * because the question being asked is "which of these", and a column of ticks
 * is the shape a QS already reads a scope matrix in.
 */

type Draft = ScopeItem & { key: string }

const blank = (kind: ScopeKind, sortOrder: number): Draft => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  id: '',
  kind,
  section: null,
  description: '',
  responsibility: null,
  responsibilityLabel: null,
  notes: null,
  sortOrder,
})

export function ScopeMatrixPanel({
  projectId,
  commitmentId,
}: {
  projectId: string
  commitmentId: string
}) {
  const matrix = useScopeMatrix(projectId, commitmentId)

  if (matrix.isPending) {
    return (
      <div className='flex justify-center py-16'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )
  }
  if (!matrix.data) {
    return (
      <p className='py-10 text-center text-sm text-muted-foreground'>
        The scope matrix could not be loaded.
      </p>
    )
  }

  // Remount when the stored matrix actually changes — after a save, an agree,
  // or somebody else adding a row — so the editor starts from the server's
  // rows without an effect resetting state behind the user.
  return (
    <MatrixEditor
      key={`${matrix.data.id}:${matrix.data.status}:${matrix.data.items.length}`}
      projectId={projectId}
      commitmentId={commitmentId}
      data={matrix.data}
    />
  )
}

function MatrixEditor({
  projectId,
  commitmentId,
  data,
}: {
  projectId: string
  commitmentId: string
  data: NonNullable<ReturnType<typeof useScopeMatrix>['data']>
}) {
  const save = useSaveScopeMatrix(projectId, commitmentId)
  const decide = useScopeDecision(projectId, commitmentId)
  const canManage = useCanPerform('commitment', 'update', 'scope.manage')
  const canAgree = useCanPerform('commitment', 'approve', 'scope.agree')

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    data.items.map((item, index) => ({ ...item, key: item.id || `row-${index}` }))
  )
  const [reason, setReason] = useState('')

  const agreed = data.status === 'agreed'
  const editable = canManage && !agreed

  const unallocated = drafts.filter(
    (row) => ALLOCATED_KINDS.includes(row.kind) && !row.responsibility
  )

  const set = (key: string, patch: Partial<Draft>) =>
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const submit = async () => {
    const rows = drafts.filter((row) => row.description.trim())
    try {
      await save.mutateAsync({
        items: rows.map((row, index) => ({
          kind: row.kind,
          section: row.section,
          description: row.description.trim(),
          responsibility: row.responsibility,
          notes: row.notes,
          sortOrder: index,
        })),
      })
      toast.success('Scope saved')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const decision = async (action: 'agree' | 'reopen') => {
    try {
      await decide.mutateAsync({ action, ...(reason.trim() ? { reason: reason.trim() } : {}) })
      toast.success(action === 'agree' ? 'Scope agreed' : 'Scope reopened')
      setReason('')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='space-y-4' data-testid='uat-scope-matrix'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h3 className='font-display text-base font-semibold'>{data.title}</h3>
          <p className='text-sm text-muted-foreground'>
            {agreed
              ? 'Agreed. The subcontract quotes this, so reopening it needs a reason.'
              : 'Every row of work needs a party against it before this can be agreed.'}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {unallocated.length > 0 && (
            <span
              className='rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning-foreground'
              data-testid='uat-scope-unallocated'
            >
              {unallocated.length} unallocated
            </span>
          )}
          {agreed && (
            <span className='rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success-foreground'>
              Agreed
            </span>
          )}
        </div>
      </div>

      {SCOPE_KINDS.map((kind) => {
        const rows = drafts.filter((row) => row.kind === kind)
        if (!rows.length && !editable) return null
        const allocates = ALLOCATED_KINDS.includes(kind)

        return (
          <div key={kind} className='rounded-md border' data-testid={`uat-scope-${kind}`}>
            <div className='flex items-center justify-between border-b bg-surface px-3 py-2'>
              <p className='text-[11px] font-medium tracking-wide text-muted-foreground uppercase'>
                {KIND_LABEL[kind]}
              </p>
              {editable && (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setDrafts((current) => [...current, blank(kind, current.length)])}
                  data-testid={`uat-scope-add-${kind}`}
                >
                  <Plus className='me-1 size-3.5' />
                  Add
                </Button>
              )}
            </div>

            <div className='overflow-x-auto'>
              <table className='w-full min-w-[720px] text-sm'>
                {allocates && (
                  <thead className='text-[11px] tracking-wide text-muted-foreground uppercase'>
                    <tr>
                      <th className='px-3 py-1.5 text-start'>Item</th>
                      {PARTIES.map((party) => (
                        <th key={party} className='px-2 py-1.5 text-center'>
                          {PARTY_SHORT[party]}
                        </th>
                      ))}
                      <th className='px-3 py-1.5 text-start'>Notes</th>
                      {editable && <th className='w-8' />}
                    </tr>
                  </thead>
                )}
                <tbody className='divide-y'>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      // The description lives in an input while the matrix is a
                      // draft and in a cell once it is agreed, so the row
                      // carries it as an attribute for anything that needs to
                      // find it either way.
                      data-scope-row={row.description}
                      className={cn(
                        allocates && !row.responsibility && 'bg-warning/5'
                      )}
                    >
                      <td className='px-3 py-1.5'>
                        {editable ? (
                          <Input
                            value={row.description}
                            onChange={(event) => set(row.key, { description: event.target.value })}
                            className='h-8'
                            placeholder='What is it?'
                          />
                        ) : (
                          <span>{row.description}</span>
                        )}
                        {row.section && (
                          <span className='ms-2 text-[11px] text-muted-foreground'>
                            {row.section}
                          </span>
                        )}
                      </td>

                      {allocates &&
                        PARTIES.map((party) => (
                          <td key={party} className='px-2 py-1.5 text-center'>
                            <input
                              type='radio'
                              name={`scope-${row.key}`}
                              checked={row.responsibility === party}
                              disabled={!editable}
                              onChange={() => set(row.key, { responsibility: party as ScopeParty })}
                              aria-label={`${row.description || 'Row'}: ${PARTY_SHORT[party]}`}
                              data-testid={`uat-scope-party-${party}`}
                              className='size-4 accent-[var(--brand-accent)]'
                            />
                          </td>
                        ))}

                      <td className='px-3 py-1.5'>
                        {editable ? (
                          <Input
                            value={row.notes ?? ''}
                            onChange={(event) => set(row.key, { notes: event.target.value })}
                            className='h-8'
                          />
                        ) : (
                          <span className='text-muted-foreground'>{row.notes ?? ''}</span>
                        )}
                      </td>

                      {editable && (
                        <td className='px-1 py-1.5'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='size-7'
                            onClick={() =>
                              setDrafts((current) => current.filter((item) => item.key !== row.key))
                            }
                            aria-label={`Remove ${row.description || 'row'}`}
                          >
                            <Trash2 className='size-3.5' />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={allocates ? PARTIES.length + 3 : 3}
                        className='px-3 py-4 text-center text-sm text-muted-foreground'
                      >
                        Nothing listed.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      <div className='flex flex-wrap items-end gap-2'>
        {agreed && canAgree && (
          <div className='min-w-56 flex-1'>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder='Why is the agreed scope being reopened?'
              data-testid='uat-scope-reopen-reason'
            />
          </div>
        )}
        {editable && (
          <Button onClick={submit} disabled={save.isPending} data-testid='uat-scope-save'>
            {save.isPending && <Loader2 className='me-1.5 size-4 animate-spin' />}
            Save scope
          </Button>
        )}
        {canAgree && !agreed && (
          <Button
            variant='outline'
            onClick={() => decision('agree')}
            disabled={decide.isPending}
            data-testid='uat-scope-agree'
          >
            Agree scope
          </Button>
        )}
        {canAgree && agreed && (
          <Button
            variant='outline'
            onClick={() => decision('reopen')}
            disabled={decide.isPending || !reason.trim()}
            data-testid='uat-scope-reopen'
          >
            Reopen
          </Button>
        )}
      </div>
    </div>
  )
}
