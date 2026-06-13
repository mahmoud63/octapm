# E2E / UAT Regression Suite

Task: `TASK-P1-QA-001`

This suite provides construction workflow evidence across frontend, backend API, auth, permissions, and responsive browser smoke checks.

## Coverage

- Personas: PM, Planning Engineer, QS, Cost Controller, Procurement, Warehouse, Site Engineer, Finance.
- Core flow: auth, project setup, BOQ allocation, schedule/progress, daily report, cost, IPC certification, invoice/payment, RFI, submittal, document revision approval, NCR, safety closeout, dashboard.
- Permission negatives: anonymous request denial, same-org unassigned project denial, cross-org project denial.
- Devices: desktop, tablet, and mobile route smoke with horizontal overflow checks and screenshots, including Site Reporting, Quality NCR, and Quality Safety field tabs.
- Evidence: JSON run summary and screenshots under `docs/release-readiness-audit/evidence/`.

## Local Test Database Setup

Run the fixture seeder against an isolated test database after migrations:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pmcopilots_uat npm run test:e2e:uat:seed
```

Seeded login:

- PM: `uat.pm@pmcopilots.test`
- Site Engineer: `uat.site@pmcopilots.test`
- Password: `UatPassw0rd!`

## Run Against Local Or Staging

CI installs Playwright for the full staging run. For a local full browser run, install it in the working copy first:

```bash
npm install --no-save playwright@1.60.0
npx playwright install chromium
```

```bash
UAT_BASE_URL=https://staging.example.com \
UAT_API_BASE_URL=https://staging.example.com/api/v1 \
UAT_PM_EMAIL=uat.pm@pmcopilots.test \
UAT_PM_PASSWORD=UatPassw0rd! \
npm run test:e2e:uat -- --use-seeded-fixtures
```

For API-created disposable fixtures, omit `--use-seeded-fixtures` and `UAT_PM_EMAIL`; the runner registers a temporary PM/org and creates a project through the public API.

Use `--skip-browser` only for API-only diagnostics. Release evidence should include the browser pass.

## Offline Definition Check

```bash
npm run test:e2e:uat:validate
```

This validates persona, flow, permission, responsive, and release evidence coverage without requiring a running app.

## Evidence Review

After a full run, attach:

- The generated `TASK-P1-QA-001-uat-regression-*.json` evidence file.
- Browser screenshots from the generated `screenshots/` folder.
- Completed `docs/qa/live-uat-evidence-checklist.md` with the staging URL, commit SHA, personas, device/browser matrix, and pass/fail results.
- Completed `docs/qa/uat-signoff-template.md`.
- `docs/qa/field-device-ux-support-matrix.md` for field-device workflow signoff.
- CI/staging run URL.

QA lead signoff is still a manual release gate even when automation passes.
