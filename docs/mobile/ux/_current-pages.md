| Route | File | lines | testID | data hooks | evidence? | width-aware? |
|---|---|---:|---|---|:-:|:-:|
| `/` | `app/(app)/index.tsx` | 261 | `screen-home` | useAuthStore useProjectStore useOutboxStatus useProjects | yes | — |
| `/+not-found` | `app/+not-found.tsx` | 15 | `—` | — | — | — |
| `/activities` | `app/(app)/activities/index.tsx` | 155 | `screen-activities` | useSplitRole useProjectStore useAuthStore useProjects | — | yes |
| `/activities/[id]` | `app/(app)/activities/[id].tsx` | 233 | `screen-activity` | useProjectStore useAuthStore usePermissions useActivity | — | yes |
| `/activities/lookahead` | `app/(app)/activities/lookahead.tsx` | 159 | `screen-lookahead` | useProjectStore usePermissions useLookaheads useLookahead | — | — |
| `/commercial` | `app/(app)/commercial/index.tsx` | 86 | `screen-commercial` | useSplitRole useProjectStore useProjects usePermissions | — | — |
| `/commercial/change-events` | `app/(app)/commercial/change-events/index.tsx` | 103 | `screen-change-events` | useSplitRole useProjectStore useProjects usePermissions | — | — |
| `/commercial/change-events/[id]` | `app/(app)/commercial/change-events/[id].tsx` | 144 | `screen-change-event` | useProjectStore useProjects useChangeEvent | — | — |
| `/commercial/change-events/new` | `app/(app)/commercial/change-events/new.tsx` | 123 | `screen-change-event-new` | useProjectStore useActivities useLocations useChangeEventActions | — | — |
| `/commercial/change-orders` | `app/(app)/commercial/change-orders/index.tsx` | 91 | `screen-change-orders` | useSplitRole useProjectStore useProjects useChangeOrders | — | — |
| `/commercial/change-orders/[id]` | `app/(app)/commercial/change-orders/[id].tsx` | 103 | `screen-change-order` | useProjectStore useProjects useChangeOrders | yes | — |
| `/commercial/commitments` | `app/(app)/commercial/commitments/index.tsx` | 74 | `screen-commitments` | useSplitRole useProjectStore useCommitments | — | — |
| `/commercial/commitments/[id]` | `app/(app)/commercial/commitments/[id].tsx` | 125 | `screen-commitment` | useProjectStore useCommitment | — | — |
| `/commercial/pay-apps` | `app/(app)/commercial/pay-apps/index.tsx` | 86 | `screen-pay-apps` | useSplitRole useProjectStore usePayApps | — | — |
| `/commercial/pay-apps/[id]` | `app/(app)/commercial/pay-apps/[id].tsx` | 183 | `screen-pay-app` | useProjectStore usePermissions usePayApp usePayAppActions | — | — |
| `/documents` | `app/(app)/documents/index.tsx` | 126 | `screen-documents` | useProjectStore useProjects useRegister | — | — |
| `/drawings` | `app/(app)/drawings/index.tsx` | 135 | `screen-drawings` | useSplitRole useProjectStore useProjects useDrawingPrefs | — | — |
| `/drawings/[id]` | `app/(app)/drawings/[id].tsx` | 169 | `screen-sheet` | useProjectStore usePermissions useSheet useSheetPins | — | — |
| `/inventory` | `app/(app)/inventory/index.tsx` | 121 | `screen-inventory` | useSplitRole useProjectStore useProjects usePermissions | — | — |
| `/inventory/items` | `app/(app)/inventory/items/index.tsx` | 96 | `screen-items` | useSplitRole useProjectStore useInventoryItems | — | — |
| `/inventory/items/[id]` | `app/(app)/inventory/items/[id].tsx` | 192 | `screen-item` | useProjectStore usePermissions useInventoryItem useItemStock | — | — |
| `/inventory/movements` | `app/(app)/inventory/movements/index.tsx` | 93 | `screen-movements` | useProjectStore useWarehouses useRememberedWarehouse useStockMovements | — | — |
| `/inventory/receive` | `app/(app)/inventory/receive/index.tsx` | 99 | `screen-goods-in` | useSplitRole useProjectStore usePurchaseOrders | — | — |
| `/inventory/receive/[id]` | `app/(app)/inventory/receive/[id].tsx` | 236 | `screen-receive` | useProjectStore usePermissions usePurchaseOrder useWarehouses | yes | — |
| `/inventory/scan` | `app/(app)/inventory/scan.tsx` | 135 | `screen-scan` | useCameraPermissions useScan | — | — |
| `/inventory/transfers` | `app/(app)/inventory/transfers/index.tsx` | 81 | `screen-transfers` | useSplitRole useProjectStore usePermissions useTransfers | — | — |
| `/inventory/transfers/[id]` | `app/(app)/inventory/transfers/[id].tsx` | 170 | `screen-transfer` | useProjectStore usePermissions useTransfers useTransferActions | — | — |
| `/inventory/transfers/new` | `app/(app)/inventory/transfers/new.tsx` | 98 | `screen-transfer-new` | useProjectStore useWarehouses useInventoryItems useRememberedWarehouse | — | — |
| `/more` | `app/(app)/more.tsx` | 99 | `screen-more` | useAuthStore useOutboxStatus | — | — |
| `/needs-you` | `app/(app)/needs-you.tsx` | 111 | `screen-needs-you` | useProjectStore useProjects useAssignments | — | — |
| `/notifications` | `app/(app)/notifications.tsx` | 186 | `screen-notifications` | useNotifications useNotificationSummary useNotificationPreferences useNotificationActions | — | — |
| `/open` | `app/(app)/open.tsx` | 72 | `screen-open` | — | — | — |
| `/outbox` | `app/(app)/outbox.tsx` | 100 | `screen-outbox` | useOutbox useOutboxStatus useProjects | yes | — |
| `/photos` | `app/(app)/photos/index.tsx` | 212 | `screen-photos` | useSplitRole useProjectStore useProjects usePermissions | yes | — |
| `/photos/[id]` | `app/(app)/photos/[id].tsx` | 138 | `screen-photo` | useProjectStore usePermissions usePhotos useUpdatePhoto | yes | — |
| `/procurement` | `app/(app)/procurement/index.tsx` | 124 | `screen-procurement` | useSplitRole useProjectStore useProjects usePermissions | — | — |
| `/procurement/long-lead` | `app/(app)/procurement/long-lead/index.tsx` | 74 | `screen-long-lead` | useProjectStore useLongLead | — | — |
| `/procurement/orders` | `app/(app)/procurement/orders/index.tsx` | 89 | `screen-orders` | useSplitRole useProjectStore useRegisterOrders | — | — |
| `/procurement/orders/[id]` | `app/(app)/procurement/orders/[id].tsx` | 129 | `screen-order` | useProjectStore usePermissions useRegisterOrder | — | — |
| `/procurement/packages` | `app/(app)/procurement/packages/index.tsx` | 78 | `screen-packages` | useSplitRole useProjectStore useProcurementOverview | — | — |
| `/procurement/packages/[id]` | `app/(app)/procurement/packages/[id].tsx` | 104 | `screen-package` | useProjectStore useProcurementOverview | — | — |
| `/projects` | `app/(app)/projects.tsx` | 99 | `screen-projects` | useProjects useWorkspace useProjectStore | — | — |
| `/quality` | `app/(app)/quality/index.tsx` | 91 | `screen-quality` | useSplitRole useProjectStore useProjects usePermissions | — | — |
| `/quality/inspections` | `app/(app)/quality/inspections/index.tsx` | 108 | `screen-inspections` | useSplitRole useProjectStore usePermissions useForms | — | — |
| `/quality/inspections/[id]` | `app/(app)/quality/inspections/[id].tsx` | 324 | `screen-inspection` | useProjectStore usePermissions useForm useFormActions | — | — |
| `/quality/inspections/new` | `app/(app)/quality/inspections/new.tsx` | 105 | `screen-inspection-new` | useProjectStore useFormTemplates useTeam useLocations | yes | — |
| `/quality/ncr` | `app/(app)/quality/ncr/index.tsx` | 120 | `screen-ncrs` | useSplitRole useProjectStore useAuthStore usePermissions | — | — |
| `/quality/ncr/[id]` | `app/(app)/quality/ncr/[id].tsx` | 137 | `screen-ncr` | useProjectStore useAuthStore usePermissions useNcrs | yes | — |
| `/quality/ncr/new` | `app/(app)/quality/ncr/new.tsx` | 91 | `screen-ncr-new` | useProjectStore useTeam useActivities useNcrActions | — | — |
| `/quality/punch` | `app/(app)/quality/punch/index.tsx` | 111 | `screen-punch` | useSplitRole useProjectStore usePermissions usePunchList | — | — |
| `/quality/punch/[id]` | `app/(app)/quality/punch/[id].tsx` | 165 | `screen-punch-item` | useProjectStore usePermissions usePunchItem usePunchActions | yes | — |
| `/quality/punch/new` | `app/(app)/quality/punch/new.tsx` | 200 | `screen-punch-new` | useProjectStore useAuthStore useTeam useLocations | yes | — |
| `/quality/safety` | `app/(app)/quality/safety/index.tsx` | 115 | `screen-safety` | useSplitRole useProjectStore useAuthStore usePermissions | — | — |
| `/quality/safety/[id]` | `app/(app)/quality/safety/[id].tsx` | 133 | `screen-safety-incident` | useProjectStore useAuthStore usePermissions useSafetyList | yes | — |
| `/quality/safety/new` | `app/(app)/quality/safety/new.tsx` | 105 | `screen-safety-new` | useProjectStore useTeam useActivities useSafetyActions | — | — |
| `/quality/tests` | `app/(app)/quality/tests/index.tsx` | 145 | `screen-tests` | useSplitRole useProjectStore usePermissions useMaterialTests | — | — |
| `/quality/tests/[id]` | `app/(app)/quality/tests/[id].tsx` | 134 | `screen-test` | useProjectStore usePermissions useMaterialTests useMaterialTestActions | — | — |
| `/rfi` | `app/(app)/rfi/index.tsx` | 124 | `screen-rfis` | useSplitRole useProjectStore useProjects usePermissions | — | — |
| `/rfi/[id]` | `app/(app)/rfi/[id].tsx` | 255 | `screen-rfi` | useProjectStore usePermissions useRfi useRfiActions | — | — |
| `/rfi/new` | `app/(app)/rfi/new.tsx` | 186 | `screen-rfi-new` | useProjectStore useAuthStore useTeam useLocations | — | — |
| `/search` | `app/(app)/search.tsx` | 99 | `screen-search` | useProjectStore useProjects useSearch | — | — |
| `/sign-in` | `app/(auth)/sign-in.tsx` | 192 | `—` | useLayout useAuthStore | — | yes |
| `/site` | `app/(app)/site/index.tsx` | 250 | `screen-daily-log` | useProjectStore useProjects usePermissions useDailyLog | yes | — |
| `/tasks` | `app/(app)/tasks/index.tsx` | 110 | `screen-tasks` | useSplitRole useProjectStore useTasks | — | — |
| `/tasks/[id]` | `app/(app)/tasks/[id].tsx` | 202 | `screen-task` | useProjectStore useTask usePermissions useTaskActions | — | — |
| `/timesheets` | `app/(app)/timesheets/index.tsx` | 98 | `screen-timesheets` | useSplitRole useProjectStore useProjects usePermissions | — | — |
| `/timesheets/[id]` | `app/(app)/timesheets/[id].tsx` | 104 | `screen-timesheet` | useProjectStore usePermissions useTimesheet useTimesheetActions | — | — |
| `/timesheets/new` | `app/(app)/timesheets/new.tsx` | 125 | `screen-timesheet-new` | useProjectStore useCrews useWorkers useActivities | yes | — |
| `/workflow` | `app/(app)/workflow/index.tsx` | 85 | `screen-workflow` | useSplitRole useProjectStore useMySteps | — | — |
| `/workflow/[id]` | `app/(app)/workflow/[id].tsx` | 214 | `screen-workflow-instance` | useProjectStore useAuthStore useWorkflowInstance useWorkflowActions | yes | — |