import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Download,
  Layers,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { downloadFile } from '@/features/lookahead/hooks/use-lookaheads'
import {
  fmtQuantity,
  useBimElements,
  useBimModel,
  useBimQuantities,
  useBimSpatial,
  type BimElementFilters,
  type BimSpatialNode,
} from '../hooks/use-bim'
import { BimElementDialog } from './bim-element-dialog'
import { BimLinkActions } from './bim-link-actions'

function StoreyTree({
  nodes,
  selected,
  onSelect,
  depth = 0,
}: {
  nodes: BimSpatialNode[]
  selected: string | null
  onSelect: (globalId: string | null) => void
  depth?: number
}) {
  return (
    <ul className='space-y-0.5'>
      {nodes.map((node) => (
        <li key={node.globalId}>
          <button
            type='button'
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted/60',
              selected === node.globalId && 'bg-primary/10 font-medium'
            )}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() =>
              onSelect(selected === node.globalId ? null : node.globalId)
            }
          >
            <span className='min-w-0 flex-1 truncate'>
              {node.name || node.longName || node.ifcType.replace('IFC', '')}
            </span>
            {node.elementCount > 0 && (
              <span className='shrink-0 text-[11px] text-muted-foreground tabular-nums'>
                {node.elementCount}
              </span>
            )}
          </button>
          {node.children.length > 0 && (
            <StoreyTree
              nodes={node.children}
              selected={selected}
              onSelect={onSelect}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/** One model: the spatial tree, the element table, the quantity rollup and the links. */
export function BimModelBrowser({
  projectId,
  modelId,
  onBack,
}: {
  projectId: string
  modelId: string
  onBack: () => void
}) {
  const canExport = useCanPerform('bim', 'export')
  const { data: model, isLoading } = useBimModel(projectId, modelId)
  const { data: spatial } = useBimSpatial(projectId, modelId)
  const [storeyGlobalId, setStorey] = useState<string | null>(null)
  const [ifcType, setIfcType] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [linkedOnly, setLinkedOnly] = useState<'true' | 'false' | null>(null)
  const [groupBy, setGroupBy] = useState<'type' | 'storey'>('type')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openElement, setOpenElement] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const filters: BimElementFilters = useMemo(
    () => ({
      ...(storeyGlobalId ? { storeyGlobalId } : {}),
      ...(ifcType ? { ifcType } : {}),
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(linkedOnly ? { linked: linkedOnly } : {}),
    }),
    [storeyGlobalId, ifcType, q, linkedOnly]
  )
  const elements = useBimElements(projectId, modelId, filters)
  const { data: quantities } = useBimQuantities(
    projectId,
    modelId,
    filters,
    groupBy
  )
  const rows = useMemo(
    () => (elements.data?.pages ?? []).flatMap((page) => page.items),
    [elements.data]
  )
  const total = elements.data?.pages?.[0]?.total ?? 0
  const units = model?.units ?? {}

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exportXlsx = async () => {
    setExporting(true)
    try {
      const name = await downloadFile(
        `/projects/${projectId}/bim/models/${modelId}/elements/export.xlsx?${new URLSearchParams(filters as Record<string, string>).toString()}`,
        'bim-elements.xlsx'
      )
      toast.success(`Downloaded ${name}`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  if (isLoading || !model) {
    return (
      <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Opening the model…
      </div>
    )
  }

  return (
    <div className='space-y-3' data-testid='uat-bim-browser'>
      <div className='flex flex-wrap items-start gap-2'>
        <Button variant='ghost' size='sm' onClick={onBack}>
          <ArrowLeft className='mr-1 h-4 w-4' /> Models
        </Button>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='font-medium'>{model.name}</p>
            <Badge variant='outline' className='text-[10px]'>
              v{model.version}
            </Badge>
            {model.schema && (
              <Badge variant='outline' className='text-[10px]'>
                {model.schema}
              </Badge>
            )}
            {model.discipline && (
              <Badge variant='outline' className='text-[10px] capitalize'>
                {model.discipline}
              </Badge>
            )}
          </div>
          <p className='text-xs text-muted-foreground'>
            {[
              `${model.elementCount.toLocaleString()} elements`,
              `${model.storeyCount} storeys`,
              `${model.linkedCount} linked`,
              model.header?.originatingSystem,
              model.ifcProjectName,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {canExport && (
          <Button
            variant='outline'
            size='sm'
            disabled={exporting}
            onClick={exportXlsx}
            data-testid='uat-bim-export'
          >
            <Download className='mr-1 h-4 w-4' />
            {exporting ? 'Exporting…' : 'XLSX'}
          </Button>
        )}
        <BimLinkActions
          projectId={projectId}
          modelId={modelId}
          elementIds={selected.size ? [...selected] : undefined}
          filter={filters}
          label={
            selected.size
              ? `Link ${selected.size} selected`
              : 'Link all filtered'
          }
          disabled={!rows.length}
          onLinked={() => setSelected(new Set())}
        />
      </div>

      {model.warnings.length > 0 && (
        <div className='flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200'>
          <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
          <span>{model.warnings.join(' ')}</span>
        </div>
      )}

      <div className='grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]'>
        <div className='space-y-3'>
          <div className='rounded-md border' data-testid='uat-bim-spatial'>
            <p className='flex items-center gap-1.5 border-b px-2 py-1.5 text-xs font-medium'>
              <Layers className='h-3.5 w-3.5' /> Spatial breakdown
            </p>
            <div className='max-h-72 overflow-y-auto p-1'>
              {spatial?.items?.length ? (
                <StoreyTree
                  nodes={spatial.items}
                  selected={storeyGlobalId}
                  onSelect={setStorey}
                />
              ) : (
                <p className='p-2 text-xs text-muted-foreground'>
                  No spatial breakdown in this model.
                </p>
              )}
            </div>
          </div>
          <div className='rounded-md border' data-testid='uat-bim-types'>
            <p className='flex items-center gap-1.5 border-b px-2 py-1.5 text-xs font-medium'>
              <Boxes className='h-3.5 w-3.5' /> Types
            </p>
            <div className='max-h-64 overflow-y-auto p-1'>
              {(model.typeSummary ?? []).map((type) => (
                <button
                  key={type.ifcType}
                  type='button'
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted/60',
                    ifcType === type.ifcType && 'bg-primary/10 font-medium'
                  )}
                  onClick={() =>
                    setIfcType(ifcType === type.ifcType ? null : type.ifcType)
                  }
                >
                  <span className='min-w-0 flex-1 truncate'>{type.label}</span>
                  <span className='shrink-0 text-[11px] text-muted-foreground tabular-nums'>
                    {type.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              className='w-56'
              placeholder='Search name, tag, type, material'
              value={q}
              onChange={(event) => setQ(event.target.value)}
              data-testid='uat-bim-search'
            />
            {(['true', 'false'] as const).map((value) => (
              <button
                key={value}
                type='button'
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs',
                  linkedOnly === value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
                onClick={() =>
                  setLinkedOnly(linkedOnly === value ? null : value)
                }
              >
                {value === 'true' ? 'Linked' : 'Not linked'}
              </button>
            ))}
            {(storeyGlobalId || ifcType || q || linkedOnly) && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  setStorey(null)
                  setIfcType(null)
                  setQ('')
                  setLinkedOnly(null)
                }}
              >
                Clear filters
              </Button>
            )}
            <span className='ml-auto text-xs text-muted-foreground tabular-nums'>
              {total.toLocaleString()} elements
            </span>
          </div>

          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead className='bg-muted/50 text-xs text-muted-foreground'>
                <tr>
                  <th className='w-8 px-2 py-1' />
                  <th className='px-2 py-1 text-left'>Element</th>
                  <th className='px-2 py-1 text-left'>Type</th>
                  <th className='px-2 py-1 text-left'>Storey</th>
                  <th className='px-2 py-1 text-right'>Net volume</th>
                  <th className='px-2 py-1 text-right'>Net area</th>
                  <th className='px-2 py-1 text-right'>Links</th>
                </tr>
              </thead>
              <tbody data-testid='uat-bim-elements'>
                {rows.map((element) => (
                  <tr
                    key={element.id}
                    className='cursor-pointer border-t hover:bg-muted/40'
                    onClick={() => setOpenElement(element.id)}
                  >
                    <td
                      className='px-2 py-1'
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={selected.has(element.id)}
                        onCheckedChange={() => toggle(element.id)}
                        aria-label='Select element'
                      />
                    </td>
                    <td className='max-w-72 px-2 py-1'>
                      <span className='block truncate font-medium'>
                        {element.name || element.typeLabel}
                      </span>
                      <span className='block truncate text-xs text-muted-foreground'>
                        {[
                          element.tag,
                          element.typeName,
                          element.materials.join(', '),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td className='px-2 py-1 text-xs'>{element.typeLabel}</td>
                    <td className='px-2 py-1 text-xs'>
                      {element.storeyName || '—'}
                    </td>
                    <td className='px-2 py-1 text-right tabular-nums'>
                      {fmtQuantity(element.quantities.netVolume)}
                    </td>
                    <td className='px-2 py-1 text-right tabular-nums'>
                      {fmtQuantity(element.quantities.netArea)}
                    </td>
                    <td className='px-2 py-1 text-right tabular-nums'>
                      {element.linkCount || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {elements.isLoading && (
              <div className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' /> Loading elements…
              </div>
            )}
            {!elements.isLoading && rows.length === 0 && (
              <p className='p-3 text-sm text-muted-foreground'>
                No element matches these filters.
              </p>
            )}
            {elements.hasNextPage && (
              <div className='border-t p-2 text-center'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={elements.isFetchingNextPage}
                  onClick={() => elements.fetchNextPage()}
                  data-testid='uat-bim-load-more'
                >
                  {elements.isFetchingNextPage && (
                    <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </div>

          <div className='rounded-md border' data-testid='uat-bim-quantities'>
            <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
              <p className='text-sm font-medium'>Quantities</p>
              <div className='flex rounded-md border p-0.5'>
                {(['type', 'storey'] as const).map((value) => (
                  <button
                    key={value}
                    type='button'
                    className={cn(
                      'rounded px-2 py-0.5 text-xs capitalize',
                      groupBy === value
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    )}
                    onClick={() => setGroupBy(value)}
                  >
                    By {value}
                  </button>
                ))}
              </div>
              <p className='ml-auto text-xs text-muted-foreground'>
                {quantities?.totals.elements.toLocaleString() ?? 0} elements ·{' '}
                {fmtQuantity(quantities?.totals.netVolume, units.volume)} ·{' '}
                {fmtQuantity(quantities?.totals.netArea, units.area)}
              </p>
            </div>
            <table className='w-full text-sm'>
              <thead className='bg-muted/30 text-xs text-muted-foreground'>
                <tr>
                  <th className='px-3 py-1 text-left'>
                    {groupBy === 'type' ? 'Type' : 'Storey'}
                  </th>
                  <th className='px-3 py-1 text-right'>Elements</th>
                  <th className='px-3 py-1 text-right'>
                    Net volume{units.volume ? ` (${units.volume})` : ''}
                  </th>
                  <th className='px-3 py-1 text-right'>
                    Net area{units.area ? ` (${units.area})` : ''}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(quantities?.items ?? []).map((row) => (
                  <tr key={row.key} className='border-t'>
                    <td className='px-3 py-1'>{row.label}</td>
                    <td className='px-3 py-1 text-right tabular-nums'>
                      {row.elements.toLocaleString()}
                    </td>
                    <td className='px-3 py-1 text-right tabular-nums'>
                      {fmtQuantity(row.netVolume)}
                    </td>
                    <td className='px-3 py-1 text-right tabular-nums'>
                      {fmtQuantity(row.netArea)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <BimElementDialog
        projectId={projectId}
        modelId={modelId}
        elementId={openElement}
        units={units}
        onOpenChange={(open) => !open && setOpenElement(null)}
      />
    </div>
  )
}
