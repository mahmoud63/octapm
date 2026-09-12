import * as React from 'react'
import { z } from 'zod'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
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
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  locationKinds,
  useArchiveLocation,
  useCreateLocation,
  useLocations,
  useReorderLocations,
  useRestoreLocation,
  useUpdateLocation,
  type LocationKind,
  type LocationNode,
  type LocationRecord,
} from '../hooks/use-locations'
import { LocationPicker } from './location-picker'

const kindLabels: Record<LocationKind, string> = {
  site: 'Site',
  building: 'Building',
  level: 'Level',
  zone: 'Zone',
  room: 'Room',
  area: 'Area',
  external: 'External',
}

const nextKindFor = (parent?: LocationRecord | null): LocationKind => {
  if (!parent) return 'site'
  const order: LocationKind[] = ['site', 'building', 'level', 'zone', 'room']
  const index = order.indexOf(parent.kind)
  return index >= 0 && index < order.length - 1 ? order[index + 1] : 'area'
}

const locationFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  code: z.string().trim().max(40).optional(),
  kind: z.enum(locationKinds),
  parentId: z.string().nullable(),
  description: z.string().trim().max(1000).optional(),
})

type LocationFormValues = z.infer<typeof locationFormSchema>

type EditorState =
  | { mode: 'create'; parent: LocationRecord | null }
  | { mode: 'edit'; location: LocationRecord }
  | null

