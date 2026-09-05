import { useSearch } from '@tanstack/react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AccountingPanel } from '@/features/integrations/components/accounting-panel'
import { ApiKeysPanel } from '@/features/integrations/components/api-keys-panel'
import { WebhooksPanel } from '@/features/integrations/components/webhooks-panel'
import { CompanySection } from './components/company-section'

/** Company integrations: API keys, webhooks and accounting connectors. */
export function CompanyIntegrations() {
  const search = useSearch({ strict: false }) as { connected?: string }
  const defaultTab = search.connected ? 'accounting' : 'api-keys'
  return (
    <CompanySection
      title='Integrations'
      description='Let other systems read and write OctaPM data with API keys, push changes to them with signed webhooks, and post approved pay applications to QuickBooks Online or Xero.'
    >
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value='api-keys'>API keys</TabsTrigger>
          <TabsTrigger value='webhooks'>Webhooks</TabsTrigger>
          <TabsTrigger value='accounting'>Accounting</TabsTrigger>
        </TabsList>
        <TabsContent value='api-keys'>
          <ApiKeysPanel />
        </TabsContent>
        <TabsContent value='webhooks'>
          <WebhooksPanel />
        </TabsContent>
        <TabsContent value='accounting'>
          <AccountingPanel />
        </TabsContent>
      </Tabs>
    </CompanySection>
  )
}
