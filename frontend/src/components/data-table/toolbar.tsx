import { Cross2Icon, DownloadIcon } from '@radix-ui/react-icons'
import { type Table } from '@tanstack/react-table'
import { csvFileName, downloadCsv } from '@/lib/export-csv'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTableFacetedFilter } from './faceted-filter'
import { DataTableViewOptions } from './view-options'

type DataTableToolbarProps<TData> = {
  table: Table<TData>
  searchPlaceholder?: string
  searchKey?: string
  filters?: {
    columnId: string
    title: string
    options: {
      label: string
      value: string
      icon?: React.ComponentType<{ className?: string }>
    }[]
  }[]
  /** File name base for "Export view"; omit to hide the button. */
  exportName?: string
}

/** Downloads the rows the table currently shows (filters applied, visible columns) as CSV. */
export function exportTableView<TData>(table: Table<TData>, name: string) {
  const columns = table
    .getVisibleLeafColumns()
    .filter((column) => column.id !== 'select' && column.id !== 'actions')
  const rows = table.getFilteredRowModel().rows
  downloadCsv(
    csvFileName(name),
    columns.map((column) => ({
      key: column.id,
      label:
        typeof column.columnDef.header === 'string'
          ? column.columnDef.header
          : column.id,
    })),
    rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [column.id, row.getValue(column.id)])
      )
    )
  )
}

export function DataTableToolbar<TData>({
  table,
  searchPlaceholder = 'Filter...',
  searchKey,
  filters = [],
  exportName,
}: DataTableToolbarProps<TData>) {
  const isFiltered =
    table.getState().columnFilters.length > 0 || table.getState().globalFilter

  return (
    <div className='flex items-center justify-between'>
      <div className='flex flex-1 flex-col-reverse items-start gap-y-2 sm:flex-row sm:items-center sm:space-x-2'>
        {searchKey ? (
          <Input
            placeholder={searchPlaceholder}
            value={
              (table.getColumn(searchKey)?.getFilterValue() as string) ?? ''
            }
            onChange={(event) =>
              table.getColumn(searchKey)?.setFilterValue(event.target.value)
            }
            className='h-8 w-[150px] lg:w-[250px]'
          />
        ) : (
          <Input
            placeholder={searchPlaceholder}
            value={table.getState().globalFilter ?? ''}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className='h-8 w-[150px] lg:w-[250px]'
          />
        )}
        <div className='flex gap-x-2'>
          {filters.map((filter) => {
            const column = table.getColumn(filter.columnId)
            if (!column) return null
            return (
              <DataTableFacetedFilter
                key={filter.columnId}
                column={column}
                title={filter.title}
                options={filter.options}
              />
            )
          })}
        </div>
        {isFiltered && (
          <Button
            variant='ghost'
            onClick={() => {
              table.resetColumnFilters()
              table.setGlobalFilter('')
            }}
            className='h-8 px-2 lg:px-3'
          >
            Reset
            <Cross2Icon className='ms-2 h-4 w-4' />
          </Button>
        )}
      </div>
      <div className='flex items-center gap-2'>
        {exportName && (
          <Button
            variant='outline'
            size='sm'
            className='h-8'
            onClick={() => exportTableView(table, exportName)}
            data-testid='uat-export-view'
          >
            <DownloadIcon className='me-1 h-4 w-4' /> Export view
          </Button>
        )}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
