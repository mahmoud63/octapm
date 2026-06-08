# Already Implemented Feedback Items

## FB-021: Project workspace concept and core project CRUD are present

### Why it is considered implemented

The repository includes project create/update endpoints, frontend create workflow, and project-scoped workspace/detail pages.

### Evidence

- `backend/src/routes/projects.js`, lines 36-54 and 93-104: project create/update endpoints and validation exist.
- `frontend/src/features/projects/components/project-create-dialog.tsx`, lines 61-69: create-project workflow exists.
- `frontend/src/features/projects/components/project-detail-page.tsx`: project workspace page exposes module navigation and project context.

### Minor follow-up recommendations

Expand setup metadata through FB-003 and add guided readiness through FB-015.

## FB-022: Schedule dashboard and baseline comparison direction are present

### Why it is considered implemented

The project includes Gantt, revision history, revision comparison, and baseline display/lock features.

### Evidence

- `frontend/src/features/schedule/components/gantt-chart.tsx`, lines 58-60 and 819-829: near-critical styling and baseline overlay exist.
- `frontend/src/features/schedule/components/revision-history-panel.tsx`, lines 44-53 and 228-262: revision history and compare UI exist.
- `backend/src/services/schedule.service.js`, lines 1136-1168 and 1230-1253: schedule retrieval and baseline lock services exist.

### Minor follow-up recommendations

Formal schedule approval and non-destructive revision activation remain active tasks in FB-004 and FB-006.

## FB-023: P6/MSP import direction is implemented at a usable module level

### Why it is considered implemented

The application includes backend import routes, parser modules, and frontend import UI.

### Evidence

- `backend/src/routes/import.js`, lines 33-125: import endpoints exist and are protected by PM/planning engineer roles.
- `backend/src/parsers`: parser folder exists for P6 XER, P6 XML, MSP XML, and related import logic.
- `frontend/src/features/schedule/components/import-schedule-dialog.tsx`: frontend import workflow exists.

### Minor follow-up recommendations

Structured dependency mapping and non-destructive revision import are covered by FB-005 and FB-006.

## FB-024: Seven-dimension project health dashboard logic exists

### Why it is considered implemented

The project includes a construction-specific health route and project-level health presentation.

### Evidence

- `backend/src/routes/health.js`, lines 121-229: health route calculates project health dimensions including schedule, commercial, quality, and document control.
- `frontend/src/features/projects/components/project-detail-page.tsx`: project detail page includes project module/health navigation.

### Minor follow-up recommendations

The top-level app dashboard still needs replacement of generic template metrics in FB-016.

## FB-025: Commercial module coverage exists for core concepts

### Why it is considered implemented

The repository contains commercial entities and frontend/backend modules for change orders, IPC, EOT, sub valuations, budget revisions, cash flow, and weather delays.

### Evidence

- `backend/prisma/schema.prisma`, lines 330-535: commercial models exist.
- `backend/src/services/eot.service.js`, lines 23-88: EOT computation service exists.
- `frontend/src/features/commercial`: frontend commercial module components exist.

### Minor follow-up recommendations

Traceability and workflow depth are still incomplete and tracked by FB-012.

## FB-026: Quality and document-control module coverage exists

### Why it is considered implemented

The repository includes quality/document data models and frontend module screens.

### Evidence

- `backend/prisma/schema.prisma`, lines 654-759: quality, safety, NCR, ITP, defect, and material test models exist.
- `backend/prisma/schema.prisma`, lines 766-884: RFI, submittal, drawing, transmittal, and correspondence models exist.
- `frontend/src/features/quality/components/quality-dashboard.tsx` and `frontend/src/features/doc-control/components/doc-control-dashboard.tsx`: frontend screens exist.

### Minor follow-up recommendations

Workflow maturity, attachments, due dates, and history are tracked by FB-014.
