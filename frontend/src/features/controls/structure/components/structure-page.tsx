import * as React from 'react'
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FolderTree,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Ruler,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  normaliseUnit,
  unitDimensions,
  useArchiveWbsNode,
  useCreateUnit,
  useCreateWbsNode,
  useRestoreWbsNode,
  useUnits,
  useUpdateWbsNode,
  useWbsNodes,
  type UnitDimension,
  type WbsNodeRecord,
  type WbsTreeNode,
} from '../hooks/use-structure'

/**
 * Project Controls › Structure (PC-1): the WBS tree editor and the
 * organisation's units of measure.
 *
 * The tree is what BOQ rows and activities are grouped by. A node flagged as
 * a package is the scope one party delivers under one commitment; there is
 * no separate package record. Nothing here rewrites an activity's imported
 * WBS code — activation links activities to nodes, and this page edits the
 * nodes.
 */

const NONE = '__none__'

type EditorState =
  | { mode: 'create'; parent: WbsNodeRecord | null }
  | { mode: 'edit'; node: WbsNodeRecord }
  | null

const isInSubtree = (candidate: WbsNodeRecord, root: WbsNodeRecord) =>
  candidate.path === root.path || candidate.path.startsWith(`${root.path}/`)

function WbsNodeEditor({
  projectId,
  state,
  nodes,
  onClose,
}: {
  projectId: string
  state: EditorState
  nodes: WbsNodeRecord[]
  onClose: () => void
}) {
  const create = useCreateWbsNode(projectId)
  const update = useUpdateWbsNode(projectId)
  const isEdit = state?.mode === 'edit'
  const editing = state?.mode === 'edit' ? state.node : null

  const [code, setCode] = React.useState('')
  const [name, setName] = React.useState('')
  const [parentId, setParentId] = React.useState<string>(NONE)
  const [isPackage, setIsPackage] = React.useState(false)
  const [ownerPartyId, setOwnerPartyId] = React.useState('')
  const [commitmentId, setCommitmentId] = React.useState('')

  React.useEffect(() => {
    if (!state) return
    if (state.mode === 'edit') {
      setCode(state.node.code)
      setName(state.node.name)
      setParentId(state.node.parentId ?? NONE)
      setIsPackage(state.node.isPackage)
      setOwnerPartyId(state.node.ownerPartyId ?? '')
      setCommitmentId(state.node.commitmentId ?? '')
    } else {
      setCode('')
      setName('')
      setParentId(state.parent?.id ?? NONE)
      setIsPackage(false)
      setOwnerPartyId('')
      setCommitmentId('')
    }
  }, [state])

  // A node cannot be moved under itself or its own descendants.
  const parentOptions = nodes.filter(
    (node) =>
      node.status === 'active' && (!editing || !isInSubtree(node, editing))
  )

  const busy = create.isPending || update.isPending

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const payload = {
      code: code.trim(),
      name: name.trim(),
      parentId: parentId === NONE ? null : parentId,
      isPackage,
      ownerPartyId: isPackage && ownerPartyId.trim() ? ownerPartyId.trim() : null,
      commitmentId:
        isPackage && commitmentId.trim() ? commitmentId.trim() : null,
    }
    try {
      if (editing) {
        await update.mutateAsync({ nodeId: editing.id, payload })
        toast.success('WBS node updated')
      } else {
        await create.mutateAsync(payload)
        toast.success('WBS node added')
      }
      onClose()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <form onSubmit={submit} data-testid='uat-wbs-editor'>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit WBS node' : 'Add WBS node'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Rename, recode, move, or flag this node as a work package. Moving it carries its whole subtree.'
                : state?.mode === 'create' && state.parent
                  ? `A new node under ${state.parent.code} ${state.parent.name}.`
                  : 'A new top-level node of the work breakdown structure.'}
            </DialogDescription>
          </DialogHeader>

          <div className='mt-4 grid gap-4'>
            <div className='grid grid-cols-3 gap-3'>
              <div className='grid gap-1.5'>
                <Label htmlFor='wbs-code'>Code</Label>
                <Input
                  id='wbs-code'
                  name='code'
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder='03.10'
                  maxLength={60}
                  required
                />
              </div>
              <div className='col-span-2 grid gap-1.5'>
                <Label htmlFor='wbs-name'>Name</Label>
                <Input
                  id='wbs-name'
                  name='name'
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder='Substructure'
                  maxLength={160}
                  required
                />
              </div>
            </div>

            <div className='grid gap-1.5'>
              <Label>Parent</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger data-testid='uat-wbs-parent'>
                  <SelectValue placeholder='Top level' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Top level</SelectItem>
                  {parentOptions.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {' '.repeat(node.depth * 2)}
                      {node.code} · {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='flex items-center justify-between rounded-md border p-3'>
              <div>
                <p className='text-sm font-medium'>Work package</p>
                <p className='text-xs text-muted-foreground'>
                  The scope one party delivers under one commitment. The
                  commitment stays the contractual truth.
                </p>
              </div>
              <Switch
                checked={isPackage}
                onCheckedChange={setIsPackage}
                aria-label='Work package'
                data-testid='uat-wbs-package'
              />
            </div>

            {isPackage && (
              <div className='grid grid-cols-2 gap-3'>
                <div className='grid gap-1.5'>
                  <Label htmlFor='wbs-owner'>Owner party id</Label>
                  <Input
                    id='wbs-owner'
                    value={ownerPartyId}
                    onChange={(event) => setOwnerPartyId(event.target.value)}
                    placeholder='Project party (optional)'
                  />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='wbs-commitment'>Commitment id</Label>
                  <Input
                    id='wbs-commitment'
                    value={commitmentId}
                    onChange={(event) => setCommitmentId(event.target.value)}
                    placeholder='Commitment (optional)'
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className='mt-6'>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={busy} data-testid='uat-wbs-save'>
              {isEdit ? 'Save changes' : 'Add node'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WbsRow({
  node,
  expanded,
  toggle,
  canEdit,
  onAddChild,
  onEdit,
  onArchive,
  onRestore,
}: {
  node: WbsTreeNode
  expanded: Set<string>
  toggle: (id: string) => void
  canEdit: boolean
  onAddChild: (node: WbsNodeRecord) => void
  onEdit: (node: WbsNodeRecord) => void
  onArchive: (node: WbsNodeRecord) => void
  onRestore: (node: WbsNodeRecord) => void
}) {
  const hasChildren = node.children.length > 0
  const open = expanded.has(node.id)
  const archived = node.status === 'archived'

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2 border-b px-2 py-1.5 text-sm hover:bg-muted/40',
          archived && 'opacity-60'
        )}
        style={{ paddingLeft: `${node.depth * 20 + 8}px` }}
        data-testid={`uat-wbs-row-${node.code}`}
      >
        {hasChildren ? (
          <button
            type='button'
            className='rounded p-0.5 hover:bg-muted'
            onClick={() => toggle(node.id)}
            aria-label={`Toggle ${node.name}`}
          >
            {open ? (
              <ChevronDown className='h-3.5 w-3.5 text-muted-foreground' />
            ) : (
              <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
            )}
          </button>
        ) : (
          <span className='w-4' />
        )}
        <span className='font-mono text-xs'>{node.code}</span>
        <span className={cn('flex-1 truncate', node.depth === 0 && 'font-medium')}>
          {node.name}
        </span>
        {node.isPackage && (
          <Badge variant='secondary' className='gap-1'>
            <Package className='h-3 w-3' /> Package
          </Badge>
        )}
        {node.source !== 'manual' && (
          <Badge variant='outline'>{node.source}</Badge>
        )}
        {archived && <Badge variant='outline'>Archived</Badge>}
        <span className='w-24 text-right text-xs text-muted-foreground'>
          {node.activityCount ? `${node.activityCount} act.` : ''}
          {node.activityCount && node.boqItemCount ? ' · ' : ''}
          {node.boqItemCount ? `${node.boqItemCount} BOQ` : ''}
        </span>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='h-7 w-7'
                aria-label={`Actions for ${node.code}`}
                data-testid={`uat-wbs-actions-${node.code}`}
              >
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {!archived && (
                <>
                  <DropdownMenuItem onClick={() => onAddChild(node)}>
                    <Plus className='mr-2 h-4 w-4' /> Add child
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEdit(node)}>
                    <Pencil className='mr-2 h-4 w-4' /> Edit or move
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onArchive(node)}>
                    <Trash2 className='mr-2 h-4 w-4' /> Archive subtree
                  </DropdownMenuItem>
                </>
              )}
              {archived && (
                <DropdownMenuItem onClick={() => onRestore(node)}>
                  <ArchiveRestore className='mr-2 h-4 w-4' /> Restore
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {hasChildren &&
        open &&
        node.children.map((child) => (
          <WbsRow
            key={child.id}
            node={child}
            expanded={expanded}
            toggle={toggle}
            canEdit={canEdit}
            onAddChild={onAddChild}
            onEdit={onEdit}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        ))}
    </>
  )
}

function WbsSection({ projectId }: { projectId: string }) {
  const canEdit = useCanPerform('boq', 'update')
  const [includeArchived, setIncludeArchived] = React.useState(false)
  const { data, isLoading, isError, error } = useWbsNodes(projectId, {
    includeArchived,
  })
  const archive = useArchiveWbsNode(projectId)
  const restore = useRestoreWbsNode(projectId)
  const [editor, setEditor] = React.useState<EditorState>(null)
  const [archiving, setArchiving] = React.useState<WbsNodeRecord | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  // A node opens the first time it is seen with children — on load, and
  // again when a child is added under a leaf — and stays as the user left
  // it afterwards.
  const openedOnce = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    if (!data) return
    const fresh = data.items.filter(
      (n) => n.childCount > 0 && !openedOnce.current.has(n.id)
    )
    if (!fresh.length) return
    fresh.forEach((n) => openedOnce.current.add(n.id))
    setExpanded((previous) => {
      const next = new Set(previous)
      fresh.forEach((n) => next.add(n.id))
      return next
    })
  }, [data])

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const confirmArchive = async () => {
    if (!archiving) return
    try {
      const result = await archive.mutateAsync({ nodeId: archiving.id })
      toast.success(
        `Archived ${result.affectedCount} node${result.affectedCount === 1 ? '' : 's'}`
      )
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    } finally {
      setArchiving(null)
    }
  }

  const doRestore = async (node: WbsNodeRecord) => {
    try {
      await restore.mutateAsync(node.id)
      toast.success(`Restored ${node.code}`)
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    }
  }

  return (
    <section className='rounded-md border' data-testid='uat-structure-wbs'>
      <header className='flex flex-wrap items-center justify-between gap-3 border-b p-4'>
        <div className='flex items-center gap-2'>
          <FolderTree className='h-5 w-5 text-muted-foreground' />
          <div>
            <h3 className='text-base font-semibold'>Work breakdown structure</h3>
            <p className='text-xs text-muted-foreground'>
              {data
                ? `${data.summary.active} nodes · ${data.summary.packages} packages · ${data.summary.linkedActivities} activities linked · ${data.summary.linkedBoqItems} BOQ rows linked`
                : 'What part of the scope each BOQ row and activity belongs to.'}
            </p>
          </div>
        </div>
        <div className='flex items-center gap-3'>
          <label className='flex items-center gap-2 text-xs text-muted-foreground'>
            <Switch
              checked={includeArchived}
              onCheckedChange={setIncludeArchived}
              aria-label='Show archived nodes'
            />
            Show archived
          </label>
          {canEdit && (
            <Button
              size='sm'
              onClick={() => setEditor({ mode: 'create', parent: null })}
              data-testid='uat-wbs-add-root'
            >
              <Plus className='mr-1 h-4 w-4' /> Add root node
            </Button>
          )}
        </div>
      </header>

      {isLoading ? (
        <div className='space-y-2 p-4'>
          <Skeleton className='h-6 w-1/2' />
          <Skeleton className='h-6 w-2/3' />
          <Skeleton className='h-6 w-1/3' />
        </div>
      ) : isError ? (
        <p className='p-4 text-sm text-destructive'>
          {getServerErrorMessage(error)}
        </p>
      ) : !data || data.tree.length === 0 ? (
        <p className='p-6 text-center text-sm text-muted-foreground'>
          No WBS yet. Import a schedule to bring its WBS in, or add a root
          node.
        </p>
      ) : (
        <div>
          {data.tree.map((node) => (
            <WbsRow
              key={node.id}
              node={node}
              expanded={expanded}
              toggle={toggle}
              canEdit={canEdit}
              onAddChild={(parent) => setEditor({ mode: 'create', parent })}
              onEdit={(target) => setEditor({ mode: 'edit', node: target })}
              onArchive={setArchiving}
              onRestore={doRestore}
            />
          ))}
        </div>
      )}

      <WbsNodeEditor
        projectId={projectId}
        state={editor}
        nodes={data?.items ?? []}
        onClose={() => setEditor(null)}
      />
      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={`Archive ${archiving?.code ?? ''} and everything under it?`}
        desc='Linked activities and BOQ rows keep their link; the branch can be restored later.'
        confirmText='Archive'
        destructive
        isLoading={archive.isPending}
        handleConfirm={confirmArchive}
      />
    </section>
  )
}

function UnitsSection({ projectId }: { projectId: string }) {
  const canEdit = useCanPerform('boq', 'update')
  const { data, isLoading, isError, error } = useUnits(projectId)
  const createUnit = useCreateUnit(projectId)
  const [code, setCode] = React.useState('')
  const [name, setName] = React.useState('')
  const [dimension, setDimension] = React.useState<UnitDimension>('count')
  const [aliases, setAliases] = React.useState('')
  const [probe, setProbe] = React.useState('')
  const [probeResult, setProbeResult] = React.useState<string | null>(null)

  const rows = data
    ? data.seeded
      ? data.items
      : data.defaults.map((unit) => ({ ...unit, id: unit.code, isSystem: true }))
    : []

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await createUnit.mutateAsync({
        code: code.trim(),
        name: name.trim() || undefined,
        dimension,
        aliases: aliases
          .split(',')
          .map((alias) => alias.trim())
          .filter(Boolean),
      })
      toast.success(`Unit ${code.trim().toLowerCase()} added`)
      setCode('')
      setName('')
      setAliases('')
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    }
  }

  React.useEffect(() => {
    const text = probe.trim()
    if (!text) {
      setProbeResult(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      normaliseUnit(projectId, text)
        .then((result) => {
          if (cancelled) return
          setProbeResult(
            result.unitCode
              ? `"${result.unit}" → ${result.unitCode}`
              : `"${result.unit}" is not recognised (kept as typed; a warning on the row)`
          )
        })
        .catch(() => !cancelled && setProbeResult(null))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [probe, projectId])

  return (
    <section className='rounded-md border' data-testid='uat-structure-units'>
      <header className='flex flex-wrap items-center justify-between gap-3 border-b p-4'>
        <div className='flex items-center gap-2'>
          <Ruler className='h-5 w-5 text-muted-foreground' />
          <div>
            <h3 className='text-base font-semibold'>Units of measure</h3>
            <p className='text-xs text-muted-foreground'>
              {data && !data.seeded
                ? 'Standard list in use until the organisation is seeded; normalisation already answers from it.'
                : 'The codes a bill is normalised to. What was typed on a row is never rewritten.'}
            </p>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <Input
            value={probe}
            onChange={(event) => setProbe(event.target.value)}
            placeholder='Check a spelling, e.g. M3'
            className='h-8 w-44'
            aria-label='Check a unit spelling'
            data-testid='uat-unit-probe'
          />
          {probeResult && (
            <span className='text-xs text-muted-foreground' data-testid='uat-unit-probe-result'>
              {probeResult}
            </span>
          )}
        </div>
      </header>

      {isLoading ? (
        <div className='space-y-2 p-4'>
          <Skeleton className='h-6 w-1/2' />
          <Skeleton className='h-6 w-1/3' />
        </div>
      ) : isError ? (
        <p className='p-4 text-sm text-destructive'>{getServerErrorMessage(error)}</p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='border-b bg-muted/50'>
              <tr>
                <th className='p-2 text-left font-medium'>Code</th>
                <th className='p-2 text-left font-medium'>Name</th>
                <th className='p-2 text-left font-medium'>Dimension</th>
                <th className='p-2 text-left font-medium'>Also written as</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((unit) => (
                <tr key={unit.id} className='border-b' data-testid={`uat-unit-${unit.code}`}>
                  <td className='p-2 font-mono text-xs'>{unit.code}</td>
                  <td className='p-2'>{unit.name}</td>
                  <td className='p-2 text-xs text-muted-foreground'>{unit.dimension}</td>
                  <td className='p-2 text-xs text-muted-foreground'>
                    {unit.aliases.join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form
          onSubmit={submit}
          className='flex flex-wrap items-end gap-2 border-t p-3'
          data-testid='uat-unit-add'
        >
          <div className='grid gap-1'>
            <Label htmlFor='unit-code' className='text-xs'>
              Code
            </Label>
            <Input
              id='unit-code'
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className='h-8 w-24'
              maxLength={16}
              required
            />
          </div>
          <div className='grid gap-1'>
            <Label htmlFor='unit-name' className='text-xs'>
              Name
            </Label>
            <Input
              id='unit-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              className='h-8 w-40'
              maxLength={80}
            />
          </div>
          <div className='grid gap-1'>
            <Label className='text-xs'>Dimension</Label>
            <Select
              value={dimension}
              onValueChange={(value) => setDimension(value as UnitDimension)}
            >
              <SelectTrigger className='h-8 w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {unitDimensions.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1'>
            <Label htmlFor='unit-aliases' className='text-xs'>
              Also written as (comma-separated)
            </Label>
            <Input
              id='unit-aliases'
              value={aliases}
              onChange={(event) => setAliases(event.target.value)}
              className='h-8 w-56'
            />
          </div>
          <Button type='submit' size='sm' disabled={createUnit.isPending}>
            <Plus className='mr-1 h-4 w-4' /> Add unit
          </Button>
        </form>
      )}
    </section>
  )
}

export function StructurePage({ projectId }: { projectId: string }) {
  return (
    <div className='space-y-6' data-testid='uat-structure-page'>
      <div>
        <h2 className='text-lg font-semibold'>Structure</h2>
        <p className='text-sm text-muted-foreground'>
          The WBS, work packages and units every BOQ row, activity and cost
          figure is grouped by.
        </p>
      </div>
      <WbsSection projectId={projectId} />
      <UnitsSection projectId={projectId} />
    </div>
  )
}
