import { useState } from 'react'
import { ChevronDown, Download, FileSpreadsheet, FileCode2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { downloadFile } from '@/features/lookahead/hooks/use-lookaheads'

interface Props {
  projectId: string
  className?: string
}

type ScheduleFormat = 'xer' | 'p6xml' | 'mspxml'

const SCHEDULE_FORMATS: Array<{
  key: ScheduleFormat
  label: string
  hint: string
}> = [
  {
    key: 'xer',
    label: 'Primavera P6 (XER)',
    hint: 'Opens in P6 Professional / EPPM',
  },
  {
    key: 'p6xml',
    label: 'Primavera P6 (XML)',
    hint: 'P6 XML business objects',
  },
  {
    key: 'mspxml',
    label: 'Microsoft Project (XML)',
    hint: 'MSPDI — opens in MS Project',
  },
]

/**
 * Export menu on the schedule: the multi-sheet workbook plus the schedule in
 * the planners' own formats (OCTA-SCH-LOOKAHEAD-041).
 */
export function ExportButton({ projectId, className }: Props) {
  const canExportWorkbook = useCanPerform('cost', 'export')
  const canExportSchedule = useCanPerform('schedule', 'export')
  const [busy, setBusy] = useState<string | null>(null)

  if (!canExportWorkbook && !canExportSchedule) return null

  const run = async (key: string, url: string, fallback: string) => {
    setBusy(key)
    try {
      const name = await downloadFile(url, fallback)
      toast.success(`Downloaded ${name}`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={className}
          disabled={Boolean(busy)}
          data-testid='uat-schedule-export'
        >
          <Download className='mr-1.5 h-4 w-4' />
          {busy ? 'Exporting…' : 'Export'}
          <ChevronDown className='ml-1 h-3.5 w-3.5 opacity-60' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-64'>
        {canExportWorkbook && (
          <>
            <DropdownMenuLabel className='text-xs text-muted-foreground'>
              Workbook
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() =>
                run(
                  'xlsx',
                  `/projects/${projectId}/export/xlsx`,
                  'project-export.xlsx'
                )
              }
              data-testid='uat-schedule-export-xlsx'
            >
              <FileSpreadsheet className='h-4 w-4' />
              <div>
                <p>Excel workbook</p>
                <p className='text-xs text-muted-foreground'>
                  Schedule, critical path, risks, long lead, WBS
                </p>
              </div>
            </DropdownMenuItem>
          </>
        )}
        {canExportWorkbook && canExportSchedule && <DropdownMenuSeparator />}
        {canExportSchedule && (
          <>
            <DropdownMenuLabel className='text-xs text-muted-foreground'>
              Planning software
            </DropdownMenuLabel>
            {SCHEDULE_FORMATS.map((format) => (
              <DropdownMenuItem
                key={format.key}
                onClick={() =>
                  run(
                    format.key,
                    `/projects/${projectId}/export/schedule/${format.key}`,
                    `schedule.${format.key === 'xer' ? 'xer' : 'xml'}`
                  )
                }
                data-testid={`uat-schedule-export-${format.key}`}
              >
                <FileCode2 className='h-4 w-4' />
                <div>
                  <p>{format.label}</p>
                  <p className='text-xs text-muted-foreground'>{format.hint}</p>
                </div>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
