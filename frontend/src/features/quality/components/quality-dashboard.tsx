import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WorkflowRecordList } from '@/features/workflows/components/workflow-record-list'
import { handleServerError } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import {
  useCreateDefect,
  useCreateItp,
  useCreateMaterialTest,
  useCreateNcr,
  useCreateSafetyIncident,
  useDefects,
  useItps,
  useMaterialTests,
  useNcrs,
  useQualityDashboard,
  useSafetyIncidents,
} from '../hooks/use-quality'

export function QualityDashboard({
  projectId,
  activeTab,
  onTabChange,
  showTabList = true,
}: {
  projectId: string
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
}) {
  const { data: dashboard } = useQualityDashboard(projectId)
  const { data: ncrs } = useNcrs(projectId)
  const { data: itps } = useItps(projectId)
  const { data: defects } = useDefects(projectId)
  const { data: safety } = useSafetyIncidents(projectId)
  const { data: tests } = useMaterialTests(projectId)

  const createNcr = useCreateNcr(projectId)
  const createItp = useCreateItp(projectId)
  const createDefect = useCreateDefect(projectId)
  const createSafety = useCreateSafetyIncident(projectId)
  const createTest = useCreateMaterialTest(projectId)
  const canCreateNcr = useCanPerform('ncr', 'create')
  const canCreateSafety = useCanPerform('safety', 'create')

  const [ncrDescription, setNcrDescription] = useState('')
  const [itpTitle, setItpTitle] = useState('')
  const [defectTitle, setDefectTitle] = useState('')
  const [safetyTitle, setSafetyTitle] = useState('')
  const [testType, setTestType] = useState('')

  const metrics = dashboard?.metrics

  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'ncr' }

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-6'>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Quality Score</p>
          <p className='text-2xl font-bold'>{metrics?.qualityScore ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Major NCR</p>
          <p className='text-2xl font-bold'>{metrics?.majorNcrs ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Failed ITP</p>
          <p className='text-2xl font-bold'>{metrics?.failedItps ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Open Defects</p>
          <p className='text-2xl font-bold'>{metrics?.openDefects ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Safety Open</p>
          <p className='text-2xl font-bold'>{metrics?.safetyOpen ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Due Alerts</p>
          <p className='text-2xl font-bold'>{metrics?.dueAlerts ?? 0}</p>
        </div>
      </div>

      <Tabs {...tabsProps} className='space-y-3'>
        {showTabList && (
          <TabsList className='flex-wrap'>
            <TabsTrigger value='ncr'>NCR</TabsTrigger>
            <TabsTrigger value='itp'>ITP</TabsTrigger>
            <TabsTrigger value='defects'>Defects</TabsTrigger>
            <TabsTrigger value='safety'>Safety</TabsTrigger>
            <TabsTrigger value='tests'>Material Tests</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='ncr' className='space-y-2'>
          {canCreateNcr && (
            <div className='flex gap-2'>
              <Input
                placeholder='New NCR description'
                value={ncrDescription}
                onChange={(e) => setNcrDescription(e.target.value)}
              />
              <Button
                disabled={createNcr.isPending || !ncrDescription}
                onClick={async () => {
                  try {
                    await createNcr.mutateAsync({ description: ncrDescription })
                    setNcrDescription('')
                    toast.success('NCR created')
                  } catch (error) {
                    handleServerError(error)
                  }
                }}
              >
                Add
              </Button>
            </div>
          )}
          <WorkflowRecordList
            rows={ncrs?.rows}
            emptyText='No NCR records'
            getRef={(row) => row.ref}
            getTitle={(row) => row.description || 'No description'}
            getSubtitle={(row) => row.disposition}
            getStatus={(row) => row.status}
            renderMeta={(row) => (
              <div className='flex flex-wrap gap-2'>
                <Badge variant={row.severity === 'major' ? 'destructive' : 'outline'}>
                  {row.severity}
                </Badge>
              </div>
            )}
          />
        </TabsContent>

        <TabsContent value='itp' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='ITP title'
              value={itpTitle}
              onChange={(e) => setItpTitle(e.target.value)}
            />
            <Button
              disabled={createItp.isPending || !itpTitle}
              onClick={async () => {
                try {
                  await createItp.mutateAsync({ title: itpTitle })
                  setItpTitle('')
                  toast.success('ITP created')
                } catch {
                  toast.error('Failed to create ITP')
                }
              }}
            >
              Add
            </Button>
          </div>
          <WorkflowRecordList
            rows={itps?.rows}
            emptyText='No ITP records'
            getRef={(row) => row.ref}
            getTitle={(row) => row.title}
            getSubtitle={(row) => row.pointType}
            getStatus={(row) => row.status}
          />
        </TabsContent>

        <TabsContent value='defects' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Defect title'
              value={defectTitle}
              onChange={(e) => setDefectTitle(e.target.value)}
            />
            <Button
              disabled={createDefect.isPending || !defectTitle}
              onClick={async () => {
                try {
                  await createDefect.mutateAsync({ title: defectTitle })
                  setDefectTitle('')
                  toast.success('Defect created')
                } catch {
                  toast.error('Failed to create defect')
                }
              }}
            >
              Add
            </Button>
          </div>
          <WorkflowRecordList
            rows={defects?.rows}
            emptyText='No defect records'
            getRef={(row) => row.ref}
            getTitle={(row) => row.title}
            getSubtitle={(row) => row.severity}
            getStatus={(row) => row.status}
            renderMeta={(row) => (
              <div className='flex flex-wrap gap-2'>
                <Badge variant={row.severity === 'critical' ? 'destructive' : 'outline'}>
                  {row.severity}
                </Badge>
              </div>
            )}
          />
        </TabsContent>

        <TabsContent value='safety' className='space-y-2'>
          {canCreateSafety && (
            <div className='flex gap-2'>
              <Input
                placeholder='Incident title'
                value={safetyTitle}
                onChange={(e) => setSafetyTitle(e.target.value)}
              />
              <Button
                disabled={createSafety.isPending || !safetyTitle}
                onClick={async () => {
                  try {
                    await createSafety.mutateAsync({
                      title: safetyTitle,
                      incidentType: 'near_miss',
                    })
                    setSafetyTitle('')
                    toast.success('Incident logged')
                  } catch (error) {
                    handleServerError(error)
                  }
                }}
              >
                Add
              </Button>
            </div>
          )}
          <WorkflowRecordList
            rows={safety?.rows}
            emptyText='No safety incidents'
            getRef={(row) => row.ref}
            getTitle={(row) => row.title}
            getSubtitle={(row) => `${row.incidentType} / ${row.lostDays} lost days`}
            getStatus={(row) => row.status}
          />
        </TabsContent>

        <TabsContent value='tests' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Test type'
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
            />
            <Button
              disabled={createTest.isPending || !testType}
              onClick={async () => {
                try {
                  await createTest.mutateAsync({ testType })
                  setTestType('')
                  toast.success('Material test logged')
                } catch {
                  toast.error('Failed to create test')
                }
              }}
            >
              Add
            </Button>
          </div>
          <WorkflowRecordList
            rows={tests?.rows}
            emptyText='No material tests'
            getRef={(row) => row.ref}
            getTitle={(row) => row.testType}
            getStatus={(row) => row.result}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
