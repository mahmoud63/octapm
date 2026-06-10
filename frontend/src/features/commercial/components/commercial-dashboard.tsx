import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import { BudgetRevisionsPanel } from './budget-revisions-panel'
import { CashFlowPanel } from './cash-flow-panel'
import { ChangeOrderRegister } from './change-order-register'
import { EotPanel } from './eot-panel'
import { IpcWorkbook } from './ipc-workbook'
import { SubValuationsPanel } from './sub-valuations-panel'
import { WeatherDelaysPanel } from './weather-delays-panel'

export function CommercialDashboard({
  projectId,
  activities,
  activeTab,
  onTabChange,
  showTabList = true,
}: {
  projectId: string
  activities: ScheduleActivity[]
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
}) {
  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'change-orders' }

  return (
    <div className='space-y-3'>
      <Tabs {...tabsProps} className='space-y-3'>
        {showTabList && (
          <TabsList className='flex-wrap'>
            <TabsTrigger value='change-orders'>Change Orders</TabsTrigger>
            <TabsTrigger value='ipc'>IPC</TabsTrigger>
            <TabsTrigger value='sub-valuations'>Sub Valuations</TabsTrigger>
            <TabsTrigger value='budget-revisions'>Budget Revisions</TabsTrigger>
            <TabsTrigger value='cash-flow'>Cash Flow</TabsTrigger>
            <TabsTrigger value='eot'>EOT</TabsTrigger>
            <TabsTrigger value='weather'>Weather Delays</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='change-orders'>
          <ChangeOrderRegister projectId={projectId} activities={activities} />
        </TabsContent>

        <TabsContent value='ipc'>
          <IpcWorkbook projectId={projectId} />
        </TabsContent>

        <TabsContent value='sub-valuations'>
          <SubValuationsPanel projectId={projectId} />
        </TabsContent>

        <TabsContent value='budget-revisions'>
          <BudgetRevisionsPanel projectId={projectId} />
        </TabsContent>

        <TabsContent value='cash-flow'>
          <CashFlowPanel projectId={projectId} />
        </TabsContent>

        <TabsContent value='eot'>
          <EotPanel projectId={projectId} activities={activities} />
        </TabsContent>

        <TabsContent value='weather'>
          <WeatherDelaysPanel projectId={projectId} activities={activities} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
