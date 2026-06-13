# Performance Test Plan

Status: pending. No load or performance evidence has been run for industrial
project volumes. Frontend build still reports a large project route chunk.

## Current Evidence

| Area | Current result | Risk |
| --- | --- | --- |
| Frontend build | `npm run build --workspace=frontend` passes. Vite warns that `_projectId` is about 850 kB minified. | Field users may see slow initial project-detail loads on weak networks/devices. |
| Backend unit/API tests | Full Jest suite passes locally. | Unit tests do not prove latency or concurrency behavior. |
| BOQ/schedule import | Parser tests pass locally. | Large real files and concurrent imports are not load-tested. |
| Dashboard queries | Local functional tests pass. | Query latency under 1,000 to 5,000 activities is unknown. |

## Required Performance Scenarios

| Scenario | Minimum data volume | Tool/command | Evidence required |
| --- | --- | --- | --- |
| Project detail dashboard | 1,000 and 5,000 activities, allocations, progress rows, RFIs/submittals/documents. | k6, Artillery, or authenticated API script. | p50/p95 latency, error rate, DB CPU, screenshots/logs. |
| BOQ upload/import | Large XLSX with more than 5,000 BOQ rows and realistic sections. | UAT runner or dedicated upload script. | Job duration, memory use, retry result, generated records. |
| Schedule import | P6/XER or MSP fixture with 1,000 and 5,000 activities and dependencies. | UAT runner or dedicated import script. | Import duration, validation warnings, activation result. |
| Document register | 5,000 documents/revisions. | API load script. | Pagination latency, download/preview smoke, access-denial checks. |
| EV dashboard | Approved allocations/progress/cost loading across 5,000 activities. | API load script. | EV report latency, DB query plan notes, result reconciliation. |
| Concurrent users | 25, 50, and 100 active users across dashboard, uploads, RFI/submittal, and daily reports. | k6 or Artillery. | p95 latency, 5xx rate, rate-limit behavior, saturation point. |

## Acceptance Targets For Pilot

| Metric | Shadow pilot target | Paid/production target |
| --- | --- | --- |
| API p95 for dashboard reads | Under 2.5 seconds at pilot data volume. | Under 1.5 seconds at production volume. |
| Upload/import job completion | Completes without process restart or manual DB repair. | Durable, resumable/retriable job state. |
| 5xx rate | 0 unexpected 5xx during scripted run. | Less than 0.1% under agreed load. |
| Frontend project route | No severe UX blocker on tablet/desktop UAT devices. | Chunk split or measured acceptable field-device load time. |

## Pilot Use Rule

Without load evidence, PMcopilots must not claim industrial scale, horizontal
scale, paid production readiness, or Primavera/Procore/Aconex replacement
readiness. A controlled shadow pilot must stay within a single project, small
user group, and pre-agreed data volume until performance tests pass.
