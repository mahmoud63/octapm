import { useState } from 'react'
import { Archive, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { CompanySection } from './components/company-section'
import {
  costCodeCategories,
  useCostCodes,
  useCreateCostCode,
  useImportCostCodes,
  useUpdateCostCode,
  type CostCodeCategory,
} from './hooks/use-company'

const NONE = '__none__'

/** "code,name,category,parentCode" per line; header row optional. */
const parseCsv = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()))
    .filter((cells) => cells[0] && cells[0].toLowerCase() !== 'code')
    .map(([code, name, category, parentCode]) => ({
      code,
      name: name || code,
      category: category || 'other',
      parentCode: parentCode || null,
    }))

export function CompanyCostCodes() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | undefined>()
  const { data, isLoading } = useCostCodes({
    ...(search ? { search } : {}),
    ...(category ? { category } : {}),
  })
  const create = useCreateCostCode()
  const update = useUpdateCostCode()
  const importCodes = useImportCostCodes()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [csv, setCsv] = useState('')
  const [draft, setDraft] = useState({
    code: '',
    name: '',
    category: 'other' as CostCodeCategory,
    parentId: NONE,
    description: '',
  })
  const items = data?.items ?? []

  const submit = async () => {
    try {
      await create.mutateAsync({
        code: draft.code,
        name: draft.name,
        category: draft.category,
        parentId: draft.parentId === NONE ? null : draft.parentId,
        description: draft.description || null,
      })
      toast.success('Cost code added.')
      setDraft({
        code: '',
        name: '',
        category: 'other',
        parentId: NONE,
        description: '',
      })
      setDialogOpen(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const runImport = async () => {
    const rows = parseCsv(csv)
    if (!rows.length) {
      toast.error('Paste at least one row: code, name, category, parent code.')
      return
    }
    try {
      const result = await importCodes.mutateAsync(rows)
      toast.success(`${result.created} created, ${result.updated} updated.`)
      setCsv('')
      setImportOpen(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <CompanySection
      title='Cost codes'
      description='The organisation’s cost code list. Projects reuse it for budgets, commitments and actuals.'
      actions={
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => setImportOpen(true)}
          >
            <Upload className='size-4' /> Import
          </Button>
          <Button
            size='sm'
            data-testid='uat-cost-code-new'
            onClick={() => setDialogOpen(true)}
          >
            <Plus className='size-4' /> New cost code
          </Button>
        </div>
      }
    >
      <div className='space-y-3' data-testid='uat-company-cost-codes'>
        <div className='flex flex-wrap gap-2'>
          <Input
            placeholder='Search code or name'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='max-w-xs'
          />
          <Select
            value={category ?? 'all'}
            onValueChange={(value) =>
              setCategory(value === 'all' ? undefined : value)
            }
          >
            <SelectTrigger className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All categories</SelectItem>
              {costCodeCategories.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isLoading ? (
          <Skeleton className='h-32 w-full' />
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead className='text-right'>Children</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className='text-center text-muted-foreground'
                    >
                      No cost codes yet. Add them one by one or import a list.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((code) => (
                    <TableRow key={code.id}>
                      <TableCell className='font-mono text-xs'>
                        {code.code}
                      </TableCell>
                      <TableCell>
                        <div className='font-medium'>{code.name}</div>
                        {code.description && (
                          <div className='text-xs text-muted-foreground'>
                            {code.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant='outline'>{code.category}</Badge>
                      </TableCell>
                      <TableCell className='font-mono text-xs text-muted-foreground'>
                        {items.find((row) => row.id === code.parentId)?.code ??
                          '—'}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {code.childCount}
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          size='icon'
                          variant='ghost'
                          aria-label='Archive cost code'
                          onClick={async () => {
                            try {
                              await update.mutateAsync({
                                costCodeId: code.id,
                                payload: { status: 'archived' },
                              })
                              toast.success(`${code.code} archived.`)
                            } catch (error) {
                              toast.error(getServerErrorMessage(error))
                            }
                          }}
                        >
                          <Archive className='size-4' />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New cost code</DialogTitle>
            <DialogDescription>
              Codes are unique per organisation and upper-cased.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='cost-code-code'>Code</Label>
              <Input
                id='cost-code-code'
                data-testid='uat-cost-code-code'
                placeholder='03-300'
                value={draft.code}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, code: e.target.value }))
                }
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='cost-code-name'>Name</Label>
              <Input
                id='cost-code-name'
                placeholder='Cast-in-place concrete'
                value={draft.name}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, name: e.target.value }))
                }
              />
            </div>
            <div className='space-y-1'>
              <Label>Category</Label>
              <Select
                value={draft.category}
                onValueChange={(value) =>
                  setDraft((p) => ({
                    ...p,
                    category: value as CostCodeCategory,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {costCodeCategories.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1'>
              <Label>Parent</Label>
              <Select
                value={draft.parentId}
                onValueChange={(value) =>
                  setDraft((p) => ({ ...p, parentId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No parent</SelectItem>
                  {items.map((code) => (
                    <SelectItem key={code.id} value={code.id}>
                      {code.code} · {code.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1 sm:col-span-2'>
              <Label htmlFor='cost-code-description'>Description</Label>
              <Textarea
                id='cost-code-description'
                rows={2}
                value={draft.description}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, description: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={create.isPending}
              data-testid='uat-cost-code-save'
            >
              {create.isPending ? 'Saving…' : 'Add cost code'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import cost codes</DialogTitle>
            <DialogDescription>
              One per line: <code>code, name, category, parent code</code>.
              Existing codes are updated.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            className='font-mono text-xs'
            placeholder={
              '01, General requirements, indirect\n03, Concrete, material\n03-300, Cast-in-place concrete, material, 03'
            }
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            data-testid='uat-cost-code-import'
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runImport} disabled={importCodes.isPending}>
              {importCodes.isPending ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CompanySection>
  )
}
