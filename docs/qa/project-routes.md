# Project workspace routes (OCTA-FE-ROUTES-008)

Every project module and sub-tab is a URL, and every module is its own chunk.

## Addresses

| URL | Opens |
| --- | --- |
| `/projects/:id` | redirects to `/projects/:id/schedule/gantt` |
| `/projects/:id/:module` | a module without sub-tabs (`site-reporting`, `meetings`, `boq`, `activities`, `equipment`, `locations`, `photos`, `team`, `reports`, `overview`) |
| `/projects/:id/:module/:child` | a sub-tab: `schedule/{gantt,activities,progress,critical,ev,milestones,resources,risks,longLead,wbs,revisions}`, `cost/{overview,activity,phase,equipment,burn}`, `commercial/{change-orders,ipc,sub-valuations,budget-revisions,cash-flow,eot,weather}`, `quality/{ncr,itp,defects,safety,tests}`, `doc-control/{rfi,submittals,drawings,transmittals,correspondence}` |
| `?status=&source=&recordId=` | optional deep-link into a record or filtered list on any module URL |

Legacy links (`/projects/:id?module=docControl&child=rfi&recordId=…`) are
redirected in the project layout's `beforeLoad` (`$projectId.tsx`), so
notifications, dashboard targets and bookmarks created before this change keep
working. Unknown module slugs return the not-found page.

Slug ↔ module key mapping lives in
`frontend/src/features/projects/lib/project-modules.ts` (`MODULE_SLUGS`,
`moduleFromSlug`, `DEFAULT_CHILD`, `MODULE_PERMISSIONS`, `isModuleVisible`).

## Shell

`ProjectDetail` no longer keeps navigation state: the active module and sub-tab
are derived from the route params, menu entries are `<Link>`s, and module
components (`ScheduleDashboard`, `CostDashboard`, `DocControlDashboard`,
`BoqPage`, …) are `React.lazy` chunks rendered inside `Suspense`. The
`Overview` content moved to `project-overview.tsx`. Permission templates that
hide a module still fall back to the first visible one.

The standalone `/projects/:id/boq` page route was removed; BOQ opens inside the
workspace like every other module.

## Bundle

`vite build` now emits one chunk per module (schedule, cost, commercial,
quality, doc-control, meetings, boq, …) instead of a single ~890 kB
`$projectId` chunk; the shell chunk only carries the menu, header and setup
wizard. Check with `npm run build --workspace=frontend` and inspect
`dist/assets`.

## Manual QA

1. Open `/projects/:id` → lands on `/projects/:id/schedule/gantt`.
2. Click Quality › NCR → URL becomes `/projects/:id/quality/ncr`; reload keeps
   the tab; browser back returns to the previous module.
3. Paste an old link `/projects/:id?module=quality&child=ncr` → redirected to
   the new URL.
4. Open a module for the first time with DevTools › Network open → its chunk
   downloads on demand.
5. `/projects/:id/not-a-module` → not-found page.
