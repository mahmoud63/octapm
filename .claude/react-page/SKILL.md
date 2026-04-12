---
name: react-page
description: Scaffold React pages and components for PMcopilots frontend. Use when creating new module pages, dashboard widgets, data tables, forms, or charts. Uses shadcn/ui, Tailwind CSS, Recharts, TanStack Table, and Zustand.
---

# React Page Scaffolder for PMcopilots

## Tech Stack
- React 19 + TypeScript + Vite
- shadcn/ui components (copy-paste, fully owned)
- Tailwind CSS v4 for styling
- TanStack Table for all data tables
- Recharts for all charts
- Zustand for state management
- Axios for API calls

## Page Types

### 1. Data Table Page (most common — used by 40+ modules)
For registers: activities, cost records, change orders, RFIs, NCRs, procurement, etc.

```tsx
import { columns } from './columns'
import { DataTable } from '@/components/data-table'
import { useProject } from '@/hooks/use-project'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ChangeOrdersPage() {
  const { projectId } = useProject()
  const { data, isLoading } = useQuery({
    queryKey: ['change-orders', projectId],
    queryFn: () => api.get(`/projects/${projectId}/commercial/change-orders`)
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Change orders</h2>
        <Button onClick={() => setOpen(true)}>Add change order</Button>
      </div>
      <DataTable columns={columns} data={data ?? []} isLoading={isLoading} />
    </div>
  )
}
```

### 2. Dashboard Widget
For KPI cards, charts, and summary displays.

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function KpiCard({ title, value, change, trend }: KpiCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {change && (
          <p className={`text-xs ${trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
            {trend === 'up' ? '↑' : '↓'} {change}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

### 3. Chart Component
For S-curves, cost charts, EVM.

```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export function EvmChart({ data }: { data: EvmDataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="month" className="text-xs" />
        <YAxis className="text-xs" />
        <Tooltip />
        <Line type="monotone" dataKey="pv" stroke="hsl(var(--primary))" name="Planned value" />
        <Line type="monotone" dataKey="ev" stroke="hsl(var(--chart-2))" name="Earned value" />
        <Line type="monotone" dataKey="ac" stroke="hsl(var(--destructive))" name="Actual cost" />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

## Mandatory Rules
1. **All data comes from API** — never hardcode data. Use React Query or SWR to fetch from Express backend.
2. **Use shadcn/ui components** — Card, Table, Button, Dialog, Sheet, Badge, Tabs, etc. Never create custom primitives.
3. **Tailwind only** — no inline styles, no CSS modules, no styled-components.
4. **Loading states** — every data-fetching component must show a skeleton or spinner while loading.
5. **Error states** — every page must handle API errors gracefully with a user-friendly message.
6. **Responsive** — must work at 1024px minimum width (tablet on construction site).
7. **Dark mode** — use Tailwind's dark: prefix or CSS variables from shadcn theme. Never hardcode colors.

## API Client Pattern
```tsx
// src/services/api.ts
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res.data, // unwrap { success, data } envelope
  (err) => {
    if (err.response?.status === 401) {
      // redirect to login or refresh token
    }
    return Promise.reject(err.response?.data?.error || err)
  }
)

export default api
```

## Sidebar Navigation
The sidebar has 8 module groups with 50+ pages. When adding a new page:
1. Add the route in the router config
2. Add the sidebar item in the navigation config
3. Add RBAC check — each role sees only their permitted modules

## File Structure
```
src/pages/
├── dashboard/          # PM Dashboard with 7-dimension health
├── project-controls/   # Schedule, Gantt, WBS, milestones, progress, critical path
├── commercial/         # Cost control, change orders, IPC, sub valuations, cash flow, EOT
├── supply-chain/       # Procurement, long-lead, materials, warehouse, GRN
├── quality-hse/        # ITP, NCR, defects, safety
├── document-control/   # RFI, submittals, drawings, transmittals
├── site-operations/    # Diary, weather, attendance, resources
└── reports/            # Cost reports, risk register, schedule history
```
