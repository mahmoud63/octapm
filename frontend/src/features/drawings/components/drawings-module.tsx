import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import { DrawingSetList } from './drawing-set-list'
import { DrawingSetReview } from './drawing-set-review'
import { SheetGrid } from './sheet-grid'
import { SheetViewer } from './sheet-viewer'

type View =
  | { kind: 'sheets' }
  | { kind: 'sets' }
  | { kind: 'sheet'; sheetId: string }
  | { kind: 'set'; setId: string }

const initialView = (target?: ProjectSetupTarget): View => {
  if (target?.recordId && target.source === 'sheet') {
    return { kind: 'sheet', sheetId: target.recordId }
  }
  if (target?.recordId && target.source === 'drawing_set') {
    return { kind: 'set', setId: target.recordId }
  }
  return { kind: 'sheets' }
}

/**
 * Drawings tool shell: the sheet register (what the site uses), the sets
 * that produced it, and the viewer / review screens. Deep links from
 * notifications arrive as `?recordId&source=sheet|drawing_set`.
 */
export function DrawingsModule({
  projectId,
  initialTarget,
  legacy,
}: {
  projectId: string
  initialTarget?: ProjectSetupTarget
  /** Legacy drawing register rows, shown collapsed under the sheet grid. */
  legacy?: ReactNode
}) {
  const [view, setView] = useState<View>(() => initialView(initialTarget))
  const [legacyOpen, setLegacyOpen] = useState(false)

  if (view.kind === 'sheet') {
    return (
      <SheetViewer
        projectId={projectId}
        sheetId={view.sheetId}
        onBack={() => setView({ kind: 'sheets' })}
      />
    )
  }
  if (view.kind === 'set') {
    return (
      <DrawingSetReview
        projectId={projectId}
        setId={view.setId}
        onBack={() => setView({ kind: 'sets' })}
        onOpenSheet={(sheetId) => setView({ kind: 'sheet', sheetId })}
      />
    )
  }

  return (
    <Tabs
      value={view.kind}
      onValueChange={(value) =>
        setView({ kind: value === 'sets' ? 'sets' : 'sheets' })
      }
      className='space-y-3'
      data-testid='uat-drawings-module'
    >
      <TabsList>
        <TabsTrigger value='sheets'>Sheets</TabsTrigger>
        <TabsTrigger value='sets'>Sets</TabsTrigger>
      </TabsList>
      <TabsContent value='sheets' className='space-y-3'>
        <SheetGrid
          projectId={projectId}
          onOpenSheet={(sheetId) => setView({ kind: 'sheet', sheetId })}
        />
        {legacy && (
          <div className='rounded-md border'>
            <Button
              type='button'
              variant='ghost'
              className='w-full justify-between'
              onClick={() => setLegacyOpen((open) => !open)}
              data-testid='uat-drawings-legacy-toggle'
            >
              <span>Drawing records (workflow register)</span>
              <ChevronDown
                className={
                  legacyOpen
                    ? 'h-4 w-4 rotate-180 transition'
                    : 'h-4 w-4 transition'
                }
              />
            </Button>
            {legacyOpen && (
              <div className='space-y-2 border-t p-3'>{legacy}</div>
            )}
          </div>
        )}
      </TabsContent>
      <TabsContent value='sets'>
        <DrawingSetList
          projectId={projectId}
          onOpenSet={(setId) => setView({ kind: 'set', setId })}
        />
      </TabsContent>
    </Tabs>
  )
}
