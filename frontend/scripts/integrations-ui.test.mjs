import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-INT-API-026 — API keys, webhooks and accounting connectors wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/integrations/hooks/use-integrations.ts')
const apiKeys = read('src/features/integrations/components/api-keys-panel.tsx')
const webhooks = read('src/features/integrations/components/webhooks-panel.tsx')
const accounting = read('src/features/integrations/components/accounting-panel.tsx')
const payAppAccounting = read('src/features/integrations/components/pay-app-accounting.tsx')
const companyPage = read('src/features/company/integrations.tsx')
const companyNav = read('src/features/company/index.tsx')
const companyRoute = read('src/routes/_authenticated/company/integrations.tsx')
const payAppDialogs = read('src/features/commercial/components/pay-app-dialogs.tsx')
const payAppsPanel = read('src/features/commercial/components/pay-apps-panel.tsx')
const policy = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))

// hooks
for (const name of [
  'useApiScopes',
  'useApiClients',
  'useCreateApiClient',
  'useRevokeApiClient',
  'useWebhooks',
  'useSaveWebhook',
  'useDeleteWebhook',
  'useRotateWebhookSecret',
  'useTestWebhook',
  'useWebhookDeliveries',
  'useRedeliverWebhook',
  'useAccountingConnections',
  'useConnectAccounting',
  'useDisconnectAccounting',
  'useAccountingAccounts',
  'useAccountingMappings',
  'useSaveAccountingMapping',
  'useAccountingSyncs',
  'useRetryAccountingSync',
  'usePollAccounting',
  'useProjectAccountingSyncs',
  'useSyncPayAppToAccounting',
  'downloadAccountingExport',
]) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /'\/integrations\/api-clients'/, 'api clients endpoint')
assert.match(hooks, /\/integrations\/webhooks\/\$\{id\}\/deliveries/, 'deliveries endpoint')
assert.match(hooks, /\/integrations\/webhooks\/deliveries\/\$\{deliveryId\}\/redeliver/, 'redeliver endpoint')
assert.match(hooks, /\/integrations\/accounting\/\$\{provider\}\/connect/, 'connect endpoint')
assert.match(hooks, /\/projects\/\$\{projectId\}\/accounting\/pay-apps\/\$\{payAppId\}\/sync/, 'pay app sync endpoint')
assert.match(hooks, /'\/integrations\/accounting\/export'/, 'company export')
assert.match(hooks, /\/projects\/\$\{projectId\}\/accounting\/export/, 'project export')

// API keys — key shown once, scopes, revoke
assert.match(apiKeys, /data-testid='uat-api-key-new'/, 'new key')
assert.match(apiKeys, /data-testid='uat-api-key-token'/, 'token revealed once')
assert.match(apiKeys, /data-testid='uat-api-scope-all-read'/, 'scope checklist')
assert.match(apiKeys, /Limit to some projects/, 'project restriction')
assert.match(apiKeys, /Revoke/, 'revoke')

// Webhooks — endpoint, events, secret, test, deliveries with redeliver
assert.match(webhooks, /data-testid='uat-webhook-url'/, 'endpoint url')
assert.match(webhooks, /data-testid='uat-webhook-events'/, 'event patterns')
assert.match(webhooks, /data-testid='uat-webhook-secret'/, 'secret shown once')
assert.match(webhooks, /data-testid='uat-webhook-test'/, 'test delivery')
assert.match(webhooks, /uat-webhook-delivery-/, 'delivery log')
assert.match(webhooks, /Redeliver/, 'redeliver')
assert.match(webhooks, /Rotate the signing secret/, 'rotate secret')

// Accounting — connect, mappings, syncs, export
assert.match(accounting, /uat-accounting-connect-\$\{connection\.provider\}/, 'connect buttons')
assert.match(accounting, /window\.open\(result\.url, '_blank', 'noopener'\)/, 'OAuth opens in a new tab')
assert.match(accounting, /Post approved pay applications automatically/, 'auto-sync switch')
assert.match(accounting, /data-testid='uat-accounting-mapping-save'/, 'cost code mapping')
assert.match(accounting, /data-testid='uat-accounting-poll'/, 'payment poll')
assert.match(accounting, /uat-accounting-export-\$\{format\}/, 'export xlsx / csv')

// Pay applications — send to accounting + status; export on the register
assert.match(payAppAccounting, /useCanPerform\(\s*'sub_pay_app',\s*'update',\s*'sub_pay_app\.accounting_sync'\s*\)/, 'accounting approver grant')
assert.match(payAppAccounting, /data-testid='uat-pay-app-send-accounting'/, 'send to accounting')
assert.match(payAppDialogs, /<PayAppAccounting[\s\S]*?payAppId=\{payApp\.id\}/, 'pay app workspace shows accounting')
assert.match(payAppsPanel, /data-testid='uat-payapp-accounting-export'/, 'export for accounting on the register')

// company page + nav + route
assert.match(companyPage, /<ApiKeysPanel \/>[\s\S]*<WebhooksPanel \/>[\s\S]*<AccountingPanel \/>/, 'three tabs')
assert.match(companyNav, /href: '\/company\/integrations'/, 'company nav')
assert.match(companyRoute, /'\/_authenticated\/company\/integrations'/, 'route')
assert.match(companyRoute, /connected/, 'OAuth return opens the accounting tab')

// permissions — accounting approver transition
assert.deepEqual(policy.modules.sub_pay_app.transitions['sub_pay_app.accounting_sync'], ['pm', 'finance'], 'accounting approver roles')

console.log('integrations-ui: ok')
