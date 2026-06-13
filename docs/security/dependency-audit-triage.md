# Dependency Audit Triage

Status: partially remediated on 2026-06-13. No critical or high production
audit finding remains after the safe dependency updates in this evidence pass.
Two moderate production findings remain and require Security/Backend acceptance
before controlled pilot.

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `npm audit --omit=dev` | Failed before remediation | 14 vulnerabilities: 9 moderate, 5 high. |
| `npm audit` | Failed before remediation | 17 vulnerabilities: 10 moderate, 5 high, 2 critical. |
| `npm audit fix` | Applied | Non-force updates only. |
| `npm audit --omit=dev` | Failed after remediation | 3 moderate vulnerabilities remain. |
| `npm audit` | Failed after remediation | 3 moderate vulnerabilities remain. |
| `cd backend && npm audit --omit=dev` | Failed after remediation | Same 3 moderate vulnerabilities remain for EC2 backend install path. |
| `cd backend && npm audit` | Failed after remediation | Same 3 moderate vulnerabilities remain for EC2 backend install path. |

## Remediated Findings

| Package/path | Severity | Production or dev | Fix applied | Remaining risk | Blocks pilot? | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| `axios` | High | Frontend production dependency | Updated by non-force `npm audit fix`. | No matching advisory remains in post-fix audit. | No | Keep audit in release gate. |
| `esbuild` via `tsx` | High | Tooling dependency | Updated by non-force `npm audit fix`. | No matching advisory remains in post-fix audit. | No | Keep build toolchain current. |
| `tmp` | High | Transitive production dependency through Excel tooling | Updated by non-force `npm audit fix`. | No matching advisory remains in post-fix audit. | No | Keep audit in release gate. |
| `xlsx` | High | Backend production parser dependency | Replaced with `@e965/xlsx@0.20.3`; backend parser imports updated. | Compatibility covered by focused BOQ parser tests; schedule import still needs live UAT fixture evidence. | No for internal demo; live UAT still blocks pilot. | Run full UAT upload/import fixture set in staging. |
| `ws`, `engine.io`, `engine.io-client`, `socket.io-adapter` | Moderate | Backend/frontend real-time dependencies | Updated by non-force `npm audit fix`. | No matching advisory remains in post-fix audit. | No | Keep Socket.IO smoke in UAT. |
| `follow-redirects` | Moderate | Transitive HTTP dependency | Updated by non-force `npm audit fix`. | No matching advisory remains in post-fix audit. | No | Keep audit in release gate. |
| `postcss` | Moderate | Frontend build dependency | Updated by non-force `npm audit fix`. | No matching advisory remains in post-fix audit. | No | Keep frontend build green. |
| `brace-expansion` | Moderate | Dev/transitive dependency | Updated by non-force `npm audit fix`. | No matching advisory remains in post-fix audit. | No | None. |
| `shell-quote` via `concurrently` | Critical | Root dev dependency | Upgraded `concurrently` to `10.0.3`, which uses `shell-quote@1.8.4`. | Dev-only issue no longer appears in audit. | No | None. |

## Remaining Findings

| Package/path | Severity | Production or dev | Why not force-fixed now | Mitigation | Blocks pilot? | Owner / target |
| --- | --- | --- | --- | --- | --- | --- |
| `@anthropic-ai/sdk@0.88.0` | Moderate | Backend production dependency | npm's suggested fix is `@anthropic-ai/sdk@0.104.1`, outside the current `0.x` minor range and marked breaking by npm. | The app uses `messages.create`; no code path currently uses the SDK local filesystem memory tool named in the advisory. AI outputs remain review-gated and must not be source of truth. | Does not block a controlled shadow pilot if AI is review-gated and Security accepts this risk. | Backend/Security; test SDK upgrade by 2026-06-27. |
| `uuid@8.3.2` through `exceljs@4.4.0` | Moderate | Backend production export/template dependency | npm's suggested force fix downgrades `exceljs` to `3.4.0`, which is breaking and regressive for XLSX export behavior. | Current usage is server-generated workbook templates/exports. Do not pass attacker-controlled UUID buffers to ExcelJS APIs. Keep file upload parsing on `@e965/xlsx`; evaluate an ExcelJS upstream fix or replacement. | Does not block a controlled shadow pilot if exports are advisory and monitored. | Backend/Security; replacement or upstream fix decision by 2026-07-15. |

## Pilot Decision

Dependency risk no longer blocks an internal demo. It may be accepted for a
controlled shadow pilot only with explicit Security and Backend owner signoff,
AI/import/calculation review gates, and the live UAT/ops evidence required by
the pilot decision document.
