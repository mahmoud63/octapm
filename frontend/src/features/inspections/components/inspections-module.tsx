import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import type { FormFilters } from '../hooks/use-forms'
import { InstanceCreateDialog } from './instance-create-dialog'
import { InstanceList } from './instance-list'
import { InstanceRunner } from './instance-runner'
import { TemplateList } from './template-list'

/**
 * Quality › Inspections: scheduled instances (inspections, ITPs, forms,
 * toolbox talks) and the templates behind them. `?recordId=` opens an
 * instance; the legacy ITP register stays reachable underneath.
 */
export function InspectionsModule({
  projectId,
  initialTarget,
  legacy,
}: {
  projectId: string
  initialTarget?: ProjectSetupTarget
  legacy?: ReactNode
}) {
  const canTemplateAdmin = useCanPerform(
    'inspection',
    'update',
    'inspection.template_admin'
  )
  const [tab, setTab] = useState<'instances' | 'templates'>('instances')
  const [detailId, setDetailId] = useState<string | null>(
    initialTarget?.recordId ?? null
  )
  const [create, setCreate] = useState<{
    open: boolean
    seed: number
    templateId: string | null
  }>({ open: false, seed: 0, templateId: null })
  const [showLegacy, setShowLegacy] = useState(false)

  const initialFilters: Partial<FormFilters> = {
    status:
      initialTarget?.source === 'inspection' && initialTarget.status
        ? initialTarget.status
        : undefined,
  }

  const openCreate = (templateId: string | null = null) =>
    setCreate((current) => ({ open: true, seed: current.seed + 1, templateId }))

  return (
    <div className='space-y-4' data-testid='uat-inspections-module'>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className='space-y-3'
      >
        <TabsList>
          <TabsTrigger
            value='instances'
            data-testid='uat-inspections-tab-instances'
          >
            Inspections
          </TabsTrigger>
          <TabsTrigger
            value='templates'
            data-testid='uat-inspections-tab-templates'
          >
            Templates
          </TabsTrigger>
        </TabsList>
        <TabsContent value='instances'>
          <InstanceList
            projectId={projectId}
            initialFilters={initialFilters}
            onOpen={setDetailId}
            onCreate={() => openCreate()}
          />
        </TabsContent>
        <TabsContent value='templates'>
          <TemplateList
            projectId={projectId}
            canEdit={canTemplateAdmin}
            onSchedule={(template) => openCreate(template.id)}
          />
        </TabsContent>
      </Tabs>

      <InstanceCreateDialog
        key={`create-${create.seed}`}
        projectId={projectId}
        open={create.open}
        onOpenChange={(open) => setCreate((current) => ({ ...current, open }))}
        initialTemplateId={create.templateId}
        onCreated={(instance) => setDetailId(instance.id)}
      />

      <InstanceRunner
        projectId={projectId}
        instanceId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
      />

      {legacy ? (
        <div className='rounded border border-dashed'>
          <Button
            variant='ghost'
            size='sm'
            className='w-full justify-start text-muted-foreground'
            onClick={() => setShowLegacy((value) => !value)}
            data-testid='uat-inspections-legacy-toggle'
          >
            {showLegacy ? (
              <ChevronDown className='mr-2 h-4 w-4' />
            ) : (
              <ChevronRight className='mr-2 h-4 w-4' />
            )}
            Legacy ITP register
          </Button>
          {showLegacy && (
            <div className='space-y-2 border-t p-3'>
              <p className='text-xs text-muted-foreground'>
                Existing ITP records were copied into the inspections above as
                instances of a migrated template; this register is kept for
                reference.
              </p>
              {legacy}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