function LocationEditorDialog({
  projectId,
  state,
  onClose,
}: {
  projectId: string
  state: EditorState
  onClose: () => void
}) {
  const create = useCreateLocation(projectId)
  const update = useUpdateLocation(projectId)
  const isEdit = state?.mode === 'edit'

  const defaults = React.useMemo<LocationFormValues>(() => {
    if (state?.mode === 'edit') {
      return {
        name: state.location.name,
        code: state.location.code ?? '',
        kind: state.location.kind,
        parentId: state.location.parentId,
        description: state.location.description ?? '',
      }
    }
    return {
      name: '',
      code: '',
      kind: nextKindFor(state?.mode === 'create' ? state.parent : null),
      parentId: state?.mode === 'create' ? (state.parent?.id ?? null) : null,
      description: '',
    }
  }, [state])

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: defaults,
  })

  React.useEffect(() => {
    form.reset(defaults)
  }, [defaults, form])

  const pending = create.isPending || update.isPending

  const onSubmit = async (values: LocationFormValues) => {
    const payload = {
      name: values.name,
      code: values.code ? values.code : null,
      kind: values.kind,
      parentId: values.parentId,
      description: values.description ? values.description : null,
    }
    try {
      if (state?.mode === 'edit') {
        await update.mutateAsync({ locationId: state.location.id, payload })
        toast.success('Location updated')
      } else {
        await create.mutateAsync(payload)
        toast.success('Location created')
      }
      onClose()
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to save the location.'))
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit location' : 'New location'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Rename, recode, or move this location. Moving carries its children with it.'
              : state?.mode === 'create' && state.parent
                ? `Adds a location inside ${state.parent.fullName}.`
                : 'Adds a top-level location such as a site or building.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4'
            data-testid='location-editor-form'
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder='e.g. Level 3' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='kind'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {locationKinds.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {kindLabels[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='code'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input placeholder='e.g. B1-L03' {...field} />
                    </FormControl>
                    <FormDescription>
                      Optional, unique in the project.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='parentId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent</FormLabel>
                  <FormControl>
                    <LocationPicker
                      projectId={projectId}
                      value={field.value}
                      onChange={field.onChange}
                      excludePaths={
                        state?.mode === 'edit' ? [state.location.path] : []
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder='Optional notes'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' disabled={pending}>
                {pending
                  ? 'Saving…'
                  : isEdit
                    ? 'Save changes'
                    : 'Create location'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function LocationRow({
  node,
  siblings,
  canEdit,
  canArchive,
  expanded,
  selected = false,
  onToggle,
  onAddChild,
  onEdit,
  onMove,
  onArchive,
  onRestore,
}: {
  node: LocationNode
  siblings: LocationNode[]
  canEdit: boolean
  canArchive: boolean
  expanded: boolean
  /** Named by a deep link. */
  selected?: boolean
  onToggle: () => void
  onAddChild: () => void
  onEdit: () => void
  onMove: (direction: -1 | 1) => void
  onArchive: () => void
  onRestore: () => void
}) {
  const index = siblings.findIndex((sibling) => sibling.id === node.id)
  const isArchived = node.status === 'archived'
  const hasChildren = node.children.length > 0

  return (
    <div
      id={`uat-record-row-${node.id}`}
      data-testid='location-row'
      data-record-id={node.id}
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        'group flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50',
        selected && 'bg-primary/5 ring-1 ring-primary/40',
        isArchived && 'opacity-60'
      )}
      style={{ paddingInlineStart: `${node.depth * 20 + 8}px` }}
    >
      <button
        type='button'
        onClick={onToggle}
        aria-label={expanded ? 'Collapse' : 'Expand'}
        aria-expanded={expanded}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground',
          hasChildren ? 'hover:bg-muted' : 'invisible'
        )}
      >
        {expanded ? (
          <ChevronDown className='size-4' />
        ) : (
          <ChevronRight className='size-4' />
        )}
      </button>
      <MapPin className='size-4 shrink-0 text-muted-foreground' />
      <span className='min-w-0 flex-1 truncate font-medium'>{node.name}</span>
      {node.code && (
        <span className='hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline'>
          {node.code}
        </span>
      )}
      <Badge
        variant='outline'
        className='hidden shrink-0 text-[10px] sm:inline-flex'
      >
        {kindLabels[node.kind]}
      </Badge>
      {isArchived && (
        <Badge variant='secondary' className='shrink-0 text-[10px]'>
          Archived
        </Badge>
      )}
      {hasChildren && (
        <span className='shrink-0 text-xs text-muted-foreground'>
          {node.children.length}
        </span>
      )}
      {(canEdit || canArchive) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='size-8 shrink-0'
              aria-label={`Actions for ${node.name}`}
            >
              <MoreHorizontal className='size-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='min-w-44'>
            {canEdit && !isArchived && (
              <>
                <DropdownMenuItem onClick={onAddChild}>
                  <Plus className='size-4' /> Add inside
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className='size-4' /> Edit / move
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index <= 0}
                  onClick={() => onMove(-1)}
                >
                  <ArrowUp className='size-4' /> Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index < 0 || index >= siblings.length - 1}
                  onClick={() => onMove(1)}
                >
                  <ArrowDown className='size-4' /> Move down
                </DropdownMenuItem>
              </>
            )}
            {canArchive && (
              <>
                {canEdit && !isArchived && <DropdownMenuSeparator />}
                {isArchived ? (
                  <DropdownMenuItem onClick={onRestore}>
                    <ArchiveRestore className='size-4' /> Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant='destructive' onClick={onArchive}>
                    <Trash2 className='size-4' /> Archive
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export function LocationsPanel({
  projectId,
  initialTarget,
}: {
  projectId: string
  initialTarget?: ProjectSetupTarget
}) {
  const targetId =
    initialTarget?.source === 'location' ? (initialTarget.recordId ?? null) : null
  const [showArchived, setShowArchived] = React.useState(false)
  const [editor, setEditor] = React.useState<EditorState>(null)
  const [archiveTarget, setArchiveTarget] =
    React.useState<LocationRecord | null>(null)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

  const canCreate = useCanPerform('location', 'create')
  const canUpdate = useCanPerform('location', 'update')
  const canArchive = useCanPerform('location', 'delete', 'location.archive')

  const { data, isLoading, isError, error } = useLocations(projectId, {
    includeArchived: showArchived,
  })
  const reorder = useReorderLocations(projectId)
  const archive = useArchiveLocation(projectId)
  const restore = useRestoreLocation(projectId)

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const move = async (
    node: LocationNode,
    siblings: LocationNode[],
    dir: -1 | 1
  ) => {
    const ids = siblings.map((sibling) => sibling.id)
    const index = ids.indexOf(node.id)
    const target = index + dir
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      await reorder.mutateAsync({ parentId: node.parentId, orderedIds: ids })
    } catch (err) {
      toast.error(getServerErrorMessage(err, 'Unable to reorder locations.'))
    }
  }

  const confirmArchive = async () => {
    if (!archiveTarget) return
    try {
      const result = await archive.mutateAsync({ locationId: archiveTarget.id })
      const count = Number(result?.affectedCount ?? 1)
      toast.success(
        count > 1
          ? `Archived ${archiveTarget.name} and ${count - 1} nested location${count - 1 === 1 ? '' : 's'}`
          : `Archived ${archiveTarget.name}`
      )
      setArchiveTarget(null)
    } catch (err) {
      toast.error(getServerErrorMessage(err, 'Unable to archive the location.'))
    }
  }

  const handleRestore = async (node: LocationRecord) => {
    try {
      await restore.mutateAsync(node.id)
      toast.success(`Restored ${node.name}`)
    } catch (err) {
      toast.error(getServerErrorMessage(err, 'Unable to restore the location.'))
    }
  }

  const renderNodes = (nodes: LocationNode[]): React.ReactNode =>
    nodes.map((node) => {
      const expanded = !collapsed.has(node.id)
      return (
        <React.Fragment key={node.id}>
          <LocationRow
            node={node}
            siblings={nodes}
            canEdit={canUpdate}
            canArchive={canArchive}
            expanded={expanded}
            onToggle={() => toggle(node.id)}
            onAddChild={() => setEditor({ mode: 'create', parent: node })}
            selected={node.id === targetId}
            onEdit={() => setEditor({ mode: 'edit', location: node })}
            onMove={(dir) => move(node, nodes, dir)}
            onArchive={() => setArchiveTarget(node)}
            onRestore={() => handleRestore(node)}
          />
          {expanded && node.children.length > 0 && renderNodes(node.children)}
        </React.Fragment>
      )
    })

  const summary = data?.summary
  const tree = data?.tree ?? []
  React.useEffect(() => {
    if (!targetId || !tree.length) return
    document
      .getElementById(`uat-record-row-${targetId}`)
      ?.scrollIntoView({ block: 'center' })
  }, [targetId, tree.length])

  return (
    <div className='space-y-4' data-testid='uat-locations-panel'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h3 className='text-base font-semibold'>Locations</h3>
          <p className='text-sm text-muted-foreground'>
            The site › building › level › zone structure that punch items,
            inspections, photos and daily entries are filed against.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='flex items-center gap-2'>
            <Switch
              id='locations-show-archived'
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor='locations-show-archived' className='text-sm'>
              Show archived
            </Label>
          </div>
          {canCreate && (
            <Button
              size='sm'
              onClick={() => setEditor({ mode: 'create', parent: null })}
              data-testid='uat-location-create'
            >
              <Plus className='size-4' /> Add location
            </Button>
          )}
        </div>
      </div>

      {summary && summary.total > 0 && (
        <div className='flex flex-wrap gap-4 text-xs text-muted-foreground'>
          <span>
            <span className='font-medium text-foreground'>
              {summary.active}
            </span>{' '}
            active
          </span>
          <span>
            <span className='font-medium text-foreground'>{summary.roots}</span>{' '}
            top-level
          </span>
          <span>
            <span className='font-medium text-foreground'>
              {summary.maxDepth}
            </span>{' '}
            levels deep
          </span>
          {summary.archived > 0 && (
            <span>
              <span className='font-medium text-foreground'>
                {summary.archived}
              </span>{' '}
              archived
            </span>
          )}
        </div>
      )}

      <div className='rounded-md border bg-card'>
        {isLoading ? (
          <div className='space-y-2 p-3'>
            <Skeleton className='h-8 w-2/3' />
            <Skeleton className='h-8 w-1/2' />
            <Skeleton className='h-8 w-3/5' />
          </div>
        ) : isError ? (
          <div className='p-6 text-sm text-destructive'>
            {getServerErrorMessage(error, 'Unable to load locations.')}
          </div>
        ) : tree.length === 0 ? (
          <div className='flex flex-col items-center gap-3 p-8 text-center'>
            <MapPin className='size-8 text-muted-foreground' />
            <div>
              <p className='text-sm font-medium'>No locations yet</p>
              <p className='text-sm text-muted-foreground'>
                Start with the site, then add buildings, levels and zones so
                field records can be filed by area.
              </p>
            </div>
            {canCreate && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => setEditor({ mode: 'create', parent: null })}
              >
                <Plus className='size-4' /> Add the first location
              </Button>
            )}
          </div>
        ) : (
          <div className='p-1'>{renderNodes(tree)}</div>
        )}
      </div>

      <LocationEditorDialog
        projectId={projectId}
        state={editor}
        onClose={() => setEditor(null)}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.name ?? 'location'}?`}
        desc={
          archiveTarget && archiveTarget.childCount > 0
            ? `This archives ${archiveTarget.name} and everything nested under it. Records already filed against these locations keep their reference.`
            : 'Archived locations are hidden from pickers but can be restored later.'
        }
        confirmText='Archive'
        destructive
        isLoading={archive.isPending}
        handleConfirm={confirmArchive}
      />
    </div>
  )
}
